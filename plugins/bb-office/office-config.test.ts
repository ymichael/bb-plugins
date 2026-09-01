import { describe, expect, test } from "vitest";
import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { createOfficeConfigModule, OfficeConfigError } from "./office-config";
import { DEFAULT_OFFICE_CONFIG } from "./office-config-schema";
import { compileOfficeBlueprint } from "./office-blueprint";
import { pixelFurnitureCatalog } from "./furniture-assets";
import { applyOfficeDecor, buildDetailedOfficeLayout } from "./office-layout";
import { buildDynamicCatalog } from "./vendor/pixel-agents/webview-ui/src/office/layout/furnitureCatalog";

function emptySprite(width: number, height: number): string[][] {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ""),
  );
}

function memoryKv(initial: Record<string, unknown> = {}): PluginKvStorage {
  const values = new Map(Object.entries(initial));
  return {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
    list: async (prefix = "") =>
      [...values.keys()].filter((key) => key.startsWith(prefix)),
  };
}

describe("OfficeConfig", () => {
  test("previews without side effects and applies one validated global revision", async () => {
    const changes: number[] = [];
    const officeConfig = createOfficeConfigModule({
      kv: memoryKv(),
      now: () => 1_000_000,
      publish: (revision) => changes.push(revision),
    });

    const initial = await officeConfig.read();
    expect(initial).toMatchObject({
      revision: 0,
      source: "implicit-factory",
      config: DEFAULT_OFFICE_CONFIG,
    });

    const proposal = await officeConfig.preview({
      expectedRevision: 0,
      base: "current",
      edits: [
        { kind: "set-appearance", mode: "neutral" },
        {
          kind: "set-behavior",
          changes: { inactiveExitAfterMinutes: 15, ambientMotion: "off" },
        },
        {
          kind: "set-decor",
          changes: { pets: false, coffee: false },
        },
      ],
    });
    expect(proposal).toMatchObject({
      outcome: "ready",
      baseRevision: 0,
      config: {
        appearance: { mode: "neutral" },
        behavior: { inactiveExitAfterMinutes: 15, ambientMotion: "off" },
        decor: { pets: false, coffee: false },
      },
    });
    expect((await officeConfig.read()).revision).toBe(0);
    expect(changes).toEqual([]);
    if (proposal.outcome !== "ready") throw new Error("Expected a proposal");

    const applied = await officeConfig.apply({
      expectedRevision: proposal.baseRevision,
      proposalId: proposal.proposalId,
    });
    expect(applied).toMatchObject({
      revision: 1,
      source: "persisted",
      config: proposal.config,
    });
    expect(changes).toEqual([1]);
    expect(await officeConfig.read()).toMatchObject(applied);
  });

  test("allows only one concurrent proposal to win a revision", async () => {
    const officeConfig = createOfficeConfigModule({
      kv: memoryKv(),
      publish: () => {},
    });
    const left = await officeConfig.preview({
      expectedRevision: 0,
      base: "current",
      edits: [{ kind: "set-appearance", mode: "neutral" }],
    });
    const right = await officeConfig.preview({
      expectedRevision: 0,
      base: "current",
      edits: [{ kind: "set-decor", changes: { pets: false } }],
    });
    if (left.outcome !== "ready" || right.outcome !== "ready") {
      throw new Error("Expected ready proposals");
    }

    const outcomes = await Promise.allSettled([
      officeConfig.apply({
        expectedRevision: 0,
        proposalId: left.proposalId,
      }),
      officeConfig.apply({
        expectedRevision: 0,
        proposalId: right.proposalId,
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toMatchObject({ code: "revision_conflict" });
    }
    expect((await officeConfig.read()).revision).toBe(1);
  });

  test("rejects malformed persisted state instead of silently replacing it", async () => {
    const officeConfig = createOfficeConfigModule({
      kv: memoryKv({
        "office-config/global": {
          storageVersion: 1,
          revision: 2,
          updatedAtMs: 5,
          config: { schemaVersion: 99 },
        },
      }),
      publish: () => {},
    });
    await expect(officeConfig.read()).rejects.toEqual(
      expect.objectContaining<Partial<OfficeConfigError>>({
        code: "invalid_stored_config",
      }),
    );
  });

  test("does not read legacy project-partitioned configuration", async () => {
    const officeConfig = createOfficeConfigModule({
      kv: memoryKv({
        "office-config/project/project-a": {
          storageVersion: 1,
          revision: 9,
          updatedAtMs: 5,
          config: { schemaVersion: 99 },
        },
      }),
      publish: () => {},
    });

    expect(await officeConfig.read()).toMatchObject({
      revision: 0,
      source: "implicit-factory",
      config: DEFAULT_OFFICE_CONFIG,
    });
  });

  test("decor controls remove only optional art while preserving routes and seats", () => {
    buildDynamicCatalog({
      catalog: pixelFurnitureCatalog,
      sprites: Object.fromEntries(
        pixelFurnitureCatalog.map((entry) => [
          entry.id,
          emptySprite(entry.width, entry.height),
        ]),
      ),
    });
    const layout = applyOfficeDecor(buildDetailedOfficeLayout(), {
      pets: false,
      coffee: false,
      plants: false,
      wallDecor: false,
    });
    const blueprint = compileOfficeBlueprint("compact", layout);

    expect(layout.pets).toEqual([]);
    expect(
      layout.furniture.some((item) => item.uid.includes("coffee")),
    ).toBe(false);
    expect(blueprint.workCapacity).toBe(12);
    expect(
      blueprint.rooms.filter((room) => room.purpose === "meeting"),
    ).toHaveLength(3);
    expect(blueprint.seats.filter((seat) => seat.role === "rest")).toHaveLength(8);
  });
});
