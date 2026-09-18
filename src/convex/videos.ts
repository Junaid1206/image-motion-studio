import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
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
// The single generation path is the self-hosted Colab GPU worker ($0, no
// API keys): jobs.ts creates the job, worker.ts streams it back, and the
// worker deposits the finished MP4 here via addVideoInternal.
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

// Studio-wide config for the UI: models, limits, worker + token presence.
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
// Internal functions used by the worker HTTP API (worker.ts).
// ---------------------------------------------------------------------------

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
