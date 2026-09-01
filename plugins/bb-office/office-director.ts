import type {
  AssignmentPlan,
  OfficeAssignment,
  ThreadPresence,
} from "./office-allocator";
import { planAssignments } from "./office-allocator";
import type {
  OfficeBlueprint,
  SemanticSeat,
  StandingAnchor,
  TileAnchor,
} from "./office-blueprint";
import type { OfficeConfig } from "./office-config-schema";
import { OfficeState } from "./vendor/pixel-agents/webview-ui/src/office/engine/officeState";
import type { Character } from "./vendor/pixel-agents/webview-ui/src/office/types";
import {
  CharacterState,
  Direction,
  TILE_SIZE,
} from "./vendor/pixel-agents/webview-ui/src/office/types";

const STAFF_AGENT_ID = 9_000_000;
const BADGE_PAUSE_SEC = 0.75;
const ARRIVAL_INTERVAL_SEC = 0.48;

type RuntimePhase =
  | "queued"
  | "entering"
  | "badging-in"
  | "to-destination"
  | "settled"
  | "to-badge-out"
  | "badging-out"
  | "to-exit";

interface RuntimeOccupant {
  threadId: string;
  phase: RuntimePhase;
  pauseSec: number;
  assignment: OfficeAssignment;
}

export interface OfficeOccupantDetails {
  agentId: number;
  name: string;
  provider: string;
  title: string;
  activity: string;
  threadId: string | null;
}

function sameAssignment(
  left: OfficeAssignment,
  right: OfficeAssignment,
): boolean {
  return (
    left.kind === right.kind &&
    left.roomId === right.roomId &&
    left.seatId === right.seatId &&
    left.anchorId === right.anchorId &&
    left.cohortId === right.cohortId
  );
}

function placeCharacter(character: Character, tile: TileAnchor): void {
  character.tileCol = tile.col;
  character.tileRow = tile.row;
  character.x = tile.col * TILE_SIZE + TILE_SIZE / 2;
  character.y = tile.row * TILE_SIZE + TILE_SIZE / 2;
  character.path = [];
  character.moveProgress = 0;
  character.frame = 0;
  character.frameTimer = 0;
}

export function directionTowardRoom(
  anchor: StandingAnchor,
  seats: readonly SemanticSeat[],
): Direction {
  const roomSeats = seats.filter((seat) => seat.roomId === anchor.roomId);
  if (roomSeats.length === 0) {
    throw new Error(`Standing anchor ${anchor.id} has no room seats`);
  }
  const center = roomSeats.reduce(
    (total, seat) => ({ col: total.col + seat.col, row: total.row + seat.row }),
    { col: 0, row: 0 },
  );
  const deltaCol = center.col / roomSeats.length - anchor.col;
  const deltaRow = center.row / roomSeats.length - anchor.row;
  if (Math.abs(deltaCol) > Math.abs(deltaRow)) {
    return deltaCol < 0 ? Direction.LEFT : Direction.RIGHT;
  }
  return deltaRow < 0 ? Direction.UP : Direction.DOWN;
}

export class OfficeDirector {
  readonly office: OfficeState;
  readonly blueprint: OfficeBlueprint;
  readonly behavior: OfficeConfig["behavior"];
  private plan: AssignmentPlan | null = null;
  private readonly threads = new Map<string, ThreadPresence>();
  private readonly agentToThread = new Map<number, string>();
  private readonly runtimes = new Map<string, RuntimeOccupant>();
  private readonly arrivalQueue: string[] = [];
  private arrivalTimerSec = 0;

  constructor(
    office: OfficeState,
    blueprint: OfficeBlueprint,
    behavior: OfficeConfig["behavior"],
  ) {
    this.office = office;
    this.blueprint = blueprint;
    this.behavior = behavior;
    this.seedStaff();
    this.placePets();
  }

  reconcile(threads: readonly ThreadPresence[], nowMs: number): AssignmentPlan {
    const nextIds = new Set(threads.map((thread) => thread.threadId));
    const combined = [...threads];
    for (const prior of this.threads.values()) {
      if (nextIds.has(prior.threadId)) continue;
      combined.push({ ...prior, status: "archived" });
    }
    for (const thread of combined) this.threads.set(thread.threadId, thread);
    const nextPlan = planAssignments({
      office: this.blueprint,
      threads: combined,
      previous: this.plan,
      nowMs,
      behavior: this.behavior,
    });
    this.applyPlan(nextPlan);
    this.plan = nextPlan;
    return nextPlan;
  }

