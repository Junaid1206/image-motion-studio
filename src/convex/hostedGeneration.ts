"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Client, handle_file } from "@gradio/client";

const HF_SPACE = "alexcheng0072/wan27-free-video-generator";

// The Space's app.py rejects prompts longer than this (MAX_PROMPT_LENGTH).
const HF_MAX_PROMPT_CHARS = 600;

// @gradio/client rejects with plain status objects (not Error instances) for
// queue / ZeroGPU-quota / gr.Error failures, so `instanceof Error` alone would
// hide the real cause. Normalise everything into a readable string.
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    const parts = [e.title, e.message, e.detail]
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    if (parts.length > 0) return parts.join(": ");
    try {
      return JSON.stringify(error).slice(0, 800);
    } catch {
      /* fall through */
    }
  }
  return "Hosted GPU generation failed.";
}

export const generate = action({
  args: {
    jobId: v.id("jobs"),
    aspectRatio: v.string(),
    durationSeconds: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in required.");

    const job = await ctx.runQuery(internal.jobs.getJobInternal, {
      jobId: args.jobId,
    });
    if (!job || job.userId !== userId) throw new Error("Job not found.");
    if (!job.inputImageId) throw new Error("Source image not found.");
    if (job.status === "cancelled") throw new Error("Generation cancelled.");

    if (!["832x480", "480x832", "640x640"].includes(args.aspectRatio)) {
      throw new Error("Invalid aspect ratio.");
    }
    if (![2, 3, 5].includes(args.durationSeconds)) {
      throw new Error("Invalid duration.");
    }

    if (job.prompt.length > HF_MAX_PROMPT_CHARS) {
      throw new Error(
        `Prompt is too long for the hosted GPU (${job.prompt.length}/${HF_MAX_PROMPT_CHARS} characters). Shorten it and try again.`,
      );
    }

    const hfToken = process.env.HF_TOKEN;
    if (!hfToken) {
      throw new Error("Hosted GPU is not configured yet. Add HF_TOKEN to the Convex deployment.");
    }

    const sourceUrl = await ctx.runQuery(internal.videos.getStorageUrlInternal, {
      storageId: job.inputImageId,
    });
    if (!sourceUrl) throw new Error("Source image URL could not be created.");

    const client = await Client.connect(HF_SPACE, {
      hf_token: hfToken as `hf_${string}`,
    });

    await ctx.runMutation(internal.jobs.setJobStateInternal, {
      id: args.jobId,
      status: "generating",
      progress: 10,
      workerStatus: "Hosted GPU authenticated",
      eventLevel: "info",
      eventMessage: "Authenticated with Hugging Face and queued generation.",
    });

    try {
      // The Space (app.py, api_name="generate_video") takes exactly:
      //   input_image, prompt, aspect_ratio ("832x480" | "480x832" | "640x640"),
      //   duration_seconds (2-5)
      // and returns [video FileData, seed]. Steps / guidance / negative prompt /
      // seed are fixed inside the Space, so they must NOT be sent —
      // @gradio/client throws on unknown keyword arguments.
      const result = await client.predict("/generate_video", {
        input_image: handle_file(sourceUrl),
        prompt: job.prompt,
        aspect_ratio: args.aspectRatio,
        duration_seconds: args.durationSeconds,
      });

      const output = (result.data as unknown[])[0] as
        | { url?: string; path?: string; name?: string }
        | string
        | undefined;

      // Gradio normally returns a remote URL. Keep path/name as fallbacks
      // because FileData shape can vary between Gradio versions.
      const videoUrl =
        typeof output === "string"
          ? output
          : output?.url ?? output?.path ?? output?.name;

      if (!videoUrl) {
        const rawOutput = JSON.stringify(result.data, null, 2);
        throw new Error(
          `Hugging Face completed generation but returned an unexpected video output: ${rawOutput.slice(0, 1800)}`,
        );
      }

      const latest = await ctx.runQuery(internal.jobs.getJobInternal, {
        jobId: args.jobId,
      });
      if (!latest || latest.status === "cancelled") {
        throw new Error("Generation cancelled.");
      }

      await ctx.runMutation(internal.jobs.setJobStateInternal, {
        id: args.jobId,
        status: "processing",
        progress: 90,
        workerStatus: "Downloading generated MP4",
        eventLevel: "info",
        eventMessage: "Hosted GPU finished; downloading the generated MP4.",
      });

      const videoHost = new URL(videoUrl).hostname;
      const isHfHost =
        videoHost.endsWith(".hf.space") || videoHost.endsWith("huggingface.co");
      const videoResponse = await fetch(
        videoUrl,
        isHfHost ? { headers: { Authorization: `Bearer ${hfToken}` } } : undefined,
      );
      if (!videoResponse.ok) {
        throw new Error(`Generated video download failed (${videoResponse.status}).`);
      }

      const videoBlob = await videoResponse.blob();
      const videoStorageId = await ctx.storage.store(videoBlob);

      await ctx.runMutation(internal.videos.completeHostedJobInternal, {
        jobId: args.jobId,
        videoStorageId,
      });

      return { ok: true };
    } catch (error) {
      const message = describeError(error);
      await ctx.runMutation(internal.jobs.failHostedJobInternal, {
        id: args.jobId,
        message,
      });
      throw new Error(message);
    }
  },
});
