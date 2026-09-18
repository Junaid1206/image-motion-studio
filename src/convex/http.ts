import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import {
  workerIndex,
  workerHealth,
  workerClaim,
  workerProgress,
  workerComplete,
  workerFail,
  workerJobStatus,
} from "./worker";
import { STALE_JOB_MS } from "./jobs";

const http = httpRouter();

// Existing auth routes (preserved untouched).
auth.addHttpRoutes(http);

// GPU worker API (self-hosted Colab worker protocol).
http.route({ path: "/worker_api", method: "GET", handler: workerIndex });
http.route({ path: "/worker_api/health", method: "POST", handler: workerHealth });
http.route({ path: "/worker_api/claim", method: "POST", handler: workerClaim });
http.route({ path: "/worker_api/progress", method: "POST", handler: workerProgress });
http.route({ path: "/worker_api/complete", method: "POST", handler: workerComplete });
http.route({ path: "/worker_api/fail", method: "POST", handler: workerFail });
http.route({ path: "/worker_api/job-status", method: "POST", handler: workerJobStatus });

// ---------------------------------------------------------------------------
// GET /worker_api/cron/sweep — housekeeping endpoint (safe to call with any
// token; it can only mark genuinely stale state, never live state):
//   1. flips worker presence offline when the last heartbeat is older than
//      2× the notebook's heartbeat interval + margin;
//   2. fails jobs stuck in non-queued active states with no worker update
//      for STALE_JOB_MS, and expires jobs queued for more than 24 h.
// A scheduled Convex cron hits this every 5 minutes; a manual call works too.
// ---------------------------------------------------------------------------
const SWEEP_STALE_MS = 5 * 60 * 1000; // ≥ 5 sweeps per heartbeat window
export const cronSweep = httpAction(async (ctx) => {
  const markedOffline = await ctx.runMutation(
    internal.settings.markWorkerOfflineInternal,
    { staleMs: SWEEP_STALE_MS },
  );
  const swept = await ctx.runMutation(internal.jobs.sweepStaleJobs, {});
  return new Response(
    JSON.stringify({ ok: true, markedOffline, ...swept }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
http.route({ path: "/worker_api/cron/sweep", method: "GET", handler: cronSweep });

export default http;
