import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
  requireUserId,
  assertOwner,
  MODELS,
  ALLOWED_DURATIONS,
  ALLOWED_ASPECT_RATIOS,
  ALLOWED_RESOLUTIONS,
} from "./shared";

// ---------------------------------------------------------------------------
// VIDEO LIBRARY — every finished clip lives here. Nothing is ever deleted
// automatically; removal is always an explicit user action (which also
// deletes the stored media).
//
// Two provider paths feed this table:
//   • "worker" (default, $0): jobs.ts + worker.ts — Google Colab GPU worker
//   • "fal"   (optional):     generation.ts — direct fal.ai queue (costs money)
// The legacy image-to-video composer writes rows directly here with
// status pending → processing → completed/failed.
// ---------------------------------------------------------------------------

// Live list of the signed-in user's library.
export const listMyVideos = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("videos")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);
  },
});

export const getVideo = query({
  args: { id: v.id("videos") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = assertOwner(await ctx.db.get(args.id), "Video");
    if (row.userId !== userId) throw new Error("Video not found.");
    return row;
  },
});

// Short-lived URL for a stored video or image.
export const getStorageUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});

// Studio-wide config for the UI: models, limits, worker + key presence.
export const getStudioConfig = query({
  args: {},
  handler: async (ctx) => {
    const worker = await ctx.db.query("workerState").first();
    const tokenRow = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "worker_token_hash"))
      .first();
    return {
      models: MODELS,
      durations: ALLOWED_DURATIONS,
      aspectRatios: ALLOWED_ASPECT_RATIOS,
      resolutions: ALLOWED_RESOLUTIONS,
      worker: worker ?? null,
      workerTokenIssued: !!tokenRow,
    };
  },
});

// Legacy model config for the original composer (fal provider status).
// VIDEO_MAX_FRAMES caps the model's max clip length (~161 frames ≈ 6.7s
// for WAN 2.2 5B); only durations that fit the cap are enabled in the UI.
export const getModelConfig = query({
  args: {},
  handler: async () => {
    const maxFrames = Number(process.env.VIDEO_MAX_FRAMES ?? 161);
    const fps = 24;
    return {
      model: process.env.VIDEO_MODEL ?? "fal-ai/wan/v2.2-5b/image-to-video",
      keyConfigured: !!process.env.FAL_KEY,
      maxDurationSeconds: Math.floor((maxFrames / fps) * 100) / 100,
    };
  },
});

// ---------------------------------------------------------------------------
// HTTP upload URL so the browser can POST source images straight into
// Convex file storage.
// ---------------------------------------------------------------------------
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// ---------------------------------------------------------------------------
// Library organization actions.
// ---------------------------------------------------------------------------

export const setVideoTitle = mutation({
  args: { id: v.id("videos"), title: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = assertOwner(await ctx.db.get(args.id), "Video");
    if (row.userId !== userId) throw new Error("Video not found.");
    await ctx.db.patch(args.id, {
      title: args.title.trim().slice(0, 120) || undefined,
      updatedAt: Date.now(),
    });
  },
});

export const setVideoTags = mutation({
  args: { id: v.id("videos"), tags: v.array(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = assertOwner(await ctx.db.get(args.id), "Video");
    if (row.userId !== userId) throw new Error("Video not found.");
    await ctx.db.patch(args.id, {
      tags: args.tags.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12),
      updatedAt: Date.now(),
    });
  },
});

export const setVideoFavorite = mutation({
  args: { id: v.id("videos"), favorite: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = assertOwner(await ctx.db.get(args.id), "Video");
    if (row.userId !== userId) throw new Error("Video not found.");
    await ctx.db.patch(args.id, { favorite: args.favorite, updatedAt: Date.now() });
  },
});

// Explicit user delete: removes the row AND the stored media (single copy).
export const deleteVideo = mutation({
  args: { id: v.id("videos") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = assertOwner(await ctx.db.get(args.id), "Video");
    if (row.userId !== userId) throw new Error("Video not found.");

    // Any dataset entries pointing at this video are removed too (metadata
    // only — they reference the same storage object, never a copy).
    const entries = await ctx.db
      .query("datasetEntries")
      .withIndex("by_video", (q) => q.eq("videoId", args.id))
      .collect();
    for (const e of entries) {
      if (e.frameStorageIds) {
        for (const fid of e.frameStorageIds) await ctx.storage.delete(fid);
      }
      await ctx.db.delete(e._id);
    }

    if (row.videoStorageId) await ctx.storage.delete(row.videoStorageId);
    if (row.thumbnailStorageId) await ctx.storage.delete(row.thumbnailStorageId);
    if (row.sourceImageId) await ctx.storage.delete(row.sourceImageId);
    await ctx.db.delete(args.id);
  },
});

