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

    // image-to-video generation jobs (one row per generation attempt)
    videos: defineTable({
      userId: v.id("users"), // owner of the job

      // generation inputs
      prompt: v.string(), // motion / camera prompt
      negativePrompt: v.optional(v.string()),
      durationSeconds: v.optional(v.number()), // requested duration: 5 | 10 | 15 | 25
      aspectRatio: v.optional(v.string()), // "9:16" | "16:9" | "1:1"

      // source image lives in Convex file storage
      sourceImageId: v.optional(v.id("_storage")),

      // provider plumbing (swappable model/provider via env)
      provider: v.string(), // e.g. "fal"
      model: v.string(), // e.g. "fal-ai/wan/v2.2-5b/image-to-video"
      providerJobId: v.optional(v.string()), // fal queue request_id

      // pending | processing | completed | failed
      status: v.string(),
      errorMessage: v.optional(v.string()),

      // results (provider-hosted MP4)
      videoUrl: v.optional(v.string()),
      seed: v.optional(v.number()),

      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId", "createdAt"])
      .index("by_user_and_status", ["userId", "status"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
