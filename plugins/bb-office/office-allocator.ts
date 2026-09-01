import type {
  OfficeBlueprint,
  SemanticSeat,
  StandingAnchor,
} from "./office-blueprint";
import type { OfficeConfig } from "./office-config-schema";

export type ThreadPresenceStatus = "active" | "idle" | "archived";
export type ThreadProvider = string;

export interface ThreadPresence {
  threadId: string;
  agentId: number;
  name: string;
  title: string;
  provider: ThreadProvider;
  worktreeId: string | null;
  parentThreadId: string | null;
  status: ThreadPresenceStatus;
  idleSinceMs: number | null;
  createdAtMs: number;
  tool: string;
  palette: number;
  hueShift: number;
}

export type AssignmentKind =
  | "work"
  | "meeting"
  | "rest"
  | "work-overflow"
  | "away"
  | "exit";

export interface OfficeAssignment {
  threadId: string;
  kind: AssignmentKind;
  roomId: string | null;
  seatId: string | null;
  anchorId: string | null;
  cohortId: string | null;
}

export interface MeetingCohortPlan {
  id: string;
  threadIds: readonly string[];
  roomId: string | null;
}

export interface AssignmentPlan {
  assignments: ReadonlyMap<string, OfficeAssignment>;
  meetingCohorts: readonly MeetingCohortPlan[];
  counts: {
    work: number;
    meeting: number;
    rest: number;
    overflow: number;
    away: number;
    exiting: number;
  };
}

export interface AssignmentInput {
  office: OfficeBlueprint;
  threads: readonly ThreadPresence[];
  previous: AssignmentPlan | null;
  nowMs: number;
  behavior: OfficeConfig["behavior"];
}

interface Cohort {
  id: string;
  threads: ThreadPresence[];
  oldestMs: number;
}

class DisjointSet {
  private readonly parent = new Map<string, string>();

  add(value: string): void {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: string): string {
    const parent = this.parent.get(value);
    if (!parent) throw new Error(`Unknown disjoint-set value ${value}`);
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    if (leftRoot < rightRoot) this.parent.set(rightRoot, leftRoot);
    else this.parent.set(leftRoot, rightRoot);
  }
}

function shouldRest(
  thread: ThreadPresence,
  nowMs: number,
  presenceWindowMs: number,
): boolean {
  return (
    thread.status === "idle" &&
    (thread.idleSinceMs === null ||
      nowMs - thread.idleSinceMs < presenceWindowMs)
  );
}

function shouldExitOffice(
  thread: ThreadPresence,
  nowMs: number,
  presenceWindowMs: number,
): boolean {
  return (
    thread.status === "archived" ||
    (thread.status === "idle" &&
      thread.idleSinceMs !== null &&
      nowMs - thread.idleSinceMs >= presenceWindowMs)
  );
}

function buildCohorts(
  threads: readonly ThreadPresence[],
  relations: OfficeConfig["behavior"]["meetingRelations"],
): {
  cohorts: Cohort[];
  membership: Map<string, string>;
} {
  const working = threads
    .filter((thread) => thread.status === "active")
    .sort((left, right) => left.threadId.localeCompare(right.threadId));
  const byId = new Map(working.map((thread) => [thread.threadId, thread]));
  const set = new DisjointSet();
  for (const thread of working) set.add(thread.threadId);

  if (relations.includes("same-worktree")) {
    const firstByWorktree = new Map<string, string>();
    for (const thread of working) {
      if (thread.worktreeId === null) continue;
      const first = firstByWorktree.get(thread.worktreeId);
      if (first) set.union(first, thread.threadId);
      else firstByWorktree.set(thread.worktreeId, thread.threadId);
    }
  }

  if (relations.includes("siblings")) {
    const firstByParent = new Map<string, string>();
    for (const thread of working) {
      if (thread.parentThreadId === null) continue;
      const first = firstByParent.get(thread.parentThreadId);
      if (first) set.union(first, thread.threadId);
      else firstByParent.set(thread.parentThreadId, thread.threadId);
    }
  }

  if (relations.includes("parent-child")) {
    for (const thread of working) {
      if (thread.parentThreadId !== null && byId.has(thread.parentThreadId)) {
        set.union(thread.threadId, thread.parentThreadId);
      }
    }
  }

  const grouped = new Map<string, ThreadPresence[]>();
  for (const thread of working) {
    const root = set.find(thread.threadId);
    const group = grouped.get(root) ?? [];
    group.push(thread);
    grouped.set(root, group);
  }

  const cohorts: Cohort[] = [];
  const membership = new Map<string, string>();
  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((left, right) =>
      left.threadId.localeCompare(right.threadId),
    );
    const id = `cohort:${sorted.map((thread) => thread.threadId).join("+")}`;
    const oldestMs = sorted.reduce(
      (oldest, thread) => Math.min(oldest, thread.createdAtMs),
      Infinity,
    );
    cohorts.push({ id, threads: sorted, oldestMs });
    for (const thread of sorted) membership.set(thread.threadId, id);
  }
  return { cohorts, membership };
}

