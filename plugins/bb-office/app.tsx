import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  experimental_useProviders,
  experimental_useSidebarThreads,
  type PluginThreadListProps,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { bbOfficeRpcContract } from "./office-config-contract";
import {
  DEFAULT_OFFICE_CONFIG,
  type OfficeConfig,
  officeConfigChangedSchema,
} from "./office-config-schema";
import type { ThreadPresence } from "./office-allocator";
import type {
  OfficeProviderUsage,
  OfficeUsageSnapshot,
} from "./office-usage";
import {
  type OfficeAppearance,
  type OfficeVisualTheme,
  officeVisualThemeFromRgb,
  parseOfficeAppearance,
} from "./office-theme";
import { resolveFloatingOfficeCollapsedKind } from "./floating-office-collapsed";
import { FloatingOfficeWidget } from "./floating-office-widget";
import { OfficeCanvas } from "./office-canvas";
import type { UsageProviderIdentity } from "./usage-posters";
import "./app.css";

const ACTIVE_INDICATORS = new Set([
  "working-draft",
  "workflow",
  "background-agent",
  "background-command",
  "plan-mode",
  "goal",
  "runtime",
]);

function hashText(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function agentIdFor(
  threadId: string,
  ids: Map<string, number>,
  usedIds: Set<number>,
): number {
  const existing = ids.get(threadId);
  if (existing !== undefined) return existing;
  let candidate = 100_000 + (hashText(threadId) % 8_000_000);
  while (usedIds.has(candidate)) candidate += 1;
  ids.set(threadId, candidate);
  usedIds.add(candidate);
  return candidate;
}

function isThreadActive(
  activity: {
    workflows: number;
    backgroundAgents: number;
    backgroundCommands: number;
    planMode: number;
    goals: number;
  },
  indicator: string,
): boolean {
  return (
    activity.workflows +
      activity.backgroundAgents +
      activity.backgroundCommands +
      activity.planMode +
      activity.goals >
      0 || ACTIVE_INDICATORS.has(indicator)
  );
}

function toolFor(indicator: string, active: boolean): string {
  if (!active || indicator === "waiting-for-input") return "Read";
  if (indicator === "background-command") return "Bash";
  if (indicator === "plan-mode" || indicator === "goal") return "Read";
  return "Edit";
}

function readThemeRgb(): { red: number; green: number; blue: number } {
  const fallback = { red: 96, green: 128, blue: 192 };
  if (typeof document === "undefined" || !document.body) return fallback;
  const probe = document.createElement("span");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.color = "var(--primary)";
  document.body.append(probe);
  const resolved = window.getComputedStyle(probe).color;
  probe.remove();
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return fallback;
  context.fillStyle = resolved;
  context.fillRect(0, 0, 1, 1);
  const data = context.getImageData(0, 0, 1, 1).data;
  return { red: data[0], green: data[1], blue: data[2] };
}

function readOfficeVisualTheme(
  appearance: OfficeAppearance,
): OfficeVisualTheme {
  const { red, green, blue } = readThemeRgb();
  return officeVisualThemeFromRgb(
    appearance,
    document.documentElement.classList.contains("dark") ? "dark" : "light",
    red,
    green,
    blue,
  );
}

function sameOfficeVisualTheme(
  left: OfficeVisualTheme,
  right: OfficeVisualTheme,
): boolean {
  return (
    left.appearance === right.appearance &&
    left.mode === right.mode &&
    left.accentHue === right.accentHue &&
    left.accentSaturation === right.accentSaturation
  );
}

function useOfficeVisualTheme(appearance: OfficeAppearance): OfficeVisualTheme {
  const [theme, setTheme] = useState(() => readOfficeVisualTheme(appearance));

  useEffect(() => {
    let frame = 0;
    const refresh = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = readOfficeVisualTheme(appearance);
        setTheme((current) =>
          sameOfficeVisualTheme(current, next) ? current : next,
        );
      });
    };
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.addEventListener("storage", refresh);
    refresh();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("storage", refresh);
    };
  }, [appearance]);

  return theme;
}

