import type { OfficeLayoutKind } from "./asset-loader";
import { WORK_CLUB_ENTRANCE } from "./normal-office-layout";
import { COMMONS_SUITE_ENTRANCE } from "./office-layout";
import {
  getBlockedTiles,
  layoutToSeats,
  layoutToTileMap,
} from "./vendor/pixel-agents/webview-ui/src/office/layout/layoutSerializer";
import {
  findPath,
  isWalkable,
} from "./vendor/pixel-agents/webview-ui/src/office/layout/tileMap";
import type {
  OfficeLayout,
  Seat,
} from "./vendor/pixel-agents/webview-ui/src/office/types";

export type RoomPurpose =
  | "lobby"
  | "work"
  | "meeting"
  | "lounge"
  | "library"
  | "cafe";
export type SeatRole =
  | "work"
  | "meeting"
  | "rest"
  | "flex-work"
  | "staff"
  | "waiting";

export interface TileAnchor {
  col: number;
  row: number;
}

export interface SemanticSeat {
  id: string;
  roomId: string;
  role: SeatRole;
  clusterId: string;
  col: number;
  row: number;
}

export interface OfficeRoom {
  id: string;
  label: string;
  purpose: RoomPurpose;
  variant: string;
  capacity: number;
  seatIds: readonly string[];
}

export interface OfficeMapLabel extends TileAnchor {
  text: string;
}

export interface StandingAnchor extends TileAnchor {
  id: string;
  roomId: string;
  role: "work-overflow" | "meeting-overflow";
}

export interface OfficeBlueprint {
  id: OfficeLayoutKind;
  name: string;
  layout: OfficeLayout;
  entrance: {
    exterior: TileAnchor;
    badge: TileAnchor;
    interior: TileAnchor;
  };
  rooms: readonly OfficeRoom[];
  seats: readonly SemanticSeat[];
  standingAnchors: readonly StandingAnchor[];
  petAnchors: readonly TileAnchor[];
  mapLabels: readonly OfficeMapLabel[];
  workCapacity: number;
}

interface RoomInput {
  id: string;
  label: string;
  purpose: RoomPurpose;
  variant: string;
  capacity: number;
  seatIds: readonly string[];
  role: SeatRole;
  clusterId: string;
}

const workClubOpenSeats = Array.from(
  { length: 24 },
  (_, index) => `work-${String.fromCharCode("a".charCodeAt(0) + index)}-chair`,
);

