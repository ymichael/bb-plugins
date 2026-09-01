import { CENTERED_COFFEE_ID, MEETING_TABLE_FRONT_ID } from "./furniture-assets";
import type { OfficeConfig } from "./office-config-schema";
import {
  ORIGINAL_OFFICE_VISUAL_THEME,
  type OfficeVisualTheme,
  resolveOfficeEnvironmentPalette,
} from "./office-theme";
import { placeFurniture } from "./vendor/pixel-agents/webview-ui/src/office/editor/editorActions";
import { getCatalogEntry } from "./vendor/pixel-agents/webview-ui/src/office/layout/furnitureCatalog";
import {
  getBlockedTiles,
  layoutToSeats,
  layoutToTileMap,
} from "./vendor/pixel-agents/webview-ui/src/office/layout/layoutSerializer";
import { findPath } from "./vendor/pixel-agents/webview-ui/src/office/layout/tileMap";
import type {
  CarpetTile,
  ColorValue,
  OfficeLayout,
  PlacedFurniture,
  TileType as TileTypeValue,
} from "./vendor/pixel-agents/webview-ui/src/office/types";
import {
  Direction,
  TileType,
} from "./vendor/pixel-agents/webview-ui/src/office/types";

const COLS = 25;
const ROWS = 26;

export const COMMONS_SUITE_ENTRANCE = { col: 12, row: 25 } as const;
export const OFFICE_ENTRANCE = COMMONS_SUITE_ENTRANCE;

function isWall(col: number, row: number): boolean {
  if (row === 2 || row === ROWS - 1) return true;
  if ((col === 0 || col === COLS - 1) && row >= 2) return true;
  if (row === 8) return true;
  if ((col === 8 || col === 16) && row <= 8) return true;
  return false;
}

function isDoor(col: number, row: number): boolean {
  return (
    (col === COMMONS_SUITE_ENTRANCE.col &&
      row === COMMONS_SUITE_ENTRANCE.row) ||
    (row === 8 && (col === 4 || col === 12 || col === 20))
  );
}

function floorAt(
  col: number,
  row: number,
  palette: ReturnType<typeof resolveOfficeEnvironmentPalette>,
): {
  type: TileTypeValue;
  color: ColorValue | null;
} {
  if (row < 2) return { type: TileType.VOID, color: null };
  if (isWall(col, row) && !isDoor(col, row)) {
    return { type: TileType.WALL, color: palette.floors.wall };
  }
  if (row <= 8)
    return { type: TileType.FLOOR_1, color: palette.floors.meeting };
  if (row >= 19)
    return { type: TileType.FLOOR_5, color: palette.floors.social };
  return { type: TileType.FLOOR_7, color: palette.floors.open };
}

function carpetAt(
  col: number,
  row: number,
  palette: ReturnType<typeof resolveOfficeEnvironmentPalette>,
): CarpetTile | null {
  if (col >= 2 && col <= 5 && row >= 3 && row <= 7) {
    return { variant: 2, ...palette.carpets.meeting };
  }
  if (col >= 10 && col <= 13 && row >= 3 && row <= 7) {
    return { variant: 2, ...palette.carpets.meeting };
  }
  if (col >= 18 && col <= 21 && row >= 3 && row <= 7) {
    return { variant: 2, ...palette.carpets.meeting };
  }
  if (col >= 1 && col <= 10 && row >= 20 && row <= 24) {
    return { variant: 1, ...palette.carpets.social };
  }
  if (col >= 14 && col <= 23 && row >= 20 && row <= 24) {
    return { variant: 0, ...palette.carpets.lounge };
  }
  return null;
}

function visualLayers(theme: OfficeVisualTheme): {
  tiles: TileTypeValue[];
  tileColors: Array<ReturnType<typeof floorAt>["color"]>;
  carpetTiles: Array<CarpetTile | null>;
} {
  const palette = resolveOfficeEnvironmentPalette(theme);
  const tiles: TileTypeValue[] = [];
  const tileColors: Array<ReturnType<typeof floorAt>["color"]> = [];
  const carpetTiles: Array<CarpetTile | null> = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const floor = floorAt(col, row, palette);
      tiles.push(floor.type);
      tileColors.push(floor.color);
      carpetTiles.push(
        floor.type === TileType.WALL || floor.type === TileType.VOID
          ? null
          : carpetAt(col, row, palette),
      );
    }
  }
  return { tiles, tileColors, carpetTiles };
}

