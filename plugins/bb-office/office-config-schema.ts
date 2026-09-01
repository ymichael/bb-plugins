import { z } from "zod";

export const officeAppearanceSchema = z.enum([
  "follow-bb",
  "neutral",
  "original",
]);

export const meetingRelationSchema = z.enum([
  "same-worktree",
  "siblings",
  "parent-child",
]);

const uniqueMeetingRelationsSchema = z
  .array(meetingRelationSchema)
  .max(3)
  .refine((values) => new Set(values).size === values.length, {
    message: "Meeting relations must not contain duplicates",
  });

export const officeConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    appearance: z
      .object({
        mode: officeAppearanceSchema,
      })
      .strict(),
    behavior: z
      .object({
        inactiveExitAfterMinutes: z.number().int().min(5).max(240),
        meetingRelations: uniqueMeetingRelationsSchema,
        ambientMotion: z.enum(["off", "rare"]),
      })
      .strict(),
    decor: z
      .object({
        pets: z.boolean(),
        coffee: z.boolean(),
        plants: z.boolean(),
        wallDecor: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type OfficeConfig = z.infer<typeof officeConfigSchema>;
export type OfficeAppearanceMode = z.infer<typeof officeAppearanceSchema>;
export type MeetingRelation = z.infer<typeof meetingRelationSchema>;

export const DEFAULT_OFFICE_CONFIG: OfficeConfig = {
  schemaVersion: 1,
  appearance: { mode: "follow-bb" },
  behavior: {
    inactiveExitAfterMinutes: 30,
    meetingRelations: ["parent-child", "same-worktree", "siblings"],
    ambientMotion: "rare",
  },
  decor: {
    pets: true,
    coffee: true,
    plants: true,
    wallDecor: true,
  },
};

const behaviorChangesSchema = z
  .object({
    inactiveExitAfterMinutes: z.number().int().min(5).max(240).optional(),
    meetingRelations: uniqueMeetingRelationsSchema.optional(),
    ambientMotion: z.enum(["off", "rare"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one behavior change is required",
  });

const decorChangesSchema = z
  .object({
    pets: z.boolean().optional(),
    coffee: z.boolean().optional(),
    plants: z.boolean().optional(),
    wallDecor: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one decor change is required",
  });

export const officeEditSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("set-appearance"),
      mode: officeAppearanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("set-behavior"),
      changes: behaviorChangesSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("set-decor"),
      changes: decorChangesSchema,
    })
    .strict(),
]);

export type OfficeEdit = z.infer<typeof officeEditSchema>;

export const officeSnapshotSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    source: z.enum(["implicit-factory", "persisted"]),
    updatedAtMs: z.number().int().nonnegative().nullable(),
    config: officeConfigSchema,
    digest: z.string().length(64),
  })
  .strict();

export type OfficeSnapshot = z.infer<typeof officeSnapshotSchema>;

export const officePreviewCommandSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    base: z.enum(["current", "factory"]),
    edits: z.array(officeEditSchema).max(3),
  })
  .strict();

export type OfficePreviewCommand = z.infer<
  typeof officePreviewCommandSchema
>;

const officeChangeSummarySchema = z
  .object({
    appearance: z.boolean(),
    behavior: z.array(z.string()),
    decor: z.array(z.string()),
  })
  .strict();

export type OfficeChangeSummary = z.infer<typeof officeChangeSummarySchema>;

export const officePreviewSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("ready"),
      baseRevision: z.number().int().nonnegative(),
      proposalId: z.string().min(1),
      expiresAtMs: z.number().int().nonnegative(),
      config: officeConfigSchema,
      digest: z.string().length(64),
      summary: officeChangeSummarySchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("invalid"),
      baseRevision: z.number().int().nonnegative(),
      issues: z.array(z.string()).min(1),
    })
    .strict(),
]);

export type OfficePreview = z.infer<typeof officePreviewSchema>;

export const officeApplyCommandSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    proposalId: z.string().min(1),
  })
  .strict();

export type OfficeApplyCommand = z.infer<typeof officeApplyCommandSchema>;

export const officeConfigChangedSchema = z
  .object({
    revision: z.number().int().positive(),
  })
  .strict();

export const officeConfigToolParametersSchema = z
  .object({
    action: z.enum(["inspect", "preview", "apply", "reset"]),
    expectedRevision: z.number().int().nonnegative().optional(),
    proposalId: z.string().min(1).optional(),
    appearance: officeAppearanceSchema.optional(),
    inactiveExitAfterMinutes: z.number().int().min(5).max(240).optional(),
    meetingRelations: uniqueMeetingRelationsSchema.optional(),
    ambientMotion: z.enum(["off", "rare"]).optional(),
    pets: z.boolean().optional(),
    coffee: z.boolean().optional(),
    plants: z.boolean().optional(),
    wallDecor: z.boolean().optional(),
  })
  .strict();

export type OfficeConfigToolParameters = z.infer<
  typeof officeConfigToolParametersSchema
>;
