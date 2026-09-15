import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireUserId, assertOwner } from "./shared";

// ---------------------------------------------------------------------------
// DATASET BUILDER — curated collections of finished videos for future
// fine-tuning / LoRA experiments.
//
// Storage discipline: dataset entries REFERENCE the same storage objects as
// the library (no media duplication). Only extracted frames are new files,
// and they are deleted with the entry. JSON metadata is separate from media.
// ---------------------------------------------------------------------------

// All datasets for the user, with entry counts.
export const listDatasets = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const datasets = await ctx.db
      .query("datasets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    const withCounts = await Promise.all(
      datasets.map(async (d) => {
        const entries = await ctx.db
          .query("datasetEntries")
          .withIndex("by_dataset", (q) => q.eq("datasetId", d._id))
          .collect();
        return { ...d, entryCount: entries.length };
      }),
    );
    return withCounts;
  },
});

// One dataset + its entries (newest first).
export const getDataset = query({
  args: { id: v.id("datasets") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const dataset = assertOwner(await ctx.db.get(args.id), "Dataset");
    if (dataset.userId !== userId) throw new Error("Dataset not found.");
    const entries = await ctx.db
      .query("datasetEntries")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.id))
      .order("desc")
      .collect();
    return { dataset, entries };
  },
});

export const createDataset = mutation({
  args: { name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Dataset name is required.");
    const now = Date.now();
    return await ctx.db.insert("datasets", {
      userId,
      name: name.slice(0, 80),
      description: args.description?.trim().slice(0, 300) || undefined,
      entryCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const renameDataset = mutation({
  args: { id: v.id("datasets"), name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const dataset = assertOwner(await ctx.db.get(args.id), "Dataset");
    if (dataset.userId !== userId) throw new Error("Dataset not found.");
    await ctx.db.patch(args.id, {
      name: args.name.trim().slice(0, 80) || dataset.name,
      description: args.description?.trim().slice(0, 300) || undefined,
      updatedAt: Date.now(),
    });
  },
});

// Deleting a dataset deletes its entries and extracted frames — but NEVER
// the library videos themselves.
export const deleteDataset = mutation({
  args: { id: v.id("datasets") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const dataset = assertOwner(await ctx.db.get(args.id), "Dataset");
    if (dataset.userId !== userId) throw new Error("Dataset not found.");
    const entries = await ctx.db
      .query("datasetEntries")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.id))
      .collect();
    for (const e of entries) {
      if (e.frameStorageIds) {
        for (const fid of e.frameStorageIds) await ctx.storage.delete(fid);
      }
      await ctx.db.delete(e._id);
    }
    await ctx.db.delete(args.id);
  },
});

// Add a library video to a dataset. Snapshots the generation metadata so the
// dataset stays self-describing even if the source job is long gone.
export const addVideoToDataset = mutation({
  args: { datasetId: v.id("datasets"), videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const dataset = assertOwner(await ctx.db.get(args.datasetId), "Dataset");
    if (dataset.userId !== userId) throw new Error("Dataset not found.");
    const video = assertOwner(await ctx.db.get(args.videoId), "Video");
    if (video.userId !== userId) throw new Error("Video not found.");
    if (video.status !== "completed" || (!video.videoStorageId && !video.videoUrl))
      throw new Error("Only completed videos with a file can be added.");

    // Prevent duplicate entries of the same video in the same dataset.
    const existing = await ctx.db
      .query("datasetEntries")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
    if (existing.some((e) => e.videoId === args.videoId)) {
      throw new Error("This video is already in the dataset.");
    }

    const now = Date.now();
    const entryId = await ctx.db.insert("datasetEntries", {
      userId,
      datasetId: args.datasetId,
      videoId: args.videoId,
      videoStorageId: video.videoStorageId,
      durationSeconds: video.durationSeconds,
      resolution: video.resolution,
      aspectRatio: video.aspectRatio,
      model: video.model,
      prompt: video.prompt,
      negativePrompt: video.negativePrompt,
      frameStatus: "none",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.datasetId, {
      entryCount: existing.length + 1,
      updatedAt: now,
    });
    return entryId;
  },
});

// Edit the training metadata of an entry.
export const updateEntryMetadata = mutation({
  args: {
    id: v.id("datasetEntries"),
    caption: v.optional(v.string()),
    style: v.optional(v.string()),
    camera: v.optional(v.string()),
    motion: v.optional(v.string()),
    lighting: v.optional(v.string()),
    subject: v.optional(v.string()),
    environment: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const entry = assertOwner(await ctx.db.get(args.id), "Dataset entry");
    if (entry.userId !== userId) throw new Error("Entry not found.");
    const { id, ...fields } = args;
    const clean: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(fields)) {
      if (val === undefined) continue;
      if (k === "tags" && Array.isArray(val)) {
        clean[k] = (val as string[]).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12);
      } else if (typeof val === "string") {
        clean[k] = (val as string).trim().slice(0, 500) || undefined;
      }
    }
    await ctx.db.patch(id, clean);
  },
});

export const removeEntry = mutation({
  args: { id: v.id("datasetEntries") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const entry = assertOwner(await ctx.db.get(args.id), "Dataset entry");
    if (entry.userId !== userId) throw new Error("Entry not found.");
    // Delete extracted frames (they belong to the entry), never the video.
    if (entry.frameStorageIds) {
      for (const fid of entry.frameStorageIds) await ctx.storage.delete(fid);
    }
    await ctx.db.delete(args.id);
    const dataset = await ctx.db.get(entry.datasetId);
    if (dataset) {
      const remaining = await ctx.db
        .query("datasetEntries")
        .withIndex("by_dataset", (q) => q.eq("datasetId", entry.datasetId))
        .collect();
      await ctx.db.patch(entry.datasetId, {
        entryCount: remaining.length,
        updatedAt: Date.now(),
      });
    }
  },
});

// ---------------------------------------------------------------------------
// FRAME EXTRACTION — queued for the remote worker (heavy work never runs on
// the user's low-spec local machine).
// ---------------------------------------------------------------------------

export const setEntryFrameSpec = mutation({
  args: {
    id: v.id("datasetEntries"),
    fps: v.number(),
    maxFrames: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const entry = assertOwner(await ctx.db.get(args.id), "Dataset entry");
    if (entry.userId !== userId) throw new Error("Entry not found.");
    if (args.fps <= 0 || args.fps > 24)
      throw new Error("Frame rate must be between 0.5 and 24 fps.");
    if (args.maxFrames < 1 || args.maxFrames > 200)
      throw new Error("Max frames must be between 1 and 200.");
    if (!entry.videoStorageId)
      throw new Error("This entry has no stored video file to extract from.");

    // Delete any previous frames before re-queueing.
    if (entry.frameStorageIds) {
      for (const fid of entry.frameStorageIds) await ctx.storage.delete(fid);
    }
    await ctx.db.patch(args.id, {
      frameSpec: { fps: args.fps, maxFrames: args.maxFrames },
      frameStatus: "queued",
      frameStorageIds: undefined,
      frameError: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const cancelFrameExtraction = mutation({
  args: { id: v.id("datasetEntries") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const entry = assertOwner(await ctx.db.get(args.id), "Dataset entry");
    if (entry.userId !== userId) throw new Error("Entry not found.");
    if (entry.frameStatus === "queued" || entry.frameStatus === "extracting") {
      await ctx.db.patch(args.id, {
        frameStatus: "none",
        updatedAt: Date.now(),
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Internal functions used by the worker HTTP API (worker.ts).
// ---------------------------------------------------------------------------

export const claimFrameTaskInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const entry = await ctx.db
      .query("datasetEntries")
      .withIndex("by_frame_status", (q) => q.eq("frameStatus", "queued"))
      .order("asc")
      .first();
    if (!entry) return null;
    if (!entry.videoStorageId || !entry.frameSpec) {
      await ctx.db.patch(entry._id, {
        frameStatus: "failed",
        frameError: "Entry is missing its video file or frame spec.",
        updatedAt: Date.now(),
      });
      return null;
    }
    await ctx.db.patch(entry._id, {
      frameStatus: "extracting",
      updatedAt: Date.now(),
    });
    const videoUrl = await ctx.storage.getUrl(entry.videoStorageId);
    const frameUploadUrls = await Promise.all(
      Array.from({ length: entry.frameSpec.maxFrames }, () =>
        ctx.storage.generateUploadUrl(),
      ),
    );
    return {
      entryId: entry._id,
      videoUrl,
      fps: entry.frameSpec.fps,
      maxFrames: entry.frameSpec.maxFrames,
      frameUploadUrls,
      metadata: {
        caption: entry.caption ?? entry.prompt ?? "",
        style: entry.style,
        camera: entry.camera,
        motion: entry.motion,
        lighting: entry.lighting,
        subject: entry.subject,
        environment: entry.environment,
        tags: entry.tags ?? [],
        duration: entry.durationSeconds,
        resolution: entry.resolution,
        model: entry.model,
        prompt: entry.prompt,
        negativePrompt: entry.negativePrompt,
      },
    };
  },
});

export const setFramesCompleteInternal = internalMutation({
  args: {
    entryId: v.id("datasetEntries"),
    frameStorageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry) return { ok: false };
    if (entry.frameStatus !== "extracting") return { ok: false, ignored: true };
    await ctx.db.patch(args.entryId, {
      frameStatus: "ready",
      frameStorageIds: args.frameStorageIds,
      frameError: undefined,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const setFramesFailedInternal = internalMutation({
  args: { entryId: v.id("datasetEntries"), error: v.string() },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry) return { ok: false };
    await ctx.db.patch(args.entryId, {
      frameStatus: "failed",
      frameError: args.error.slice(0, 500),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});