function previousAssignment(
  previous: AssignmentPlan | null,
  threadId: string,
): OfficeAssignment | null {
  return previous?.assignments.get(threadId) ?? null;
}

function assignRoom(
  cohort: Cohort,
  roomId: string,
  roomSeatIds: readonly string[],
  roomStandingAnchors: readonly StandingAnchor[],
  previous: AssignmentPlan | null,
  assignments: Map<string, OfficeAssignment>,
  reservedSeats: Set<string>,
): void {
  const availableSeats = [...roomSeatIds];
  const availableAnchors = [...roomStandingAnchors];
  for (const thread of cohort.threads) {
    const prior = previousAssignment(previous, thread.threadId);
    if (prior?.roomId === roomId && prior.seatId !== null) {
      const index = availableSeats.indexOf(prior.seatId);
      if (index >= 0) {
        const seatId = availableSeats.splice(index, 1)[0];
        reservedSeats.add(seatId);
        assignments.set(thread.threadId, {
          threadId: thread.threadId,
          kind: "meeting",
          roomId,
          seatId,
          anchorId: null,
          cohortId: cohort.id,
        });
      }
    }
  }
  for (const thread of cohort.threads) {
    if (assignments.has(thread.threadId)) continue;
    const prior = previousAssignment(previous, thread.threadId);
    if (prior?.roomId !== roomId || prior.anchorId === null) continue;
    const index = availableAnchors.findIndex(
      (anchor) => anchor.id === prior.anchorId,
    );
    if (index < 0) continue;
    const anchor = availableAnchors.splice(index, 1)[0];
    assignments.set(thread.threadId, {
      threadId: thread.threadId,
      kind: "meeting",
      roomId,
      seatId: null,
      anchorId: anchor.id,
      cohortId: cohort.id,
    });
  }
  for (const thread of cohort.threads) {
    if (assignments.has(thread.threadId)) continue;
    const seatId = availableSeats.shift();
    if (seatId) {
      reservedSeats.add(seatId);
      assignments.set(thread.threadId, {
        threadId: thread.threadId,
        kind: "meeting",
        roomId,
        seatId,
        anchorId: null,
        cohortId: cohort.id,
      });
      continue;
    }
    const anchor = availableAnchors.shift();
    if (!anchor) continue;
    assignments.set(thread.threadId, {
      threadId: thread.threadId,
      kind: "meeting",
      roomId,
      seatId: null,
      anchorId: anchor.id,
      cohortId: cohort.id,
    });
  }
}

