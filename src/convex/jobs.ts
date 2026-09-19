import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  requireUserId,
  assertOwner,
  validateJobInput,
  JOB_STATUSES,
  ACTIVE_STATUSES,
} from "./shared";

// ---------------------------------------------------------------------------
// GENERATION JOB MANAGER
// Jobs are created by the UI, picked up by the self-hosted GPU worker through
// the authenticated worker API (worker.ts), and streamed back here. Status is
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

// Create a hosted GPU generation job. The browser dispatches the queued job to
// Hugging Face ZeroGPU and deposits the resulting MP4 back into Convex storage.
export const createJob = mutation({
  args: {
    type: v.string(), prompt: v.string(), negativePrompt: v.optional(v.string()),
    inputImageId: v.optional(v.id("_storage")), model: v.string(), provider: v.optional(v.string()),
    durationSeconds: v.number(), aspectRatio: v.string(), resolution: v.string(), seed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    if (args.provider && args.provider !== "hosted") throw new Error("This studio uses the hosted GPU generation service.");
    if (args.type !== "image") throw new Error("Job type must be image (image → video).");
    if (!args.inputImageId) throw new Error("Image → Video requires a source image.");
    const problem = validateJobInput({ prompt: args.prompt, negativePrompt: args.negativePrompt, model: args.model, durationSeconds: args.durationSeconds, aspectRatio: args.aspectRatio, resolution: args.resolution });
    if (problem) throw new Error(problem);
    if (!(await ctx.db.system.get(args.inputImageId))) throw new Error("Uploaded image not found. Upload it again.");
    const now = Date.now();
    const jobId = await ctx.db.insert("jobs", {
      userId, type: args.type, prompt: args.prompt.trim(), negativePrompt: args.negativePrompt?.trim() || undefined,
      inputImageId: args.inputImageId, model: args.model, provider: "hosted",
      settings: { durationSeconds: args.durationSeconds, aspectRatio: args.aspectRatio, resolution: args.resolution, seed: args.seed },
      status: "queued", workerJobKey: randomKey(), createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("workerEvents", { jobId, level: "info", state: "queued", message: `Job created (image→video, ${args.model}). Hosted GPU generation queued.`, at: now });
    return jobId;
  },
});

export const markHostedJobRunning = mutation({
  args: { id: v.id("jobs") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const job = await ctx.db.get(args.id);
    if (!job || job.userId !== userId) throw new Error("Job not found.");
    if (job.status !== "queued") return;
    const now = Date.now();
    await ctx.db.patch(args.id, { status: "generating", progress: 5, workerStatus: "hosted GPU generating", updatedAt: now });
    await ctx.db.insert("workerEvents", { jobId: args.id, level: "info", state: "generating", message: "Hosted GPU generation started.", at: now });
  },
});

export const failHostedJobInternal = internalMutation({
  args: { id: v.id("jobs"), message: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job) throw new Error("Job not found.");
    if (job.status === "completed" || job.status === "cancelled") return;
    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "failed",
      errorMessage: args.message.slice(0, 1000),
      updatedAt: now,
    });
    await ctx.db.insert("workerEvents", {
      jobId: args.id,
      level: "error",
      state: "failed",
      message: args.message.slice(0, 500),
      at: now,
    });
  },
});

export const failHostedJob = mutation({
  args: { id: v.id("jobs"), message: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const job = await ctx.db.get(args.id);
    if (!job || job.userId !== userId) throw new Error("Job not found.");
    const now = Date.now();
    await ctx.db.patch(args.id, { status: "failed", errorMessage: args.message.slice(0, 1000), updatedAt: now });
    await ctx.db.insert("workerEvents", { jobId: args.id, level: "error", state: "failed", message: args.message.slice(0, 500), at: now });
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
// STALE-JOB REAPER — no job may stay stuck forever. A job is stale when it is
// in a non-queued active state (connecting/loading_model/generating/
// processing) and has not been touched by the worker for STALE_JOB_MS, or
// when it has been queued far longer than any legitimate wait. Invoked every
// 5 minutes by the /worker_api/cron/sweep housekeeping route (http.ts).
// Queued jobs are expired with a readable message; claimed jobs are failed
// with a readable message.
// ---------------------------------------------------------------------------

export const STALE_JOB_MS = 12 * 60 * 1000; // 12 min without a worker touch
const MAX_QUEUE_WAIT_MS = 24 * 60 * 60 * 1000; // queued > 24 h → expired

export const sweepStaleJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let expired = 0;
    let reaped = 0;

    const queued = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect();
    for (const job of queued) {
      if (now - job.updatedAt <= MAX_QUEUE_WAIT_MS) continue;
      expired++;
      await ctx.db.patch(job._id, {
        status: "failed",
        errorMessage:
          "No GPU worker claimed this job within 24 hours. Start the Colab worker and queue it again.",
        updatedAt: now,
      });
      await ctx.db.insert("workerEvents", {
        jobId: job._id,
        level: "error",
        state: "failed",
        message: "Expired in the queue — no worker connected for 24 hours.",
        at: now,
      });
    }

    for (const status of ["connecting", "loading_model", "generating", "processing"] as const) {
      const jobs = await ctx.db
        .query("jobs")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      for (const job of jobs) {
        if (now - job.updatedAt <= STALE_JOB_MS) continue;
        reaped++;
        await ctx.db.patch(job._id, {
          status: "failed",
          errorMessage:
            "The GPU worker stopped responding mid-render. Start the worker again and queue a new job.",
          updatedAt: now,
        });
        await ctx.db.insert("workerEvents", {
          jobId: job._id,
          level: "error",
          state: "failed",
          message: `Worker went silent during "${status}" — marked failed after 12 minutes without updates.`,
          at: now,
        });
      }
    }

    return { expired, reaped };
  },
});

// ---------------------------------------------------------------------------
// Internal state transitions (called by the worker API in worker.ts).
// ---------------------------------------------------------------------------

// Oldest queued job for the GPU worker's claim poll. Runs as an internal
// query because the httpAction ctx has no direct db access.
export const getOldestQueuedJobInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .order("asc")
      .first();
  },
});

// Atomically flip a claimed job to "connecting" and record the event.
// Returns false if the job was claimed/cancelled between query and patch.
export const claimJobInternal = internalMutation({
  args: { id: v.id("jobs") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const job = await ctx.db.get(args.id);
    if (!job || job.status !== "queued") return false;

    await ctx.db.patch(args.id, {
      status: "connecting",
      workerStatus: "claimed by worker",
      updatedAt: now,
    });
    await ctx.db.insert("workerEvents", {
      jobId: args.id,
      level: "info",
      state: "connecting",
      message: "Job claimed by GPU worker.",
      at: now,
    });
    return true;
  },
});

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