// ---------------------------------------------------------------------------
// Legacy composer flow (fal direct provider — OPTIONAL, requires FAL_KEY).
// Kept so the original image-to-video workflow continues to work unchanged.
// ---------------------------------------------------------------------------

export const createJob = mutation({
  args: {
    prompt: v.string(),
    durationSeconds: v.number(),
    aspectRatio: v.string(),
    sourceImageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    if (!args.prompt.trim()) throw new Error("Prompt is required.");
    if (args.prompt.length > 2000)
      throw new Error("Prompt is too long (2000 character limit).");
    if (!ALLOWED_DURATIONS.includes(args.durationSeconds))
      throw new Error("Duration must be 5, 10, 15 or 25 seconds.");
    if (!ALLOWED_ASPECT_RATIOS.includes(args.aspectRatio))
      throw new Error("Aspect ratio must be 9:16, 16:9 or 1:1.");

    const img = await ctx.db.system.get(args.sourceImageId);
    if (!img) throw new Error("Uploaded image not found. Upload it again.");

    const now = Date.now();
    return await ctx.db.insert("videos", {
      userId,
      type: "image",
      prompt: args.prompt.trim(),
      sourceImageId: args.sourceImageId,
      durationSeconds: args.durationSeconds,
      aspectRatio: args.aspectRatio,
      model: process.env.VIDEO_MODEL ?? "fal-ai/wan/v2.2-5b/image-to-video",
      provider: "fal",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markFailed = mutation({
  args: { id: v.id("videos"), errorMessage: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = assertOwner(await ctx.db.get(args.id), "Video");
    if (row.userId !== userId) throw new Error("Video not found.");
    if (row.status !== "pending" && row.status !== "processing") return;
    await ctx.db.patch(args.id, {
      status: "failed",
      errorMessage: args.errorMessage.slice(0, 400),
      updatedAt: Date.now(),
    });
  },
});

export const removeVideo = mutation({
  args: { id: v.id("videos") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = assertOwner(await ctx.db.get(args.id), "Video");
    if (row.userId !== userId) throw new Error("Video not found.");
    if (row.videoStorageId) await ctx.storage.delete(row.videoStorageId);
    if (row.thumbnailStorageId) await ctx.storage.delete(row.thumbnailStorageId);
    if (row.sourceImageId) await ctx.storage.delete(row.sourceImageId);
    await ctx.db.delete(args.id);
  },
});

// ---------------------------------------------------------------------------
// Internal functions used by the provider adapters and the worker bridge.
// ---------------------------------------------------------------------------

// Status / result updates for the fal direct-provider flow.
export const setVideoStatusInternal = internalMutation({
  args: {
    id: v.id("videos"),
    status: v.string(),
    errorMessage: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    providerJobId: v.optional(v.string()),
    seed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.status !== undefined) patch.status = args.status;
    if (args.errorMessage !== undefined) patch.errorMessage = args.errorMessage;
    if (args.videoUrl !== undefined) patch.videoUrl = args.videoUrl;
    if (args.providerJobId !== undefined) patch.providerJobId = args.providerJobId;
    if (args.seed !== undefined) patch.seed = args.seed;
    await ctx.db.patch(args.id, patch);
  },
});

export const getStorageUrlInternal = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});

// Deposit a finished video into the library (called by the worker bridge).
export const addVideoInternal = internalMutation({
  args: {
    userId: v.id("users"),
    type: v.string(),
    prompt: v.string(),
    negativePrompt: v.optional(v.string()),
    videoStorageId: v.optional(v.id("_storage")),
    videoUrl: v.optional(v.string()),
    thumbnailStorageId: v.optional(v.id("_storage")),
    model: v.string(),
    provider: v.string(),
    jobId: v.optional(v.id("jobs")),
    durationSeconds: v.optional(v.number()),
    aspectRatio: v.optional(v.string()),
    resolution: v.optional(v.string()),
    seed: v.optional(v.number()),
    sourceImageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("videos", {
      ...args,
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getVideoInternal = internalQuery({
  args: { id: v.id("videos") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