function preserveIncumbentRoom(
  cohort: Cohort,
  previous: AssignmentPlan | null,
  roomById: ReadonlyMap<
    string,
    {
      capacity: number;
      seatIds: readonly string[];
      standingAnchors: readonly StandingAnchor[];
    }
  >,
  reservedRooms: Set<string>,
): string | null {
  if (!previous) return null;
  const prior = cohort.threads.map((thread) =>
    previousAssignment(previous, thread.threadId),
  );
  if (prior.some((assignment) => assignment?.kind !== "meeting")) return null;
  const roomId = prior[0]?.roomId ?? null;
  if (
    roomId === null ||
    prior.some((assignment) => assignment?.roomId !== roomId)
  )
    return null;
  const room = roomById.get(roomId);
  if (!room || reservedRooms.has(roomId)) return null;
  return roomId;
}

function adjacencyKey(
  thread: ThreadPresence,
  cohortMembership: ReadonlyMap<string, string>,
): string {
  return (
    cohortMembership.get(thread.threadId) ??
    `thread:${thread.threadId}`
  );
}

function chooseWorkSeat(
  candidates: readonly SemanticSeat[],
  thread: ThreadPresence,
  assignments: ReadonlyMap<string, OfficeAssignment>,
  threadById: ReadonlyMap<string, ThreadPresence>,
  semanticById: ReadonlyMap<string, SemanticSeat>,
  membership: ReadonlyMap<string, string>,
  entrance: { col: number; row: number },
): SemanticSeat {
  const key = adjacencyKey(thread, membership);
  const scored = candidates.map((seat) => {
    let sameGroup = 0;
    let otherGroup = 0;
    let nearestSameGroup = Number.POSITIVE_INFINITY;
    for (const assignment of assignments.values()) {
      if (assignment.seatId === null) continue;
      const assignedSeat = semanticById.get(assignment.seatId);
      const assignedThread = threadById.get(assignment.threadId);
      if (
        !assignedSeat ||
        !assignedThread ||
        assignedSeat.clusterId !== seat.clusterId
      )
        continue;
      if (
        adjacencyKey(assignedThread, membership) === key
      ) {
        sameGroup += 1;
        nearestSameGroup = Math.min(
          nearestSameGroup,
          Math.abs(seat.col - assignedSeat.col) +
            Math.abs(seat.row - assignedSeat.row),
        );
      } else {
        otherGroup += 1;
      }
    }
    const entranceDistance =
      Math.abs(seat.col - entrance.col) + Math.abs(seat.row - entrance.row);
    const proximity = Number.isFinite(nearestSameGroup)
      ? nearestSameGroup
      : entranceDistance / 100;
    return { seat, score: sameGroup * 1_000 - otherGroup * 20 - proximity };
  });
  scored.sort(
    (left, right) =>
      right.score - left.score || left.seat.id.localeCompare(right.seat.id),
  );
  const chosen = scored[0]?.seat;
  if (!chosen)
    throw new Error(`No work seat candidates for ${thread.threadId}`);
  return chosen;
}

function makeSeatAssignment(
  thread: ThreadPresence,
  seat: SemanticSeat,
  membership: ReadonlyMap<string, string>,
): OfficeAssignment {
  return {
    threadId: thread.threadId,
    kind: "work",
    roomId: seat.roomId,
    seatId: seat.id,
    anchorId: null,
    cohortId: membership.get(thread.threadId) ?? null,
  };
}

function makeRestAssignment(
  thread: ThreadPresence,
  seat: SemanticSeat,
): OfficeAssignment {
  return {
    threadId: thread.threadId,
    kind: "rest",
    roomId: seat.roomId,
    seatId: seat.id,
    anchorId: null,
    cohortId: null,
  };
}

function makeOverflowAssignment(
  thread: ThreadPresence,
  anchor: StandingAnchor,
  membership: ReadonlyMap<string, string>,
): OfficeAssignment {
  return {
    threadId: thread.threadId,
    kind: "work-overflow",
    roomId: anchor.roomId,
    seatId: null,
    anchorId: anchor.id,
    cohortId: membership.get(thread.threadId) ?? null,
  };
}

