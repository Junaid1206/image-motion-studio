import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUserId } from "./shared";

// ---------------------------------------------------------------------------
// PROVIDER ABSTRACTION — the UI never decides how a job is generated. It
// reads provider config from here; jobs carry a snapshot of the provider at
// creation time so a later settings change never re-routes an in-flight job.
//
//   "colab" — your personal Google Colab GPU worker ($0, default).
//             Requires the worker to be running: Settings → Colab setup.
//             When the worker is offline, jobs stay queued and the UI shows
//             exactly: GPU worker offline
//             (No silent fal.ai fallback — fallback is a deliberate choice
//             made here in Settings, applied at job creation only.)
//
//   "fal"   — optional direct fal.ai provider (costs money, needs FAL_KEY).
// ---------------------------------------------------------------------------

export const PROVIDERS = ["colab", "fal"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

const PROVIDER_KEY = "generation_provider";

function isProvider(p: string): p is ProviderId {
  return (PROVIDERS as readonly string[]).includes(p);
}

export const getProviderConfig = query({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", PROVIDER_KEY))
      .first();
    const value = row?.value;
    const provider: ProviderId = value && isProvider(value) ? value : "colab";

    const worker = await ctx.db.query("workerState").first();
    const tokenRow = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "worker_token_hash"))
      .first();

    // FAL_KEY lives in the deployment environment (managed in the Keys tab);
    // its presence decides whether the fal option is selectable.
    const falConfigured = !!process.env.FAL_KEY;

    return {
      provider,
      workerOnline: worker?.online ?? false,
      workerStatus: worker?.status ?? "offline",
      workerGpuName: worker?.gpuName,
      workerLoadedModel: worker?.loadedModel,
      workerLastSeenAt: worker?.lastSeenAt,
      workerTokenIssued: !!tokenRow,
      falConfigured,
    };
  },
});

export const setProvider = mutation({
  args: { provider: v.string() },
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    if (!isProvider(args.provider)) {
      throw new Error('Unknown provider. Use "colab" or "fal".');
    }
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", PROVIDER_KEY))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.provider });
    } else {
      await ctx.db.insert("appSettings", {
        key: PROVIDER_KEY,
        value: args.provider,
      });
    }
  },
});
