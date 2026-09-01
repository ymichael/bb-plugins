import { describe, expect, test } from "vitest";
import {
  clampFloatingOfficeState,
  defaultFloatingOfficeState,
  expandedOfficeSize,
  floatingOfficeFrame,
  moveFloatingOfficeState,
  parseFloatingOfficeState,
  redockFloatingOfficeState,
  resizeFloatingOfficeState,
  serializeFloatingOfficeState,
  setFloatingOfficeMode,
  snapFloatingOfficeState,
  type FloatingOfficeState,
} from "./floating-office-placement";

const DESKTOP_VIEWPORT = { width: 1_440, height: 900 };

function state(overrides: Partial<FloatingOfficeState> = {}): FloatingOfficeState {
  return {
    schemaVersion: 2,
    mode: "worker",
    anchorX: 600,
    anchorY: 400,
    anchorHorizontal: "right",
    anchorVertical: "bottom",
    expandedWidth: 432,
    ...overrides,
  };
}

describe("floating office geometry", () => {
  test("starts from one bottom-right worker anchor in both modes", () => {
    const expanded = defaultFloatingOfficeState(DESKTOP_VIEWPORT, "expanded");
    const worker = defaultFloatingOfficeState(DESKTOP_VIEWPORT, "worker");

    expect(expanded).toEqual({
      schemaVersion: 2,
      mode: "expanded",
      anchorX: 1_352,
      anchorY: 812,
      anchorHorizontal: "right",
      anchorVertical: "bottom",
      expandedWidth: 432,
    });
    expect(worker).toEqual({ ...expanded, mode: "worker" });
    expect(floatingOfficeFrame(expanded, DESKTOP_VIEWPORT)).toEqual({
      x: 992,
      y: 435,
      width: 432,
      height: 449,
      originX: 396,
      originY: 413,
    });
    expect(floatingOfficeFrame(worker, DESKTOP_VIEWPORT)).toEqual({
      x: 1_352,
      y: 812,
      width: 72,
      height: 72,
      originX: 36,
      originY: 36,
    });
  });

  test("never moves the worker through an expand and collapse cycle", () => {
    const positioned = redockFloatingOfficeState(
      state({ anchorX: 258, anchorY: 174 }),
      DESKTOP_VIEWPORT,
    );
    const before = floatingOfficeFrame(positioned, DESKTOP_VIEWPORT);
    const expanded = setFloatingOfficeMode(positioned, "expanded");
    const collapsed = setFloatingOfficeMode(expanded, "worker");

    expect(expanded.anchorX).toBe(positioned.anchorX);
    expect(expanded.anchorY).toBe(positioned.anchorY);
    expect(collapsed).toEqual(positioned);
    expect(floatingOfficeFrame(collapsed, DESKTOP_VIEWPORT)).toEqual(before);
  });

  test("preserves the worker anchor when the expanded frame must be clamped", () => {
    const positioned = state({
      anchorX: 700,
      anchorY: 700,
      anchorHorizontal: "left",
      anchorVertical: "top",
    });
    const expanded = setFloatingOfficeMode(positioned, "expanded");
    const expandedFrame = floatingOfficeFrame(expanded, DESKTOP_VIEWPORT);
    const collapsed = setFloatingOfficeMode(expanded, "worker");

    expect(expandedFrame.x).toBe(700);
    expect(expandedFrame.y).toBe(435);
    expect(collapsed.anchorX).toBe(700);
    expect(collapsed.anchorY).toBe(700);
  });

  test("resizes at a fixed worker anchor and keeps the floorplan aspect", () => {
    const positioned = state({ mode: "expanded", anchorX: 1_352, anchorY: 812 });
    const resized = resizeFloatingOfficeState(
      positioned,
      600,
      DESKTOP_VIEWPORT,
    );

    expect(expandedOfficeSize(resized.expandedWidth)).toEqual({
      width: 600,
      height: 624,
    });
    expect(resized.anchorX).toBe(positioned.anchorX);
    expect(resized.anchorY).toBe(positioned.anchorY);
    expect(floatingOfficeFrame(resized, DESKTOP_VIEWPORT)).toMatchObject({
      x: 824,
      y: 260,
      width: 600,
      height: 624,
    });
    expect(
      floatingOfficeFrame(
        setFloatingOfficeMode(resized, "worker"),
        DESKTOP_VIEWPORT,
      ),
    ).toMatchObject({ x: 1_352, y: 812, width: 72, height: 72 });
  });

  test("clamps anchors and resize bounds to the current viewport", () => {
    expect(
      clampFloatingOfficeState(
        state({ anchorX: -120, anchorY: 2_000, expandedWidth: 1_000 }),
        DESKTOP_VIEWPORT,
      ),
    ).toMatchObject({ anchorX: 16, anchorY: 812, expandedWidth: 720 });
    expect(
      clampFloatingOfficeState(
        state({ expandedWidth: 432 }),
        { width: 400, height: 300 },
      ),
    ).toMatchObject({ anchorX: 312, anchorY: 212, expandedWidth: 257 });
  });

  test("moves the worker anchor by pointer or keyboard deltas", () => {
    expect(
      moveFloatingOfficeState(
        state({ anchorX: 100, anchorY: 100 }),
        { x: 85, y: -42 },
        DESKTOP_VIEWPORT,
      ),
    ).toMatchObject({ anchorX: 185, anchorY: 58 });
    expect(
      moveFloatingOfficeState(
        state({ anchorX: 100, anchorY: 100 }),
        { x: 5_000, y: -5_000 },
        DESKTOP_VIEWPORT,
      ),
    ).toMatchObject({ anchorX: 1_352, anchorY: 16 });
  });

  test("snaps the visible frame while keeping its worker anchor coherent", () => {
    const snappedWorker = snapFloatingOfficeState(
      state({ anchorX: 30, anchorY: 800 }),
      DESKTOP_VIEWPORT,
    );
    expect(snappedWorker).toMatchObject({
      anchorX: 16,
      anchorY: 812,
      anchorHorizontal: "left",
      anchorVertical: "bottom",
    });

    const expanded = state({
      mode: "expanded",
      anchorX: 1_335,
      anchorY: 500,
    });
    const snappedExpanded = snapFloatingOfficeState(
      expanded,
      DESKTOP_VIEWPORT,
    );
    expect(floatingOfficeFrame(snappedExpanded, DESKTOP_VIEWPORT).x).toBe(992);
    expect(snappedExpanded.anchorX).toBe(1_352);
  });
});

