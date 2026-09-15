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

export const JOB_TYPES = ["text", "image"] as const;

export const ALLOWED_DURATIONS = [5, 10, 15, 25];
export const ALLOWED_ASPECT_RATIOS = ["9:16", "16:9", "1:1"];
export const ALLOWED_RESOLUTIONS = ["480p", "720p"];

export const MODELS = [
  {
    id: "wan2.2-t2v-a14b",
    label: "WAN 2.2 T2V A14B",
    type: "text" as const,
    repo: "Wan-AI/Wan2.2-T2V-A14B-Diffusers",
    maxDurationSeconds: 5,
    note: "Text → Video. Best free quality on a Colab T4/A100.",
  },
  {
    id: "wan2.2-i2v-a14b",
    label: "WAN 2.2 I2V A14B",
    type: "image" as const,
    repo: "Wan-AI/Wan2.2-I2V-A14B-Diffusers",
    maxDurationSeconds: 5,
    note: "Image → Video. Strong subject preservation.",
  },
  {
    id: "wan2.1-t2v-1.3b",
    label: "WAN 2.1 T2V 1.3B (fast)",
    type: "text" as const,
    repo: "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
    maxDurationSeconds: 5,
    note: "Lightweight fallback — runs on a free T4.",
  },
  {
    id: "wan2.1-i2v-480p",
    label: "WAN 2.1 I2V 480p",
    type: "image" as const,
    repo: "Wan-AI/Wan2.1-I2V-14B-480P-Diffusers",
    maxDurationSeconds: 5,
    note: "Lighter I2V variant for low-VRAM sessions.",
  },
];

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
  if (opts.prompt.length > 2000)
    return "Prompt is too long (2000 character limit).";
  if (opts.negativePrompt && opts.negativePrompt.length > 1000)
    return "Negative prompt is too long (1000 character limit).";
  if (!isValidModel(opts.model)) return "Unknown model.";
  if (!ALLOWED_DURATIONS.includes(opts.durationSeconds))
    return "Duration must be 5, 10, 15 or 25 seconds.";
  if (!ALLOWED_ASPECT_RATIOS.includes(opts.aspectRatio))
    return "Aspect ratio must be 9:16, 16:9 or 1:1.";
  if (!ALLOWED_RESOLUTIONS.includes(opts.resolution))
    return "Resolution must be 480p or 720p.";
  return null;
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
