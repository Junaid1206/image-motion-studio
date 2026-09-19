import { QueryCtx, MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ---------------------------------------------------------------------------
// Shared helpers + validation constants for the whole backend.
// ---------------------------------------------------------------------------

export const JOB_STATUSES = [
  "queued",
  "connecting",
  "loading_model",
  "generating",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;

export const ACTIVE_STATUSES = [
  "queued",
  "connecting",
  "loading_model",
  "generating",
  "processing",
] as const;

export const JOB_TYPES = ["image"] as const;

export const ALLOWED_DURATIONS = [2, 3, 5];
export const ALLOWED_ASPECT_RATIOS = ["9:16", "16:9", "1:1"];
export const ALLOWED_RESOLUTIONS = ["480p"];

// Model registry. The Colab worker notebook (worker/ims-worker.ipynb) is the
// source of truth for what it can execute; only what it actually loads is
// listed here. wan2.2-ti2v-5b is the default/only image → video model:
// TI2V = text+image → video, conditioned on the uploaded image through
// WanImageToVideoPipeline's expand_timesteps first-frame path, 4-bit NF4 on a
// free T4. A14B/14B checkpoints need A100-class VRAM and are intentionally
// absent — validateJobInput rejects them by name so old clients get a clear
// message instead of an "unknown model".
export const MODELS = [
  {
    id: "wan2.2-ti2v-5b",
    label: "WAN 2.2 TI2V-5B",
    type: "image" as const,
    repo: "Wan-AI/Wan2.2-TI2V-5B-Diffusers",
    maxDurationSeconds: 5,
    colab: false,
    note: "Hosted GPU image → video — no local worker or Colab setup required.",
  },
];

// Never runnable on the hosted GPU service; kept as named rejections.
export const BLOCKED_MODEL_IDS = [
  "wan2.2-i2v-a14b",
  "wan2.2-t2v-a14b",
  "wan2.1-i2v-480p",
  "wan2.1-i2v-720p",
] as const;

export function isValidModel(model: string): boolean {
  return MODELS.some((m) => m.id === model);
}

export function modelMaxDuration(model: string): number {
  return MODELS.find((m) => m.id === model)?.maxDurationSeconds ?? 5;
}

export function validateJobInput(opts: {
  prompt: string;
  negativePrompt?: string;
  model: string;
  durationSeconds: number;
  aspectRatio: string;
  resolution: string;
}): string | null {
  if (!opts.prompt.trim()) return "Prompt is required.";
  if (opts.prompt.length > 600)
    return "Prompt is too long (600 character limit).";
  if (opts.negativePrompt && opts.negativePrompt.length > 1000)
    return "Negative prompt is too long (1000 character limit).";
  if ((BLOCKED_MODEL_IDS as readonly string[]).includes(opts.model)) {
    return `${opts.model} needs A100-class VRAM and cannot run on the free Colab T4 worker. Use WAN 2.2 TI2V-5B.`;
  }
  if (!isValidModel(opts.model))
    return `Unknown model "${opts.model}". The hosted GPU service runs WAN 2.2 TI2V-5B.`;
  if (!ALLOWED_DURATIONS.includes(opts.durationSeconds))
    return "Duration must be 2, 3 or 5 seconds.";
  if (!ALLOWED_ASPECT_RATIOS.includes(opts.aspectRatio))
    return "Aspect ratio must be 9:16, 16:9 or 1:1.";
  if (!ALLOWED_RESOLUTIONS.includes(opts.resolution))
    return "Resolution must be 480p.";
  return null;
}

// Human-readable error mapping for the UI (requirement 15). The worker and
// backend store readable messages already; this normalizes the generic ones.
export function friendlyJobError(message?: string): string {
  if (!message) return "Video generation failed. Check worker logs in Jobs → Timeline.";
  const m = message.toLowerCase();
  if (m.includes("out of memory") || m.includes("oom") || m.includes("cuda error"))
    return "GPU memory is insufficient for the current generation settings. Reduce resolution, frames, or inference steps.";
  if (m.includes("worker") && m.includes("offline"))
    return "GPU worker is offline. Start the configured worker to generate videos.";
  if (m.includes("token") || m.includes("401") || m.includes("unauthorized"))
    return "Worker authentication failed. Generate a new worker token in Settings.";
  if (m.includes("model") && m.includes("load"))
    return "WAN 2.2 TI2V-5B failed to load. Check the worker notebook output for the underlying error.";
  return message;
}

/** Requires a signed-in user; returns their id or throws. */
export async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Sign in required.");
  return userId;
}

/** Asserts the row belongs to the signed-in user (or throws). */
export function assertOwner<T extends { userId: string }>(
  row: T | null,
  what: string,
): T {
  if (!row) throw new Error(`${what} not found.`);
  return row;
}
