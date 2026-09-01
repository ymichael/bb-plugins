import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const officeUsageReadInputSchema = z
  .object({
    hostId: z.string().min(1).nullable(),
    providerIds: z.array(z.string().min(1)).max(3),
  })
  .strict();

export const officeUsageWindowSchema = z
  .object({
    label: z.string(),
    usedPercent: z.number().min(0).max(100),
    resetsAt: z.string().nullable(),
    cost: z
      .object({
        usedUsdCents: z.number().nonnegative(),
        limitUsdCents: z.number().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const officeProviderUsageSchema = z
  .object({
    providerId: z.string(),
    status: z.enum([
      "ok",
      "not_installed",
      "unauthenticated",
      "expired",
      "error",
    ]),
    planLabel: z.string().nullable(),
    windows: z.array(officeUsageWindowSchema),
  })
  .strict();

export const officeUsageSnapshotSchema = z
  .object({
    observedAtMs: z.number().int().nonnegative(),
    providers: z.array(officeProviderUsageSchema).max(3),
  })
  .strict();

export type OfficeUsageReadInput = z.infer<
  typeof officeUsageReadInputSchema
>;
export type OfficeUsageWindow = z.infer<typeof officeUsageWindowSchema>;
export type OfficeProviderUsage = z.infer<typeof officeProviderUsageSchema>;
export type OfficeUsageSnapshot = z.infer<typeof officeUsageSnapshotSchema>;
export type UsageLimitsResult = Awaited<
  ReturnType<BbPluginApi["sdk"]["system"]["usageLimits"]>
>;

type RawProviderUsage = UsageLimitsResult[string];
type RawOkProviderUsage = Extract<RawProviderUsage, { status: "ok" }>;
type RawUsageWindow = RawOkProviderUsage["windows"][number];

interface OfficeUsageDependencies {
  usageLimits(args: {
    hostId: string | null;
    providerId: string;
  }): Promise<UsageLimitsResult>;
  now?: () => number;
  cacheTtlMs?: number;
}

interface CachedProviderUsage {
  expiresAtMs: number;
  value: OfficeProviderUsage;
}

export interface OfficeUsageModule {
  read(input: OfficeUsageReadInput): Promise<OfficeUsageSnapshot>;
}

function boundedPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function normalizeWindow(window: RawUsageWindow): OfficeUsageWindow {
  return {
    label: window.label,
    usedPercent: boundedPercent(window.usedPercent),
    resetsAt: window.resetsAt,
    ...(window.cost === undefined
      ? {}
      : {
          cost: {
            usedUsdCents: Math.max(0, window.cost.usedUsdCents),
            limitUsdCents: Math.max(0, window.cost.limitUsdCents),
          },
        }),
  };
}

function unavailableProvider(
  providerId: string,
  status: Exclude<OfficeProviderUsage["status"], "ok">,
): OfficeProviderUsage {
  return {
    providerId,
    status,
    planLabel: null,
    windows: [],
  };
}

export function normalizeProviderUsage(
  providerId: string,
  raw: UsageLimitsResult,
): OfficeProviderUsage {
  const candidates = Object.values(raw);
  const provider =
    raw[providerId] ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!provider) return unavailableProvider(providerId, "error");
  if (provider.status !== "ok") {
    return unavailableProvider(providerId, provider.status);
  }
  return {
    providerId,
    status: "ok",
    planLabel: provider.planLabel,
    windows: provider.windows.map(normalizeWindow),
  };
}

export function createOfficeUsageModule(
  dependencies: OfficeUsageDependencies,
): OfficeUsageModule {
  const now = dependencies.now ?? Date.now;
  const cacheTtlMs = dependencies.cacheTtlMs ?? 90_000;
  const cache = new Map<string, CachedProviderUsage>();
  const inFlight = new Map<string, Promise<OfficeProviderUsage>>();

  const readProvider = (
    hostId: string | null,
    providerId: string,
  ): Promise<OfficeProviderUsage> => {
    const key = `${hostId ?? "primary"}\u0000${providerId}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAtMs > now()) {
      return Promise.resolve(cached.value);
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
    const request = dependencies
      .usageLimits({ hostId, providerId })
      .then((raw) => normalizeProviderUsage(providerId, raw))
      .catch(() => unavailableProvider(providerId, "error"))
      .then((value) => {
        cache.set(key, { value, expiresAtMs: now() + cacheTtlMs });
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  };

  return {
    async read(input) {
      const providerIds = [...new Set(input.providerIds)];
      const providers = await Promise.all(
        providerIds.map((providerId) =>
          readProvider(input.hostId, providerId),
        ),
      );
      return {
        observedAtMs: now(),
        providers,
      };
    },
  };
}
