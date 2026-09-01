import { describe, expect, test } from "vitest";
import { officeViewportZoom } from "./office-canvas";

describe("pixel office viewport zoom", () => {
  test("fills a resized floating panel continuously", () => {
    expect(officeViewportZoom(1.4, "floating")).toBe(1.4);
    expect(officeViewportZoom(2.81, "floating")).toBe(2.81);
  });

  test("retains integer pixel steps on fixed surfaces", () => {
    expect(officeViewportZoom(2.81, "full")).toBe(2);
    expect(officeViewportZoom(2.81, "sidebar")).toBe(2);
    expect(officeViewportZoom(0.8, "full")).toBe(0.8);
  });
});
