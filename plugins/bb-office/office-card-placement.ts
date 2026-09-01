export interface OfficeCardPlacementInput {
  stageWidth: number;
  stageHeight: number;
  cardWidth: number;
  cardHeight: number;
  anchorX: number;
  anchorTop: number;
  anchorBottom: number;
  inset: number;
  gap: number;
}

export interface OfficeCardPlacement {
  left: number;
  top: number;
  side: "above" | "below";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function calculateOfficeCardPlacement(
  input: OfficeCardPlacementInput,
): OfficeCardPlacement {
  const maximumLeft = Math.max(
    input.inset,
    input.stageWidth - input.cardWidth - input.inset,
  );
  const maximumTop = Math.max(
    input.inset,
    input.stageHeight - input.cardHeight - input.inset,
  );
  const left = clamp(
    input.anchorX - input.cardWidth / 2,
    input.inset,
    maximumLeft,
  );
  const aboveTop = input.anchorTop - input.gap - input.cardHeight;
  const belowTop = input.anchorBottom + input.gap;
  const fitsAbove = aboveTop >= input.inset;
  const fitsBelow =
    belowTop + input.cardHeight <= input.stageHeight - input.inset;
  const side = fitsAbove || !fitsBelow ? "above" : "below";
  const top = clamp(
    side === "above" ? aboveTop : belowTop,
    input.inset,
    maximumTop,
  );
  return { left, top, side };
}
