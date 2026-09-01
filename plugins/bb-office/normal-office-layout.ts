import type { ColorValue } from "./vendor/pixel-agents/webview-ui/src/components/ui/types";
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
  OfficeLayout,
  PlacedFurniture,
  TileType as TileTypeValue,
} from "./vendor/pixel-agents/webview-ui/src/office/types";
import {
  Direction,
  TileType,
} from "./vendor/pixel-agents/webview-ui/src/office/types";

const COLS = 60;
const ROWS = 46;

export const WORK_CLUB_ENTRANCE = { col: 30, row: 45 } as const;

const FLOOR_COLORS = {
  cafe: { h: 30, s: 37, b: -18, c: -34 },
  library: { h: 28, s: 40, b: -27, c: -42 },
  lobby: { h: 205, s: 21, b: -10, c: -22 },
  lounge: { h: 205, s: 30, b: -12, c: -25 },
  meeting: { h: 211, s: 31, b: -16, c: -30 },
  office: { h: 202, s: 27, b: -18, c: -32 },
  open: { h: 27, s: 44, b: -34, c: -48 },
  wall: { h: 218, s: 34, b: -76, c: -54 },
} satisfies Record<string, ColorValue>;

const CARPET_COLORS = {
  cafe: {
    color: { h: 28, s: 48, b: -18, c: -24 },
    accentColor: { h: 47, s: 34, b: 7, c: 5 },
  },
  lounge: {
    color: { h: 202, s: 34, b: -22, c: -28 },
    accentColor: { h: 174, s: 22, b: 8, c: 3 },
  },
  meeting: {
    color: { h: 220, s: 28, b: -24, c: -30 },
    accentColor: { h: 42, s: 24, b: 6, c: 4 },
  },
} satisfies Record<string, Omit<CarpetTile, "variant">>;

function isWall(col: number, row: number): boolean {
  if (row === 2) return true;
  if ((col === 0 || col === COLS - 1) && row <= 39) return true;
  if (row === 39) return true;
  if ((col === 24 || col === 36) && row >= 39) return true;
  if (row === ROWS - 1 && col >= 24 && col <= 36) return true;
  if (row === 10 || row === 29) return true;
  if ((col === 8 || col === 16 || col === 24 || col === 36) && row <= 10) return true;
  if (col === 48 && (row <= 10 || (row >= 12 && row <= 29))) return true;
  if (row === 12 && col >= 48) return true;
  if (col === 10 && row >= 10 && row <= 29) return true;
  if (row === 19 && col <= 10) return true;
  if ((col === 21 || col === 39) && row >= 29) return true;
  return false;
}

function isDoor(col: number, row: number): boolean {
  return (
    (col === WORK_CLUB_ENTRANCE.col && row === WORK_CLUB_ENTRANCE.row) ||
    (col === 30 && row === 39) ||
    (row === 10 && (col === 4 || col === 12 || col === 20 || col === 30 || col === 42 || col === 54)) ||
    (col === 10 && (row === 15 || row === 24)) ||
    (col === 48 && row === 19) ||
    (row === 12 && col === 54) ||
    (row === 29 && (col === 15 || col === 30 || col === 49))
  );
}

function floorAt(col: number, row: number): {
  type: TileTypeValue;
  color: ColorValue | null;
} {
  if (row < 2) return { type: TileType.VOID, color: null };
  const insideMainFloor = row <= 39;
  const insideLobby = row >= 39 && row <= 45 && col >= 24 && col <= 36;
  if (!insideMainFloor && !insideLobby) return { type: TileType.VOID, color: null };
  if (isWall(col, row) && !isDoor(col, row)) {
    return { type: TileType.WALL, color: FLOOR_COLORS.wall };
  }
  if (row >= 40) {
    return { type: TileType.FLOOR_1, color: FLOOR_COLORS.lobby };
  }
  if (row <= 10) {
    return col >= 49
      ? { type: TileType.FLOOR_7, color: FLOOR_COLORS.office }
      : { type: TileType.FLOOR_1, color: FLOOR_COLORS.meeting };
  }
  if (row >= 29) {
    if (col <= 21) return { type: TileType.FLOOR_7, color: FLOOR_COLORS.library };
    if (col <= 39) return { type: TileType.FLOOR_7, color: FLOOR_COLORS.cafe };
    return { type: TileType.FLOOR_1, color: FLOOR_COLORS.lounge };
  }
  if (col <= 10 || col >= 49) {
    return col >= 49
      ? { type: TileType.FLOOR_1, color: FLOOR_COLORS.meeting }
      : { type: TileType.FLOOR_7, color: FLOOR_COLORS.office };
  }
  return { type: TileType.FLOOR_7, color: FLOOR_COLORS.open };
}

