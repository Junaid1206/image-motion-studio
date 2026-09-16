import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { assertOwner } from "./shared";

// ---------------------------------------------------------------------------
// FAL DIRECT PROVIDER — optional legacy path for the original image→video
// composer. Requires FAL_KEY in the deployment environment; without it every
// call here fails loudly with "FAL_KEY is not configured." The default
// generation path is the Colab GPU worker (jobs.ts + worker.ts) at $0.
//
// Flow: the browser creates a "pending" videos row (videos.createJob) and
// calls startVideoGeneration; an internal action then polls the fal queue,
// downloads the finished MP4, and stores it — writing progress through
// setVideoStatusInternal. Rows carry provider:"fal" so the UI, providers.ts
// and the worker bridge can tell the two paths apart.
// ---------------------------------------------------------------------------

const FAL_BASE = "https://queue.fal.run";
const MODEL_MAX_FRAMES = 161;

function falModel(): string {
  return process.env.VIDEO_MODEL ?? "fal-ai/wan/v2.2-5b/image-to-video";
}

function falKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not configured. Add it in the Keys tab.");
  return key;
}

type QueuedRequest = {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  request_id: string;
  response_url?: string;
  status_url?: string;
  cancel_url?: string;
  queue_position?: number;
  error?: unknown;
};

type FalResult = {
  video?: { url?: string };
  video_url?: string;
  seed?: number;
  error?: unknown;
};

async function falFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${FAL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Key ${falKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

// Start a fal image→video generation for an existing pending videos row.
// (The row is created by videos.createJob; ownership is enforced here.)
export const startVideoGeneration = action({
  args: {
    videoId: v.id("videos"),
    prompt: v.string(),
    negativePrompt: v.optional(v.string()),
    durationSeconds: v.number(),
    aspectRatio: v.string(),
    sourceImageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    // Auth (an action ctx has no requireUserId-compatible ctx): the caller
    // must be signed in and must own the pending video row.
    const user = (await ctx.runQuery(api.users.currentUser, {})) as
      | { _id: string }
      | null;
    if (!user) throw new Error("Sign in required.");

    const video = (await ctx.runQuery(internal.videos.getVideoInternal, {
      id: args.videoId,
    })) as { userId: string } | null;
    const row = assertOwner(video, "Video");
    if (row.userId !== user._id) throw new Error("Video not found.");

    const imageUrl = (await ctx.runQuery(internal.videos.getStorageUrlInternal, {
      storageId: args.sourceImageId,
    })) as string | null;
    if (!imageUrl) throw new Error("Source image is no longer available in storage.");

    // Resolution box for the model (shorter side snapped to a multiple of 16).
    const width = args.aspectRatio === "9:16" ? 480 : 832;
    const height = args.aspectRatio === "9:16" ? 832 : 480;

    const res = await fetch(`${FAL_BASE}/${falModel()}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: args.prompt,
        negative_prompt: args.negativePrompt || undefined,
        image_url: imageUrl,
        num_frames: Math.min(MODEL_MAX_FRAMES, args.durationSeconds * 16),
        ...(args.aspectRatio === "1:1" ? { width: 480, height: 480 } : {}),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`fal.ai request failed (${res.status}): ${text.slice(0, 300)}`);
    }

    const queued = (await res.json()) as QueuedRequest;

    await ctx.runMutation(internal.videos.setVideoStatusInternal, {
      id: args.videoId,
      status: "processing",
      providerJobId: queued.request_id,
    });

    // Schedule the poller (runAfter takes milliseconds). The row's status
    // stays truthful the whole time: processing → completed/failed.
    await ctx.scheduler.runAfter(0, internal.generation.pollVideoStatus, {
      videoId: args.videoId,
      requestId: queued.request_id,
      attempt: 0,
    });

    return { requestId: queued.request_id };
  },
});

// Poll the fal queue until the render finishes, then store the MP4.
export const pollVideoStatus = internalAction({
  args: {
    videoId: v.id("videos"),
    requestId: v.string(),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    const video = (await ctx.runQuery(internal.videos.getVideoInternal, {
      id: args.videoId,
    })) as { _id: typeof args.videoId; status: string } | null;
    if (!video) return;
    if (video.status !== "processing") return; // cancelled or already terminal

    let status: QueuedRequest | null = null;
    try {
      const res = await falFetch(`/${falModel()}/requests/${args.requestId}/status`);
      if (!res.ok) throw new Error(`fal.ai status check failed (${res.status}).`);
      status = (await res.json()) as QueuedRequest;
    } catch (err) {
      await ctx.runMutation(internal.videos.setVideoStatusInternal, {
        id: args.videoId,
        status: "failed",
        errorMessage: err instanceof Error ? err.message : "fal.ai status check failed.",
      });
      return;
    }

    if (status && status.status === "COMPLETED") {
      try {
        const res = await falFetch(`/${falModel()}/requests/${args.requestId}`);
        if (!res.ok) throw new Error(`fal.ai result fetch failed (${res.status}).`);
        const result = (await res.json()) as FalResult;
        const videoUrl = result.video?.url ?? result.video_url;
        if (!videoUrl) throw new Error("fal.ai returned no video URL.");

        // Download the MP4 and deposit it into Convex storage so the clip
        // survives fal's temporary result URLs.
        const mp4 = await fetch(videoUrl);
        if (!mp4.ok) throw new Error(`MP4 download failed (${mp4.status}).`);
        const bytes = new Uint8Array(await mp4.arrayBuffer());
        const uploadUrl = await ctx.storage.generateUploadUrl();
        const put = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "video/mp4" },
          body: bytes,
        });
        if (!put.ok) throw new Error(`Storage upload failed (${put.status}).`);
        const { storageId } = (await put.json()) as { storageId: string };

        await ctx.runMutation(internal.videos.setVideoStorageInternal, {
          id: args.videoId,
          videoStorageId: storageId as never,
        });
        await ctx.runMutation(internal.videos.setVideoStatusInternal, {
          id: args.videoId,
          status: "completed",
          videoUrl,
          seed: typeof result.seed === "number" ? result.seed : undefined,
        });
        return;
      } catch (err) {
        await ctx.runMutation(internal.videos.setVideoStatusInternal, {
          id: args.videoId,
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "fal.ai result handling failed.",
        });
        return;
      }
    }

    // Still queued or in progress — reschedule unless we've waited too long
    // (25 s × 60 attempts = 25 minutes cap).
    if (args.attempt >= 60) {
      await ctx.runMutation(internal.videos.setVideoStatusInternal, {
        id: args.videoId,
        status: "failed",
        errorMessage: "fal.ai generation timed out after 25 minutes.",
      });
      return;
    }

    await ctx.scheduler.runAfter(25_000, internal.generation.pollVideoStatus, {
      videoId: args.videoId,
      requestId: args.requestId,
      attempt: args.attempt + 1,
    });
  },
});