function emptyLayout(theme: OfficeVisualTheme): OfficeLayout {
  const { tiles, tileColors, carpetTiles } = visualLayers(theme);
  return {
    version: 1,
    cols: COLS,
    rows: ROWS,
    layoutRevision: 15,
    tiles,
    tileColors,
    carpetTiles,
    furniture: [],
    pets: [
      { id: "commons-claudio", petType: 0 },
      { id: "commons-gitcat", petType: 1 },
    ],
  };
}

function add(
  layout: OfficeLayout,
  uid: string,
  type: string,
  col: number,
  row: number,
): OfficeLayout {
  const item: PlacedFurniture = { uid, type, col, row };
  const placed = placeFurniture(layout, item);
  if (placed === layout) {
    throw new Error(`Pixel Agents rejected ${uid} (${type}) at ${col},${row}`);
  }
  return placed;
}

function addMany(
  layout: OfficeLayout,
  items: ReadonlyArray<readonly [string, string, number, number]>,
): OfficeLayout {
  let next = layout;
  for (const [uid, type, col, row] of items)
    next = add(next, uid, type, col, row);
  return next;
}

function addMeetingRoom(layout: OfficeLayout): OfficeLayout {
  return addMany(layout, [
    ["commons-meeting-board", "WHITEBOARD", 2, 1],
    ["commons-meeting-art", "SMALL_PAINTING_2", 5, 1],
    ["commons-meeting-table", MEETING_TABLE_FRONT_ID, 3, 3],
    ["commons-meeting-coffee", CENTERED_COFFEE_ID, 3, 4],
    ["commons-meeting-left-top", "CUSHIONED_CHAIR_SIDE", 2, 3],
    ["commons-meeting-left-bottom", "CUSHIONED_CHAIR_SIDE", 2, 5],
    ["commons-meeting-right-top", "CUSHIONED_CHAIR_SIDE:left", 5, 3],
    ["commons-meeting-right-bottom", "CUSHIONED_CHAIR_SIDE:left", 5, 5],
    ["commons-meeting-plant", "PLANT", 6, 5],
  ]);
}

function addMeetingRoomB(layout: OfficeLayout): OfficeLayout {
  return addMany(layout, [
    ["commons-meeting-b-board", "WHITEBOARD", 9, 1],
    ["commons-meeting-b-clock", "CLOCK", 15, 1],
    ["commons-meeting-b-table", MEETING_TABLE_FRONT_ID, 11, 3],
    ["commons-meeting-b-coffee", CENTERED_COFFEE_ID, 11, 4],
    ["commons-meeting-b-left-top", "CUSHIONED_CHAIR_SIDE", 10, 3],
    ["commons-meeting-b-left-bottom", "CUSHIONED_CHAIR_SIDE", 10, 5],
    ["commons-meeting-b-right-top", "CUSHIONED_CHAIR_SIDE:left", 13, 3],
    ["commons-meeting-b-right-bottom", "CUSHIONED_CHAIR_SIDE:left", 13, 5],
    ["commons-meeting-b-plant", "PLANT_2", 14, 5],
  ]);
}

function addMeetingRoomC(layout: OfficeLayout): OfficeLayout {
  return addMany(layout, [
    ["commons-meeting-c-board", "SMALL_PAINTING", 17, 1],
    ["commons-meeting-c-clock", "CLOCK", 22, 1],
    ["commons-meeting-c-table", MEETING_TABLE_FRONT_ID, 19, 3],
    ["commons-meeting-c-left-top", "CUSHIONED_CHAIR_SIDE", 18, 3],
    ["commons-meeting-c-left-bottom", "CUSHIONED_CHAIR_SIDE", 18, 5],
    ["commons-meeting-c-right-top", "CUSHIONED_CHAIR_SIDE:left", 21, 3],
    ["commons-meeting-c-right-bottom", "CUSHIONED_CHAIR_SIDE:left", 21, 5],
    ["commons-meeting-c-plant", "CACTUS", 22, 5],
  ]);
}