  seedSettled(
    threads: readonly ThreadPresence[],
    nowMs: number,
  ): AssignmentPlan {
    for (const thread of threads) this.threads.set(thread.threadId, thread);
    const nextPlan = planAssignments({
      office: this.blueprint,
      threads,
      previous: null,
      nowMs,
      behavior: this.behavior,
    });
    for (const thread of threads) {
      const assignment = nextPlan.assignments.get(thread.threadId);
      if (
        !assignment ||
        assignment.kind === "exit" ||
        assignment.kind === "away"
      )
        continue;
      this.addAgent(thread, assignment);
      this.settleAtAssignment(thread, assignment);
      this.runtimes.set(thread.threadId, {
        threadId: thread.threadId,
        phase: "settled",
        pauseSec: 0,
        assignment,
      });
    }
    this.plan = nextPlan;
    return nextPlan;
  }

  update(deltaSec: number): void {
    this.office.update(deltaSec);
    this.arrivalTimerSec -= deltaSec;
    if (this.arrivalTimerSec <= 0) this.releaseNextArrival();

    for (const runtime of this.runtimes.values()) {
      const thread = this.threads.get(runtime.threadId);
      const character = thread
        ? this.office.characters.get(thread.agentId)
        : null;
      if (!thread || !character) continue;
      if (
        runtime.phase === "entering" &&
        this.isAt(character, this.blueprint.entrance.badge)
      ) {
        runtime.phase = "badging-in";
        runtime.pauseSec = BADGE_PAUSE_SEC;
        character.wanderTimer = Number.POSITIVE_INFINITY;
      } else if (runtime.phase === "badging-in") {
        runtime.pauseSec -= deltaSec;
        if (runtime.pauseSec <= 0) this.routeToAssignment(thread, runtime);
      } else if (
        runtime.phase === "to-destination" &&
        this.isAtAssignment(character, runtime.assignment)
      ) {
        this.settleAtAssignment(thread, runtime.assignment);
        runtime.phase = "settled";
      } else if (
        runtime.phase === "to-badge-out" &&
        this.isAt(character, this.blueprint.entrance.badge)
      ) {
        runtime.phase = "badging-out";
        runtime.pauseSec = BADGE_PAUSE_SEC;
        character.wanderTimer = Number.POSITIVE_INFINITY;
      } else if (runtime.phase === "badging-out") {
        runtime.pauseSec -= deltaSec;
        if (runtime.pauseSec <= 0) {
          this.office.walkToTile(
            thread.agentId,
            this.blueprint.entrance.exterior.col,
            this.blueprint.entrance.exterior.row,
          );
          runtime.phase = "to-exit";
        }
      } else if (
        runtime.phase === "to-exit" &&
        this.isAt(character, this.blueprint.entrance.exterior)
      ) {
        this.office.removeAgent(thread.agentId);
        this.runtimes.delete(runtime.threadId);
        this.agentToThread.delete(thread.agentId);
      }
    }
  }

  getPlan(): AssignmentPlan | null {
    return this.plan;
  }

  getOccupant(agentId: number): OfficeOccupantDetails | null {
    if (
      agentId === STAFF_AGENT_ID &&
      this.office.characters.has(STAFF_AGENT_ID)
    ) {
      return {
        agentId,
        name: "Maru",
        provider: "Office",
        title: "Front desk",
        activity: "Reception · monitoring arrivals",
        threadId: null,
      };
    }
    const threadId = this.agentToThread.get(agentId);
    if (!threadId) return null;
    const thread = this.threads.get(threadId);
    const runtime = this.runtimes.get(threadId);
    if (!thread || !runtime) return null;
    return {
      agentId,
      name: thread.name,
      provider: thread.provider,
      title: thread.title,
      activity: this.describeActivity(thread, runtime),
      threadId,
    };
  }

