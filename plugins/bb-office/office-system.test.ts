import { beforeAll, describe, expect, test, vi } from "vitest";
import { makeFakeThreads, scenarioThreadCount } from "./fake-office-scenarios";
import {
  buildCenteredCoffeeSprite,
  buildMediaScreenSprite,
  buildMeetingTableSprite,
  buildWorkbenchSprite,
  CENTERED_COFFEE_ID,
  MEDIA_SCREEN_ID,
  MEETING_TABLE_FRONT_ID,
  pixelFurnitureCatalog,
} from "./furniture-assets";
import { buildWorkClubLayout } from "./normal-office-layout";
import { planAssignments, type ThreadPresence } from "./office-allocator";
import {
  compileOfficeBlueprint,
  type OfficeBlueprint,
} from "./office-blueprint";
import { directionTowardRoom, OfficeDirector } from "./office-director";
import { DEFAULT_OFFICE_CONFIG } from "./office-config-schema";
import {
  buildDetailedOfficeLayout,
  COMMONS_SUITE_ENTRANCE,
} from "./office-layout";
import {
  officeVisualThemeFromRgb,
  parseOfficeAppearance,
} from "./office-theme";
import { selectedAgentIdForThread } from "./office-canvas";
import {
  createPet,
  updatePet,
} from "./vendor/pixel-agents/webview-ui/src/office/engine/petEntity";
import { OfficeState } from "./vendor/pixel-agents/webview-ui/src/office/engine/officeState";
import { buildDynamicCatalog } from "./vendor/pixel-agents/webview-ui/src/office/layout/furnitureCatalog";
import {
  CharacterState,
  Direction,
  TileType,
} from "./vendor/pixel-agents/webview-ui/src/office/types";

const NOW_MS = 2_000_000_000_000;
const OFFICE_PRESENCE_WINDOW_MS = 30 * 60 * 1000;

function emptySprite(width: number, height: number): string[][] {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ""),
  );
}

function directionVector(direction: Direction): { col: number; row: number } {
  if (direction === Direction.LEFT) return { col: -1, row: 0 };
  if (direction === Direction.RIGHT) return { col: 1, row: 0 };
  if (direction === Direction.UP) return { col: 0, row: -1 };
  return { col: 0, row: 1 };
}

function blueprint(kind: "work-club" | "compact"): OfficeBlueprint {
  const layout =
    kind === "work-club" ? buildWorkClubLayout() : buildDetailedOfficeLayout();
  return compileOfficeBlueprint(kind, layout);
}

function assignmentsFor(
  office: OfficeBlueprint,
  threads: readonly ThreadPresence[],
  previous: ReturnType<typeof planAssignments> | null = null,
) {
  return planAssignments({
    office,
    threads,
    previous,
    nowMs: NOW_MS,
    behavior: DEFAULT_OFFICE_CONFIG.behavior,
  });
}

