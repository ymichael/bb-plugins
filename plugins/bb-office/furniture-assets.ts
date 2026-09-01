import baseFurnitureCatalog from "./assets/furniture-catalog.json";
import type { CatalogEntry } from "./vendor/pixel-agents/core/src/assets/types";
import type { SpriteData } from "./vendor/pixel-agents/webview-ui/src/office/types";

export const WORKBENCH_FRONT_ID = "WORKBENCH_FRONT";
export const MEETING_TABLE_FRONT_ID = "MEETING_TABLE_FRONT";
export const CENTERED_COFFEE_ID = "CENTERED_COFFEE";
export const MEDIA_SCREEN_ID = "MEDIA_SCREEN";

const tableEntry = baseFurnitureCatalog.find(
  (entry) => entry.id === "TABLE_FRONT",
);
if (!tableEntry) throw new Error("Pixel Agents TABLE_FRONT asset is missing");
const whiteboardEntry = baseFurnitureCatalog.find(
  (entry) => entry.id === "WHITEBOARD",
);
if (!whiteboardEntry)
  throw new Error("Pixel Agents WHITEBOARD asset is missing");
const coffeeEntry = baseFurnitureCatalog.find((entry) => entry.id === "COFFEE");
if (!coffeeEntry) throw new Error("Pixel Agents COFFEE asset is missing");

const workbenchEntry = {
  ...tableEntry,
  id: WORKBENCH_FRONT_ID,
  name: "Long Workbench",
  label: "Long Workbench",
  file: "WORKBENCH_FRONT.png",
  height: 144,
  footprintH: 9,
  groupId: WORKBENCH_FRONT_ID,
} satisfies CatalogEntry;

const meetingTableEntry = {
  ...tableEntry,
  id: MEETING_TABLE_FRONT_ID,
  name: "Narrow Meeting Table",
  label: "Narrow Meeting Table",
  file: "MEETING_TABLE_FRONT.png",
  width: 32,
  height: 48,
  footprintW: 2,
  footprintH: 3,
  groupId: MEETING_TABLE_FRONT_ID,
} satisfies CatalogEntry;

const mediaScreenEntry = {
  ...whiteboardEntry,
  id: MEDIA_SCREEN_ID,
  name: "Media Screen",
  label: "Media Screen",
  file: "MEDIA_SCREEN.png",
  groupId: MEDIA_SCREEN_ID,
} satisfies CatalogEntry;

const centeredCoffeeEntry = {
  ...coffeeEntry,
  id: CENTERED_COFFEE_ID,
  name: "Centered Coffee",
  label: "Centered Coffee",
  file: "CENTERED_COFFEE.png",
  width: 32,
  footprintW: 2,
  groupId: CENTERED_COFFEE_ID,
} satisfies CatalogEntry;

export const pixelFurnitureCatalog: CatalogEntry[] = [
  ...baseFurnitureCatalog,
  workbenchEntry,
  meetingTableEntry,
  mediaScreenEntry,
  centeredCoffeeEntry,
];

export function buildWorkbenchSprite(source: SpriteData): SpriteData {
  if (source.length !== 64 || source.some((row) => row.length !== 48)) {
    throw new Error("Pixel Agents TABLE_FRONT must remain 48×64");
  }
  return [
    ...source.slice(0, 55).map((row) => [...row]),
    ...Array.from({ length: 80 }, () => [...source[54]]),
    ...source.slice(55).map((row) => [...row]),
  ];
}

export function buildMeetingTableSprite(source: SpriteData): SpriteData {
  if (source.length !== 64 || source.some((row) => row.length !== 48)) {
    throw new Error("Pixel Agents TABLE_FRONT must remain 48×64");
  }
  const narrowed = source.map((row) => [
    ...row.slice(0, 8),
    ...row.slice(16, 32),
    ...row.slice(40),
  ]);
  return [...narrowed.slice(11, 50), ...narrowed.slice(55)];
}

export function buildMediaScreenSprite(source: SpriteData): SpriteData {
  if (source.length !== 32 || source.some((row) => row.length !== 32)) {
    throw new Error("Pixel Agents WHITEBOARD must remain 32×32");
  }
  const screen: SpriteData = source.map((row) =>
    row.map((pixel) => {
      if (pixel === "") return "";
      const red = Number.parseInt(pixel.slice(1, 3), 16);
      const green = Number.parseInt(pixel.slice(3, 5), 16);
      const blue = Number.parseInt(pixel.slice(5, 7), 16);
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      if (luminance >= 220) return "#8396A8";
      if (luminance >= 160) return "#5B7084";
      if (luminance >= 90) return "#354B60";
      return "#182838";
    }),
  );
  for (let row = 12; row <= 20; row += 1) {
    for (let col = 5; col <= 26; col += 1) screen[row][col] = "#142C42";
  }
  for (let col = 7; col <= 13; col += 1) screen[14][col] = "#68D5C1";
  for (let col = 16; col <= 23; col += 1) screen[14][col] = "#E7C968";
  for (let col = 7; col <= 18; col += 1) screen[17][col] = "#6E9FD8";
  for (let col = 20; col <= 24; col += 1) screen[17][col] = "#D8778D";
  return screen;
}

export function buildCenteredCoffeeSprite(source: SpriteData): SpriteData {
  if (source.length !== 16 || source.some((row) => row.length !== 16)) {
    throw new Error("Pixel Agents COFFEE must remain 16×16");
  }
  return source.map((row) => [
    ...Array.from({ length: 4 }, () => ""),
    ...row,
    ...Array.from({ length: 12 }, () => ""),
  ]);
}

export function addDerivedFurnitureSprites(
  source: Record<string, SpriteData>,
): Record<string, SpriteData> {
  const table = source.TABLE_FRONT;
  if (!table) throw new Error("Pixel Agents TABLE_FRONT sprite is missing");
  const whiteboard = source.WHITEBOARD;
  if (!whiteboard) throw new Error("Pixel Agents WHITEBOARD sprite is missing");
  const coffee = source.COFFEE;
  if (!coffee) throw new Error("Pixel Agents COFFEE sprite is missing");
  return {
    ...source,
    [WORKBENCH_FRONT_ID]: buildWorkbenchSprite(table),
    [MEETING_TABLE_FRONT_ID]: buildMeetingTableSprite(table),
    [MEDIA_SCREEN_ID]: buildMediaScreenSprite(whiteboard),
    [CENTERED_COFFEE_ID]: buildCenteredCoffeeSprite(coffee),
  };
}
