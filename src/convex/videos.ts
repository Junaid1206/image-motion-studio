import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

// ---------------------------------------------------------------------------
// Video job queries & mutations (no node runtime needed).
// Generation actions live in generation.ts ("use node").
// ---------------------------------------------------------------------------

const ALLOWED_DURATIONS = [5, 10, 15, 25];
const ALLOWED_ASPECT_RATIOS = ["9:16", "16:9", "1:1"];

const FALLBACK_MODEL = "fal-ai/wan/v2.2-5b/image-to-video";
const FALLBACK_NEGATIVE_PROMPT =
  "deformed, distorted, extra limbs, extra fingers, morphing, warping, flickering, glitch, artifacts, scene change, background change, low quality";

function getModelId(): string {
  return process.env.VIDEO_MODEL ?? FALLBACK_MODEL;
}

function getNegativePrompt(): string {
  return process.env.VIDEO_NEGATIVE_PROMPT ?? FALLBACK_NEGATIVE_PROMPT;
}

// Live list of the signed-in user's generations (history + status).
export const listMyVideos = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("videos")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
  },
});

// Which model/provider is configured (surfaced in the UI so nothing is hidden).
export const getModelConfig = query({
  args: {},
  handler: async () => {
    const maxFrames = Number(process.env.VIDEO_MAX_FRAMES ?? 161);
    return {
      provider: "fal",
      model: getModelId(),
      keyConfigured: !!process.env.FAL_KEY,
      negativePrompt: getNegativePrompt(),
      maxDurationSeconds: Math.floor((maxFrames / 24) * 10) / 10,
    };
  },
});

// HTTP upload URL so the browser can POST the source image straight
// into Convex file storage.
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in required.");
    return await ctx.storage.generateUploadUrl();
  },
});

// Short-lived URL for showing the uploaded source image.
export const getSourceImageUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});

export const createJob = mutation({
  args: {
    prompt: v.string(),
    negativePrompt: v.optional(v.string()),
    durationSeconds: v.number(),
    aspectRatio: v.string(),
    sourceImageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in required.");

    if (!args.prompt.trim()) throw new Error("Motion prompt is required.");
    if (args.prompt.length > 2000) {
      throw new Error("Motion prompt is too long (2000 character limit).");
    }
    if (!ALLOWED_DURATIONS.includes(args.durationSeconds)) {
      throw new Error("Duration must be 5, 10, 15 or 25 seconds.");
    }
    if (!ALLOWED_ASPECT_RATIOS.includes(args.aspectRatio)) {
      throw new Error("Aspect ratio must be 9:16, 16:9 or 1:1.");
    }
    const image = await ctx.db.system.get(args.sourceImageId);
    if (!image) throw new Error("Uploaded image not found. Upload it again.");

    const now = Date.now();
    return await ctx.db.insert("videos", {
      userId,
      prompt: args.prompt.trim(),
      negativePrompt: args.negativePrompt?.trim() || undefined,
      durationSeconds: args.durationSeconds,
      aspectRatio: args.aspectRatio,
      sourceImageId: args.sourceImageId,
      provider: "fal",
      model: getModelId(),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Client-driven failure marking (e.g. user gave up after repeated errors).
export const markFailed = mutation({
  args: { id: v.id("videos"), errorMessage: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in required.");
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== userId) throw new Error("Job not found.");
    if (row.status === "completed") return; // never overwrite a real result
    await ctx.db.patch(args.id, {
      status: "failed",
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    });
  },
});

export const removeVideo = mutation({
  args: { id: v.id("videos") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in required.");
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== userId) throw new Error("Job not found.");
    if (row.sourceImageId) {
      await ctx.storage.delete(row.sourceImageId);
    }
    await ctx.db.delete(args.id);
  },
});

// ---------------------------------------------------------------------------
// Internal functions used by the generation actions in generation.ts.
// (Actions cannot touch the database directly, and "use node" files may
// only define actions — so these live here.)
// ---------------------------------------------------------------------------

export const getJobForUser = internalQuery({
  args: { jobId: v.id("videos") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in required.");
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) throw new Error("Job not found.");
    return job;
  },
});

export const setJobSubmitted = internalMutation({
  args: { id: v.id("videos"), providerJobId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "processing",
      providerJobId: args.providerJobId,
      updatedAt: Date.now(),
    });
  },
});

export const setJobCompleted = internalMutation({
  args: {
    id: v.id("videos"),
    videoUrl: v.string(),
    seed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "completed",
      videoUrl: args.videoUrl,
      seed: args.seed,
      updatedAt: Date.now(),
    });
  },
});

export const setJobFailedInternal = internalMutation({
  args: { id: v.id("videos"), errorMessage: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "failed",
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    });
  },
});
