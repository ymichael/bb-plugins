import { z } from "zod";

export type FloatingOfficeMode = "expanded" | "worker";
export type FloatingOfficeHorizontalAnchor = "left" | "right";
export type FloatingOfficeVerticalAnchor = "top" | "bottom";

export interface FloatingOfficePoint {
  x: number;
  y: number;
}

export interface FloatingOfficeSize {
  width: number;
  height: number;
}

export interface FloatingOfficeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FloatingOfficeFrame extends FloatingOfficeSize {
  x: number;
  y: number;
  originX: number;
  originY: number;
}

export const FLOATING_OFFICE_WORKER_SIZE: FloatingOfficeSize = {
  width: 72,
  height: 72,
};

export const FLOATING_OFFICE_DEFAULT_WIDTH = 432;
export const FLOATING_OFFICE_MIN_WIDTH = 280;
export const FLOATING_OFFICE_MAX_WIDTH = 720;
export const FLOATING_OFFICE_SAFE_INSETS: FloatingOfficeInsets = {
  top: 16,
  right: 16,
  bottom: 16,
  left: 16,
};
export const FLOATING_OFFICE_SNAP_THRESHOLD = 24;

export const floatingOfficeStateSchema = z
  .object({
    schemaVersion: z.literal(2),
    mode: z.enum(["expanded", "worker"]),
    anchorX: z.number().finite().nonnegative(),
    anchorY: z.number().finite().nonnegative(),
    anchorHorizontal: z.enum(["left", "right"]),
    anchorVertical: z.enum(["top", "bottom"]),
    expandedWidth: z.number().finite().positive(),
  })
  .strict();

const legacyFloatingOfficePlacementSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(["expanded", "worker"]),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
  })
  .strict();

export type FloatingOfficeState = z.infer<typeof floatingOfficeStateSchema>;

interface AxisBounds {
  minimum: number;
  maximum: number;
}

function nonnegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}

function axisBounds(
  viewportExtent: number,
  itemExtent: number,
  startInset: number,
  endInset: number,
): AxisBounds {
  const availableMaximum = Math.max(
    0,
    nonnegativeFinite(viewportExtent) - nonnegativeFinite(itemExtent),
  );
  const minimum = Math.min(nonnegativeFinite(startInset), availableMaximum);
  const maximum = Math.max(
    minimum,
    availableMaximum - nonnegativeFinite(endInset),
  );
  return { minimum, maximum };
}

function frameBounds(
  viewport: FloatingOfficeSize,
  frame: FloatingOfficeSize,
  insets: FloatingOfficeInsets,
): { horizontal: AxisBounds; vertical: AxisBounds } {
  return {
    horizontal: axisBounds(
      viewport.width,
      frame.width,
      insets.left,
      insets.right,
    ),
    vertical: axisBounds(
      viewport.height,
      frame.height,
      insets.top,
      insets.bottom,
    ),
  };
}

export function expandedOfficeSize(width: number): FloatingOfficeSize {
  const normalizedWidth = Math.max(1, Math.round(width));
  return {
    width: normalizedWidth,
    height: Math.round((normalizedWidth * 26) / 25),
  };
}

export function maximumExpandedOfficeWidth(
  viewport: FloatingOfficeSize,
  insets: FloatingOfficeInsets = FLOATING_OFFICE_SAFE_INSETS,
): number {
  const widthAvailable = Math.max(
    FLOATING_OFFICE_WORKER_SIZE.width,
    viewport.width - insets.left - insets.right,
  );
  const heightAvailable = Math.max(
    FLOATING_OFFICE_WORKER_SIZE.height,
    viewport.height - insets.top - insets.bottom,
  );
  return Math.floor(
    Math.min(
      FLOATING_OFFICE_MAX_WIDTH,
      widthAvailable,
      (heightAvailable * 25) / 26,
    ),
  );
}

export function clampExpandedOfficeWidth(
  width: number,
  viewport: FloatingOfficeSize,
  insets: FloatingOfficeInsets = FLOATING_OFFICE_SAFE_INSETS,
): number {
  const maximum = maximumExpandedOfficeWidth(viewport, insets);
  const minimum = Math.min(FLOATING_OFFICE_MIN_WIDTH, maximum);
  return Math.round(clamp(width, minimum, maximum));
}

