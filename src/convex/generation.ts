"use node";

// ---------------------------------------------------------------------------
// Image-to-video generation actions (node runtime for fetch + polling).
//
// Flow:
//   1. submitGeneration  — uploads context + submits to the fal.ai queue
//   2. pollGeneration    — short status check, safe to call repeatedly
//   3. cancelGeneration  — best-effort remote cancel + local fail
//
// The DB is the source of truth, so polling resumes across reloads.
// Provider is swappable via env (VIDEO_MODEL, FAL_QUEUE_BASE_URL).
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

// Explicit annotation breaks circular type inference between this module
// and the generated api types (TS7022/TS7023 otherwise).
type VideoJob = Doc<"videos">;

const FALLBACK_MODEL = "fal-ai/wan/v2.2-5b/image-to-video";
const FALLBACK_NEGATIVE_PROMPT =
  "deformed, distorted, extra limbs, extra fingers, morphing, warping, flickering, glitch, artifacts, scene change, background change, low quality";

function getModelId(): string {
  return process.env.VIDEO_MODEL ?? FALLBACK_MODEL;
}

function getNegativePrompt(): string {
  return process.env.VIDEO_NEGATIVE_PROMPT ?? FALLBACK_NEGATIVE_PROMPT;
}

// ---------------------------------------------------------------------------
// fal.ai queue API (plain fetch)
// ---------------------------------------------------------------------------

const FAL_QUEUE_BASE =
  process.env.FAL_QUEUE_BASE_URL ?? "https://queue.fal.run";

function falHeaders(): HeadersInit {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error(
      "FAL_KEY is not configured. Add your fal.ai API key in the project's Keys / API keys tab (env var: FAL_KEY).",
    );
  }
  return { Authorization: `Key ${key}`, "Content-Type": "application/json" };
}

async function falFetch(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${FAL_QUEUE_BASE}${path}`, {
    ...init,
    headers: { ...falHeaders(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Provider request failed (${res.status}): ${text.slice(0, 400)}`,
    );
  }
  return (await res.json()) as unknown;
}

interface FalSubmitResponse {
  request_id?: string;
}

interface FalStatusResponse {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  queue_position?: number;
}

interface FalVideoFile {
  url?: string;
  file_name?: string;
  content_type?: string;
}

interface FalResultResponse {
  video?: FalVideoFile;
  seed?: number;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

// Submit the job to the provider queue. Fast — returns as soon as the
// queue accepts the request.
export const submitGeneration = action({
  args: { jobId: v.id("videos") },
  handler: async (ctx, args) => {
    const job: VideoJob = await ctx.runQuery(internal.videos.getJobForUser, {
      jobId: args.jobId,
    });
    if (job.providerJobId) {
      return { providerJobId: job.providerJobId }; // idempotent re-submit
    }
    if (job.status !== "pending") {
      throw new Error(`Job is already ${job.status}.`);
    }

    const model = job.model || getModelId();
    const maxFrames = Number(process.env.VIDEO_MAX_FRAMES ?? 161);

    try {
      const imageUrl = job.sourceImageId
        ? await ctx.storage.getUrl(job.sourceImageId)
        : null;
      if (!imageUrl) throw new Error("Source image is no longer available.");

      // Duration → frames (WAN: frame-driven at 24fps, bounded by model max).
      const fps = 24;
      const requested = job.durationSeconds ?? 5;
      const rawFrames = Math.round(requested * fps);
      const numFrames = Math.min(Math.max(rawFrames, 17), maxFrames);

      const submitBody: Record<string, unknown> = {
        image_url: imageUrl,
        prompt: job.prompt,
        negative_prompt: job.negativePrompt ?? getNegativePrompt(),
        num_frames: numFrames,
        frames_per_second: fps,
        resolution: "720p",
        aspect_ratio: job.aspectRatio,
        num_inference_steps: 40,
        enable_prompt_expansion: false,
        enable_safety_checker: true,
        enable_output_safety_checker: true,
      };

      const submitted = (await falFetch(`/${model}`, {
        method: "POST",
        body: JSON.stringify(submitBody),
      })) as FalSubmitResponse;

      if (!submitted?.request_id) {
        throw new Error("Provider did not return a request id.");
      }

      await ctx.runMutation(internal.videos.setJobSubmitted, {
        id: args.jobId,
        providerJobId: submitted.request_id,
      });

      return { providerJobId: submitted.request_id };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown submission error.";
      await ctx.runMutation(internal.videos.setJobFailedInternal, {
        id: args.jobId,
        errorMessage: message,
      });
      throw err;
    }
  },
});

// Short status check. The client calls this on an interval while a job is
// pending/processing; the DB stays authoritative so status survives reloads.
export const pollGeneration = action({
  args: { jobId: v.id("videos") },
  handler: async (ctx, args) => {
    const job: VideoJob = await ctx.runQuery(internal.videos.getJobForUser, {
      jobId: args.jobId,
    });
    if (job.status !== "processing" || !job.providerJobId) {
      return { status: job.status }; // nothing to poll
    }

    const model = job.model;
    try {
      const status = (await falFetch(
        `/${model}/requests/${job.providerJobId}/status`,
      )) as FalStatusResponse;

      if (status.status === "COMPLETED") {
        const result = (await falFetch(
          `/${model}/requests/${job.providerJobId}`,
        )) as FalResultResponse;
        const videoUrl = result?.video?.url;
        if (!videoUrl) {
          throw new Error(
            "Generation finished but the provider returned no video file.",
          );
        }
        await ctx.runMutation(internal.videos.setJobCompleted, {
          id: args.jobId,
          videoUrl,
          seed: result.seed,
        });
        return { status: "completed" as const };
      }

      return {
        status: status.status === "IN_PROGRESS" ? "processing" : "queued",
        queuePosition: status.queue_position,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Polling error.";
      // Distinguish transient network errors from hard provider errors.
      const transient =
        /failed to fetch|networkerror|timeout|temporarily|econn/i.test(message);
      if (!transient) {
        await ctx.runMutation(internal.videos.setJobFailedInternal, {
          id: args.jobId,
          errorMessage: message,
        });
      }
      throw err;
    }
  },
});

export const cancelGeneration = action({
  args: { jobId: v.id("videos") },
  handler: async (ctx, args) => {
    const job: VideoJob = await ctx.runQuery(internal.videos.getJobForUser, {
      jobId: args.jobId,
    });
    if (job.status !== "pending" && job.status !== "processing") {
      throw new Error("Only pending or processing jobs can be cancelled.");
    }

    if (job.providerJobId) {
      try {
        await fetch(
          `${FAL_QUEUE_BASE}/${job.model}/requests/${job.providerJobId}/cancel`,
          { method: "PUT", headers: falHeaders() },
        );
      } catch {
        // Best-effort: remote cancel failure must not block local cleanup.
      }
    }

    await ctx.runMutation(internal.videos.setJobFailedInternal, {
      id: args.jobId,
      errorMessage: "Cancelled by user.",
    });
  },
});
