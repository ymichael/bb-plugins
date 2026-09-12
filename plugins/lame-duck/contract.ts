import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const statusSchema = z
  .object({
    paused: z.boolean(),
    heldCount: z.number().int().nonnegative(),
    runningCount: z.number().int().nonnegative(),
    drained: z.boolean(),
  })
  .strict();

export const lameDuckContract = defineRpcContract({
  status: { input: z.null(), output: statusSchema },
  pause: { input: z.null(), output: statusSchema },
  resume: { input: z.null(), output: statusSchema },
});

export type LameDuckStatus = z.infer<typeof statusSchema>;