export function clampFloatingOfficeState(
  state: FloatingOfficeState,
  viewport: FloatingOfficeSize,
  insets: FloatingOfficeInsets = FLOATING_OFFICE_SAFE_INSETS,
): FloatingOfficeState {
  const workerBounds = frameBounds(
    viewport,
    FLOATING_OFFICE_WORKER_SIZE,
    insets,
  );
  return {
    ...state,
    anchorX: clamp(
      state.anchorX,
      workerBounds.horizontal.minimum,
      workerBounds.horizontal.maximum,
    ),
    anchorY: clamp(
      state.anchorY,
      workerBounds.vertical.minimum,
      workerBounds.vertical.maximum,
    ),
    expandedWidth: clampExpandedOfficeWidth(
      state.expandedWidth,
      viewport,
      insets,
    ),
  };
}

export function redockFloatingOfficeState(
  state: FloatingOfficeState,
  viewport: FloatingOfficeSize,
): FloatingOfficeState {
  const workerCenterX =
    state.anchorX + FLOATING_OFFICE_WORKER_SIZE.width / 2;
  const workerCenterY =
    state.anchorY + FLOATING_OFFICE_WORKER_SIZE.height / 2;
  return {
    ...state,
    anchorHorizontal: workerCenterX <= viewport.width / 2 ? "left" : "right",
    anchorVertical: workerCenterY <= viewport.height / 2 ? "top" : "bottom",
  };
}

export function defaultFloatingOfficeState(
  viewport: FloatingOfficeSize,
  mode: FloatingOfficeMode = "expanded",
  insets: FloatingOfficeInsets = FLOATING_OFFICE_SAFE_INSETS,
): FloatingOfficeState {
  const workerBounds = frameBounds(
    viewport,
    FLOATING_OFFICE_WORKER_SIZE,
    insets,
  );
  return clampFloatingOfficeState(
    {
      schemaVersion: 2,
      mode,
      anchorX: workerBounds.horizontal.maximum,
      anchorY: workerBounds.vertical.maximum,
      anchorHorizontal: "right",
      anchorVertical: "bottom",
      expandedWidth: FLOATING_OFFICE_DEFAULT_WIDTH,
    },
    viewport,
    insets,
  );
}

export function floatingOfficeFrame(
  state: FloatingOfficeState,
  viewport: FloatingOfficeSize,
  insets: FloatingOfficeInsets = FLOATING_OFFICE_SAFE_INSETS,
): FloatingOfficeFrame {
  const clampedState = clampFloatingOfficeState(state, viewport, insets);
  if (clampedState.mode === "worker") {
    return {
      x: clampedState.anchorX,
      y: clampedState.anchorY,
      width: FLOATING_OFFICE_WORKER_SIZE.width,
      height: FLOATING_OFFICE_WORKER_SIZE.height,
      originX: FLOATING_OFFICE_WORKER_SIZE.width / 2,
      originY: FLOATING_OFFICE_WORKER_SIZE.height / 2,
    };
  }
  const size = expandedOfficeSize(clampedState.expandedWidth);
  const bounds = frameBounds(viewport, size, insets);
  const idealX =
    clampedState.anchorHorizontal === "left"
      ? clampedState.anchorX
      : clampedState.anchorX + FLOATING_OFFICE_WORKER_SIZE.width - size.width;
  const idealY =
    clampedState.anchorVertical === "top"
      ? clampedState.anchorY
      : clampedState.anchorY + FLOATING_OFFICE_WORKER_SIZE.height - size.height;
  const x = clamp(idealX, bounds.horizontal.minimum, bounds.horizontal.maximum);
  const y = clamp(idealY, bounds.vertical.minimum, bounds.vertical.maximum);
  return {
    x,
    y,
    ...size,
    originX: clamp(
      clampedState.anchorX + FLOATING_OFFICE_WORKER_SIZE.width / 2 - x,
      0,
      size.width,
    ),
    originY: clamp(
      clampedState.anchorY + FLOATING_OFFICE_WORKER_SIZE.height / 2 - y,
      0,
      size.height,
    ),
  };
}

export function moveFloatingOfficeState(
  state: FloatingOfficeState,
  delta: FloatingOfficePoint,
  viewport: FloatingOfficeSize,
  insets: FloatingOfficeInsets = FLOATING_OFFICE_SAFE_INSETS,
): FloatingOfficeState {
  return clampFloatingOfficeState(
    {
      ...state,
      anchorX: state.anchorX + delta.x,
      anchorY: state.anchorY + delta.y,
    },
    viewport,
    insets,
  );
}

