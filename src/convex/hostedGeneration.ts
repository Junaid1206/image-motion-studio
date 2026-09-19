"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Client, handle_file } from "@gradio/client";

const HF_SPACE = "alexcheng0072/wan27-free-video-generator";

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
      // Verified against the Space's current app.py: the public API accepts
      // the original aspect_ratio string and returns [video_path, seed].
      const result = await client.predict("/generate_video", {
        input_image: handle_file(sourceUrl),
        prompt: job.prompt,
        aspect_ratio: args.aspectRatio,
        duration_seconds: args.durationSeconds,
      });

      // The Space returns the video path as the first output and the seed as
      // the second output. Gradio may serialize FileData as a string path,
      // a URL, or an object.
      const output = (result.data as unknown[])[0] as
        | { url?: string; path?: string; name?: string; orig_name?: string }
        | string
        | undefined;

      const videoUrl =
        typeof output === "string"
          ? output
          : output?.url ?? output?.path;

      if (!videoUrl) {
        const rawOutput = JSON.stringify(result.data, null, 2);
        throw new Error(
          `Hugging Face returned an invalid video output. Raw output: ${rawOutput.slice(0, 1800)}`,
        );
      }

      await ctx.runMutation(internal.jobs.setJobStateInternal, {
        id: args.jobId,
        status: "processing",
        progress: 90,
        workerStatus: "Downloading generated MP4",
        eventLevel: "info",
        eventMessage: "Hosted GPU finished; downloading the generated MP4.",
      });

      const videoResponse = await fetch(videoUrl);
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
      const message = error instanceof Error ? error.message : "Hosted GPU generation failed.";
      await ctx.runMutation(internal.jobs.failHostedJobInternal, {
        id: args.jobId,
        message,
      });
      throw new Error(message);
    }
  },
});
