import type { OfficeLayoutKind } from "./asset-loader";
import type { ThreadPresence, ThreadProvider } from "./office-allocator";

export type OfficeScenarioKind = "five" | "ten" | "twenty" | "overflow";

const names = [
  "Rowan", "Jules", "Mina", "Otis", "Nia", "Sora", "Cal", "Inez", "Theo", "Ari",
  "Bea", "Cleo", "Dara", "Emi", "Finn", "Gia", "Hugo", "Ira", "June", "Kit",
  "Lena", "Milo", "Nori", "Omar", "Pia", "Quin", "Remy", "Sol", "Tali", "Uma",
  "Vera", "Wren", "Xavi", "Yara", "Zev", "Anya", "Basil", "Cora", "Dev", "Esme",
  "Faye", "Gus", "Hope", "Indy", "Juno", "Kai", "Lumi", "Mars", "Nell", "Orla",
] as const;

const titles = [
  "Fix auth redirect",
  "Investigate cache misses",
  "Refine onboarding copy",
  "Plan the API migration",
  "Review the release checklist",
  "Audit plugin loading",
  "Tighten event parsing",
  "Trace the reconnect loop",
  "Review release notes",
  "Harden session recovery",
] as const;

const tools = ["Edit", "Read", "Bash", "Grep", "Read", "Edit"] as const;

function providerAt(index: number): ThreadProvider {
  return index % 3 === 1 ? "Claude" : "Codex";
}

function baseThread(index: number, nowMs: number): ThreadPresence {
  return {
    threadId: `thread-${String(index + 1).padStart(2, "0")}`,
    agentId: 1_000 + index,
    name: names[index % names.length],
    title: titles[index % titles.length],
    provider: providerAt(index),
    worktreeId: null,
    parentThreadId: null,
    status: "active",
    idleSinceMs: null,
    createdAtMs: nowMs - (index + 1) * 60_000,
    tool: tools[index % tools.length],
    palette: index % 6,
    hueShift: index < 6 ? 0 : 45 + ((index * 37) % 270),
  };
}

function fiveThreads(nowMs: number): ThreadPresence[] {
  return Array.from({ length: 5 }, (_, index) => {
    const thread = baseThread(index, nowMs);
    if (index < 2) {
      return { ...thread, worktreeId: "worktree-alpha" };
    }
    return thread;
  });
}

function tenThreads(nowMs: number): ThreadPresence[] {
  return Array.from({ length: 10 }, (_, index) => {
    const thread = baseThread(index, nowMs);
    if (index < 2) {
      return { ...thread, worktreeId: "worktree-alpha" };
    }
    if (index === 9) {
      return {
        ...thread,
        status: "idle",
        idleSinceMs: nowMs - 8 * 60_000,
      };
    }
    return thread;
  });
}

function twentyThreads(nowMs: number): ThreadPresence[] {
  return Array.from({ length: 20 }, (_, index) => {
    const thread = baseThread(index, nowMs);
    if (index < 2) {
      return { ...thread, worktreeId: "worktree-alpha" };
    }
    if (index < 6) {
      return { ...thread, worktreeId: "worktree-beta" };
    }
    if (index === 6) {
      return thread;
    }
    if (index === 7) {
      return { ...thread, parentThreadId: "thread-07" };
    }
    if (index >= 17) {
      return {
        ...thread,
        status: "idle",
        idleSinceMs: nowMs - 8 * 60_000,
      };
    }
    return thread;
  });
}

function overflowThreads(layoutKind: OfficeLayoutKind, nowMs: number): ThreadPresence[] {
  const count = layoutKind === "work-club" ? 48 : 20;
  return Array.from({ length: count }, (_, index) => {
    const thread = baseThread(index, nowMs);
    return {
      ...thread,
      worktreeId: null,
      parentThreadId: null,
    };
  });
}

export function makeFakeThreads(
  layoutKind: OfficeLayoutKind,
  scenario: OfficeScenarioKind,
  nowMs: number,
): ThreadPresence[] {
  if (scenario === "five") return fiveThreads(nowMs);
  if (scenario === "ten") return tenThreads(nowMs);
  if (scenario === "twenty") return twentyThreads(nowMs);
  return overflowThreads(layoutKind, nowMs);
}

export function scenarioThreadCount(
  layoutKind: OfficeLayoutKind,
  scenario: OfficeScenarioKind,
): number {
  if (scenario === "five") return 5;
  if (scenario === "ten") return 10;
  if (scenario === "twenty") return 20;
  return layoutKind === "work-club" ? 48 : 20;
}
