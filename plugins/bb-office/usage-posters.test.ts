import { describe, expect, test } from "vitest";
import type { OfficeUsageSnapshot } from "./office-usage";
import {
  buildUsagePosters,
  providerMonogram,
  usagePosterSummary,
} from "./usage-posters";

const snapshot: OfficeUsageSnapshot = {
  observedAtMs: 1,
  providers: [
    {
      providerId: "codex",
      status: "ok",
      planLabel: "Pro",
      windows: [
        { label: "Session", usedPercent: 22, resetsAt: null },
        { label: "Weekly", usedPercent: 81.6, resetsAt: null },
      ],
    },
    {
      providerId: "claude-code",
      status: "unauthenticated",
      planLabel: null,
      windows: [],
    },
  ],
};

describe("usage posters", () => {
  test("lays one poster centrally and two posters symmetrically", () => {
    const codex = { providerId: "codex", displayName: "Codex" };
    const claude = {
      providerId: "claude-code",
      displayName: "Claude Code",
    };

    expect(buildUsagePosters([codex], snapshot)[0]?.placement.x).toBe(209);
    expect(
      buildUsagePosters([codex, claude], snapshot).map(
        (poster) => poster.placement.x,
      ),
    ).toEqual([81, 337]);
  });

  test("uses the most constrained window without changing worker data", () => {
    const [poster] = buildUsagePosters(
      [{ providerId: "codex", displayName: "Codex" }],
      snapshot,
    );

    expect(poster?.primaryWindow?.label).toBe("Weekly");
    expect(poster ? usagePosterSummary(poster) : null).toBe(
      "82% used · Weekly",
    );
  });

  test("provides short provider marks and useful unavailable copy", () => {
    expect(providerMonogram("Codex")).toBe("CX");
    expect(providerMonogram("Claude Code")).toBe("CC");
    const poster = buildUsagePosters(
      [{ providerId: "claude-code", displayName: "Claude Code" }],
      snapshot,
    )[0];
    expect(poster ? usagePosterSummary(poster) : null).toBe(
      "Sign-in required",
    );
  });
});
