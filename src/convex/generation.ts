"use node";

// ---------------------------------------------------------------------------
// OPTIONAL DIRECT PROVIDER — fal.ai queue adapter ("fal" provider).
//
// The default provider in this studio is the personal GPU worker (Google
// Colab, $0 — see jobs.ts + worker.ts). This module keeps the earlier
// fal.ai direct path working as an explicitly OPTIONAL alternative: it is
// only used when the user has set FAL_KEY, and the UI labels it as costing
// money. Provider selection stays swappable via environment variables:
//   FAL_KEY                enables this provider (optional)
//   VIDEO_MODEL            fal model id (default: wan 2.2 5b i2v)
//   VIDEO_NEGATIVE_PROMPT  default negative prompt
//   FAL_QUEUE_BASE_URL     queue base (default https://queue.fal.run)
//
// No fake success paths: any provider error marks the job failed verbatim.
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
      "FAL_KEY is not configured. This provider is optional — add a fal.ai API key in the project's Keys / API keys tab, or use the default GPU worker instead.",
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
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      detail = res.statusText;
    }
    throw new Error(
      `fal.ai request failed (${res.status}): ${detail || res.statusText}`,
    );
  }
  return (await res.json()) as unknown;
}

// ---------------------------------------------------------------------------
// Actions — called by the legacy composer UI. Jobs live in the videos table
// (providerJobId = fal request_id), matching the original flow.
// ---------------------------------------------------------------------------

// Submit an image-to-video job to fal.ai and mark the job "processing".
export const submitGeneration = action({
  args: { jobId: v.id("videos") },
  handler: async (ctx, args) => {
    const job: VideoJob | null = await ctx.runQuery(
      internal.videos.getVideoInternal,
      { id: args.jobId },
    );
    if (!job) throw new Error("Job not found.");
    if (job.status !== "pending")
      throw new Error(`Job is not pending (current status: ${job.status}).`);
    if (!job.sourceImageId)
      throw new Error("Job has no source image.");

    const imageUrl = await ctx.runQuery(internal.videos.getStorageUrlInternal, {
      storageId: job.sourceImageId,
    });
    if (!imageUrl) throw new Error("Source image URL unavailable.");

    // Mark processing before the network call so the UI sees the truth even
    // if the submit fails and we immediately mark failed below.
    await ctx.runMutation(internal.videos.setVideoStatusInternal, {
      id: job._id,
      status: "processing",
    });

    try {
      const submitted = (await falFetch(`/${getModelId()}`, {
        method: "POST",
        body: JSON.stringify({
          prompt: job.prompt,
          negative_prompt: getNegativePrompt(),
          image_url: imageUrl,
          // enable_prompt_expansion off → the user's exact words reach the model
          enable_prompt_expansion: false,
        }),
      })) as { request_id?: string; status?: string };

      if (!submitted?.request_id) {
        throw new Error(
          "fal.ai did not return a request_id — unexpected response from the queue.",
        );
      }

      await ctx.runMutation(internal.videos.setVideoStatusInternal, {
        id: job._id,
        status: "processing",
        providerJobId: submitted.request_id,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "fal.ai submission failed.";
      await ctx.runMutation(internal.videos.setVideoStatusInternal, {
        id: job._id,
        status: "failed",
        errorMessage: message.slice(0, 400),
      });
      throw err;
    }
  },
});

// One short poll — safe to call repeatedly from the client.
export const pollGeneration = action({
  args: { jobId: v.id("videos") },
  handler: async (ctx, args) => {
    const job: VideoJob | null = await ctx.runQuery(
      internal.videos.getVideoInternal,
      { id: args.jobId },
    );
    if (!job) throw new Error("Job not found.");
    if (job.status !== "processing" || !job.providerJobId) return;

    try {
      const status = (await falFetch(
        `/${getModelId()}/requests/${job.providerJobId}/status`,
      )) as { status?: string; queue_position?: number };

      if (status?.status === "COMPLETED") {
        const result = (await falFetch(
          `/${getModelId()}/requests/${job.providerJobId}`,
        )) as { video?: { url?: string }; video_url?: string };
        const videoUrl = result?.video?.url ?? result?.video_url;
        if (!videoUrl) {
          throw new Error(
            "Generation finished but the provider returned no video URL.",
          );
        }
        await ctx.runMutation(internal.videos.setVideoStatusInternal, {
          id: job._id,
          status: "completed",
          videoUrl,
          seed: undefined,
        });
      } else if (status?.status === "IN_QUEUE" || status?.status === "IN_PROGRESS") {
        // Still working — nothing to persist; the row stays "processing".
      } else if (status?.status && !["OK"].includes(status.status)) {
        throw new Error(`Unexpected provider status: ${status.status}`);
      }
    } catch (err) {
      // Transient network errors must not kill an in-flight render.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("fal.ai request failed")) {
        await ctx.runMutation(internal.videos.setVideoStatusInternal, {
          id: job._id,
          status: "failed",
          errorMessage: message.slice(0, 400),
        });
        return;
      }
      // Otherwise swallow: next poll retries.
    }
  },
});

// Best-effort remote cancel + local failure marker.
export const cancelGeneration = action({
  args: { jobId: v.id("videos") },
  handler: async (ctx, args) => {
    const job: VideoJob | null = await ctx.runQuery(
      internal.videos.getVideoInternal,
      { id: args.jobId },
    );
    if (!job) throw new Error("Job not found.");
    if (job.providerJobId) {
      try {
        await falFetch(`/${getModelId()}/requests/${job.providerJobId}/cancel`, {
          method: "PUT",
        });
      } catch {
        // Remote cancel is best-effort; the local state is still corrected.
      }
    }
    if (job.status === "pending" || job.status === "processing") {
      await ctx.runMutation(internal.videos.setVideoStatusInternal, {
        id: job._id,
        status: "failed",
        errorMessage: "Cancelled by user.",
      });
    }
  },
});
