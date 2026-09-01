import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BB_OFFICE_ASSET_ROOT } from "./asset-loader";
import { resolveAssetDirectory } from "./server";

describe("managed server asset resolution", () => {
  it("finds the same asset directory from source and dist entry points", () => {
    expect(BB_OFFICE_ASSET_ROOT).toBe("/api/v1/plugins/bb-office/http/assets");
    const sourceDirectory = resolveAssetDirectory(import.meta.url);
    const builtDirectory = resolveAssetDirectory(
      new URL("./dist/server.js", import.meta.url).href,
    );

    expect(builtDirectory).toBe(sourceDirectory);
    expect(existsSync(sourceDirectory)).toBe(true);
  });
});
