import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireUserId } from "./shared";

// ---------------------------------------------------------------------------
// WORKER TOKEN — a personal API secret that authenticates the Google Colab
// worker against this app's HTTP endpoints.
//
// Threat model (single-user personal app):
//   • The RAW token is shown ONCE in the UI at issue time, to be pasted into
//     the Colab notebook. It is NEVER stored server-side or returned again.
//   • The server stores only the SHA-256 hash of the token.
//   • The worker authenticates by sending the raw token; the HTTP layer
//     hashes what it receives and compares against the stored hash.
// ---------------------------------------------------------------------------

const TOKEN_KEY = "worker_token_hash";

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", TOKEN_KEY))
      .first();
    const worker = await ctx.db.query("workerState").first();
    return {
      workerTokenIssued: !!row,
      worker: worker ?? null,
    };
  },
});

// Issue a fresh token (or re-issue, invalidating the old one). Returns the
// raw token exactly once. 32 random bytes → 64 hex chars.
export const issueWorkerToken = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);

    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const raw = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(raw),
    );
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", TOKEN_KEY))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: hash });
    } else {
      await ctx.db.insert("appSettings", { key: TOKEN_KEY, value: hash });
    }

    // Reset worker presence: the old token is dead, so treat the worker as
    // offline until it re-registers with the new one.
    const worker = await ctx.db.query("workerState").first();
    if (worker) {
      await ctx.db.patch(worker._id, { online: false, status: "offline" });
    }

    return { token: raw };
  },
});

// Delete the stored hash — every worker call starts failing until a new
// token is issued.
export const revokeWorkerToken = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", TOKEN_KEY))
      .first();
    if (row) await ctx.db.delete(row._id);
    const worker = await ctx.db.query("workerState").first();
    if (worker) {
      await ctx.db.patch(worker._id, { online: false, status: "offline" });
    }
  },
});

// Internal: fetch the stored SHA-256 worker-token hash (null when revoked).
// Used by the worker HTTP API — an httpAction ctx has no direct db access.
export const getWorkerTokenHashInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", TOKEN_KEY))
      .first();
    return row?.value ?? null;
  },
});

// Internal: heartbeat upsert of the singleton workerState row. Only fields
// explicitly supplied by the worker are changed; omitted fields keep their
// previous value. A completed job's error is cleared here via clearError.
export const upsertWorkerStateInternal = internalMutation({
  args: {
    online: v.boolean(),
    status: v.string(),
    gpuName: v.optional(v.string()),
    vramGb: v.optional(v.number()),
    loadedModel: v.optional(v.string()),
    message: v.optional(v.string()),
    lastSeenAt: v.number(),
    workerVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("workerState").first();
    const patch: Record<string, unknown> = {
      online: args.online,
      status: args.status,
      lastSeenAt: args.lastSeenAt,
    };
    if (args.gpuName !== undefined) patch.gpuName = args.gpuName;
    if (args.vramGb !== undefined) patch.vramGb = args.vramGb;
    if (args.loadedModel !== undefined) patch.loadedModel = args.loadedModel;
    if (args.message !== undefined) patch.message = args.message;
    if (args.workerVersion !== undefined) patch.workerVersion = args.workerVersion;

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("workerState", patch);
  },
});

// Internal: flip a worker to offline — but only if its last heartbeat is
// genuinely older than `staleMs`. A live worker (heartbeat every ~60 s) is
// never touched, so this can run from any path without flapping presence.
export const markWorkerOfflineInternal = internalMutation({
  args: { staleMs: v.number() },
  handler: async (ctx, args) => {
    const worker = await ctx.db.query("workerState").first();
    if (!worker || !worker.online) return false;
    if (worker.lastSeenAt !== undefined && Date.now() - worker.lastSeenAt < args.staleMs)
      return false; // still fresh — leave it alone
    await ctx.db.patch(worker._id, { online: false, status: "offline" });
    return true;
  },
});