function carpetAt(col: number, row: number): CarpetTile | null {
  if (row >= 4 && row <= 8 && col >= 2 && col <= 46) {
    return { variant: 2, ...CARPET_COLORS.meeting };
  }
  if (col >= 50 && col <= 57 && row >= 14 && row <= 25) {
    return { variant: 2, ...CARPET_COLORS.meeting };
  }
  if (col >= 2 && col <= 19 && row >= 31 && row <= 37) {
    return { variant: 0, ...CARPET_COLORS.lounge };
  }
  if (col >= 23 && col <= 37 && row >= 32 && row <= 37) {
    return { variant: 1, ...CARPET_COLORS.cafe };
  }
  if (col >= 41 && col <= 57 && row >= 31 && row <= 37) {
    return { variant: 0, ...CARPET_COLORS.lounge };
  }
  if (col >= 25 && col <= 35 && row >= 40 && row <= 44) {
    return { variant: 1, ...CARPET_COLORS.lounge };
  }
  return null;
}

function emptyLayout(): OfficeLayout {
  const tiles: TileTypeValue[] = [];
  const tileColors: Array<ColorValue | null> = [];
  const carpetTiles: Array<CarpetTile | null> = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const floor = floorAt(col, row);
      tiles.push(floor.type);
      tileColors.push(floor.color);
      carpetTiles.push(
        floor.type === TileType.WALL || floor.type === TileType.VOID
          ? null
          : carpetAt(col, row),
      );
    }
  }
  return {
    version: 1,
    cols: COLS,
    rows: ROWS,
    layoutRevision: 3,
    tiles,
    tileColors,
    carpetTiles,
    furniture: [],
    pets: [
      { id: "work-club-claudio", petType: 0 },
      { id: "work-club-gitcat", petType: 1 },
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
  for (const [uid, type, col, row] of items) {
    next = add(next, uid, type, col, row);
  }
  return next;
}

function addCommunalTable(
  layout: OfficeLayout,
  prefix: string,
  col: number,
  firstSeatLetter: string,
): OfficeLayout {
  let next = layout;
  const firstSeatCode = firstSeatLetter.charCodeAt(0);
  const segmentRows = [14, 18, 22] as const;
  segmentRows.forEach((row, segmentIndex) => {
    next = add(next, `${prefix}-table-${segmentIndex + 1}`, "TABLE_FRONT", col, row);
    const seatCode = firstSeatCode + segmentIndex * 4;
    next = add(next, `work-${String.fromCharCode(seatCode)}-chair`, "CUSHIONED_CHAIR_SIDE", col - 1, row);
    next = add(next, `work-${String.fromCharCode(seatCode + 1)}-chair`, "CUSHIONED_CHAIR_SIDE:left", col + 3, row);
    next = add(next, `work-${String.fromCharCode(seatCode + 2)}-chair`, "CUSHIONED_CHAIR_SIDE", col - 1, row + 2);
    next = add(next, `work-${String.fromCharCode(seatCode + 3)}-chair`, "CUSHIONED_CHAIR_SIDE:left", col + 3, row + 2);
    next = add(next, `${prefix}-pc-left-a-${segmentIndex + 1}`, "PC_SIDE", col, row);
    next = add(next, `${prefix}-pc-right-a-${segmentIndex + 1}`, "PC_SIDE:left", col + 2, row);
    next = add(next, `${prefix}-pc-left-b-${segmentIndex + 1}`, "PC_SIDE", col, row + 2);
    next = add(next, `${prefix}-pc-right-b-${segmentIndex + 1}`, "PC_SIDE:left", col + 2, row + 2);
    next = add(next, `${prefix}-coffee-${segmentIndex + 1}`, "COFFEE", col + 1, row + (segmentIndex % 2 === 0 ? 1 : 3));
  });
  return next;
}

function addCentralWorkFloor(layout: OfficeLayout): OfficeLayout {
  let next = addCommunalTable(layout, "oak", 21, "a");
  next = addCommunalTable(next, "walnut", 32, "m");
  return addMany(next, [
    ["work-floor-plant-nw", "LARGE_PLANT", 12, 11],
    ["work-floor-plant-ne", "LARGE_PLANT", 44, 11],
    ["work-floor-touchdown-sofa", "SOFA_SIDE", 13, 18],
    ["work-floor-touchdown-table", "COFFEE_TABLE", 15, 18],
    ["work-floor-touchdown-coffee", "COFFEE", 16, 18],
    ["work-floor-plant-sw", "PLANT_2", 12, 25],
    ["work-floor-plant-se", "PLANT", 45, 26],
    ["work-floor-cactus", "CACTUS", 28, 20],
    ["work-floor-bin-a", "BIN", 20, 27],
    ["work-floor-bin-b", "BIN", 36, 27],
  ]);
}

function addNorthRooms(layout: OfficeLayout): OfficeLayout {
  return addMany(layout, [
    ["huddle-a-board", "WHITEBOARD", 2, 1],
    ["huddle-a-table", "SMALL_TABLE_FRONT", 3, 5],
    ["huddle-a-coffee", "COFFEE", 4, 5],
    ["huddle-a-north", "CUSHIONED_CHAIR_FRONT", 3, 4],
    ["huddle-a-south", "CUSHIONED_CHAIR_BACK", 3, 7],
    ["huddle-a-plant", "PLANT", 6, 7],

    ["huddle-b-art", "LARGE_PAINTING", 10, 1],
    ["huddle-b-clock", "CLOCK", 14, 1],
    ["huddle-b-table", "SMALL_TABLE_FRONT", 11, 5],
    ["huddle-b-coffee", "COFFEE", 12, 5],
    ["huddle-b-north", "WOODEN_CHAIR_FRONT", 11, 4],
    ["huddle-b-south", "WOODEN_CHAIR_BACK", 11, 7],
    ["huddle-b-cactus", "CACTUS", 14, 7],

    ["huddle-c-board", "WHITEBOARD", 18, 1],
    ["huddle-c-art", "SMALL_PAINTING_2", 22, 1],
    ["huddle-c-table", "SMALL_TABLE_FRONT", 19, 5],
    ["huddle-c-coffee", "COFFEE", 20, 5],
    ["huddle-c-north", "CUSHIONED_CHAIR_FRONT", 19, 4],
    ["huddle-c-south", "CUSHIONED_CHAIR_BACK", 19, 7],
    ["huddle-c-plant", "PLANT_2", 22, 7],

    ["project-a-board", "WHITEBOARD", 26, 1],
    ["project-a-art", "SMALL_PAINTING", 34, 1],
    ["project-a-table", "TABLE_FRONT", 29, 4],
    ["project-a-pc", "PC_FRONT_OFF", 30, 4],
    ["project-a-left-top", "CUSHIONED_CHAIR_SIDE", 28, 4],
    ["project-a-left-bottom", "CUSHIONED_CHAIR_SIDE", 28, 6],
    ["project-a-right-top", "CUSHIONED_CHAIR_SIDE:left", 32, 4],
    ["project-a-right-bottom", "CUSHIONED_CHAIR_SIDE:left", 32, 6],
    ["project-a-plant", "PLANT", 34, 7],

    ["project-b-art", "LARGE_PAINTING", 38, 1],
    ["project-b-board", "WHITEBOARD", 44, 1],
    ["project-b-table", "TABLE_FRONT", 41, 4],
    ["project-b-coffee", "COFFEE", 42, 5],
    ["project-b-left-top", "WOODEN_CHAIR_SIDE", 40, 4],
    ["project-b-left-bottom", "WOODEN_CHAIR_SIDE", 40, 6],
    ["project-b-right-top", "WOODEN_CHAIR_SIDE:left", 44, 4],
    ["project-b-right-bottom", "WOODEN_CHAIR_SIDE:left", 44, 6],
    ["project-b-plant", "LARGE_PLANT", 46, 6],

    ["north-office-books", "DOUBLE_BOOKSHELF", 49, 1],
    ["north-office-art", "LARGE_PAINTING", 54, 1],
    ["north-office-desk", "DESK_FRONT", 52, 4],
    ["north-office-pc", "PC_FRONT_OFF", 53, 4],
    ["north-office-coffee", "COFFEE", 54, 4],
    ["office-chair", "CUSHIONED_BENCH", 53, 6],
    ["north-office-guest-table", "SMALL_TABLE_FRONT", 49, 7],
    ["north-office-guest-coffee", "COFFEE", 49, 7],
    ["north-office-guest-chair", "CUSHIONED_CHAIR_SIDE:left", 51, 8],
    ["north-office-plant", "LARGE_PLANT", 56, 6],
  ]);
}

function addPrivateOffices(layout: OfficeLayout): OfficeLayout {
  return addMany(layout, [
    ["west-office-a-art", "SMALL_PAINTING", 2, 9],
    ["west-office-a-books", "BOOKSHELF", 6, 10],
    ["west-office-a-desk", "DESK_FRONT", 2, 12],
    ["west-office-a-pc", "PC_FRONT_OFF", 3, 12],
    ["west-office-a-coffee", "COFFEE", 4, 12],
    ["west-office-a-chair", "CUSHIONED_BENCH", 3, 14],
    ["west-office-a-guest-table", "SMALL_TABLE_FRONT", 6, 13],
    ["west-office-a-guest-chair", "CUSHIONED_CHAIR_BACK", 6, 15],
    ["west-office-a-plant", "PLANT_2", 8, 16],

    ["west-office-b-art", "LARGE_PAINTING", 2, 18],
    ["west-office-b-clock", "CLOCK", 7, 18],
    ["west-office-b-desk", "DESK_FRONT", 2, 21],
    ["west-office-b-pc", "PC_FRONT_OFF", 3, 21],
    ["west-office-b-coffee", "COFFEE", 2, 21],
    ["west-office-b-chair", "CUSHIONED_BENCH", 3, 23],
    ["west-office-b-side-table", "SMALL_TABLE_FRONT", 6, 25],
    ["west-office-b-side-coffee", "COFFEE", 7, 25],
    ["west-office-b-guest-chair", "CUSHIONED_CHAIR_FRONT", 6, 23],
    ["west-office-b-plant", "LARGE_PLANT", 8, 25],
  ]);
}

function addBoardroom(layout: OfficeLayout): OfficeLayout {
  return addMany(layout, [
    ["boardroom-table", "TABLE_FRONT", 53, 17],
    ["boardroom-coffee", "COFFEE", 54, 18],
    ["boardroom-top-chair", "WOODEN_CHAIR_FRONT", 54, 16],
    ["boardroom-bottom-chair", "WOODEN_CHAIR_BACK", 54, 21],
    ["meeting-left-chair", "WOODEN_CHAIR_SIDE", 52, 17],
    ["boardroom-left-middle", "WOODEN_CHAIR_SIDE", 52, 18],
    ["boardroom-left-bottom", "WOODEN_CHAIR_SIDE", 52, 20],
    ["meeting-right-chair", "WOODEN_CHAIR_SIDE:left", 56, 17],
    ["boardroom-right-middle", "WOODEN_CHAIR_SIDE:left", 56, 18],
    ["boardroom-right-bottom", "WOODEN_CHAIR_SIDE:left", 56, 20],
    ["boardroom-board", "WHITEBOARD", 50, 11],
    ["boardroom-clock", "CLOCK", 55, 11],
    ["boardroom-art", "LARGE_PAINTING", 56, 11],
    ["boardroom-plant", "LARGE_PLANT", 49, 24],
  ]);
}

function addLibrary(layout: OfficeLayout): OfficeLayout {
  return addMany(layout, [
    ["library-books-a", "DOUBLE_BOOKSHELF", 2, 28],
    ["library-books-b", "DOUBLE_BOOKSHELF", 5, 28],
    ["library-books-c", "DOUBLE_BOOKSHELF", 8, 28],
    ["library-books-d", "BOOKSHELF", 17, 29],
    ["library-sofa", "SOFA_FRONT", 5, 32],
    ["library-coffee-table", "COFFEE_TABLE", 5, 34],
    ["library-coffee", "COFFEE", 6, 34],
    ["library-left-chair", "CUSHIONED_CHAIR_SIDE", 4, 34],
    ["library-right-chair", "CUSHIONED_CHAIR_SIDE:left", 7, 34],
    ["library-reading-table", "SMALL_TABLE_FRONT", 13, 33],
    ["library-reading-coffee", "COFFEE", 14, 33],
    ["library-reading-left", "CUSHIONED_CHAIR_SIDE", 12, 33],
    ["library-reading-right", "CUSHIONED_CHAIR_SIDE:left", 15, 33],
    ["library-bottom-sofa", "SOFA_BACK", 5, 37],
    ["library-plant", "LARGE_PLANT", 18, 34],
    ["library-cactus", "CACTUS", 10, 35],
  ]);
}

function addCafe(layout: OfficeLayout): OfficeLayout {
  return addMany(layout, [
    ["cafe-counter-a", "DESK_FRONT", 23, 30],
    ["cafe-counter-b", "DESK_FRONT", 26, 30],
    ["cafe-coffee-a", "COFFEE", 24, 30],
    ["cafe-coffee-b", "COFFEE", 27, 30],
    ["cafe-pot", "POT", 36, 30],
    ["cafe-table-a", "SMALL_TABLE_FRONT", 24, 34],
    ["cafe-table-a-coffee", "COFFEE", 24, 34],
    ["nook-chair-a", "CUSHIONED_CHAIR_SIDE", 23, 34],
    ["cafe-chair-b", "CUSHIONED_CHAIR_SIDE:left", 26, 34],
    ["cafe-table-b", "SMALL_TABLE_FRONT", 33, 34],
    ["cafe-table-b-coffee", "COFFEE", 34, 34],
    ["cafe-chair-c", "CUSHIONED_CHAIR_SIDE", 32, 34],
    ["cafe-chair-d", "CUSHIONED_CHAIR_SIDE:left", 35, 34],
    ["cafe-bench-a", "CUSHIONED_BENCH", 25, 36],
    ["cafe-bench-b", "CUSHIONED_BENCH", 34, 36],
    ["cafe-plant", "LARGE_PLANT", 36, 35],
    ["cafe-bin", "BIN", 22, 37],
  ]);
}

function addLounge(layout: OfficeLayout): OfficeLayout {
  return addMany(layout, [
    ["lounge-art", "LARGE_PAINTING", 42, 28],
    ["lounge-books", "DOUBLE_BOOKSHELF", 53, 28],
    ["lounge-table", "COFFEE_TABLE", 44, 33],
    ["lounge-table-coffee", "COFFEE", 45, 33],
    ["lounge-left", "CUSHIONED_CHAIR_SIDE", 43, 33],
    ["lounge-right", "CUSHIONED_CHAIR_SIDE:left", 46, 33],
    ["lounge-bottom", "SOFA_BACK", 44, 36],
    ["lounge-nook-sofa", "SOFA_FRONT", 52, 31],
    ["lounge-nook-table", "SMALL_TABLE_FRONT", 52, 33],
    ["lounge-nook-coffee", "COFFEE", 52, 33],
    ["lounge-nook-chair", "CUSHIONED_CHAIR_SIDE:left", 54, 34],
    ["lounge-large-plant", "LARGE_PLANT", 56, 35],
    ["lounge-plant", "PLANT_2", 40, 36],
  ]);
}

function addLobby(layout: OfficeLayout): OfficeLayout {
  return addMany(layout, [
    ["lobby-reception-desk", "DESK_FRONT", 25, 40],
    ["lobby-reception-pc", "PC_FRONT_OFF", 26, 40],
    ["lobby-reception-coffee", "COFFEE", 27, 40],
    ["lobby-reception-chair", "CUSHIONED_BENCH", 26, 42],
    ["lobby-waiting-table", "SMALL_TABLE_SIDE", 32, 40],
    ["lobby-waiting-sofa", "SOFA_SIDE:left", 34, 40],
    ["lobby-plant", "PLANT_2", 34, 43],
    ["lobby-clock", "CLOCK", 29, 44],
    ["lobby-art", "SMALL_PAINTING_2", 33, 44],
    ["lobby-bin", "BIN", 25, 44],
  ]);
}

const EXPECTED_FACING = new Map<string, Direction>([
  ["work-a-chair", Direction.RIGHT],
  ["work-b-chair", Direction.LEFT],
  ["work-c-chair", Direction.RIGHT],
  ["office-chair", Direction.UP],
  ["meeting-left-chair", Direction.RIGHT],
  ["meeting-right-chair", Direction.LEFT],
  ["huddle-a-north", Direction.DOWN],
  ["huddle-a-south", Direction.UP],
  ["huddle-b-north", Direction.DOWN],
  ["huddle-b-south", Direction.UP],
  ["huddle-c-north", Direction.DOWN],
  ["huddle-c-south", Direction.UP],
  ["nook-chair-a", Direction.RIGHT],
  ["work-floor-touchdown-sofa", Direction.RIGHT],
  ["lounge-left", Direction.RIGHT],
  ["lounge-bottom", Direction.UP],
  ["lobby-reception-chair", Direction.UP],
]);

function validateLayout(layout: OfficeLayout): void {
  for (const item of layout.furniture) {
    if (!getCatalogEntry(item.type)) throw new Error(`Unknown furniture type ${item.type}`);
  }
  const seats = layoutToSeats(layout.furniture);
  if (seats.size !== 78) {
    throw new Error(`Detailed office has ${seats.size} seats, expected 78`);
  }
  const tileMap = layoutToTileMap(layout);
  const blocked = getBlockedTiles(layout.furniture);
  for (const [seatId, seat] of seats) {
    const expected = [...EXPECTED_FACING].find(([prefix]) =>
      seatId === prefix || seatId.startsWith(`${prefix}:`),
    );
    if (expected && seat.facingDir !== expected[1]) {
      throw new Error(`Seat ${seatId} faces ${seat.facingDir}, expected ${expected[1]}`);
    }
    const routeBlocks = new Set(blocked);
    routeBlocks.delete(`${seat.seatCol},${seat.seatRow}`);
    const path = findPath(
      WORK_CLUB_ENTRANCE.col,
      WORK_CLUB_ENTRANCE.row,
      seat.seatCol,
      seat.seatRow,
      tileMap,
      routeBlocks,
    );
    if (path.length === 0) {
      throw new Error(`Seat ${seatId} at ${seat.seatCol},${seat.seatRow} is unreachable`);
    }
  }
  for (const prefix of EXPECTED_FACING.keys()) {
    if (![...seats.keys()].some((seatId) => seatId === prefix || seatId.startsWith(`${prefix}:`))) {
      throw new Error(`Expected seat ${prefix} was not generated`);
    }
  }
}

export function buildWorkClubLayout(): OfficeLayout {
  let layout = emptyLayout();
  layout = addNorthRooms(layout);
  layout = addPrivateOffices(layout);
  layout = addBoardroom(layout);
  layout = addCentralWorkFloor(layout);
  layout = addLibrary(layout);
  layout = addCafe(layout);
  layout = addLounge(layout);
  layout = addLobby(layout);
  validateLayout(layout);
  return layout;
}
