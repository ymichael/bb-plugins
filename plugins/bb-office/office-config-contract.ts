import type { PluginRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  officeApplyCommandSchema,
  officePreviewCommandSchema,
  officePreviewSchema,
  officeSnapshotSchema,
} from "./office-config-schema";
import {
  officeUsageReadInputSchema,
  officeUsageSnapshotSchema,
} from "./office-usage";

export const bbOfficeRpcContract = {
  readOfficeConfig: {
    input: z.object({}).strict(),
    output: officeSnapshotSchema,
  },
  previewOfficeConfig: {
    input: officePreviewCommandSchema,
    output: officePreviewSchema,
  },
  applyOfficeConfig: {
    input: officeApplyCommandSchema,
    output: officeSnapshotSchema,
  },
  readOfficeUsage: {
    input: officeUsageReadInputSchema,
    output: officeUsageSnapshotSchema,
  },
} as const satisfies PluginRpcContract;
