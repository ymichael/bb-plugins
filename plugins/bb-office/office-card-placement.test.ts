import { describe, expect, test } from "vitest";
import { calculateOfficeCardPlacement } from "./office-card-placement";

const BASE_INPUT = {
  stageWidth: 800,
  stageHeight: 500,
  cardWidth: 280,
  cardHeight: 116,
  anchorX: 400,
  anchorTop: 250,
  anchorBottom: 282,
  inset: 8,
  gap: 10,
} as const;

describe("office hover cue placement", () => {
  test("centers above a worker when space is available", () => {
    expect(calculateOfficeCardPlacement(BASE_INPUT)).toEqual({
      left: 260,
      top: 124,
      side: "above",
    });
  });

  test("flips below workers near the top wall", () => {
    expect(
      calculateOfficeCardPlacement({
        ...BASE_INPUT,
        anchorTop: 40,
        anchorBottom: 72,
      }),
    ).toEqual({
      left: 260,
      top: 82,
      side: "below",
    });
  });

  test("keeps the cue and pointer inside both horizontal edges", () => {
    expect(
      calculateOfficeCardPlacement({
        ...BASE_INPUT,
        anchorX: 4,
      }),
    ).toEqual({
      left: 8,
      top: 124,
      side: "above",
    });
    expect(
      calculateOfficeCardPlacement({
        ...BASE_INPUT,
        anchorX: 796,
      }),
    ).toEqual({
      left: 512,
      top: 124,
      side: "above",
    });
  });
});