function snapAxis(value: number, bounds: AxisBounds, threshold: number): number {
  const startDistance = Math.abs(value - bounds.minimum);
  const endDistance = Math.abs(bounds.maximum - value);
  if (Math.min(startDistance, endDistance) > nonnegativeFinite(threshold)) {
    return value;
  }
  return startDistance <= endDistance ? bounds.minimum : bounds.maximum;
}

export function snapFloatingOfficeState(
  state: FloatingOfficeState,
  viewport: FloatingOfficeSize,
  insets: FloatingOfficeInsets = FLOATING_OFFICE_SAFE_INSETS,
  threshold: number = FLOATING_OFFICE_SNAP_THRESHOLD,
): FloatingOfficeState {
  const frame = floatingOfficeFrame(state, viewport, insets);
  const bounds = frameBounds(viewport, frame, insets);
  const snappedX = snapAxis(frame.x, bounds.horizontal, threshold);
  const snappedY = snapAxis(frame.y, bounds.vertical, threshold);
  const moved = moveFloatingOfficeState(
    state,
    { x: snappedX - frame.x, y: snappedY - frame.y },
    viewport,
    insets,
  );
  return moved.mode === "worker"
    ? redockFloatingOfficeState(moved, viewport)
    : moved;
}

export function setFloatingOfficeMode(
  state: FloatingOfficeState,
  mode: FloatingOfficeMode,
): FloatingOfficeState {
  return { ...state, mode };
}

export function resizeFloatingOfficeState(
  state: FloatingOfficeState,
  width: number,
  viewport: FloatingOfficeSize,
  insets: FloatingOfficeInsets = FLOATING_OFFICE_SAFE_INSETS,
): FloatingOfficeState {
  return {
    ...state,
    expandedWidth: clampExpandedOfficeWidth(width, viewport, insets),
  };
}

function migrateLegacyState(
  legacy: z.infer<typeof legacyFloatingOfficePlacementSchema>,
  viewport: FloatingOfficeSize,
  insets: FloatingOfficeInsets,
): FloatingOfficeState {
  const expandedWidth = clampExpandedOfficeWidth(
    FLOATING_OFFICE_DEFAULT_WIDTH,
    viewport,
    insets,
  );
  if (legacy.mode === "worker") {
    return redockFloatingOfficeState(
      clampFloatingOfficeState(
        {
          schemaVersion: 2,
          mode: legacy.mode,
          anchorX: legacy.x,
          anchorY: legacy.y,
          anchorHorizontal: "right",
          anchorVertical: "bottom",
          expandedWidth,
        },
        viewport,
        insets,
      ),
      viewport,
    );
  }
  const oldExpandedSize = { width: 432, height: 480 };
  const anchorHorizontal =
    legacy.x + oldExpandedSize.width / 2 <= viewport.width / 2
      ? "left"
      : "right";
  const anchorVertical =
    legacy.y + oldExpandedSize.height / 2 <= viewport.height / 2
      ? "top"
      : "bottom";
  return clampFloatingOfficeState(
    {
      schemaVersion: 2,
      mode: legacy.mode,
      anchorX:
        anchorHorizontal === "left"
          ? legacy.x
          : legacy.x + oldExpandedSize.width - FLOATING_OFFICE_WORKER_SIZE.width,
      anchorY:
        anchorVertical === "top"
          ? legacy.y
          : legacy.y + oldExpandedSize.height - FLOATING_OFFICE_WORKER_SIZE.height,
      anchorHorizontal,
      anchorVertical,
      expandedWidth,
    },
    viewport,
    insets,
  );
}

export function parseFloatingOfficeState(
  serialized: string | null,
  viewport: FloatingOfficeSize,
  insets: FloatingOfficeInsets = FLOATING_OFFICE_SAFE_INSETS,
): FloatingOfficeState | null {
  if (serialized === null || serialized.length === 0) return null;
  try {
    const decoded: unknown = JSON.parse(serialized);
    const current = floatingOfficeStateSchema.safeParse(decoded);
    if (current.success) {
      return clampFloatingOfficeState(current.data, viewport, insets);
    }
    const legacy = legacyFloatingOfficePlacementSchema.safeParse(decoded);
    return legacy.success
      ? migrateLegacyState(legacy.data, viewport, insets)
      : null;
  } catch {
    return null;
  }
}

export function serializeFloatingOfficeState(
  state: FloatingOfficeState,
): string {
  return JSON.stringify(floatingOfficeStateSchema.parse(state));
}