const workClubRooms: readonly RoomInput[] = [
  {
    id: "open-touchdown",
    label: "Oak touchdown couch",
    purpose: "lounge",
    variant: "small couch beside the communal bench",
    capacity: 2,
    seatIds: ["work-floor-touchdown-sofa", "work-floor-touchdown-sofa:1"],
    role: "rest",
    clusterId: "open-touchdown",
  },
  {
    id: "open-oak",
    label: "Oak bench garden",
    purpose: "work",
    variant: "face-to-face communal table",
    capacity: 12,
    seatIds: workClubOpenSeats.slice(0, 12),
    role: "work",
    clusterId: "open-oak",
  },
  {
    id: "open-walnut",
    label: "Walnut bench garden",
    purpose: "work",
    variant: "face-to-face communal table",
    capacity: 12,
    seatIds: workClubOpenSeats.slice(12),
    role: "work",
    clusterId: "open-walnut",
  },
  {
    id: "office-north",
    label: "Library office",
    purpose: "work",
    variant: "books and guest corner",
    capacity: 1,
    seatIds: ["office-chair"],
    role: "work",
    clusterId: "office-north",
  },
  {
    id: "office-west-a",
    label: "Plant office",
    purpose: "work",
    variant: "plant and guest chair",
    capacity: 1,
    seatIds: ["west-office-a-chair"],
    role: "work",
    clusterId: "office-west-a",
  },
  {
    id: "office-west-b",
    label: "Studio office",
    purpose: "work",
    variant: "art and side table",
    capacity: 1,
    seatIds: ["west-office-b-chair"],
    role: "work",
    clusterId: "office-west-b",
  },
  {
    id: "huddle-a",
    label: "Whiteboard booth",
    purpose: "meeting",
    variant: "cushioned side chairs",
    capacity: 2,
    seatIds: ["huddle-a-north", "huddle-a-south"],
    role: "meeting",
    clusterId: "huddle-a",
  },
  {
    id: "huddle-b",
    label: "Review booth",
    purpose: "meeting",
    variant: "formal opposing chairs",
    capacity: 2,
    seatIds: ["huddle-b-north", "huddle-b-south"],
    role: "meeting",
    clusterId: "huddle-b",
  },
  {
    id: "huddle-c",
    label: "Coffee chat",
    purpose: "meeting",
    variant: "soft side chairs",
    capacity: 2,
    seatIds: ["huddle-c-north", "huddle-c-south"],
    role: "meeting",
    clusterId: "huddle-c",
  },
  {
    id: "project-a",
    label: "Sprint room",
    purpose: "meeting",
    variant: "computer and whiteboard",
    capacity: 4,
    seatIds: [
      "project-a-left-top",
      "project-a-left-bottom",
      "project-a-right-top",
      "project-a-right-bottom",
    ],
    role: "meeting",
    clusterId: "project-a",
  },
  {
    id: "project-b",
    label: "Crit room",
    purpose: "meeting",
    variant: "mixed wood seating",
    capacity: 4,
    seatIds: [
      "project-b-left-top",
      "project-b-left-bottom",
      "project-b-right-top",
      "project-b-right-bottom",
    ],
    role: "meeting",
    clusterId: "project-b",
  },
  {
    id: "boardroom",
    label: "Boardroom",
    purpose: "meeting",
    variant: "continuous table and whiteboard",
    capacity: 8,
    seatIds: [
      "boardroom-top-chair",
      "meeting-left-chair",
      "boardroom-left-middle",
      "boardroom-left-bottom",
      "meeting-right-chair",
      "boardroom-right-middle",
      "boardroom-right-bottom",
      "boardroom-bottom-chair",
    ],
    role: "meeting",
    clusterId: "boardroom",
  },
  {
    id: "library",
    label: "Reading room",
    purpose: "library",
    variant: "bookshelf wall and mixed seating",
    capacity: 8,
    seatIds: [
      "library-sofa",
      "library-sofa:1",
      "library-left-chair",
      "library-right-chair",
      "library-reading-left",
      "library-reading-right",
      "library-bottom-sofa",
      "library-bottom-sofa:1",
    ],
    role: "flex-work",
    clusterId: "library",
  },
  {
    id: "cafe",
    label: "Coffee commons",
    purpose: "cafe",
    variant: "counter and table mix",
    capacity: 6,
    seatIds: [
      "nook-chair-a",
      "cafe-chair-b",
      "cafe-chair-c",
      "cafe-chair-d",
      "cafe-bench-a",
      "cafe-bench-b",
    ],
    role: "flex-work",
    clusterId: "cafe",
  },
  {
    id: "lounge",
    label: "Conversation lounge",
    purpose: "lounge",
    variant: "asymmetric sofa groups",
    capacity: 7,
    seatIds: [
      "lounge-left",
      "lounge-right",
      "lounge-bottom",
      "lounge-bottom:1",
      "lounge-nook-sofa",
      "lounge-nook-sofa:1",
      "lounge-nook-chair",
    ],
    role: "rest",
    clusterId: "lounge",
  },
  {
    id: "lobby",
    label: "Gallery reception",
    purpose: "lobby",
    variant: "front desk and waiting sofa",
    capacity: 1,
    seatIds: ["lobby-reception-chair"],
    role: "staff",
    clusterId: "lobby",
  },
];