  private applyPlan(nextPlan: AssignmentPlan): void {
    for (const [threadId, assignment] of nextPlan.assignments) {
      const thread = this.threads.get(threadId);
      if (!thread) continue;
      const runtime = this.runtimes.get(threadId);
      if (assignment.kind === "exit" || assignment.kind === "away") {
        if (
          runtime &&
          runtime.phase !== "to-badge-out" &&
          runtime.phase !== "badging-out" &&
          runtime.phase !== "to-exit"
        ) {
          runtime.assignment = assignment;
          this.startExit(thread, runtime);
        }
        continue;
      }
      if (!runtime) {
        this.runtimes.set(threadId, {
          threadId,
          phase: "queued",
          pauseSec: 0,
          assignment,
        });
        this.arrivalQueue.push(threadId);
        continue;
      }
      if (runtime.phase === "queued") {
        runtime.assignment = assignment;
        continue;
      }
      if (!sameAssignment(runtime.assignment, assignment)) {
        runtime.assignment = assignment;
        this.routeToAssignment(thread, runtime);
      } else {
        this.applyActivity(thread, assignment);
      }
    }
  }

  private releaseNextArrival(): void {
    const threadId = this.arrivalQueue.shift();
    if (!threadId) return;
    const runtime = this.runtimes.get(threadId);
    const thread = this.threads.get(threadId);
    if (
      !runtime ||
      !thread ||
      runtime.assignment.kind === "exit" ||
      runtime.assignment.kind === "away"
    )
      return;
    this.addAgent(thread, runtime.assignment);
    const character = this.office.characters.get(thread.agentId);
    if (!character) return;
    this.office.setAgentActive(thread.agentId, false);
    placeCharacter(character, this.blueprint.entrance.exterior);
    character.dir = Direction.UP;
    character.state = CharacterState.IDLE;
    character.wanderTimer = Number.POSITIVE_INFINITY;
    this.office.walkToTile(
      thread.agentId,
      this.blueprint.entrance.badge.col,
      this.blueprint.entrance.badge.row,
    );
    runtime.phase = "entering";
    this.arrivalTimerSec = ARRIVAL_INTERVAL_SEC;
  }

  private addAgent(thread: ThreadPresence, assignment: OfficeAssignment): void {
    this.office.addAgent(
      thread.agentId,
      thread.palette,
      thread.hueShift,
      assignment.seatId ?? undefined,
      true,
    );
    const character = this.office.characters.get(thread.agentId);
    if (!character)
      throw new Error(`Could not add office character ${thread.agentId}`);
    if (assignment.seatId === null) this.releaseSeat(character);
    this.agentToThread.set(thread.agentId, thread.threadId);
  }

  private routeToAssignment(
    thread: ThreadPresence,
    runtime: RuntimeOccupant,
  ): void {
    const character = this.office.characters.get(thread.agentId);
    if (
      !character ||
      runtime.assignment.kind === "exit" ||
      runtime.assignment.kind === "away"
    )
      return;
    if (runtime.assignment.seatId !== null) {
      this.office.setAgentActive(thread.agentId, true);
      if (character.seatId !== runtime.assignment.seatId) {
        this.office.reassignSeat(thread.agentId, runtime.assignment.seatId);
      } else {
        this.office.sendToSeat(thread.agentId);
      }
    } else {
      const anchor = this.blueprint.standingAnchors.find(
        (candidate) => candidate.id === runtime.assignment.anchorId,
      );
      if (!anchor)
        throw new Error(
          `Unknown standing anchor ${runtime.assignment.anchorId}`,
        );
      this.releaseSeat(character);
      this.office.setAgentActive(thread.agentId, false);
      character.wanderTimer = Number.POSITIVE_INFINITY;
      this.office.walkToTile(thread.agentId, anchor.col, anchor.row);
    }
    runtime.phase = "to-destination";
  }

  private settleAtAssignment(
    thread: ThreadPresence,
    assignment: OfficeAssignment,
  ): void {
    const character = this.office.characters.get(thread.agentId);
    if (!character || assignment.kind === "exit" || assignment.kind === "away")
      return;
    if (assignment.seatId !== null) {
      const seat = this.office.seats.get(assignment.seatId);
      if (!seat) throw new Error(`Missing runtime seat ${assignment.seatId}`);
      placeCharacter(character, { col: seat.seatCol, row: seat.seatRow });
      character.seatId = assignment.seatId;
      seat.assigned = true;
      character.dir = seat.facingDir;
      character.state = CharacterState.TYPE;
      this.office.setAgentActive(thread.agentId, true);
    } else {
      const anchor = this.blueprint.standingAnchors.find(
        (candidate) => candidate.id === assignment.anchorId,
      );
      if (!anchor)
        throw new Error(`Unknown standing anchor ${assignment.anchorId}`);
      placeCharacter(character, anchor);
      character.dir = directionTowardRoom(anchor, this.blueprint.seats);
      character.state = CharacterState.IDLE;
      character.isActive = false;
      character.wanderTimer = Number.POSITIVE_INFINITY;
    }
    this.applyActivity(thread, assignment);
  }

