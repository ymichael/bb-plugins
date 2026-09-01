import assetIndex from "./assets/asset-index.json";
import baseFurnitureCatalog from "./assets/furniture-catalog.json";
import {
  addDerivedFurnitureSprites,
  pixelFurnitureCatalog,
} from "./furniture-assets";
import { buildWorkClubLayout } from "./normal-office-layout";
import { buildDetailedOfficeLayout } from "./office-layout";
import { rgbaToHex } from "./vendor/pixel-agents/core/src/assets/colorUtils";
import {
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHARACTER_DIRECTIONS,
  CARPET_GRID_COLS,
  CARPET_MARCHING_SQUARES_COUNT,
  CARPET_TILE_SIZE,
  FLOOR_TILE_SIZE,
  PET_FRAME_H,
  PET_FRAME_W_LARGE,
  PET_FRAME_W_SMALL,
  PET_IDLE_FRAMES_VERT,
  PET_WALK_FRAMES_HORIZ,
  PET_WALK_FRAMES_VERT,
  WALL_BITMASK_COUNT,
  WALL_GRID_COLS,
  WALL_PIECE_HEIGHT,
  WALL_PIECE_WIDTH,
} from "./vendor/pixel-agents/core/src/assets/constants";
import type {
  CatalogEntry,
  CharacterDirectionSprites,
} from "./vendor/pixel-agents/core/src/assets/types";
import { setFloorSprites } from "./vendor/pixel-agents/webview-ui/src/office/floorTiles";
import { buildDynamicCatalog } from "./vendor/pixel-agents/webview-ui/src/office/layout/furnitureCatalog";
import { setCarpetSprites } from "./vendor/pixel-agents/webview-ui/src/office/sprites/carpetTiles";
import { setPetTemplates } from "./vendor/pixel-agents/webview-ui/src/office/sprites/petSpriteData";
import { setCharacterTemplates } from "./vendor/pixel-agents/webview-ui/src/office/sprites/spriteData";
import { setProviderCapabilities } from "./vendor/pixel-agents/webview-ui/src/office/toolUtils";
import type {
  OfficeLayout,
  SpriteData,
} from "./vendor/pixel-agents/webview-ui/src/office/types";
import { setWallSprites } from "./vendor/pixel-agents/webview-ui/src/office/wallTiles";

export const BB_OFFICE_ASSET_ROOT = "/api/v1/plugins/bb-office/http/assets";

export type OfficeLayoutKind = "compact" | "work-club";
export type EmbeddedAssetMap = Readonly<Record<string, string>>;