export function planAssignments(input: AssignmentInput): AssignmentPlan {
  const { office, previous, nowMs, behavior } = input;
  const officePresenceWindowMs =
    behavior.inactiveExitAfterMinutes * 60 * 1000;
  const threads = [...input.threads].sort(
    (left, right) =>
      left.createdAtMs - right.createdAtMs ||
      left.threadId.localeCompare(right.threadId),
  );
  const threadById = new Map(
    threads.map((thread) => [thread.threadId, thread]),
  );
  const semanticById = new Map(office.seats.map((seat) => [seat.id, seat]));
  const assignments = new Map<string, OfficeAssignment>();
  const reservedSeats = new Set<string>();
  const reservedRooms = new Set<string>();
  const { cohorts, membership } = buildCohorts(
    threads,
    behavior.meetingRelations,
  );
  const meetingRooms = office.rooms
    .filter((room) => room.purpose === "meeting")
    .sort(
      (left, right) =>
        left.capacity - right.capacity || left.id.localeCompare(right.id),
    );
  const roomById = new Map(
    meetingRooms.map((room) => [
      room.id,
      {
        capacity: room.capacity,
        seatIds: room.seatIds,
        standingAnchors: office.standingAnchors.filter(
          (anchor) =>
            anchor.role === "meeting-overflow" && anchor.roomId === room.id,
        ),
      },
    ]),
  );
  const cohortPlans = new Map<string, MeetingCohortPlan>();

  for (const cohort of cohorts) {
    const roomId = preserveIncumbentRoom(
      cohort,
      previous,
      roomById,
      reservedRooms,
    );
    if (roomId === null) continue;
    const room = roomById.get(roomId);
    if (!room) throw new Error(`Missing incumbent room ${roomId}`);
    reservedRooms.add(roomId);
    assignRoom(
      cohort,
      roomId,
      room.seatIds,
      room.standingAnchors,
      previous,
      assignments,
      reservedSeats,
    );
    cohortPlans.set(cohort.id, {
      id: cohort.id,
      threadIds: cohort.threads.map((thread) => thread.threadId),
      roomId,
    });
  }

  const pendingCohorts = cohorts
    .filter((cohort) => !cohortPlans.has(cohort.id))
    .sort((left, right) => {
      const leftChoices = meetingRooms.filter(
        (room) => room.capacity >= left.threads.length,
      ).length;
      const rightChoices = meetingRooms.filter(
        (room) => room.capacity >= right.threads.length,
      ).length;
      return (
        leftChoices - rightChoices ||
        left.oldestMs - right.oldestMs ||
        left.id.localeCompare(right.id)
      );
    });

  for (const cohort of pendingCohorts) {
    const availableRooms = meetingRooms.filter(
      (candidate) => !reservedRooms.has(candidate.id),
    );
    const fittingRoom = availableRooms.find(
      (candidate) => candidate.capacity >= cohort.threads.length,
    );
    const largestRoom = availableRooms.reduce<
      (typeof meetingRooms)[number] | null
    >(
      (largest, candidate) =>
        largest === null || candidate.capacity > largest.capacity
          ? candidate
          : largest,
      null,
    );
    const room = fittingRoom ?? largestRoom;
    if (room) {
      const roomAllocation = roomById.get(room.id);
      if (!roomAllocation)
        throw new Error(`Missing meeting room allocation ${room.id}`);
      reservedRooms.add(room.id);
      assignRoom(
        cohort,
        room.id,
        room.seatIds,
        roomAllocation.standingAnchors,
        previous,
        assignments,
        reservedSeats,
      );
    }
    cohortPlans.set(cohort.id, {
      id: cohort.id,
      threadIds: cohort.threads.map((thread) => thread.threadId),
      roomId: room?.id ?? null,
    });
  }

  const workingThreads = threads.filter(
    (thread) => thread.status === "active" && !assignments.has(thread.threadId),
  );
  const workSeats = office.seats.filter((seat) => seat.role === "work");
  const flexSeats = office.seats.filter((seat) => seat.role === "flex-work");

  for (const thread of workingThreads) {
    const prior = previousAssignment(previous, thread.threadId);
    if (
      prior?.seatId === null ||
      (prior?.kind !== "work" && prior?.kind !== "rest")
    )
      continue;
    const seat = semanticById.get(prior.seatId);
    if (
      !seat ||
      (seat.role !== "work" && seat.role !== "flex-work") ||
      reservedSeats.has(seat.id)
    )
      continue;
    reservedSeats.add(seat.id);
    assignments.set(
      thread.threadId,
      makeSeatAssignment(thread, seat, membership),
    );
  }

  for (const thread of workingThreads) {
    if (assignments.has(thread.threadId)) continue;
    const dedicated = workSeats.filter((seat) => !reservedSeats.has(seat.id));
    const flex = flexSeats.filter((seat) => !reservedSeats.has(seat.id));
    const candidates = dedicated.length > 0 ? dedicated : flex;
    if (candidates.length > 0) {
      const seat = chooseWorkSeat(
        candidates,
        thread,
        assignments,
        threadById,
        semanticById,
        membership,
        office.entrance.interior,
      );
      reservedSeats.add(seat.id);
      assignments.set(
        thread.threadId,
        makeSeatAssignment(thread, seat, membership),
      );
      continue;
    }
    const anchor = office.standingAnchors.find(
      (candidate) =>
        candidate.role === "work-overflow" &&
        ![...assignments.values()].some(
          (assignment) => assignment.anchorId === candidate.id,
        ),
    );
    if (anchor)
      assignments.set(
        thread.threadId,
        makeOverflowAssignment(thread, anchor, membership),
      );
  }

  const restingThreads = threads.filter((thread) =>
    shouldRest(thread, nowMs, officePresenceWindowMs),
  );
  const restSeats = office.seats.filter(
    (seat) => seat.role === "rest" || seat.role === "flex-work",
  );
  for (const thread of restingThreads) {
    const prior = previousAssignment(previous, thread.threadId);
    if (prior?.kind !== "rest" || prior.seatId === null) continue;
    const seat = semanticById.get(prior.seatId);
    if (!seat || !restSeats.includes(seat) || reservedSeats.has(seat.id))
      continue;
    reservedSeats.add(seat.id);
    assignments.set(thread.threadId, makeRestAssignment(thread, seat));
  }
  for (const thread of restingThreads) {
    if (assignments.has(thread.threadId)) continue;
    const candidates = restSeats.filter((seat) => !reservedSeats.has(seat.id));
    const seat = [...candidates].sort((left, right) => {
      if (left.role !== right.role) return left.role === "rest" ? -1 : 1;
      return left.id.localeCompare(right.id);
    })[0];
    if (seat) {
      reservedSeats.add(seat.id);
      assignments.set(thread.threadId, makeRestAssignment(thread, seat));
    }
  }

  for (const thread of threads) {
    if (assignments.has(thread.threadId)) continue;
    if (!shouldExitOffice(thread, nowMs, officePresenceWindowMs)) continue;
    assignments.set(thread.threadId, {
      threadId: thread.threadId,
      kind: "exit",
      roomId: null,
      seatId: null,
      anchorId: null,
      cohortId: null,
    });
  }

  for (const thread of threads) {
    if (assignments.has(thread.threadId)) continue;
    assignments.set(thread.threadId, {
      threadId: thread.threadId,
      kind: "away",
      roomId: null,
      seatId: null,
      anchorId: null,
      cohortId: membership.get(thread.threadId) ?? null,
    });
  }

  const counts = {
    work: 0,
    meeting: 0,
    rest: 0,
    overflow: 0,
    away: 0,
    exiting: 0,
  };
  for (const assignment of assignments.values()) {
    if (assignment.kind === "work") counts.work += 1;
    else if (assignment.kind === "meeting") counts.meeting += 1;
    else if (assignment.kind === "rest") counts.rest += 1;
    else if (assignment.kind === "work-overflow") counts.overflow += 1;
    else if (assignment.kind === "away") counts.away += 1;
    else counts.exiting += 1;
  }
  return {
    assignments,
    meetingCohorts: [...cohortPlans.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    counts,
  };
}