function addWorkbench(
  layout: OfficeLayout,
  prefix: "west" | "east",
  tableCol: number,
): OfficeLayout {
  const leftCol = tableCol - 1;
  const rightCol = tableCol + 3;
  const coffeeRow = prefix === "west" ? 11 : 17;
  return addMany(layout, [
    [`commons-${prefix}-table`, "WORKBENCH_FRONT", tableCol, 10],
    [`commons-${prefix}-left-1`, "CUSHIONED_CHAIR_SIDE", leftCol, 11],
    [`commons-${prefix}-left-2`, "CUSHIONED_CHAIR_SIDE", leftCol, 14],
    [`commons-${prefix}-left-3`, "CUSHIONED_CHAIR_SIDE", leftCol, 17],
    [`commons-${prefix}-right-1`, "CUSHIONED_CHAIR_SIDE:left", rightCol, 11],
    [`commons-${prefix}-right-2`, "CUSHIONED_CHAIR_SIDE:left", rightCol, 14],
    [`commons-${prefix}-right-3`, "CUSHIONED_CHAIR_SIDE:left", rightCol, 17],
    [`commons-${prefix}-pc-left-top`, "PC_SIDE", tableCol, 10],
    [`commons-${prefix}-pc-left-middle`, "PC_SIDE", tableCol, 13],
    [`commons-${prefix}-pc-left-bottom`, "PC_SIDE", tableCol, 16],
    [`commons-${prefix}-pc-right-top`, "PC_SIDE:left", tableCol + 2, 10],
    [`commons-${prefix}-pc-right-middle`, "PC_SIDE:left", tableCol + 2, 13],
    [`commons-${prefix}-pc-right-bottom`, "PC_SIDE:left", tableCol + 2, 16],
    [`commons-${prefix}-coffee`, "COFFEE", tableCol + 1, coffeeRow],
  ]);
}

function addOpenWorkspace(layout: OfficeLayout): OfficeLayout {
  let next = addWorkbench(layout, "west", 5);
  next = addWorkbench(next, "east", 16);
  return addMany(next, [
    ["commons-work-plant-nw", "LARGE_PLANT", 2, 10],
    ["commons-work-plant-ne", "LARGE_PLANT", 22, 10],
    ["commons-work-cactus", "CACTUS", 12, 15],
  ]);
}

function addLounges(layout: OfficeLayout): OfficeLayout {
  return addMany(layout, [
    ["commons-media-sofa-left", "SOFA_FRONT", 2, 20],
    ["commons-media-sofa-right", "SOFA_FRONT", 6, 20],
    ["commons-media-table", "COFFEE_TABLE", 4, 22],
    ["commons-media-coffee", "COFFEE", 4, 23],
    ["commons-media-screen", "MEDIA_SCREEN", 4, 24],
    ["commons-media-plant", "PLANT_2", 10, 21],
    ["commons-team-books", "DOUBLE_BOOKSHELF", 14, 24],
    ["commons-team-sofa-north", "SOFA_FRONT", 18, 20],
    ["commons-team-table", "COFFEE_TABLE", 18, 21],
    ["commons-team-coffee", "COFFEE", 18, 22],
    ["commons-team-sofa-south", "SOFA_BACK", 18, 23],
    ["commons-team-plant", "LARGE_PLANT", 22, 21],
    ["commons-entry-plant-left", "PLANT_2", 10, 23],
    ["commons-entry-plant-right", "PLANT", 15, 22],
  ]);
}

const EXPECTED_FACING = new Map<string, Direction>([
  ["commons-meeting-left-top", Direction.RIGHT],
  ["commons-meeting-left-bottom", Direction.RIGHT],
  ["commons-meeting-right-top", Direction.LEFT],
  ["commons-meeting-right-bottom", Direction.LEFT],
  ["commons-meeting-b-left-top", Direction.RIGHT],
  ["commons-meeting-b-left-bottom", Direction.RIGHT],
  ["commons-meeting-b-right-top", Direction.LEFT],
  ["commons-meeting-b-right-bottom", Direction.LEFT],
  ["commons-meeting-c-left-top", Direction.RIGHT],
  ["commons-meeting-c-left-bottom", Direction.RIGHT],
  ["commons-meeting-c-right-top", Direction.LEFT],
  ["commons-meeting-c-right-bottom", Direction.LEFT],
  ["commons-west-left-1", Direction.RIGHT],
  ["commons-west-right-1", Direction.LEFT],
  ["commons-east-left-1", Direction.RIGHT],
  ["commons-east-right-1", Direction.LEFT],
  ["commons-media-sofa-left", Direction.DOWN],
  ["commons-media-sofa-right", Direction.DOWN],
  ["commons-team-sofa-north", Direction.DOWN],
  ["commons-team-sofa-south", Direction.UP],
]);

