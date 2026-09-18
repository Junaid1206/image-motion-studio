import { QueryCtx, MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const JOB_STATUSES = ["queued","connecting","loading_model","generating","processing","completed","failed","cancelled"] as const;
export const ACTIVE_STATUSES = ["queued","connecting","loading_model","generating","processing"] as const;
export const JOB_TYPES = ["image"] as const;

export const ALLOWED_DURATIONS = [2, 3, 5];
export const ALLOWED_ASPECT_RATIOS = ["9:16", "16:9", "1:1"];
export const ALLOWED_RESOLUTIONS = ["480p", "720p"];

export const MODELS = [{
  id: "wan2.2-ti2v-5b",
  label: "WAN 2.2 TI2V-5B",
  type: "image" as const,
  repo: "Wan-AI/Wan2.2-TI2V-5B-Diffusers",
  maxDurationSeconds: 5,
  colab: false,
  note: "Hosted GPU generation — no local worker required.",
}];

export const BLOCKED_MODEL_IDS = ["wan2.2-i2v-a14b","wan2.2-t2v-a14b","wan2.1-i2v-480p","wan2.1-i2v-720p"] as const;
export function isValidModel(model: string): boolean { return MODELS.some((m) => m.id === model); }
export function modelMaxDuration(model: string): number { return MODELS.find((m) => m.id === model)?.maxDurationSeconds ?? 5; }

export function validateJobInput(opts: { prompt: string; negativePrompt?: string; model: string; durationSeconds: number; aspectRatio: string; resolution: string; }): string | null {
  if (!opts.prompt.trim()) return "Prompt is required.";
  if (opts.prompt.length > 2000) return "Prompt is too long (2000 character limit).";
  if (opts.negativePrompt && opts.negativePrompt.length > 1000) return "Negative prompt is too long (1000 character limit).";
  if ((BLOCKED_MODEL_IDS as readonly string[]).includes(opts.model)) return opts.model + " is not supported by the hosted TI2V-5B path. Use WAN 2.2 TI2V-5B.";
  if (!isValidModel(opts.model)) return "Unknown model \"" + opts.model + "\". The studio runs WAN 2.2 TI2V-5B.";
  if (!ALLOWED_DURATIONS.includes(opts.durationSeconds)) return "Duration must be 2, 3 or 5 seconds.";
  if (!ALLOWED_ASPECT_RATIOS.includes(opts.aspectRatio)) return "Aspect ratio must be 9:16, 16:9 or 1:1.";
  if (!ALLOWED_RESOLUTIONS.includes(opts.resolution)) return "Resolution must be 480p or 720p.";
  return null;
}

export function friendlyJobError(message?: string): string {
  if (!message) return "Video generation failed. Try again.";
  const m = message.toLowerCase();
  if (m.includes("out of memory") || m.includes("oom") || m.includes("cuda error")) return "GPU memory is insufficient. Reduce duration or resolution.";
  if (m.includes("worker") && m.includes("offline")) return "The hosted GPU service is unavailable right now. Try again.";
  if (m.includes("token") || m.includes("401") || m.includes("unauthorized")) return "GPU service authentication failed.";
  if (m.includes("model") && m.includes("load")) return "WAN 2.2 TI2V-5B failed to load. Try again.";
  return message;
}

export async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Sign in required.");
  return userId;
}

export function assertOwner<T extends { userId: string }>(row: T | null, what: string): T {
  if (!row) throw new Error(what + " not found.");
  return row;
}