const compactRooms: readonly RoomInput[] = [
  {
    id: "commons-west-neighborhood",
    label: "West workbench",
    purpose: "work",
    variant: "six-person face-to-face communal table",
    capacity: 6,
    seatIds: [
      "commons-west-left-1",
      "commons-west-left-2",
      "commons-west-left-3",
      "commons-west-right-1",
      "commons-west-right-2",
      "commons-west-right-3",
    ],
    role: "work",
    clusterId: "commons-west-neighborhood",
  },
  {
    id: "commons-east-neighborhood",
    label: "East workbench",
    purpose: "work",
    variant: "six-person face-to-face communal table",
    capacity: 6,
    seatIds: [
      "commons-east-left-1",
      "commons-east-left-2",
      "commons-east-left-3",
      "commons-east-right-1",
      "commons-east-right-2",
      "commons-east-right-3",
    ],
    role: "work",
    clusterId: "commons-east-neighborhood",
  },
  {
    id: "commons-meeting-b",
    label: "Four-person project room B",
    purpose: "meeting",
    variant: "continuous table, whiteboard, and plants",
    capacity: 4,
    seatIds: [
      "commons-meeting-b-left-top",
      "commons-meeting-b-left-bottom",
      "commons-meeting-b-right-top",
      "commons-meeting-b-right-bottom",
    ],
    role: "meeting",
    clusterId: "commons-meeting-b",
  },
  {
    id: "commons-meeting",
    label: "Four-person project room A",
    purpose: "meeting",
    variant: "continuous table and whiteboard",
    capacity: 4,
    seatIds: [
      "commons-meeting-left-top",
      "commons-meeting-left-bottom",
      "commons-meeting-right-top",
      "commons-meeting-right-bottom",
    ],
    role: "meeting",
    clusterId: "commons-meeting",
  },
  {
    id: "commons-meeting-c",
    label: "Four-person project room C",
    purpose: "meeting",
    variant: "continuous table with art and cactus",
    capacity: 4,
    seatIds: [
      "commons-meeting-c-left-top",
      "commons-meeting-c-left-bottom",
      "commons-meeting-c-right-top",
      "commons-meeting-c-right-bottom",
    ],
    role: "meeting",
    clusterId: "commons-meeting-c",
  },
  {
    id: "commons-media-lounge",
    label: "TV lounge",
    purpose: "lounge",
    variant: "two paired sofas facing a wall-mounted media screen",
    capacity: 4,
    seatIds: [
      "commons-media-sofa-left",
      "commons-media-sofa-left:1",
      "commons-media-sofa-right",
      "commons-media-sofa-right:1",
    ],
    role: "rest",
    clusterId: "commons-media-lounge",
  },
  {
    id: "commons-team-lounge",
    label: "Team lounge",
    purpose: "lounge",
    variant: "opposing sofas around a shared table with books and plants",
    capacity: 4,
    seatIds: [
      "commons-team-sofa-north",
      "commons-team-sofa-north:1",
      "commons-team-sofa-south",
      "commons-team-sofa-south:1",
    ],
    role: "rest",
    clusterId: "commons-team-lounge",
  },
];

const workClubMeetingOverflowAnchors: readonly StandingAnchor[] = [
  {
    id: "huddle-a-packed-1",
    roomId: "huddle-a",
    role: "meeting-overflow",
    col: 1,
    row: 5,
  },
  {
    id: "huddle-a-packed-2",
    roomId: "huddle-a",
    role: "meeting-overflow",
    col: 6,
    row: 5,
  },
  {
    id: "huddle-b-packed-1",
    roomId: "huddle-b",
    role: "meeting-overflow",
    col: 9,
    row: 5,
  },
  {
    id: "huddle-b-packed-2",
    roomId: "huddle-b",
    role: "meeting-overflow",
    col: 14,
    row: 5,
  },
  {
    id: "huddle-c-packed-1",
    roomId: "huddle-c",
    role: "meeting-overflow",
    col: 17,
    row: 5,
  },
  {
    id: "huddle-c-packed-2",
    roomId: "huddle-c",
    role: "meeting-overflow",
    col: 22,
    row: 5,
  },
  {
    id: "project-a-packed-1",
    roomId: "project-a",
    role: "meeting-overflow",
    col: 26,
    row: 5,
  },
  {
    id: "project-a-packed-2",
    roomId: "project-a",
    role: "meeting-overflow",
    col: 34,
    row: 5,
  },
  {
    id: "project-a-packed-3",
    roomId: "project-a",
    role: "meeting-overflow",
    col: 26,
    row: 8,
  },
  {
    id: "project-a-packed-4",
    roomId: "project-a",
    role: "meeting-overflow",
    col: 33,
    row: 8,
  },
  {
    id: "project-b-packed-1",
    roomId: "project-b",
    role: "meeting-overflow",
    col: 38,
    row: 5,
  },
  {
    id: "project-b-packed-2",
    roomId: "project-b",
    role: "meeting-overflow",
    col: 46,
    row: 4,
  },
  {
    id: "project-b-packed-3",
    roomId: "project-b",
    role: "meeting-overflow",
    col: 38,
    row: 8,
  },
  {
    id: "project-b-packed-4",
    roomId: "project-b",
    role: "meeting-overflow",
    col: 45,
    row: 8,
  },
  {
    id: "boardroom-packed-1",
    roomId: "boardroom",
    role: "meeting-overflow",
    col: 50,
    row: 15,
  },
  {
    id: "boardroom-packed-2",
    roomId: "boardroom",
    role: "meeting-overflow",
    col: 57,
    row: 15,
  },
  {
    id: "boardroom-packed-3",
    roomId: "boardroom",
    role: "meeting-overflow",
    col: 50,
    row: 22,
  },
  {
    id: "boardroom-packed-4",
    roomId: "boardroom",
    role: "meeting-overflow",
    col: 57,
    row: 22,
  },
  {
    id: "boardroom-packed-5",
    roomId: "boardroom",
    role: "meeting-overflow",
    col: 51,
    row: 25,
  },
  {
    id: "boardroom-packed-6",
    roomId: "boardroom",
    role: "meeting-overflow",
    col: 56,
    row: 25,
  },
];

