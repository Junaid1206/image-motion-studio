import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // ------------------------------------------------------------------
    // GENERATION JOBS — one row per generation attempt (text->video or
    // image->video). The remote GPU worker updates these rows through an
    // authenticated HTTP API; the UI subscribes reactively.
    // ------------------------------------------------------------------
    jobs: defineTable({
      userId: v.id("users"),

      // "text" | "image"
      type: v.string(),
      prompt: v.string(),
      negativePrompt: v.optional(v.string()),

      // source image for image->video (Convex file storage)
      inputImageId: v.optional(v.id("_storage")),

      // model + generation settings (validated at creation)
      model: v.string(),
      settings: v.object({
        durationSeconds: v.number(),
        aspectRatio: v.string(),
        resolution: v.string(),
        seed: v.optional(v.number()),
      }),

      // queued | connecting | loading_model | generating | processing |
      // completed | failed | cancelled
      status: v.string(),
      progress: v.optional(v.number()), // 0..100 as reported by the worker
      workerStatus: v.optional(v.string()), // free-form worker detail line

      // opaque key the worker uses to address this job (not a Convex id)
      workerJobKey: v.optional(v.string()),
      remoteJobId: v.optional(v.string()), // worker-side / provider-side id

      // set when the completed video has been deposited in the library
      videoId: v.optional(v.id("videos")),

      errorMessage: v.optional(v.string()),

      createdAt: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId", "createdAt"])
      .index("by_user_and_status", ["userId", "status"])
      .index("by_status", ["status", "createdAt"])
      .index("by_worker_key", ["workerJobKey"]),

    // ------------------------------------------------------------------
    // VIDEO LIBRARY — every finished clip lives here. Videos are NEVER
    // deleted automatically; only the user deletes them.
    // ------------------------------------------------------------------
    videos: defineTable({
      userId: v.id("users"),

      // "image" | "text" — how the clip was made
      type: v.string(),
      title: v.optional(v.string()),
      prompt: v.string(),
      negativePrompt: v.optional(v.string()),

      // results (provider-hosted or storage-hosted MP4)
      videoUrl: v.optional(v.string()),
      videoStorageId: v.optional(v.id("_storage")), // worker-deposited MP4
      thumbnailStorageId: v.optional(v.id("_storage")),

      model: v.string(),
      provider: v.string(), // "worker" (default, $0) | "fal" (optional direct)
      providerJobId: v.optional(v.string()), // provider-side request id (fal)
      jobId: v.optional(v.id("jobs")), // originating job, if any

      durationSeconds: v.optional(v.number()),
      aspectRatio: v.optional(v.string()),
      resolution: v.optional(v.string()),
      seed: v.optional(v.number()),

      // "completed" | "failed" (failed rows keep their error for history)
      status: v.string(),
      errorMessage: v.optional(v.string()),

      // library organization
      favorite: v.optional(v.boolean()),
      tags: v.optional(v.array(v.string())),

      // dataset bookkeeping (informational; entries live in datasetEntries)
      inDataset: v.optional(v.boolean()),

      sourceImageId: v.optional(v.id("_storage")),

      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId", "createdAt"])
      .index("by_user_and_status", ["userId", "status"]),

    // ------------------------------------------------------------------
    // WORKER STATE — singleton row describing the remote GPU worker
    // (Google Colab). Only the worker's own authenticated calls may set
    // online=true; the app never pretends the worker is up.
    // ------------------------------------------------------------------
    workerState: defineTable({
      online: v.optional(v.boolean()),
      status: v.optional(v.string()), // "online" | "busy" | "error" | "offline"
      gpuName: v.optional(v.string()),
      vramGb: v.optional(v.number()),
      loadedModel: v.optional(v.string()),
      message: v.optional(v.string()),
      lastSeenAt: v.optional(v.number()),
    }),

    // Append-only diagnostics for job state transitions (worker + app).
    workerEvents: defineTable({
      jobId: v.optional(v.id("jobs")),
      level: v.string(), // "info" | "warning" | "error"
      state: v.optional(v.string()),
      message: v.string(),
      at: v.number(),
    }).index("by_job", ["jobId", "at"]),

    // ------------------------------------------------------------------
    // DATASETS — curated collections of finished videos for future
    // fine-tuning / LoRA experiments. Metadata here; media stays in
    // storage exactly once (entries reference the same storage ids).
    // ------------------------------------------------------------------
    datasets: defineTable({
      userId: v.id("users"),
      name: v.string(),
      description: v.optional(v.string()),
      entryCount: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_user", ["userId", "createdAt"]),

    datasetEntries: defineTable({
      userId: v.id("users"),
      datasetId: v.id("datasets"),
      videoId: v.id("videos"),

      // reference to the SAME storage object as the library video
      // (no media duplication)
      videoStorageId: v.optional(v.id("_storage")),

      // captioning / tagging for future training
      caption: v.optional(v.string()),
      style: v.optional(v.string()),
      camera: v.optional(v.string()),
      motion: v.optional(v.string()),
      lighting: v.optional(v.string()),
      subject: v.optional(v.string()),
      environment: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),

      // snapshot of the clip's generation facts
      durationSeconds: v.optional(v.number()),
      resolution: v.optional(v.string()),
      aspectRatio: v.optional(v.string()),
      model: v.optional(v.string()),
      prompt: v.optional(v.string()),
      negativePrompt: v.optional(v.string()),

      // frame extraction (done on the remote worker, not the local machine)
      frameSpec: v.optional(
        v.object({ fps: v.number(), maxFrames: v.number() }),
      ),
      frameStatus: v.optional(v.string()), // none|queued|extracting|ready|failed
      frameStorageIds: v.optional(v.array(v.id("_storage"))),
      frameError: v.optional(v.string()),

      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_dataset", ["datasetId", "createdAt"])
      .index("by_video", ["videoId"])
      .index("by_frame_status", ["frameStatus"]),

    // ------------------------------------------------------------------
    // APP SETTINGS — internal key/value (e.g. hashed WORKER_TOKEN secret).
    // Not user-facing.
    // ------------------------------------------------------------------
    appSettings: defineTable({
      key: v.string(),
      value: v.string(),
    }).index("by_key", ["key"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