function useOfficeConfig(): OfficeConfig {
  const rpc = useRpc<typeof bbOfficeRpcContract>();
  const [config, setConfig] = useState<OfficeConfig>(DEFAULT_OFFICE_CONFIG);

  const refresh = useCallback(() => {
    void rpc
      .call("readOfficeConfig", {})
      .then((snapshot) => setConfig(snapshot.config))
      .catch((error: Error) => {
        console.error("BB Office could not load the office configuration", error);
      });
  }, [rpc]);

  useEffect(refresh, [refresh]);
  useRealtime(
    "office-config-changed",
    useCallback(
      (payload) => {
        const parsed = officeConfigChangedSchema.safeParse(payload);
        if (parsed.success) refresh();
      },
      [refresh],
    ),
  );
  return config;
}

function failedUsageSnapshot(
  providerIds: readonly string[],
): OfficeUsageSnapshot {
  const providers: OfficeProviderUsage[] = providerIds.map((providerId) => ({
    providerId,
    status: "error",
    planLabel: null,
    windows: [],
  }));
  return { observedAtMs: Date.now(), providers };
}

function useOfficeUsage(
  hostId: string | null,
  providers: readonly UsageProviderIdentity[],
): OfficeUsageSnapshot | null {
  const rpc = useRpc<typeof bbOfficeRpcContract>();
  const [snapshot, setSnapshot] = useState<OfficeUsageSnapshot | null>(null);
  const providerIdsKey = providers
    .map((provider) => provider.providerId)
    .join("\u0000");

  useEffect(() => {
    const providerIds = providers.map((provider) => provider.providerId);
    if (providerIds.length === 0) {
      setSnapshot({ observedAtMs: Date.now(), providers: [] });
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void rpc
        .call("readOfficeUsage", { hostId, providerIds })
        .then((next) => {
          if (!cancelled) setSnapshot(next);
        })
        .catch((error: Error) => {
          console.error("BB Office could not load provider usage", error);
          if (!cancelled) setSnapshot(failedUsageSnapshot(providerIds));
        });
    };
    setSnapshot(null);
    refresh();
    const timer = window.setInterval(refresh, 120_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hostId, providerIdsKey, rpc]);

  return snapshot;
}

function BbOfficeFloatingOffice({
  activeThreadId,
  onOpenThread,
}: {
  activeThreadId: string | null;
  onOpenThread: (threadId: string) => void;
}) {
  const sidebar = experimental_useSidebarThreads();
  const providerState = experimental_useProviders();
  const officeConfig = useOfficeConfig();
  const appearance = parseOfficeAppearance(
    officeConfig.appearance.mode === "follow-bb"
      ? "Follow BB"
      : officeConfig.appearance.mode === "neutral"
        ? "Neutral"
        : "Original",
  );
  const officeTheme = useOfficeVisualTheme(appearance);
  const agentIdsRef = useRef(new Map<string, number>());
  const usedAgentIdsRef = useRef(new Set<number>());
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const providers = useMemo(
    () =>
      new Map(
        providerState.providers.map((provider) => [
          provider.id,
          provider.displayName,
        ]),
      ),
    [providerState.providers],
  );
  const threads = useMemo<readonly ThreadPresence[]>(
    () =>
      sidebar.threads
        .filter((thread) => !thread.isArchived)
        .map((thread) => {
          const active = isThreadActive(thread.activity, thread.indicator);
          const hash = hashText(thread.id);
          const workspace =
            thread.environment?.branchName ??
            thread.environment?.name ??
            thread.host?.name;
          return {
            threadId: thread.id,
            agentId: agentIdFor(
              thread.id,
              agentIdsRef.current,
              usedAgentIdsRef.current,
            ),
            name:
              thread.title?.trim() ||
              thread.titleFallback?.trim() ||
              "Untitled thread",
            title: workspace ?? "BB thread",
            provider: providers.get(thread.providerId) ?? thread.providerId,
            worktreeId: thread.environment?.id ?? null,
            parentThreadId: thread.parentThreadId,
            status: active ? "active" : "idle",
            idleSinceMs: active ? null : Math.min(thread.updatedAt, nowMs),
            createdAtMs: thread.createdAt,
            tool: toolFor(thread.indicator, active),
            palette: hash % 6,
            hueShift: hash % 4 === 0 ? 45 + (hash % 270) : 0,
          };
        }),
    [nowMs, providers, sidebar.threads],
  );
  const usageProviders = useMemo<readonly UsageProviderIdentity[]>(() => {
    const presenceWindowMs =
      officeConfig.behavior.inactiveExitAfterMinutes * 60_000;
    const counts = new Map<string, number>();
    for (const thread of sidebar.threads) {
      if (thread.isArchived) continue;
      const active = isThreadActive(thread.activity, thread.indicator);
      if (!active && nowMs - thread.updatedAt >= presenceWindowMs) continue;
      counts.set(thread.providerId, (counts.get(thread.providerId) ?? 0) + 1);
    }
    return [...counts]
      .sort(
        ([leftId, leftCount], [rightId, rightCount]) =>
          rightCount - leftCount ||
          (providers.get(leftId) ?? leftId).localeCompare(
            providers.get(rightId) ?? rightId,
          ),
      )
      .slice(0, 3)
      .map(([providerId]) => ({
        providerId,
        displayName: providers.get(providerId) ?? providerId,
      }));
  }, [
    nowMs,
    officeConfig.behavior.inactiveExitAfterMinutes,
    providers,
    sidebar.threads,
  ]);
  const usageHostId = useMemo(
    () =>
      sidebar.threads.find((thread) => thread.id === activeThreadId)?.host?.id ??
      null,
    [activeThreadId, sidebar.threads],
  );
  const usageSnapshot = useOfficeUsage(usageHostId, usageProviders);
  const presentWorkers = useMemo(() => {
    const presenceWindowMs =
      officeConfig.behavior.inactiveExitAfterMinutes * 60_000;
    return threads.filter(
      (thread) =>
        thread.status === "active" ||
        thread.idleSinceMs === null ||
        nowMs - thread.idleSinceMs < presenceWindowMs,
    );
  }, [nowMs, officeConfig.behavior.inactiveExitAfterMinutes, threads]);
  const currentWorker = useMemo(
    () =>
      activeThreadId
        ? (presentWorkers.find(
            (thread) => thread.threadId === activeThreadId,
          ) ?? null)
        : null,
    [activeThreadId, presentWorkers],
  );
  const collapsedKind = resolveFloatingOfficeCollapsedKind({
    activeThreadId,
    hasCurrentWorker: currentWorker !== null,
    pathname: window.location.pathname,
  });

  return (
    <FloatingOfficeWidget
      collapsedKind={collapsedKind}
      currentWorker={currentWorker}
      workerCount={presentWorkers.length}
    >
      {(expanded) => (
        <div className="bb-office-minimap">
          <OfficeCanvas
            chrome="floating"
            layoutKind="compact"
            officeConfig={officeConfig}
            officeTheme={officeTheme}
            playback={expanded ? "live" : "static"}
            selectedThreadId={activeThreadId}
            threads={threads}
            sourceStatus={sidebar.status}
            usageProviders={usageProviders}
            usageSnapshot={usageSnapshot}
            onOpenThread={onOpenThread}
          />
        </div>
      )}
    </FloatingOfficeWidget>
  );
}

function BbOfficeThreadList({
  Original,
  activeThreadId,
  isCompactViewport,
  onNavigate,
}: PluginThreadListProps) {
  const navigate = useBbNavigate();
  const openThread = useCallback(
    (threadId: string) => {
      navigate.toThread(threadId);
      onNavigate();
    },
    [navigate, onNavigate],
  );

  if (isCompactViewport) return <Original />;

  return (
    <>
      <Original />
      {createPortal(
        <BbOfficeFloatingOffice
          activeThreadId={activeThreadId}
          onOpenThread={openThread}
        />,
        document.body,
      )}
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "bb-office-floating",
    title: "BB Office",
    description: "A draggable office overview for live BB threads.",
    component: BbOfficeThreadList,
  });
});