function packedMeetingAnchors(
  roomId: string,
  coordinates: ReadonlyArray<readonly [number, number]>,
): StandingAnchor[] {
  return coordinates.map(([col, row], index) => ({
    id: `${roomId}-packed-${index + 1}`,
    roomId,
    role: "meeting-overflow",
    col,
    row,
  }));
}

const compactMeetingOverflowAnchors: readonly StandingAnchor[] = [
  ...packedMeetingAnchors("commons-meeting", [
    [1, 7],
    [2, 7],
    [3, 7],
    [4, 7],
    [5, 7],
    [6, 7],
    [7, 7],
    [1, 5],
  ]),
  ...packedMeetingAnchors("commons-meeting-b", [
    [9, 7],
    [11, 7],
    [13, 7],
    [15, 7],
    [9, 6],
    [11, 6],
    [13, 6],
    [15, 6],
    [9, 5],
    [15, 5],
  ]),
  ...packedMeetingAnchors("commons-meeting-c", [
    [17, 7],
    [19, 7],
    [21, 7],
    [23, 7],
    [17, 6],
    [19, 6],
    [21, 6],
    [23, 6],
    [17, 5],
    [23, 5],
  ]),
];

function compileSeats(
  inputs: readonly RoomInput[],
  seats: Map<string, Seat>,
): SemanticSeat[] {
  const output: SemanticSeat[] = [];
  const seen = new Set<string>();
  for (const room of inputs) {
    for (const seatId of room.seatIds) {
      if (seen.has(seatId))
        throw new Error(`Semantic seat ${seatId} is assigned twice`);
      const seat = seats.get(seatId);
      if (!seat) throw new Error(`Semantic seat ${seatId} does not exist`);
      seen.add(seatId);
      output.push({
        id: seatId,
        roomId: room.id,
        role: room.role,
        clusterId: room.clusterId,
        col: seat.seatCol,
        row: seat.seatRow,
      });
    }
  }
  return output;
}

function validateBlueprint(blueprint: OfficeBlueprint): void {
  const tileMap = layoutToTileMap(blueprint.layout);
  const blocked = getBlockedTiles(blueprint.layout.furniture);
  const workCapacity = blueprint.seats.filter(
    (seat) => seat.role === "work",
  ).length;
  if (workCapacity !== blueprint.workCapacity) {
    throw new Error(
      `${blueprint.name} has ${workCapacity} work seats, expected ${blueprint.workCapacity}`,
    );
  }
  for (const seat of blueprint.seats) {
    const routeBlocks = new Set(blocked);
    routeBlocks.delete(`${seat.col},${seat.row}`);
    const path = findPath(
      blueprint.entrance.exterior.col,
      blueprint.entrance.exterior.row,
      seat.col,
      seat.row,
      tileMap,
      routeBlocks,
    );
    if (path.length === 0)
      throw new Error(`${blueprint.name} cannot reach ${seat.id}`);
  }
  for (const anchor of blueprint.standingAnchors) {
    if (!isWalkable(anchor.col, anchor.row, tileMap, blocked)) {
      throw new Error(
        `${blueprint.name} standing anchor ${anchor.id} is blocked`,
      );
    }
    const path = findPath(
      blueprint.entrance.exterior.col,
      blueprint.entrance.exterior.row,
      anchor.col,
      anchor.row,
      tileMap,
      blocked,
    );
    if (path.length === 0)
      throw new Error(`${blueprint.name} cannot reach ${anchor.id}`);
  }
}