  private applyActivity(
    thread: ThreadPresence,
    assignment: OfficeAssignment,
  ): void {
    if (assignment.kind === "rest")
      this.office.setAgentTool(thread.agentId, "Read");
    else if (assignment.kind === "meeting")
      this.office.setAgentTool(thread.agentId, "Read");
    else this.office.setAgentTool(thread.agentId, thread.tool);
    const character = this.office.characters.get(thread.agentId);
    if (!character) return;
    if (thread.status === "idle" && character.bubbleType === null) {
      this.office.showWaitingBubble(thread.agentId, false);
    }
  }

  private startExit(thread: ThreadPresence, runtime: RuntimeOccupant): void {
    const character = this.office.characters.get(thread.agentId);
    if (!character) {
      this.runtimes.delete(runtime.threadId);
      return;
    }
    this.releaseSeat(character);
    this.office.setAgentActive(thread.agentId, false);
    character.wanderTimer = Number.POSITIVE_INFINITY;
    this.office.walkToTile(
      thread.agentId,
      this.blueprint.entrance.badge.col,
      this.blueprint.entrance.badge.row,
    );
    runtime.phase = "to-badge-out";
  }

  private releaseSeat(character: Character): void {
    if (character.seatId !== null) {
      const seat = this.office.seats.get(character.seatId);
      if (seat) seat.assigned = false;
    }
    character.seatId = null;
  }

  private isAt(character: Character, target: TileAnchor): boolean {
    return (
      character.path.length === 0 &&
      character.tileCol === target.col &&
      character.tileRow === target.row
    );
  }

  private isAtAssignment(
    character: Character,
    assignment: OfficeAssignment,
  ): boolean {
    if (assignment.seatId !== null) {
      const seat = this.office.seats.get(assignment.seatId);
      return Boolean(
        seat &&
        character.path.length === 0 &&
        character.tileCol === seat.seatCol &&
        character.tileRow === seat.seatRow,
      );
    }
    const anchor = this.blueprint.standingAnchors.find(
      (candidate) => candidate.id === assignment.anchorId,
    );
    return Boolean(anchor && this.isAt(character, anchor));
  }

  private describeActivity(
    thread: ThreadPresence,
    runtime: RuntimeOccupant,
  ): string {
    if (runtime.phase === "queued") return "Waiting outside the entrance";
    if (runtime.phase === "entering") return "Walking through the south door";
    if (runtime.phase === "badging-in") return "Checking in";
    if (runtime.phase === "to-badge-out") return "Walking to the exit";
    if (runtime.phase === "badging-out") return "Checking out";
    if (runtime.phase === "to-exit") return "Leaving through the south door";
    if (runtime.phase === "to-destination") {
      if (runtime.assignment.kind === "meeting")
        return "Joining a project room";
      if (runtime.assignment.kind === "rest") return "Walking to a break area";
      return "Walking to an assigned workstation";
    }
    if (runtime.assignment.kind === "meeting")
      return "Meeting with related threads";
    if (runtime.assignment.kind === "rest") return "Taking a break · reading";
    if (runtime.assignment.kind === "work-overflow")
      return "Working at an overflow anchor";
    return thread.status === "idle"
      ? "Turn complete · holding this seat"
      : `Working · ${thread.tool}`;
  }

  private seedStaff(): void {
    const staffSeat = this.blueprint.seats.find(
      (seat) => seat.role === "staff",
    );
    if (!staffSeat) return;
    this.office.addAgent(STAFF_AGENT_ID, 5, 55, staffSeat.id, true);
    this.office.setAgentTool(STAFF_AGENT_ID, "Read");
    this.office.setAgentActive(STAFF_AGENT_ID, true);
  }

  private placePets(): void {
    this.office.pets.forEach((pet, index) => {
      const anchor = this.blueprint.petAnchors[index];
      if (!anchor) return;
      pet.tileCol = anchor.col;
      pet.tileRow = anchor.row;
      pet.x = anchor.col * TILE_SIZE + TILE_SIZE / 2;
      pet.y = anchor.row * TILE_SIZE + TILE_SIZE / 2;
      pet.path = [];
      pet.moveProgress = 0;
      pet.wanderTimer =
        this.behavior.ambientMotion === "rare"
          ? 45 + index * 30
          : Number.POSITIVE_INFINITY;
    });
  }
}