describe("floating office persistence", () => {
  test("round-trips the explicit versioned state", () => {
    const positioned = state({
      mode: "expanded",
      anchorX: 728.5,
      anchorY: 416,
      anchorHorizontal: "left",
      anchorVertical: "bottom",
      expandedWidth: 512,
    });
    const serialized = serializeFloatingOfficeState(positioned);

    expect(serialized).toBe(
      '{"schemaVersion":2,"mode":"expanded","anchorX":728.5,"anchorY":416,"anchorHorizontal":"left","anchorVertical":"bottom","expandedWidth":512}',
    );
    expect(parseFloatingOfficeState(serialized, DESKTOP_VIEWPORT)).toEqual(
      positioned,
    );
  });

  test("migrates a collapsed v1 position without moving the worker", () => {
    expect(
      parseFloatingOfficeState(
        '{"schemaVersion":1,"mode":"worker","x":100,"y":120}',
        DESKTOP_VIEWPORT,
      ),
    ).toEqual({
      schemaVersion: 2,
      mode: "worker",
      anchorX: 100,
      anchorY: 120,
      anchorHorizontal: "left",
      anchorVertical: "top",
      expandedWidth: 432,
    });
  });

  test("migrates the old expanded bottom-right frame to its worker anchor", () => {
    expect(
      parseFloatingOfficeState(
        '{"schemaVersion":1,"mode":"expanded","x":992,"y":404}',
        DESKTOP_VIEWPORT,
      ),
    ).toEqual({
      schemaVersion: 2,
      mode: "expanded",
      anchorX: 1_352,
      anchorY: 812,
      anchorHorizontal: "right",
      anchorVertical: "bottom",
      expandedWidth: 432,
    });
  });

  test.each([
    null,
    "",
    "not json",
    "null",
    '{"schemaVersion":3,"mode":"worker","anchorX":10,"anchorY":20,"anchorHorizontal":"left","anchorVertical":"top","expandedWidth":432}',
    '{"schemaVersion":2,"mode":"collapsed","anchorX":10,"anchorY":20,"anchorHorizontal":"left","anchorVertical":"top","expandedWidth":432}',
    '{"schemaVersion":2,"mode":"worker","anchorX":"10","anchorY":20,"anchorHorizontal":"left","anchorVertical":"top","expandedWidth":432}',
    '{"schemaVersion":2,"mode":"worker","anchorX":-1,"anchorY":20,"anchorHorizontal":"left","anchorVertical":"top","expandedWidth":432}',
    '{"schemaVersion":2,"mode":"worker","anchorX":10,"anchorY":20,"anchorHorizontal":"left","anchorVertical":"top"}',
    '{"schemaVersion":2,"mode":"worker","anchorX":10,"anchorY":20,"anchorHorizontal":"left","anchorVertical":"top","expandedWidth":432,"extra":true}',
  ])("rejects untrusted persisted input %s", (serialized) => {
    expect(parseFloatingOfficeState(serialized, DESKTOP_VIEWPORT)).toBeNull();
  });
});
