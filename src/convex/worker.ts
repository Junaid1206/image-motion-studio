import { v } from "convex/values";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// ---------------------------------------------------------------------------
// WORKER HTTP API — the protocol between this app and the remote GPU worker
// (Google Colab). All endpoints are POST + JSON and authenticated with the
// personal WORKER_TOKEN (verified by SHA-256 hash; the raw token is never
// stored server-side).
//
//   POST /worker_api/health        worker heartbeat / registration
//   POST /worker_api/claim         worker polls for the next queued job
//   POST /worker_api/progress      mid-render status updates
//   POST /worker_api/complete      worker deposits the finished MP4
//   POST /worker_api/fail          worker reports a hard failure
//   POST /worker_api/job-status    worker checks whether the user cancelled
//
// The worker uploads the MP4 (and optional JPEG thumbnail) DIRECTLY to
// Convex storage using upload URLs included in the claim payload — the
// video bytes never pass through a Convex function (20 MB HTTP limit).
// ---------------------------------------------------------------------------

type WorkerBody = {
  token?: string;
  workerJobKey?: string;
  [k: string]: unknown;
};

async function readJson(req: Request): Promise<WorkerBody> {
  try {
    return (await req.json()) as WorkerBody;
  } catch {
    return {};
  }
}

function respond(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Returns null if the token is valid, or a 401 Response if not.
async function verifyToken(
  ctx: any,
  token: unknown,
): Promise<Response | null> {
  if (typeof token !== "string" || token.length < 16) {
    return respond(
      { ok: false, error: "Missing or malformed worker token." },
      401,
    );
  }
  const hash = await sha256Hex(token);
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q: any) => q.eq("key", "worker_token_hash"))
    .first();
  if (!row || row.value !== hash) {
    return respond(
      { ok: false, error: "Invalid worker token. Issue a new one in Settings." },
      401,
    );
  }
  return null;
}

function workerError(message: string, status = 400): Response {
  return respond({ ok: false, error: message }, status);
}

// ---------------------------------------------------------------------------
// GET /worker_api — discovery / sanity check for setup.
// ---------------------------------------------------------------------------
export const workerIndex = httpAction(async () => {
  return respond({
    ok: true,
    service: "image-motion-studio worker API",
    endpoints: [
      "POST /worker_api/health",
      "POST /worker_api/claim",
      "POST /worker_api/progress",
      "POST /worker_api/complete",
      "POST /worker_api/fail",
      "POST /worker_api/job-status",
    ],
  });
});

// ---------------------------------------------------------------------------
// POST /worker_api/health — heartbeat. Upserts the singleton workerState row.
// ---------------------------------------------------------------------------
export const workerHealth = httpAction(async (ctx: any, req) => {
  const body = await readJson(req);
  const denied = await verifyToken(ctx, body.token);
  if (denied) return denied;

  const status = ["online", "busy", "error"].includes(String(body.status))
    ? String(body.status)
    : "online";

  const existing = await ctx.db.query("workerState").first();
  const patch = {
    online: true,
    status,
    gpuName: typeof body.gpuName === "string" ? body.gpuName.slice(0, 80) : undefined,
    vramGb: typeof body.vramGb === "number" ? body.vramGb : undefined,
    loadedModel:
      typeof body.loadedModel === "string" ? body.loadedModel.slice(0, 120) : undefined,
    message: typeof body.message === "string" ? body.message.slice(0, 300) : undefined,
    lastSeenAt: Date.now(),
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    await ctx.db.insert("workerState", patch);
  }
  return respond({ ok: true, serverTime: patch.lastSeenAt });
});