function assignmentSnapshot(plan: ReturnType<typeof planAssignments>) {
  return [...plan.assignments.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

function advanceUntil(
  director: OfficeDirector,
  condition: () => boolean,
  maxSteps = 1_200,
): void {
  for (let step = 0; step < maxSteps; step += 1) {
    director.update(0.1);
    if (condition()) return;
  }
  throw new Error("Office director did not reach the expected state");
}

beforeAll(() => {
  const sprites = Object.fromEntries(
    pixelFurnitureCatalog.map((entry) => [
      entry.id,
      emptySprite(entry.width, entry.height),
    ]),
  );
  expect(buildDynamicCatalog({ catalog: pixelFurnitureCatalog, sprites })).toBe(
    true,
  );
});

describe("authored office blueprints", () => {
  test("resolves the current route thread to its worker", () => {
    const threads = makeFakeThreads("compact", "five", NOW_MS);

    expect(selectedAgentIdForThread(threads, threads[2]?.threadId)).toBe(
      threads[2]?.agentId,
    );
    expect(selectedAgentIdForThread(threads, "missing-thread")).toBeNull();
    expect(selectedAgentIdForThread(threads, null)).toBeNull();
  });

  test("compile every semantic seat and anchor onto reachable authored geometry", () => {
    const workClub = blueprint("work-club");
    const compact = blueprint("compact");

    expect(workClub.workCapacity).toBe(27);
    expect(compact.workCapacity).toBe(12);
    expect(compact.name).toBe("Commons Suite 12");
    expect(compact.layout.cols).toBe(25);
    expect(compact.layout.rows).toBe(26);
    expect(COMMONS_SUITE_ENTRANCE).toEqual({ col: 12, row: 25 });
    expect(
      workClub.rooms.filter((room) => room.purpose === "meeting"),
    ).toHaveLength(6);
    expect(
      compact.rooms.filter((room) => room.purpose === "meeting"),
    ).toHaveLength(3);
    expect(
      compact.rooms
        .filter((room) => room.purpose === "meeting")
        .map((room) => room.capacity)
        .sort((left, right) => left - right),
    ).toEqual([4, 4, 4]);
    expect(
      compact.rooms
        .filter((room) => room.purpose === "meeting")
        .every((room) => room.seatIds.length === 4),
    ).toBe(true);
    expect(
      compact.layout.furniture.filter(
        (item) => item.type === MEETING_TABLE_FRONT_ID,
      ),
    ).toHaveLength(3);
    expect(
      compact.rooms.filter((room) => room.purpose === "work"),
    ).toHaveLength(2);
    expect(compact.seats.filter((seat) => seat.role === "rest")).toHaveLength(
      8,
    );
    expect(
      compact.rooms
        .filter((room) => room.purpose === "lounge")
        .map((room) => room.capacity),
    ).toEqual([4, 4]);
    expect(compact.mapLabels).toEqual([]);
    expect(
      workClub.standingAnchors.filter(
        (anchor) => anchor.role === "work-overflow",
      ),
    ).toHaveLength(8);
    expect(
      workClub.standingAnchors.filter(
        (anchor) => anchor.role === "meeting-overflow",
      ),
    ).toHaveLength(20);
    expect(
      compact.standingAnchors.filter(
        (anchor) => anchor.role === "work-overflow",
      ),
    ).toHaveLength(8);
    expect(
      compact.standingAnchors.filter(
        (anchor) => anchor.role === "meeting-overflow",
      ),
    ).toHaveLength(28);
    for (const anchor of compact.standingAnchors) {
      const roomSeats = compact.seats.filter(
        (seat) => seat.roomId === anchor.roomId,
      );
      const center = roomSeats.reduce(
        (total, seat) => ({
          col: total.col + seat.col / roomSeats.length,
          row: total.row + seat.row / roomSeats.length,
        }),
        { col: 0, row: 0 },
      );
      const vector = directionVector(
        directionTowardRoom(anchor, compact.seats),
      );
      expect(
        vector.col * (center.col - anchor.col) +
          vector.row * (center.row - anchor.row),
        anchor.id,
      ).toBeGreaterThan(0);
    }

    for (const room of compact.rooms.filter(
      (candidate) => candidate.purpose === "work",
    )) {
      const seatsBySide = new Map<number, number[]>();
      for (const seat of compact.seats.filter(
        (candidate) => candidate.roomId === room.id,
      )) {
        const rows = seatsBySide.get(seat.col) ?? [];
        rows.push(seat.row);
        seatsBySide.set(seat.col, rows);
      }
      expect(seatsBySide.size).toBe(2);
      for (const sideRows of seatsBySide.values()) {
        const rows = [...sideRows].sort((left, right) => left - right);
        expect(rows).toHaveLength(3);
        expect(rows[1] - rows[0]).toBeGreaterThanOrEqual(3);
        expect(rows[2] - rows[1]).toBeGreaterThanOrEqual(3);
      }
    }

    for (const prefix of ["west", "east"] as const) {
      const workbench = compact.layout.furniture.filter((item) =>
        item.uid.startsWith(`commons-${prefix}-table`),
      );
      expect(workbench).toHaveLength(1);
      expect(workbench[0]?.type).toBe("WORKBENCH_FRONT");
      expect(workbench[0]?.col).toBe(prefix === "west" ? 5 : 16);
      const seatRows = compact.seats
        .filter((seat) => seat.clusterId === `commons-${prefix}-neighborhood`)
        .map((seat) => seat.row)
        .sort((left, right) => left - right);
      expect([...new Set(seatRows)]).toEqual([11, 14, 17]);
      const computerRows = compact.layout.furniture
        .filter((item) => item.uid.startsWith(`commons-${prefix}-pc-`))
        .map((item) => item.row)
        .sort((left, right) => left - right);
      expect([...new Set(computerRows)]).toEqual([10, 13, 16]);
    }
    expect(
      compact.layout.furniture.some((item) =>
        item.uid.startsWith("commons-resource-"),
      ),
    ).toBe(false);
  });

  test("places meeting seats and mugs at their optical surface anchors", () => {
    const compact = blueprint("compact");
    const furnitureById = new Map(
      compact.layout.furniture.map((item) => [item.uid, item]),
    );
    const mediaTable = furnitureById.get("commons-media-table");
    const teamTable = furnitureById.get("commons-team-table");

    expect(
      pixelFurnitureCatalog.find(
        (entry) => entry.id === MEETING_TABLE_FRONT_ID,
      ),
    ).toMatchObject({ width: 32, height: 48, footprintW: 2, footprintH: 3 });
    expect(
      pixelFurnitureCatalog.find((entry) => entry.id === CENTERED_COFFEE_ID),
    ).toMatchObject({ width: 32, height: 16, footprintW: 2, footprintH: 1 });
    const meetingRooms = [
      { prefix: "commons-meeting", roomId: "commons-meeting", center: 4 },
      {
        prefix: "commons-meeting-b",
        roomId: "commons-meeting-b",
        center: 12,
      },
      {
        prefix: "commons-meeting-c",
        roomId: "commons-meeting-c",
        center: 20,
      },
    ] as const;
    for (const room of meetingRooms) {
      const table = furnitureById.get(`${room.prefix}-table`);
      const tableEntry = pixelFurnitureCatalog.find(
        (candidate) => candidate.id === table?.type,
      );
      expect(table?.type).toBe(MEETING_TABLE_FRONT_ID);
      expect(
        (table?.col ?? Number.NaN) + (tableEntry?.footprintW ?? Number.NaN) / 2,
      ).toBe(room.center);
      expect(table?.row).toBe(3);
      for (const row of ["top", "bottom"] as const) {
        const left = furnitureById.get(`${room.prefix}-left-${row}`);
        const right = furnitureById.get(`${room.prefix}-right-${row}`);
        expect((right?.col ?? Number.NaN) - (left?.col ?? Number.NaN)).toBe(3);
        expect(
          ((left?.col ?? Number.NaN) + 0.5 + (right?.col ?? Number.NaN) + 0.5) /
            2,
        ).toBe(room.center);
      }
      expect(
        compact.seats
          .filter((candidate) => candidate.roomId === room.roomId)
          .map((seat) => seat.row)
          .sort((left, right) => left - right),
      ).toEqual([3, 3, 5, 5]);
    }
    expect(furnitureById.get("commons-media-screen")).toMatchObject({
      type: MEDIA_SCREEN_ID,
      col: 4,
      row: 24,
    });
    expect(mediaTable).toMatchObject({ col: 4, row: 22 });
    expect(teamTable).toMatchObject({ col: 18, row: 21 });
    expect(
      compact.layout.furniture.filter((item) => item.type.startsWith("SOFA_")),
    ).toHaveLength(4);
    expect(
      compact.layout.furniture.some((item) =>
        item.uid.startsWith("commons-coffee-counter"),
      ),
    ).toBe(false);

    const expectedMugs = new Map<string, readonly [number, number]>([
      ["commons-meeting-coffee", [3, 4]],
      ["commons-meeting-b-coffee", [11, 4]],
      ["commons-west-coffee", [6, 11]],
      ["commons-east-coffee", [17, 17]],
      ["commons-media-coffee", [4, 23]],
      ["commons-team-coffee", [18, 22]],
    ]);
    const mugs = compact.layout.furniture.filter(
      (item) => item.type === "COFFEE" || item.type === CENTERED_COFFEE_ID,
    );
    expect(mugs.map((mug) => mug.uid).sort()).toEqual(
      [...expectedMugs.keys()].sort(),
    );
    for (const mug of mugs) {
      expect([mug.col, mug.row], mug.uid).toEqual(expectedMugs.get(mug.uid));
    }

    const desks = compact.layout.furniture.filter((item) => {
      const entry = pixelFurnitureCatalog.find(
        (candidate) => candidate.id === item.type.split(":")[0],
      );
      return entry?.isDesk === true;
    });
    for (const mug of mugs) {
      const support = desks.find((desk) => {
        const entry = pixelFurnitureCatalog.find(
          (candidate) => candidate.id === desk.type.split(":")[0],
        );
        return Boolean(
          entry &&
          mug.col >= desk.col &&
          mug.col < desk.col + entry.footprintW &&
          mug.row >= desk.row &&
          mug.row < desk.row + entry.footprintH,
        );
      });
      expect(support, mug.uid).toBeDefined();
      const supportEntry = pixelFurnitureCatalog.find(
        (candidate) => candidate.id === support?.type.split(":")[0],
      );
      expect(mug.row, mug.uid).toBeGreaterThanOrEqual(
        (support?.row ?? Number.POSITIVE_INFINITY) +
          (supportEntry?.backgroundTiles ?? 0),
      );
    }
    expect(compact.layout.furniture.some((item) => item.type === "BIN")).toBe(
      false,
    );
  });

  test("builds restrained BB-following and neutral environment palettes", () => {
    const following = buildDetailedOfficeLayout({
      appearance: "follow-bb",
      mode: "light",
      accentHue: 292,
      accentSaturation: 80,
    });
    const neutral = buildDetailedOfficeLayout({
      appearance: "neutral",
      mode: "light",
      accentHue: 292,
      accentSaturation: 80,
    });
    const meetingFloor = 3 * following.cols + 1;
    const openFloor = 10 * following.cols + 1;
    const topWall = 2 * following.cols + 1;

    expect(following.tileColors?.[meetingFloor]).toMatchObject({
      h: 292,
      s: 32,
    });
    expect(following.tileColors?.[openFloor]).toMatchObject({ h: 26, s: 43 });
    expect(following.tileColors?.[topWall]).toMatchObject({ h: 292, s: 16 });
    expect(
      neutral.tileColors
        ?.filter((color) => color !== null)
        .every((color) => color.s === 0),
    ).toBe(true);
    expect(
      neutral.carpetTiles
        ?.filter((tile) => tile !== null)
        .every((tile) => tile.color?.s === 0 && tile.accentColor?.s === 0),
    ).toBe(true);
    expect(neutral.furniture).toEqual(following.furniture);
  });

  test("derives office appearance and accent from BB theme colors", () => {
    expect(parseOfficeAppearance("Follow BB")).toBe("follow-bb");
    expect(parseOfficeAppearance("Neutral")).toBe("neutral");
    expect(parseOfficeAppearance("Original")).toBe("original");
    expect(officeVisualThemeFromRgb("follow-bb", "dark", 66, 135, 245)).toEqual(
      {
        appearance: "follow-bb",
        mode: "dark",
        accentHue: 217,
        accentSaturation: 90,
      },
    );
    expect(
      officeVisualThemeFromRgb("follow-bb", "light", 128, 128, 128),
    ).toMatchObject({ accentHue: 0, accentSaturation: 0 });
  });

  test("keeps pets settled for at least 45 seconds between decisions", () => {
    const officeBlueprint = blueprint("compact");
    const officeState = new OfficeState(officeBlueprint.layout);
    const anchoredPet = createPet("quiet-pet", 0, 1, 1);
    officeState.pets.push(anchoredPet);
    new OfficeDirector(
      officeState,
      officeBlueprint,
      DEFAULT_OFFICE_CONFIG.behavior,
    );
    expect(anchoredPet.wanderTimer).toBeGreaterThanOrEqual(45);

    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const idlePet = createPet("idle-pet", 0, 0, 0);
      idlePet.wanderTimer = 0;
      updatePet(
        idlePet,
        0.1,
        [{ col: 0, row: 0 }],
        new Map(),
        [[TileType.FLOOR_1]],
        new Set(),
      );
      expect(idlePet.wanderTimer).toBeGreaterThanOrEqual(45);

      random.mockReturnValue(0.99);
      const roamingPet = createPet("roaming-pet", 0, 10, 0);
      roamingPet.wanderTimer = 0;
      const walkableTiles = Array.from({ length: 21 }, (_, col) => ({
        col,
        row: 0,
      }));
      updatePet(
        roamingPet,
        0.1,
        walkableTiles,
        new Map(),
        [Array.from({ length: 21 }, () => TileType.FLOOR_1)],
        new Set(),
      );
      const destination = roamingPet.path.at(-1);
      expect(destination).toBeDefined();
      expect(Math.abs((destination?.col ?? 10) - 10)).toBeLessThanOrEqual(6);
    } finally {
      random.mockRestore();
    }
  });

  test("builds a continuous nine-tile workbench without an internal edge", () => {
    const source = Array.from({ length: 64 }, (_, row) =>
      Array.from({ length: 48 }, () =>
        row < 11 ? "" : row < 55 ? "#body" : "#edge",
      ),
    );
    const workbench = buildWorkbenchSprite(source);

    expect(workbench).toHaveLength(144);
    expect(
      workbench
        .slice(11, 135)
        .every((row) => row.every((pixel) => pixel === "#body")),
    ).toBe(true);
    expect(
      workbench
        .slice(135)
        .every((row) => row.every((pixel) => pixel === "#edge")),
    ).toBe(true);
  });

  test("narrows the meeting table without losing its outer edges", () => {
    const source = Array.from({ length: 64 }, (_, row) =>
      Array.from({ length: 48 }, (_, col) => (row < 11 ? "" : `#${col}`)),
    );
    const table = buildMeetingTableSprite(source);

    expect(table).toHaveLength(48);
    expect(table.every((row) => row.length === 32)).toBe(true);
    expect(table[0]).toEqual([
      ...source[11].slice(0, 8),
      ...source[11].slice(16, 32),
      ...source[11].slice(40),
    ]);
    expect(table.at(-1)).toEqual([
      ...source.at(-1)!.slice(0, 8),
      ...source.at(-1)!.slice(16, 32),
      ...source.at(-1)!.slice(40),
    ]);
    expect(table[39]).toEqual([
      ...source[55].slice(0, 8),
      ...source[55].slice(16, 32),
      ...source[55].slice(40),
    ]);
  });

  test("turns the whiteboard silhouette into a native-size media screen", () => {
    const source = Array.from({ length: 32 }, () =>
      Array.from({ length: 32 }, () => "#FFFFFF"),
    );
    const screen = buildMediaScreenSprite(source);

    expect(screen).toHaveLength(32);
    expect(screen.every((row) => row.length === 32)).toBe(true);
    expect(screen[12]?.[5]).toBe("#142C42");
    expect(screen[14]?.[7]).toBe("#68D5C1");
  });

  test("centers the Pixel Agents mug across a two-tile table", () => {
    const source = Array.from({ length: 16 }, (_, row) =>
      Array.from({ length: 16 }, (_, col) => `${row}:${col}`),
    );
    const centered = buildCenteredCoffeeSprite(source);

    expect(centered).toHaveLength(16);
    expect(centered.every((row) => row.length === 32)).toBe(true);
    expect(centered[0]?.slice(0, 4)).toEqual(["", "", "", ""]);
    expect(centered[0]?.slice(4, 20)).toEqual(source[0]);
    expect(centered[0]?.slice(20)).toEqual(
      Array.from({ length: 12 }, () => ""),
    );
  });

  test.each([
    ["work-club", "five", { work: 3, meeting: 2, rest: 0, overflow: 0 }],
    ["work-club", "ten", { work: 7, meeting: 2, rest: 1, overflow: 0 }],
    ["work-club", "twenty", { work: 9, meeting: 8, rest: 3, overflow: 0 }],
    ["work-club", "overflow", { work: 41, meeting: 0, rest: 0, overflow: 7 }],
    ["compact", "five", { work: 3, meeting: 2, rest: 0, overflow: 0 }],
    ["compact", "ten", { work: 7, meeting: 2, rest: 1, overflow: 0 }],
    ["compact", "twenty", { work: 9, meeting: 8, rest: 3, overflow: 0 }],
    ["compact", "overflow", { work: 12, meeting: 0, rest: 0, overflow: 8 }],
  ] as const)(
    "places the %s %s population without collisions",
    (kind, scenario, expected) => {
      const office = blueprint(kind);
      const threads = makeFakeThreads(kind, scenario, NOW_MS);
      const plan = assignmentsFor(office, threads);
      const destinations = [...plan.assignments.values()]
        .map((assignment) => assignment.seatId ?? assignment.anchorId)
        .filter((destination): destination is string => destination !== null);

      expect(plan.assignments.size).toBe(scenarioThreadCount(kind, scenario));
      expect(new Set(destinations).size).toBe(destinations.length);
      expect(plan.counts).toEqual({ ...expected, away: 0, exiting: 0 });
    },
  );
});

describe("deterministic assignment policy", () => {
  test("puts active sibling child threads in the smallest shared room", () => {
    const office = blueprint("compact");
    const siblings = makeFakeThreads("compact", "five", NOW_MS)
      .slice(2, 4)
      .map((thread) => ({
        ...thread,
        worktreeId: null,
        parentThreadId: "parent-outside-office",
      }));
    const plan = assignmentsFor(office, siblings);
    const cohort = plan.meetingCohorts[0];

    expect(plan.meetingCohorts).toHaveLength(1);
    expect(cohort?.threadIds).toEqual(["thread-03", "thread-04"]);
    expect(cohort?.roomId).toBe("commons-meeting");
    expect(
      siblings.map((thread) => plan.assignments.get(thread.threadId)?.kind),
    ).toEqual(["meeting", "meeting"]);
  });

  test("merges overlapping sibling and worktree relationships once", () => {
    const office = blueprint("compact");
    const related = makeFakeThreads("compact", "five", NOW_MS)
      .slice(0, 3)
      .map((thread, index) => ({
        ...thread,
        worktreeId: index < 2 ? "shared-worktree" : null,
        parentThreadId: index === 0 || index === 2 ? "shared-parent" : null,
      }));
    const plan = assignmentsFor(office, related);
    const cohort = plan.meetingCohorts[0];

    expect(plan.meetingCohorts).toHaveLength(1);
    expect(cohort?.threadIds).toEqual(["thread-01", "thread-02", "thread-03"]);
    expect(cohort?.roomId).toBe("commons-meeting");
    expect(plan.assignments.size).toBe(3);
    expect(
      related.map((thread) => plan.assignments.get(thread.threadId)?.cohortId),
    ).toEqual([cohort?.id, cohort?.id, cohort?.id]);
  });

  test("selects smallest-fitting rooms and distributes unrelated work", () => {
    const office = blueprint("work-club");
    const threads = makeFakeThreads("work-club", "twenty", NOW_MS);
    const plan = assignmentsFor(office, threads);
    const roomById = new Map(office.rooms.map((room) => [room.id, room]));

    for (const cohort of plan.meetingCohorts) {
      expect(cohort.roomId).not.toBeNull();
      const room = roomById.get(cohort.roomId ?? "");
      expect(room?.capacity).toBe(cohort.threadIds.length);
    }

    const sparseThreads = makeFakeThreads("work-club", "five", NOW_MS);
    const sparsePlan = assignmentsFor(office, sparseThreads);
    const seats = new Map(office.seats.map((seat) => [seat.id, seat]));
    const third = sparsePlan.assignments.get("thread-03");
    const fourth = sparsePlan.assignments.get("thread-04");
    const thirdSeat = seats.get(third?.seatId ?? "");
    const fourthSeat = seats.get(fourth?.seatId ?? "");
    expect(thirdSeat?.clusterId).not.toBe(fourthSeat?.clusterId);
  });

  test("preserves occupied rooms and produces identical plans on replay", () => {
    const office = blueprint("work-club");
    const threads = makeFakeThreads("work-club", "twenty", NOW_MS);
    const first = assignmentsFor(office, threads);
    const replay = assignmentsFor(office, threads);
    const retained = assignmentsFor(office, threads, first);

    expect(assignmentSnapshot(replay)).toEqual(assignmentSnapshot(first));
    expect(assignmentSnapshot(retained)).toEqual(assignmentSnapshot(first));
  });

  test("packs an oversized cohort into the largest available meeting room", () => {
    const office = blueprint("compact");
    const threads = makeFakeThreads("compact", "overflow", NOW_MS)
      .slice(0, 12)
      .map((thread) => ({
        ...thread,
        worktreeId: "worktree-oversized",
      }));
    const plan = assignmentsFor(office, threads);
    const cohort = plan.meetingCohorts[0];
    const cohortAssignments = threads.map((thread) =>
      plan.assignments.get(thread.threadId),
    );

    expect(cohort?.roomId).toBe("commons-meeting");
    expect(cohortAssignments).toHaveLength(12);
    expect(
      cohortAssignments.every(
        (assignment) =>
          assignment?.kind === "meeting" &&
          assignment.roomId === "commons-meeting",
      ),
    ).toBe(true);
    expect(
      cohortAssignments.filter((assignment) => assignment?.seatId !== null),
    ).toHaveLength(4);
    expect(
      cohortAssignments.filter((assignment) => assignment?.anchorId !== null),
    ).toHaveLength(8);
    const destinations = cohortAssignments.map(
      (assignment) => assignment?.seatId ?? assignment?.anchorId,
    );
    expect(new Set(destinations).size).toBe(destinations.length);
  });

  test("rests immediately, returns to work, and exits after thirty idle minutes", () => {
    const office = blueprint("compact");
    const active = makeFakeThreads("compact", "five", NOW_MS)[4];
    const workPlan = assignmentsFor(office, [active]);
    const resting = {
      ...active,
      status: "idle",
      idleSinceMs: NOW_MS,
    } satisfies ThreadPresence;
    const restPlan = assignmentsFor(office, [resting], workPlan);
    const resumed = {
      ...resting,
      status: "active",
      idleSinceMs: null,
    } satisfies ThreadPresence;
    const resumedPlan = assignmentsFor(office, [resumed], restPlan);
    const expired = {
      ...resting,
      idleSinceMs: NOW_MS - OFFICE_PRESENCE_WINDOW_MS,
    } satisfies ThreadPresence;
    const expiredPlan = assignmentsFor(office, [expired], restPlan);

    expect(workPlan.assignments.get(active.threadId)?.kind).toBe("work");
    expect(restPlan.assignments.get(active.threadId)?.kind).toBe("rest");
    expect(resumedPlan.assignments.get(active.threadId)?.kind).toBe("work");
    expect(expiredPlan.assignments.get(active.threadId)?.kind).toBe("exit");
  });
});

describe("office motion director", () => {
  test("honors configured relationship and inactivity rules", () => {
    const officeBlueprint = blueprint("compact");
    const related = makeFakeThreads("compact", "five", NOW_MS)
      .slice(0, 3)
      .map((thread) => ({
        ...thread,
        worktreeId: "shared-worktree",
        parentThreadId: "shared-parent",
      }));
    const noMeetingPlan = planAssignments({
      office: officeBlueprint,
      threads: related,
      previous: null,
      nowMs: NOW_MS,
      behavior: {
        ...DEFAULT_OFFICE_CONFIG.behavior,
        meetingRelations: [],
      },
    });
    expect(noMeetingPlan.counts.meeting).toBe(0);
    expect(noMeetingPlan.counts.work).toBe(3);

    const idle = {
      ...related[0],
      status: "idle" as const,
      idleSinceMs: NOW_MS - 16 * 60 * 1000,
    };
    const earlierExit = planAssignments({
      office: officeBlueprint,
      threads: [idle],
      previous: null,
      nowMs: NOW_MS,
      behavior: {
        ...DEFAULT_OFFICE_CONFIG.behavior,
        inactiveExitAfterMinutes: 15,
      },
    });
    expect(earlierExit.assignments.get(idle.threadId)?.kind).toBe("exit");
    expect(assignmentsFor(officeBlueprint, [idle]).assignments.get(idle.threadId)?.kind).toBe("rest");
  });

  test("can disable ambient pet decisions without removing pets", () => {
    const officeBlueprint = blueprint("compact");
    const officeState = new OfficeState(officeBlueprint.layout);
    officeState.pets.push(createPet("quiet-pet", 0, 0, 0));
    new OfficeDirector(officeState, officeBlueprint, {
      ...DEFAULT_OFFICE_CONFIG.behavior,
      ambientMotion: "off",
    });
    expect(officeState.pets.length).toBeGreaterThan(0);
    expect(
      officeState.pets.every(
        (pet) => pet.wanderTimer === Number.POSITIVE_INFINITY,
      ),
    ).toBe(true);
  });

  test("walks every member of an oversized cohort into its packed room", () => {
    const officeBlueprint = blueprint("compact");
    const officeState = new OfficeState(officeBlueprint.layout);
    const director = new OfficeDirector(
      officeState,
      officeBlueprint,
      DEFAULT_OFFICE_CONFIG.behavior,
    );
    const threads = makeFakeThreads("compact", "overflow", NOW_MS)
      .slice(0, 12)
      .map((thread) => ({
        ...thread,
        worktreeId: "worktree-oversized",
      }));
    const plan = director.reconcile(threads, NOW_MS);

    expect(plan.counts.meeting).toBe(12);
    advanceUntil(
      director,
      () =>
        threads.every(
          (thread) =>
            director.getOccupant(thread.agentId)?.activity ===
            "Meeting with related threads",
        ),
      2_400,
    );

    for (const thread of threads) {
      const assignment = plan.assignments.get(thread.threadId);
      expect(assignment?.roomId).toBe("commons-meeting");
      expect(assignment?.kind).toBe("meeting");
      if (!assignment || assignment.anchorId === null) continue;
      const anchor = officeBlueprint.standingAnchors.find(
        (candidate) => candidate.id === assignment.anchorId,
      );
      const character = officeState.characters.get(thread.agentId);
      expect({ col: character?.tileCol, row: character?.tileRow }).toEqual({
        col: anchor?.col,
        row: anchor?.row,
      });
      expect(character?.state).toBe(CharacterState.IDLE);
      if (!anchor) throw new Error(`Missing anchor ${assignment.anchorId}`);
      expect(character?.dir).toBe(
        directionTowardRoom(anchor, officeBlueprint.seats),
      );
    }
  });

  test("rests idle threads immediately and admits overflow when work resumes", () => {
    const officeBlueprint = blueprint("compact");
    const officeState = new OfficeState(officeBlueprint.layout);
    const director = new OfficeDirector(
      officeState,
      officeBlueprint,
      DEFAULT_OFFICE_CONFIG.behavior,
    );
    const idleThreads = makeFakeThreads("compact", "ten", NOW_MS)
      .slice(0, 10)
      .map((thread) => ({
        ...thread,
        status: "idle" as const,
        idleSinceMs: NOW_MS,
      }));
    const idlePlan = director.seedSettled(idleThreads, NOW_MS);
    const away = idleThreads.find(
      (thread) => idlePlan.assignments.get(thread.threadId)?.kind === "away",
    );

    expect(idlePlan.counts.rest).toBe(8);
    expect(idlePlan.counts.away).toBe(2);
    expect(away).toBeDefined();
    expect(director.getOccupant(away?.agentId ?? -1)).toBeNull();

    const resumedThreads = idleThreads.map((thread) =>
      thread.threadId === away?.threadId
        ? { ...thread, status: "active" as const, idleSinceMs: null }
        : thread,
    );
    director.reconcile(resumedThreads, NOW_MS + 1);
    director.update(0.1);
    expect(director.getOccupant(away?.agentId ?? -1)?.activity).toBe(
      "Walking through the south door",
    );
    advanceUntil(
      director,
      () =>
        director
          .getOccupant(away?.agentId ?? -1)
          ?.activity.startsWith("Working") === true,
    );
  });

  test("walks in, rests immediately, resumes, and walks out after thirty idle minutes", () => {
    const officeBlueprint = blueprint("compact");
    const officeState = new OfficeState(officeBlueprint.layout);
    const director = new OfficeDirector(
      officeState,
      officeBlueprint,
      DEFAULT_OFFICE_CONFIG.behavior,
    );
    const thread = makeFakeThreads("compact", "five", NOW_MS)[4];

    director.reconcile([thread], NOW_MS);
    expect(officeState.characters.has(thread.agentId)).toBe(false);
    director.update(0.1);
    expect(director.getOccupant(thread.agentId)?.activity).toBe(
      "Walking through the south door",
    );

    advanceUntil(
      director,
      () =>
        director.getOccupant(thread.agentId)?.activity.startsWith("Working") ===
        true,
    );
    const workingCharacter = officeState.characters.get(thread.agentId);
    expect(workingCharacter?.state).toBe(CharacterState.TYPE);
    const settledPosition = {
      col: workingCharacter?.tileCol,
      row: workingCharacter?.tileRow,
    };
    for (let step = 0; step < 600; step += 1) director.update(0.1);
    expect({
      col: officeState.characters.get(thread.agentId)?.tileCol,
      row: officeState.characters.get(thread.agentId)?.tileRow,
    }).toEqual(settledPosition);

    const resting = {
      ...thread,
      status: "idle",
      idleSinceMs: NOW_MS,
    } satisfies ThreadPresence;
    director.reconcile([resting], NOW_MS);
    advanceUntil(
      director,
      () =>
        director.getOccupant(thread.agentId)?.activity ===
        "Taking a break · reading",
    );
    expect(officeState.characters.get(thread.agentId)?.state).toBe(
      CharacterState.TYPE,
    );

    const resumed = {
      ...resting,
      status: "active",
      idleSinceMs: null,
    } satisfies ThreadPresence;
    director.reconcile([resumed], NOW_MS + 1);
    advanceUntil(
      director,
      () =>
        director.getOccupant(thread.agentId)?.activity.startsWith("Working") ===
        true,
    );

    director.reconcile(
      [
        {
          ...resumed,
          status: "idle",
          idleSinceMs: NOW_MS + 2 - OFFICE_PRESENCE_WINDOW_MS,
        },
      ],
      NOW_MS + 2,
    );
    advanceUntil(director, () => director.getOccupant(thread.agentId) === null);
    for (let step = 0; step < 20; step += 1) director.update(0.1);
    expect(officeState.characters.has(thread.agentId)).toBe(false);
  });
});