interface DecodedPng {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function getPixel(
  png: DecodedPng,
  x: number,
  y: number,
): [number, number, number, number] {
  const index = (y * png.width + x) * 4;
  return [
    png.data[index],
    png.data[index + 1],
    png.data[index + 2],
    png.data[index + 3],
  ];
}

function readSprite(
  png: DecodedPng,
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
): SpriteData {
  const sprite: SpriteData = [];
  for (let y = 0; y < height; y += 1) {
    const row: string[] = [];
    for (let x = 0; x < width; x += 1) {
      row.push(rgbaToHex(...getPixel(png, offsetX + x, offsetY + y)));
    }
    sprite.push(row);
  }
  return sprite;
}

async function decodePng(
  assetRoot: string,
  path: string,
  embeddedAssets?: EmbeddedAssetMap,
): Promise<DecodedPng> {
  const response = await fetch(embeddedAssets?.[path] ?? `${assetRoot}/${path}`);
  if (!response.ok) {
    throw new Error(`Could not load Pixel Agents asset ${path}`);
  }
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Could not create the asset decoding canvas");
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return {
    width: canvas.width,
    height: canvas.height,
    data: context.getImageData(0, 0, canvas.width, canvas.height).data,
  };
}

async function decodeCharacters(
  assetRoot: string,
  embeddedAssets?: EmbeddedAssetMap,
): Promise<CharacterDirectionSprites[]> {
  return Promise.all(
    assetIndex.characters.map(async (file) => {
      const png = await decodePng(assetRoot, `characters/${file}`, embeddedAssets);
      const character: CharacterDirectionSprites = { down: [], up: [], right: [] };
      for (let direction = 0; direction < CHARACTER_DIRECTIONS.length; direction += 1) {
        const frames: SpriteData[] = [];
        for (let frame = 0; frame < CHAR_FRAMES_PER_ROW; frame += 1) {
          frames.push(
            readSprite(
              png,
              CHAR_FRAME_W,
              CHAR_FRAME_H,
              frame * CHAR_FRAME_W,
              direction * CHAR_FRAME_H,
            ),
          );
        }
        character[CHARACTER_DIRECTIONS[direction]] = frames;
      }
      return character;
    }),
  );
}

async function decodeFloors(
  assetRoot: string,
  embeddedAssets?: EmbeddedAssetMap,
): Promise<SpriteData[]> {
  return Promise.all(
    assetIndex.floors.map(async (file) =>
      readSprite(
        await decodePng(assetRoot, `floors/${file}`, embeddedAssets),
        FLOOR_TILE_SIZE,
        FLOOR_TILE_SIZE,
      ),
    ),
  );
}

async function decodeWalls(
  assetRoot: string,
  embeddedAssets?: EmbeddedAssetMap,
): Promise<SpriteData[][]> {
  return Promise.all(
    assetIndex.walls.map(async (file) => {
      const png = await decodePng(assetRoot, `walls/${file}`, embeddedAssets);
      const pieces: SpriteData[] = [];
      for (let mask = 0; mask < WALL_BITMASK_COUNT; mask += 1) {
        pieces.push(
          readSprite(
            png,
            WALL_PIECE_WIDTH,
            WALL_PIECE_HEIGHT,
            (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH,
            Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT,
          ),
        );
      }
      return pieces;
    }),
  );
}

async function decodeCarpets(
  assetRoot: string,
  embeddedAssets?: EmbeddedAssetMap,
): Promise<SpriteData[][]> {
  return Promise.all(
    [0, 1, 2].map(async (variant) => {
      const png = await decodePng(assetRoot, `carpets/carpet_${variant}.png`, embeddedAssets);
      return Array.from({ length: CARPET_MARCHING_SQUARES_COUNT }, (_, index) =>
        readSprite(
          png,
          CARPET_TILE_SIZE,
          CARPET_TILE_SIZE,
          (index % CARPET_GRID_COLS) * CARPET_TILE_SIZE,
          Math.floor(index / CARPET_GRID_COLS) * CARPET_TILE_SIZE,
        ),
      );
    }),
  );
}

function readFrames(
  png: DecodedPng,
  count: number,
  width: number,
  offsetX: number,
  offsetY: number,
): SpriteData[] {
  return Array.from({ length: count }, (_, frame) =>
    readSprite(png, width, PET_FRAME_H, offsetX + frame * width, offsetY),
  );
}

async function decodePets(
  assetRoot: string,
  embeddedAssets?: EmbeddedAssetMap,
): Promise<{
  templates: Array<{
    walkDown: SpriteData[];
    idleDown: SpriteData[];
    walkUp: SpriteData[];
    idleUp: SpriteData[];
    walkRight: SpriteData[];
  }>;
  names: string[];
}> {
  const pets = [
    { id: "claudio", name: "Claudio" },
    { id: "gitcat", name: "Gitcat" },
  ] as const;
  const templates = await Promise.all(
    pets.map(async ({ id }) => {
      const png = await decodePng(assetRoot, `pets/${id}/pet.png`, embeddedAssets);
      return {
        walkDown: readFrames(png, PET_WALK_FRAMES_VERT, PET_FRAME_W_SMALL, 0, 0),
        idleDown: readFrames(png, PET_IDLE_FRAMES_VERT, PET_FRAME_W_SMALL, 48, 0),
        walkUp: readFrames(png, PET_WALK_FRAMES_VERT, PET_FRAME_W_SMALL, 0, 32),
        idleUp: readFrames(png, PET_IDLE_FRAMES_VERT, PET_FRAME_W_SMALL, 48, 32),
        walkRight: readFrames(png, PET_WALK_FRAMES_HORIZ, PET_FRAME_W_LARGE, 0, 64),
      };
    }),
  );
  return { templates, names: pets.map(({ name }) => name) };
}

async function decodeFurniture(
  assetRoot: string,
  catalog: CatalogEntry[],
  embeddedAssets?: EmbeddedAssetMap,
): Promise<Record<string, SpriteData>> {
  const decoded = await Promise.all(
    catalog.map(async (entry) => [
      entry.id,
      readSprite(
        await decodePng(assetRoot, entry.furniturePath, embeddedAssets),
        entry.width,
        entry.height,
      ),
    ] as const),
  );
  return Object.fromEntries(decoded);
}

const assetsPromises = new Map<string, Promise<OfficeLayout>>();

export function loadPixelAgentsOffice(
  assetRoot = BB_OFFICE_ASSET_ROOT,
  layoutKind: OfficeLayoutKind = "compact",
  embeddedAssets?: EmbeddedAssetMap,
): Promise<OfficeLayout> {
  const cacheKey = `${embeddedAssets ? "embedded" : assetRoot}:${layoutKind}`;
  const existing = assetsPromises.get(cacheKey);
  if (existing) return existing;
  const loading = Promise.all([
    decodeCharacters(assetRoot, embeddedAssets),
    decodeFloors(assetRoot, embeddedAssets),
    decodeWalls(assetRoot, embeddedAssets),
    decodeCarpets(assetRoot, embeddedAssets),
    decodePets(assetRoot, embeddedAssets),
    decodeFurniture(assetRoot, baseFurnitureCatalog, embeddedAssets),
  ]).then(([characters, floors, walls, carpets, pets, furniture]) => {
    setCharacterTemplates(characters);
    setFloorSprites(floors);
    setWallSprites(walls);
    setCarpetSprites(carpets);
    setPetTemplates(pets.templates, pets.names);
    if (!buildDynamicCatalog({
      catalog: pixelFurnitureCatalog,
      sprites: addDerivedFurnitureSprites(furniture),
    })) {
      throw new Error("Pixel Agents furniture catalog was empty");
    }
    setProviderCapabilities({
      readingTools: ["Read", "Grep", "Glob", "WebFetch", "WebSearch"],
      subagentToolNames: [],
    });
    return layoutKind === "work-club"
      ? buildWorkClubLayout()
      : buildDetailedOfficeLayout();
  });
  assetsPromises.set(cacheKey, loading);
  return loading;
}