// ---------------------------------------------------------------------------
// POST /worker_api/claim — fetch the oldest queued job, if any.
// The job moves to "connecting" atomically with the claim.
// ---------------------------------------------------------------------------
export const workerClaim = httpAction(async (ctx: any, req) => {
  const body = await readJson(req);
  const denied = await verifyToken(ctx, body.token);
  if (denied) return denied;

  const job = await ctx.db
    .query("jobs")
    .withIndex("by_status", (q: any) => q.eq("status", "queued"))
    .order("asc")
    .first();

  if (!job) return respond({ ok: true, job: null });

  if (!job.workerJobKey) return workerError("Job has no worker key.", 409);

  const now = Date.now();
  await ctx.db.patch(job._id, {
    status: "connecting",
    workerStatus: "claimed by worker",
    updatedAt: now,
  });
  await ctx.db.insert("workerEvents", {
    jobId: job._id,
    level: "info",
    state: "connecting",
    message: "Job claimed by GPU worker.",
    at: now,
  });

  // Fresh upload URLs for the worker to deposit results directly.
  const videoUploadUrl = await ctx.storage.generateUploadUrl();
  const thumbnailUploadUrl = await ctx.storage.generateUploadUrl();

  const imageUrl = job.inputImageId
    ? await ctx.storage.getUrl(job.inputImageId)
    : null;

  return respond({
    ok: true,
    job: {
      workerJobKey: job.workerJobKey,
      type: job.type,
      prompt: job.prompt,
      negativePrompt: job.negativePrompt ?? "",
      model: job.model,
      settings: job.settings,
      imageUrl,
      videoUploadUrl,
      thumbnailUploadUrl,
      callbacks: {
        progress: `${process.env.CONVEX_SITE_URL ?? ""}/worker_api/progress`,
        complete: `${process.env.CONVEX_SITE_URL ?? ""}/worker_api/complete`,
        fail: `${process.env.CONVEX_SITE_URL ?? ""}/worker_api/fail`,
        status: `${process.env.CONVEX_SITE_URL ?? ""}/worker_api/job-status`,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// POST /worker_api/progress — status / progress / message updates.
// ---------------------------------------------------------------------------
export const workerProgress = httpAction(async (ctx: any, req) => {
  const body = await readJson(req);
  const denied = await verifyToken(ctx, body.token);
  if (denied) return denied;
  if (typeof body.workerJobKey !== "string")
    return workerError("workerJobKey is required.");

  const job = await ctx.runQuery(internal.jobs.getJobByKeyInternal, {
    workerJobKey: body.workerJobKey,
  });
  if (!job) return workerError("Unknown workerJobKey.", 404);

  const status =
    typeof body.status === "string" ? body.status : undefined;
  if (
    status &&
    !["loading_model", "generating", "processing", "connecting"].includes(status)
  )
    return workerError("Invalid status for progress update.");

  await ctx.runMutation(internal.jobs.setJobStateInternal, {
    id: job._id,
    status,
    progress: typeof body.progress === "number" ? body.progress : undefined,
    workerStatus:
      typeof body.message === "string" ? body.message.slice(0, 300) : undefined,
    eventMessage:
      typeof body.message === "string" && body.message
        ? `${status ?? "working"}: ${body.message}`
        : status
          ? `Worker state → ${status}`
          : undefined,
  });

  return respond({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /worker_api/complete — deposit the finished video into the library.
// Expects videoStorageId (and optional thumbnailStorageId) already uploaded
// via the upload URLs from /claim.
// ---------------------------------------------------------------------------
export const workerComplete = httpAction(async (ctx: any, req) => {
  const body = await readJson(req);
  const denied = await verifyToken(ctx, body.token);
  if (denied) return denied;
  if (typeof body.workerJobKey !== "string")
    return workerError("workerJobKey is required.");
  if (typeof body.videoStorageId !== "string")
    return workerError("videoStorageId is required (upload the MP4 first).");

  const job = await ctx.runQuery(internal.jobs.getJobByKeyInternal, {
    workerJobKey: body.workerJobKey,
  });
  if (!job) return workerError("Unknown workerJobKey.", 404);

  // Sanity-check the storage object exists and belongs to this deployment.
  const stored = await ctx.storage.get(body.videoStorageId as any);
  if (!stored) return workerError("videoStorageId not found in storage.", 404);

  // Never overwrite a terminal state.
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return respond({ ok: true, ignored: true, jobStatus: job.status });
  }

  const videoId = await ctx.runMutation(internal.videos.addVideoInternal, {
    userId: job.userId,
    type: job.type,
    prompt: job.prompt,
    negativePrompt: job.negativePrompt,
    videoStorageId: body.videoStorageId as any,
    thumbnailStorageId:
      typeof body.thumbnailStorageId === "string"
        ? (body.thumbnailStorageId as any)
        : undefined,
    model: job.model,
    provider: "worker",
    jobId: job._id,
    durationSeconds: job.settings?.durationSeconds,
    aspectRatio: job.settings?.aspectRatio,
    resolution: job.settings?.resolution,
    seed: typeof body.seed === "number" ? body.seed : job.settings?.seed,
    sourceImageId: job.inputImageId,
  });

  await ctx.runMutation(internal.jobs.setJobVideoInternal, {
    id: job._id,
    videoId,
  });
  await ctx.runMutation(internal.jobs.setJobStateInternal, {
    id: job._id,
    status: "completed",
    progress: 100,
    eventMessage: "Video deposited into the library.",
  });

  return respond({ ok: true, videoId });
});

// ---------------------------------------------------------------------------
// POST /worker_api/fail — hard failure reported by the worker.
// ---------------------------------------------------------------------------
export const workerFail = httpAction(async (ctx: any, req) => {
  const body = await readJson(req);
  const denied = await verifyToken(ctx, body.token);
  if (denied) return denied;
  if (typeof body.workerJobKey !== "string")
    return workerError("workerJobKey is required.");

  const job = await ctx.runQuery(internal.jobs.getJobByKeyInternal, {
    workerJobKey: body.workerJobKey,
  });
  if (!job) return workerError("Unknown workerJobKey.", 404);

  const message =
    typeof body.error === "string" && body.error.trim()
      ? body.error.trim().slice(0, 500)
      : "Worker reported failure without details.";

  await ctx.runMutation(internal.jobs.setJobStateInternal, {
    id: job._id,
    status: "failed",
    errorMessage: message,
    eventLevel: "error",
    eventMessage: message,
  });

  return respond({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /worker_api/job-status — lets the worker see user cancellations so it
// can abort an in-flight render.
// ---------------------------------------------------------------------------
export const workerJobStatus = httpAction(async (ctx: any, req) => {
  const body = await readJson(req);
  const denied = await verifyToken(ctx, body.token);
  if (denied) return denied;
  if (typeof body.workerJobKey !== "string")
    return workerError("workerJobKey is required.");

  const job = await ctx.runQuery(internal.jobs.getJobByKeyInternal, {
    workerJobKey: body.workerJobKey,
  });
  if (!job) return workerError("Unknown workerJobKey.", 404);

  return respond({
    ok: true,
    status: job.status,
    cancelled: job.status === "cancelled" || job.status === "failed",
  });
});