function validateLayout(layout: OfficeLayout): void {
  for (const item of layout.furniture) {
    if (!getCatalogEntry(item.type))
      throw new Error(`Unknown furniture type ${item.type}`);
  }
  const seats = layoutToSeats(layout.furniture);
  if (seats.size !== 32) {
    throw new Error(`Commons Suite 12 has ${seats.size} seats, expected 32`);
  }
  const workSeats = [...seats.keys()].filter(
    (seatId) =>
      seatId.startsWith("commons-west-") || seatId.startsWith("commons-east-"),
  );
  if (workSeats.length !== 12) {
    throw new Error(
      `Commons Suite 12 has ${workSeats.length} work seats, expected 12`,
    );
  }
  const tileMap = layoutToTileMap(layout);
  const blocked = getBlockedTiles(layout.furniture);
  for (const [seatId, seat] of seats) {
    const expected = [...EXPECTED_FACING].find(
      ([prefix]) => seatId === prefix || seatId.startsWith(`${prefix}:`),
    );
    if (expected && seat.facingDir !== expected[1]) {
      throw new Error(
        `Seat ${seatId} faces ${seat.facingDir}, expected ${expected[1]}`,
      );
    }
    const routeBlocks = new Set(blocked);
    routeBlocks.delete(`${seat.seatCol},${seat.seatRow}`);
    const path = findPath(
      COMMONS_SUITE_ENTRANCE.col,
      COMMONS_SUITE_ENTRANCE.row,
      seat.seatCol,
      seat.seatRow,
      tileMap,
      routeBlocks,
    );
    if (path.length === 0) {
      throw new Error(
        `Seat ${seatId} at ${seat.seatCol},${seat.seatRow} is unreachable`,
      );
    }
  }
  for (const prefix of EXPECTED_FACING.keys()) {
    if (
      ![...seats.keys()].some(
        (seatId) => seatId === prefix || seatId.startsWith(`${prefix}:`),
      )
    ) {
      throw new Error(`Expected seat ${prefix} was not generated`);
    }
  }
}

export function withDetailedOfficeVisualTheme(
  layout: OfficeLayout,
  theme: OfficeVisualTheme,
): OfficeLayout {
  if (layout.cols !== COLS || layout.rows !== ROWS) {
    throw new Error("Commons Suite 12 theme requires the authored 25×26 shell");
  }
  const { tileColors, carpetTiles } = visualLayers(theme);
  return { ...layout, tileColors, carpetTiles };
}

const PLANT_TYPES = new Set(["CACTUS", "HANGING_PLANT", "LARGE_PLANT", "PLANT", "PLANT_2", "POT"]);
const WALL_DECOR_TYPES = new Set([
  "CLOCK",
  "LARGE_PAINTING",
  "SMALL_PAINTING",
  "SMALL_PAINTING_2",
]);

export function applyOfficeDecor(
  layout: OfficeLayout,
  decor: OfficeConfig["decor"],
): OfficeLayout {
  const furniture = layout.furniture.filter((item) => {
    if (!decor.coffee && item.uid.includes("coffee")) return false;
    if (!decor.plants && PLANT_TYPES.has(item.type.split(":")[0] ?? item.type))
      return false;
    if (
      !decor.wallDecor &&
      WALL_DECOR_TYPES.has(item.type.split(":")[0] ?? item.type)
    )
      return false;
    return true;
  });
  return {
    ...layout,
    furniture,
    pets: decor.pets ? layout.pets : [],
  };
}

export function buildDetailedOfficeLayout(
  theme: OfficeVisualTheme = ORIGINAL_OFFICE_VISUAL_THEME,
): OfficeLayout {
  let layout = emptyLayout(theme);
  layout = addMeetingRoom(layout);
  layout = addMeetingRoomB(layout);
  layout = addMeetingRoomC(layout);
  layout = addOpenWorkspace(layout);
  layout = addLounges(layout);
  validateLayout(layout);
  return layout;
}
