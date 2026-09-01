import { describe, expect, test, vi } from "vitest";
import {
  createOfficeUsageModule,
  normalizeProviderUsage,
  type UsageLimitsResult,
} from "./office-usage";

const usageResult: UsageLimitsResult = {
  codex: {
    status: "ok",
    accountEmail: "private@example.com",
    planLabel: "Pro",
    windows: [
      {
        label: "Weekly",
        usedPercent: 114,
        resetsAt: "2026-09-06T12:00:00.000Z",
      },
      {
        label: "Session",
        usedPercent: -8,
        resetsAt: null,
        cost: { usedUsdCents: 250, limitUsdCents: 1_000 },
      },
    ],
  },
};

describe("office usage boundary", () => {
  test("strips account identity and bounds provider percentages", () => {
    const provider = normalizeProviderUsage("codex", usageResult);

    expect(provider).toEqual({
      providerId: "codex",
      status: "ok",
      planLabel: "Pro",
      windows: [
        {
          label: "Weekly",
          usedPercent: 100,
          resetsAt: "2026-09-06T12:00:00.000Z",
        },
        {
          label: "Session",
          usedPercent: 0,
          resetsAt: null,
          cost: { usedUsdCents: 250, limitUsdCents: 1_000 },
        },
      ],
    });
    expect(JSON.stringify(provider)).not.toContain("private@example.com");
  });

  test("coalesces and caches usage reads by host and provider", async () => {
    let nowMs = 1_000;
    const usageLimits = vi.fn(async () => usageResult);
    const usage = createOfficeUsageModule({
      usageLimits,
      now: () => nowMs,
      cacheTtlMs: 90_000,
    });

    const input = { hostId: "host-one", providerIds: ["codex"] };
    const [first, concurrent] = await Promise.all([
      usage.read(input),
      usage.read(input),
    ]);
    const cached = await usage.read(input);

    expect(first.providers).toEqual(concurrent.providers);
    expect(cached.providers).toEqual(first.providers);
    expect(usageLimits).toHaveBeenCalledTimes(1);

    nowMs += 90_001;
    await usage.read(input);
    expect(usageLimits).toHaveBeenCalledTimes(2);

    await usage.read({ hostId: "host-two", providerIds: ["codex"] });
    expect(usageLimits).toHaveBeenCalledTimes(3);
  });

  test("turns provider read failures into a bounded unavailable state", async () => {
    const usage = createOfficeUsageModule({
      usageLimits: async () => {
        throw new Error("host offline");
      },
      now: () => 42,
    });

    await expect(
      usage.read({ hostId: null, providerIds: ["codex"] }),
    ).resolves.toEqual({
      observedAtMs: 42,
      providers: [
        {
          providerId: "codex",
          status: "error",
          planLabel: null,
          windows: [],
        },
      ],
    });
  });
});
