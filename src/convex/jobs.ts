import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  requireUserId,
  assertOwner,
  validateJobInput,
  JOB_STATUSES,
  ACTIVE_STATUSES,
} from "./shared";

// ---------------------------------------------------------------------------
// GENERATION JOB MANAGER
// Jobs are created by the UI, picked up by the remote GPU worker through the
// authenticated worker API (worker.ts), and streamed back here. Status is
// always the real backend state — nothing is simulated.
// ---------------------------------------------------------------------------

function randomKey(): string {
  // Opaque per-job key the worker uses to address the job (not a DB id).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isStatus(s: string): s is (typeof JOB_STATUSES)[number] {
  return (JOB_STATUSES as readonly string[]).includes(s);
}

// Create a job (text→video or image→video). Validation is server-side.
export const createJob = mutation({
  args: {
    type: v.string(), // "text" | "image"
    prompt: v.string(),
    negativePrompt: v.optional(v.string()),
    inputImageId: v.optional(v.id("_storage")),
    model: v.string(),
    durationSeconds: v.number(),
    aspectRatio: v.string(),
    resolution: v.string(),
    seed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    if (args.type !== "text" && args.type !== "image")
      throw new Error("Job type must be text or image.");
    if (args.type === "image" && !args.inputImageId)
      throw new Error("Image → Video requires a source image.");

    const problem = validateJobInput({
      prompt: args.prompt,
      negativePrompt: args.negativePrompt,
      model: args.model,
      durationSeconds: args.durationSeconds,
      aspectRatio: args.aspectRatio,
      resolution: args.resolution,
    });
    if (problem) throw new Error(problem);

    if (args.inputImageId) {
      const img = await ctx.db.system.get(args.inputImageId);
      if (!img)
        throw new Error("Uploaded image not found. Upload it again.");
    }

    const now = Date.now();
    const jobId = await ctx.db.insert("jobs", {
      userId,
      type: args.type,
      prompt: args.prompt.trim(),
      negativePrompt: args.negativePrompt?.trim() || undefined,
      inputImageId: args.type === "image" ? args.inputImageId : undefined,
      model: args.model,
      settings: {
        durationSeconds: args.durationSeconds,
        aspectRatio: args.aspectRatio,
        resolution: args.resolution,
        seed: args.seed,
      },
      status: "queued",
      workerJobKey: randomKey(),
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("workerEvents", {
      jobId,
      level: "info",
      state: "queued",
      message: `Job created (${args.type}→video, ${args.model}). Waiting for a worker.`,
      at: now,
    });

    return jobId;
  },
});

// Job detail for the signed-in user.
export const getJob = query({
  args: { id: v.id("jobs") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = assertOwner(await ctx.db.get(args.id), "Job");
    if (row.userId !== userId) throw new Error("Job not found.");
    return row;
  },
});

export const listMyJobs = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("jobs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
  },
});

// Status timeline for a job (user-scoped).
export const getJobEvents = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) throw new Error("Job not found.");
    return await ctx.db
      .query("workerEvents")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(50);
  },
});

export const hasActiveJob = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    for (const s of ACTIVE_STATUSES) {
      const found = await ctx.db
        .query("jobs")
        .withIndex("by_user_and_status", (q) =>
          q.eq("userId", userId).eq("status", s),
        )
        .first();
      if (found) return true;
    }
    return false;
  },
});

// User-initiated cancel. The worker also polls the job's status and will
// abort rendering when it sees cancelled/failed here.
export const cancelJob = mutation({
  args: { id: v.id("jobs") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = assertOwner(await ctx.db.get(args.id), "Job");
    if (row.userId !== userId) throw new Error("Job not found.");
    if (!isStatus(row.status)) throw new Error("Job has an invalid status.");
    if (row.status === "completed" || row.status === "failed" || row.status === "cancelled")
      return; // already terminal

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "cancelled",
      errorMessage: "Cancelled by user.",
      updatedAt: now,
    });
    await ctx.db.insert("workerEvents", {
      jobId: args.id,
      level: "warning",
      state: "cancelled",
      message: "Cancelled by user.",
      at: now,
    });
  },
});

// ---------------------------------------------------------------------------
// Internal state transitions (called by the worker API in worker.ts).
// ---------------------------------------------------------------------------

export const getJobByKeyInternal = internalQuery({
  args: { workerJobKey: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_worker_key", (q) => q.eq("workerJobKey", args.workerJobKey))
      .first();
  },
});

export const setJobStateInternal = internalMutation({
  args: {
    id: v.id("jobs"),
    status: v.optional(v.string()),
    progress: v.optional(v.number()),
    workerStatus: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    eventLevel: v.optional(v.string()), // info | warning | error
    eventMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const patch: Record<string, unknown> = { updatedAt: now };

    if (args.status !== undefined) {
      if (!isStatus(args.status)) throw new Error("Invalid job status.");
      patch.status = args.status;
      if (args.status === "completed") patch.completedAt = now;
    }
    if (args.progress !== undefined) patch.progress = Math.max(0, Math.min(100, args.progress));
    if (args.workerStatus !== undefined) patch.workerStatus = args.workerStatus;
    if (args.errorMessage !== undefined) patch.errorMessage = args.errorMessage;

    await ctx.db.patch(args.id, patch);

    if (args.eventMessage) {
      await ctx.db.insert("workerEvents", {
        jobId: args.id,
        level: args.eventLevel ?? "info",
        state: args.status,
        message: args.eventMessage.slice(0, 500),
        at: now,
      });
    }
  },
});

// Link a finished video into the job row.
export const setJobVideoInternal = internalMutation({
  args: { id: v.id("jobs"), videoId: v.id("videos") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      videoId: args.videoId,
      updatedAt: Date.now(),
    });
  },
});