export function compileOfficeBlueprint(
  kind: OfficeLayoutKind,
  layout: OfficeLayout,
): OfficeBlueprint {
  const seatMap = layoutToSeats(layout.furniture);
  const inputs = kind === "work-club" ? workClubRooms : compactRooms;
  const blueprint: OfficeBlueprint =
    kind === "work-club"
      ? {
          id: kind,
          name: "Perimeter Work Club",
          layout,
          entrance: {
            exterior: WORK_CLUB_ENTRANCE,
            badge: { col: 30, row: 42 },
            interior: { col: 30, row: 38 },
          },
          rooms: inputs.map(
            ({ role: _role, clusterId: _clusterId, ...room }) => room,
          ),
          seats: compileSeats(inputs, seatMap),
          standingAnchors: [
            {
              id: "work-club-overflow-1",
              roomId: "open-oak",
              role: "work-overflow",
              col: 16,
              row: 13,
            },
            {
              id: "work-club-overflow-2",
              roomId: "open-oak",
              role: "work-overflow",
              col: 16,
              row: 17,
            },
            {
              id: "work-club-overflow-3",
              roomId: "open-oak",
              role: "work-overflow",
              col: 16,
              row: 21,
            },
            {
              id: "work-club-overflow-4",
              roomId: "open-oak",
              role: "work-overflow",
              col: 16,
              row: 25,
            },
            {
              id: "work-club-overflow-5",
              roomId: "open-walnut",
              role: "work-overflow",
              col: 40,
              row: 13,
            },
            {
              id: "work-club-overflow-6",
              roomId: "open-walnut",
              role: "work-overflow",
              col: 40,
              row: 17,
            },
            {
              id: "work-club-overflow-7",
              roomId: "open-walnut",
              role: "work-overflow",
              col: 40,
              row: 21,
            },
            {
              id: "work-club-overflow-8",
              roomId: "open-walnut",
              role: "work-overflow",
              col: 40,
              row: 25,
            },
            ...workClubMeetingOverflowAnchors,
          ],
          petAnchors: [
            { col: 11, row: 36 },
            { col: 50, row: 36 },
          ],
          mapLabels: [],
          workCapacity: 27,
        }
      : {
          id: kind,
          name: "Commons Suite 12",
          layout,
          entrance: {
            exterior: COMMONS_SUITE_ENTRANCE,
            badge: { col: 12, row: 23 },
            interior: { col: 12, row: 18 },
          },
          rooms: inputs.map(
            ({ role: _role, clusterId: _clusterId, ...room }) => room,
          ),
          seats: compileSeats(inputs, seatMap),
          standingAnchors: [
            {
              id: "commons-overflow-1",
              roomId: "commons-west-neighborhood",
              role: "work-overflow",
              col: 1,
              row: 12,
            },
            {
              id: "commons-overflow-2",
              roomId: "commons-west-neighborhood",
              role: "work-overflow",
              col: 1,
              row: 15,
            },
            {
              id: "commons-overflow-3",
              roomId: "commons-west-neighborhood",
              role: "work-overflow",
              col: 11,
              row: 12,
            },
            {
              id: "commons-overflow-4",
              roomId: "commons-west-neighborhood",
              role: "work-overflow",
              col: 11,
              row: 15,
            },
            {
              id: "commons-overflow-5",
              roomId: "commons-east-neighborhood",
              role: "work-overflow",
              col: 14,
              row: 12,
            },
            {
              id: "commons-overflow-6",
              roomId: "commons-east-neighborhood",
              role: "work-overflow",
              col: 14,
              row: 15,
            },
            {
              id: "commons-overflow-7",
              roomId: "commons-east-neighborhood",
              role: "work-overflow",
              col: 23,
              row: 13,
            },
            {
              id: "commons-overflow-8",
              roomId: "commons-east-neighborhood",
              role: "work-overflow",
              col: 23,
              row: 16,
            },
            ...compactMeetingOverflowAnchors,
          ],
          petAnchors: [
            { col: 9, row: 22 },
            { col: 22, row: 22 },
          ],
          mapLabels: [],
          workCapacity: 12,
        };
  validateBlueprint(blueprint);
  return blueprint;
}
