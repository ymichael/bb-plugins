import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type EmbeddedAssetMap,
  type OfficeLayoutKind,
  loadPixelAgentsOffice,
} from "./asset-loader";
import type { AssignmentPlan, ThreadPresence } from "./office-allocator";
import {
  compileOfficeBlueprint,
  type OfficeMapLabel,
} from "./office-blueprint";
import { OfficeDirector } from "./office-director";
import {
  type OfficeScenarioKind,
  makeFakeThreads,
  scenarioThreadCount,
} from "./fake-office-scenarios";
import { calculateOfficeCardPlacement } from "./office-card-placement";
import {
  DEFAULT_OFFICE_CONFIG,
  type OfficeConfig,
} from "./office-config-schema";
import {
  ORIGINAL_OFFICE_VISUAL_THEME,
  type OfficeVisualTheme,
} from "./office-theme";
import type { OfficeUsageSnapshot } from "./office-usage";
import {
  applyOfficeDecor,
  withDetailedOfficeVisualTheme,
} from "./office-layout";
import {
  buildUsagePosters,
  renderUsagePosters,
  type UsageProviderIdentity,
  usagePosterSummary,
} from "./usage-posters";
import { startGameLoop } from "./vendor/pixel-agents/webview-ui/src/office/engine/gameLoop";
import { OfficeState } from "./vendor/pixel-agents/webview-ui/src/office/engine/officeState";
import { renderFrame } from "./vendor/pixel-agents/webview-ui/src/office/engine/renderer";
import { CHARACTER_SITTING_OFFSET_PX } from "./vendor/pixel-agents/webview-ui/src/constants";
import {
  CharacterState,
  type OfficeLayout,
  TILE_SIZE,
} from "./vendor/pixel-agents/webview-ui/src/office/types";

interface Viewport {
  dpr: number;
  offsetX: number;
  offsetY: number;
  zoom: number;
}

const INITIAL_VIEWPORT: Viewport = {
  dpr: 1,
  offsetX: 0,
  offsetY: 0,
  zoom: 1,
};

const CUE_INSET_PX = 8;
const CUE_GAP_PX = 10;
const CHARACTER_RENDER_HEIGHT_PX = 32;

export interface OfficeCanvasProps {
  assetRoot?: string;
  embeddedAssets?: EmbeddedAssetMap;
  layoutKind?: OfficeLayoutKind;
  scenario?: OfficeScenarioKind;
  arrivalMode?: "animated" | "settled";
  chrome?: "full" | "preview" | "sidebar" | "floating";
  playback?: "live" | "static";
  officeTheme?: OfficeVisualTheme;
  officeConfig?: OfficeConfig;
  threads?: readonly ThreadPresence[];
  selectedThreadId?: string | null;
  sourceStatus?: "loading" | "ready" | "error";
  onOpenThread?: (threadId: string) => void;
  usageProviders?: readonly UsageProviderIdentity[];
  usageSnapshot?: OfficeUsageSnapshot | null;
  usageSettingsHref?: string;
}

export function officeViewportZoom(
  fit: number,
  chrome: NonNullable<OfficeCanvasProps["chrome"]>,
): number {
  return fit < 1 || chrome === "floating" ? fit : Math.floor(fit);
}

export function selectedAgentIdForThread(
  threads: readonly ThreadPresence[],
  threadId: string | null | undefined,
): number | null {
  if (!threadId) return null;
  return (
    threads.find((thread) => thread.threadId === threadId)?.agentId ?? null
  );
}

function summaryLabel(plan: AssignmentPlan | null): string {
  if (!plan) return "Preparing office";
  const parts = [
    `${plan.counts.work} working`,
    `${plan.counts.meeting} meeting`,
    `${plan.counts.rest} resting`,
  ];
  if (plan.counts.overflow > 0) parts.push(`${plan.counts.overflow} overflow`);
  if (plan.counts.away > 0) parts.push(`${plan.counts.away} away`);
  return parts.join(" · ");
}

function renderMapLabels(
  context: CanvasRenderingContext2D,
  labels: readonly OfficeMapLabel[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  dpr: number,
): void {
  const fontSize = Math.max(Math.round(6 * zoom), Math.round(8 * dpr));
  const horizontalPadding = Math.max(Math.round(3 * zoom), Math.round(3 * dpr));
  const height = fontSize + Math.max(4, Math.round(3 * dpr));
  context.save();
  context.font = `800 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const label of labels) {
    const centerX = Math.round(offsetX + label.col * TILE_SIZE * zoom);
    const centerY = Math.round(offsetY + label.row * TILE_SIZE * zoom);
    const width =
      Math.ceil(context.measureText(label.text).width) + horizontalPadding * 2;
    const left = Math.round(centerX - width / 2);
    const top = Math.round(centerY - height / 2);
    context.fillStyle = "rgba(12, 18, 25, 0.82)";
    context.fillRect(left, top, width, height);
    context.strokeStyle = "rgba(236, 242, 243, 0.35)";
    context.lineWidth = Math.max(1, Math.round(dpr));
    context.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
    context.fillStyle = "rgba(246, 249, 248, 0.96)";
    context.fillText(label.text, centerX, centerY + Math.round(dpr * 0.25));
  }
  context.restore();
}

export function OfficeCanvas({
  assetRoot,
  embeddedAssets,
  layoutKind = "compact",
  scenario,
  arrivalMode = "settled",
  chrome = "full",
  playback = "live",
  officeTheme = ORIGINAL_OFFICE_VISUAL_THEME,
  officeConfig = DEFAULT_OFFICE_CONFIG,
  threads,
  selectedThreadId,
  sourceStatus = "ready",
  onOpenThread,
  usageProviders = [],
  usageSnapshot = null,
  usageSettingsHref = "/settings/usage",
}: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cueRef = useRef<HTMLElement>(null);
  const usageCueRef = useRef<HTMLElement>(null);
  const usageLayerRef = useRef<HTMLDivElement>(null);
  const officeRef = useRef<OfficeState | null>(null);
  const directorRef = useRef<OfficeDirector | null>(null);
  const baseLayoutRef = useRef<OfficeLayout | null>(null);
  const renderLayoutRef = useRef<OfficeLayout | null>(null);
  const renderOfficeRef = useRef<(() => void) | null>(null);
  const startLoopRef = useRef<(() => void) | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const officeThemeRef = useRef(officeTheme);
  officeThemeRef.current = officeTheme;
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const viewportRef = useRef<Viewport>(INITIAL_VIEWPORT);
  const threadsRef = useRef<readonly ThreadPresence[]>(threads ?? []);
  threadsRef.current = threads ?? [];
  const selectedAgentId = selectedAgentIdForThread(
    threads ?? [],
    selectedThreadId,
  );
  const selectedAgentIdRef = useRef<number | null>(selectedAgentId);
  selectedAgentIdRef.current = selectedAgentId;
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [hoveredUsageProviderId, setHoveredUsageProviderId] = useState<
    string | null
  >(null);
  const visibleAgentId = hoveredId;
  const visibleAgentIdRef = useRef<number | null>(visibleAgentId);
  visibleAgentIdRef.current = visibleAgentId;
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [plan, setPlan] = useState<AssignmentPlan | null>(null);
  const [officeName, setOfficeName] = useState(
    layoutKind === "work-club" ? "Perimeter Work Club" : "Commons Suite 12",
  );
  const [hasFrontDesk, setHasFrontDesk] = useState(layoutKind === "work-club");
  const resolvedScenario =
    scenario ?? (layoutKind === "work-club" ? "twenty" : "five");
  const usesLiveThreads = threads !== undefined;
  const usagePosters = useMemo(
    () => buildUsagePosters(usageProviders, usageSnapshot),
    [usageProviders, usageSnapshot],
  );
  const usagePostersRef = useRef(usagePosters);
  usagePostersRef.current = usagePosters;
  const hoveredUsageProviderIdRef = useRef(hoveredUsageProviderId);
  hoveredUsageProviderIdRef.current = hoveredUsageProviderId;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let startLoop: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;
    setStatus("loading");
    setHoveredId(null);

    void loadPixelAgentsOffice(assetRoot, layoutKind, embeddedAssets)
      .then((loadedLayout) => {
        if (cancelled) return;
        const layout =
          layoutKind === "compact"
            ? applyOfficeDecor(loadedLayout, officeConfig.decor)
            : loadedLayout;
        baseLayoutRef.current = layout;
        renderLayoutRef.current =
          layoutKind === "compact"
            ? withDetailedOfficeVisualTheme(layout, officeThemeRef.current)
            : layout;
        const blueprint = compileOfficeBlueprint(layoutKind, layout);
        const office = new OfficeState(layout);
        office.selectedAgentId = selectedAgentIdRef.current;
        const director = new OfficeDirector(
          office,
          blueprint,
          officeConfig.behavior,
        );
        const nowMs = Date.now();
        const initialThreads = usesLiveThreads
          ? threadsRef.current
          : makeFakeThreads(layoutKind, resolvedScenario, nowMs);
        const nextPlan =
          arrivalMode === "settled"
            ? director.seedSettled(initialThreads, nowMs)
            : director.reconcile(initialThreads, nowMs);
        officeRef.current = office;
        directorRef.current = director;
        setPlan(nextPlan);
        setOfficeName(blueprint.name);
        setHasFrontDesk(blueprint.seats.some((seat) => seat.role === "staff"));

        const renderOffice = () => {
          const context = canvas.getContext("2d");
          if (!context)
            throw new Error("BB Office could not create a canvas context");
          const viewport = viewportRef.current;
          const renderLayout = renderLayoutRef.current ?? layout;
          const offsets = renderFrame(
            context,
            canvas.width,
            canvas.height,
            office.tileMap,
            office.furniture,
            office.getCharacters(),
            viewport.zoom,
            0,
            0,
            {
              selectedAgentId: office.selectedAgentId,
              hoveredAgentId: office.hoveredAgentId,
              hoveredTile: null,
              seats: office.seats,
              characters: office.characters,
            },
            undefined,
            renderLayout.tileColors,
            renderLayout.cols,
            renderLayout.rows,
            renderLayout.carpetTiles,
            renderLayout.areas,
            renderLayout.areaTiles,
            false,
            null,
            office.getPets(),
          );
          renderMapLabels(
            context,
            blueprint.mapLabels,
            offsets.offsetX,
            offsets.offsetY,
            viewport.zoom,
            viewport.dpr,
          );
          if (layoutKind === "compact") {
            renderUsagePosters(
              context,
              usagePostersRef.current,
              offsets.offsetX,
              offsets.offsetY,
              viewport.zoom,
              officeThemeRef.current,
            );
          }
          const nextViewport = { ...viewport, ...offsets };
          viewportRef.current = nextViewport;
          const usageLayer = usageLayerRef.current;
          if (usageLayer) {
            usageLayer.style.transform = `translate(${nextViewport.offsetX / nextViewport.dpr}px, ${nextViewport.offsetY / nextViewport.dpr}px) scale(${nextViewport.zoom / nextViewport.dpr})`;
          }
          const cue = cueRef.current;
          const visibleCharacter =
            visibleAgentIdRef.current === null
              ? null
              : office.characters.get(visibleAgentIdRef.current);
          if (
            cue &&
            visibleCharacter &&
            cue.offsetWidth > 0 &&
            cue.offsetHeight > 0
          ) {
            const placement = calculateOfficeCardPlacement({
              stageWidth: canvas.clientWidth,
              stageHeight: canvas.clientHeight,
              cardWidth: cue.offsetWidth,
              cardHeight: cue.offsetHeight,
              anchorX:
                (nextViewport.offsetX +
                  visibleCharacter.x * nextViewport.zoom) /
                nextViewport.dpr,
              anchorTop:
                (nextViewport.offsetY +
                  (visibleCharacter.y +
                    (visibleCharacter.state === CharacterState.TYPE
                      ? CHARACTER_SITTING_OFFSET_PX
                      : 0) -
                    CHARACTER_RENDER_HEIGHT_PX) *
                    nextViewport.zoom) /
                nextViewport.dpr,
              anchorBottom:
                (nextViewport.offsetY +
                  (visibleCharacter.y +
                    (visibleCharacter.state === CharacterState.TYPE
                      ? CHARACTER_SITTING_OFFSET_PX
                      : 0)) *
                    nextViewport.zoom) /
                nextViewport.dpr,
              inset: CUE_INSET_PX,
              gap: CUE_GAP_PX,
            });
            cue.style.left = `${placement.left}px`;
            cue.style.top = `${placement.top}px`;
            cue.dataset.side = placement.side;
            cue.dataset.positioned = "true";
          }
          const usageCue = usageCueRef.current;
          const visiblePoster = usagePostersRef.current.find(
            (poster) =>
              poster.providerId === hoveredUsageProviderIdRef.current,
          );
          if (
            usageCue &&
            visiblePoster &&
            usageCue.offsetWidth > 0 &&
            usageCue.offsetHeight > 0
          ) {
            const placement = calculateOfficeCardPlacement({
              stageWidth: canvas.clientWidth,
              stageHeight: canvas.clientHeight,
              cardWidth: usageCue.offsetWidth,
              cardHeight: usageCue.offsetHeight,
              anchorX:
                (nextViewport.offsetX +
                  (visiblePoster.placement.x +
                    visiblePoster.placement.width / 2) *
                    nextViewport.zoom) /
                nextViewport.dpr,
              anchorTop:
                (nextViewport.offsetY +
                  visiblePoster.placement.y * nextViewport.zoom) /
                nextViewport.dpr,
              anchorBottom:
                (nextViewport.offsetY +
                  (visiblePoster.placement.y +
                    visiblePoster.placement.height) *
                    nextViewport.zoom) /
                nextViewport.dpr,
              inset: CUE_INSET_PX,
              gap: CUE_GAP_PX,
            });
            usageCue.style.left = `${placement.left}px`;
            usageCue.style.top = `${placement.top}px`;
            usageCue.dataset.side = placement.side;
            usageCue.dataset.positioned = "true";
          }
        };
        renderOfficeRef.current = renderOffice;

        const resize = () => {
          const bounds = canvas.getBoundingClientRect();
          const horizontalBackingScale =
            (layout.cols * TILE_SIZE) / bounds.width;
          const verticalBackingScale =
            (layout.rows * TILE_SIZE) / bounds.height;
          const requiresCanvasDownscale =
            horizontalBackingScale > 1 || verticalBackingScale > 1;
          const dpr = Math.min(
            requiresCanvasDownscale
              ? Math.max(horizontalBackingScale, verticalBackingScale)
              : Math.max(window.devicePixelRatio || 1, 2),
            2,
          );
          canvas.width = Math.max(1, Math.round(bounds.width * dpr));
          canvas.height = Math.max(1, Math.round(bounds.height * dpr));
          const horizontalFit = canvas.width / (layout.cols * TILE_SIZE);
          const verticalFit = canvas.height / (layout.rows * TILE_SIZE);
          const fit = Math.min(horizontalFit, verticalFit);
          viewportRef.current = {
            ...viewportRef.current,
            dpr,
            zoom: officeViewportZoom(fit, chrome),
          };
          if (playbackRef.current === "static") renderOffice();
        };

        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);
        resize();
        startLoop = () => {
          if (stopLoopRef.current) return;
          stopLoopRef.current = startGameLoop(canvas, {
            update: (delta) => director.update(delta),
            render: () => renderOffice(),
          });
        };
        startLoopRef.current = startLoop;
        if (playbackRef.current === "live") startLoop();
        renderOffice();
        setStatus("ready");
      })
      .catch((error: Error) => {
        console.error("BB Office initialization failed", error);
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      stopLoopRef.current?.();
      stopLoopRef.current = null;
      if (startLoopRef.current === startLoop) startLoopRef.current = null;
      resizeObserver?.disconnect();
      officeRef.current = null;
      directorRef.current = null;
      baseLayoutRef.current = null;
      renderLayoutRef.current = null;
      renderOfficeRef.current = null;
    };
  }, [
    arrivalMode,
    assetRoot,
    embeddedAssets,
    layoutKind,
    officeConfig,
    resolvedScenario,
    usesLiveThreads,
  ]);

  useEffect(() => {
    if (playback === "live") {
      startLoopRef.current?.();
      return;
    }
    stopLoopRef.current?.();
    stopLoopRef.current = null;
    renderOfficeRef.current?.();
  }, [playback]);

  useEffect(() => {
    const layout = baseLayoutRef.current;
    if (!layout) return;
    renderLayoutRef.current =
      layoutKind === "compact"
        ? withDetailedOfficeVisualTheme(layout, officeTheme)
        : layout;
    if (playback === "static") renderOfficeRef.current?.();
  }, [layoutKind, officeTheme, playback]);

  useEffect(() => {
    if (playback === "static") renderOfficeRef.current?.();
  }, [playback, usagePosters]);

  useEffect(() => {
    if (!usesLiveThreads) return;
    const director = directorRef.current;
    if (!director) return;
    const nextPlan = director.reconcile(threadsRef.current, Date.now());
    setPlan(nextPlan);
  }, [threads, usesLiveThreads]);

  useEffect(() => {
    const office = officeRef.current;
    if (office) office.selectedAgentId = selectedAgentId;
  }, [selectedAgentId]);

  const agentAtPointer = useCallback((event: MouseEvent<HTMLCanvasElement>) => {
    const office = officeRef.current;
    const canvas = canvasRef.current;
    if (!office || !canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    const viewport = viewportRef.current;
    const deviceX = (event.clientX - bounds.left) * viewport.dpr;
    const deviceY = (event.clientY - bounds.top) * viewport.dpr;
    return office.getCharacterAt(
      (deviceX - viewport.offsetX) / viewport.zoom,
      (deviceY - viewport.offsetY) / viewport.zoom,
    );
  }, []);

  const onPointerMove = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      const office = officeRef.current;
      const canvas = canvasRef.current;
      if (!office || !canvas) return;
      const agentId = agentAtPointer(event);
      office.hoveredAgentId = agentId;
      setHoveredId((current) => (current === agentId ? current : agentId));
      canvas.style.cursor = agentId === null ? "default" : "pointer";
    },
    [agentAtPointer],
  );

  const onPointerLeave = useCallback(() => {
    const office = officeRef.current;
    if (office) office.hoveredAgentId = null;
    setHoveredId(null);
  }, []);

  const onClick = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      const director = directorRef.current;
      if (!director || !onOpenThread) return;
      const agentId = agentAtPointer(event);
      if (agentId === null) return;
      const occupant = director.getOccupant(agentId);
      if (occupant?.threadId) onOpenThread(occupant.threadId);
    },
    [agentAtPointer, onOpenThread],
  );

  const visibleOccupant = useMemo(() => {
    if (visibleAgentId === null) return null;
    return directorRef.current?.getOccupant(visibleAgentId) ?? null;
  }, [plan, visibleAgentId]);
  const visibleUsagePoster = useMemo(
    () =>
      usagePosters.find(
        (poster) => poster.providerId === hoveredUsageProviderId,
      ) ?? null,
    [hoveredUsageProviderId, usagePosters],
  );
  const showUsagePoster = useCallback((providerId: string) => {
    const office = officeRef.current;
    if (office) office.hoveredAgentId = null;
    setHoveredId(null);
    setHoveredUsageProviderId(providerId);
  }, []);
  const hideUsagePoster = useCallback(() => {
    setHoveredUsageProviderId(null);
  }, []);

  const count =
    threads?.length ?? scenarioThreadCount(layoutKind, resolvedScenario);
  const isLive = threads !== undefined;

  return (
    <section
      className={`bb-office-canvas-shell bb-office-canvas-shell-${chrome}`}
      data-appearance={officeTheme.appearance}
      data-color-mode={officeTheme.mode}
    >
      {chrome === "preview" ? (
        <header className="bb-office-canvas-header">
          <div>
            <p className="bb-office-canvas-kicker">
              {isLive
                ? `${count} live thread${count === 1 ? "" : "s"}`
                : `${count}-thread review`}
            </p>
            <h1>{officeName}</h1>
          </div>
          <p className="bb-office-canvas-summary-line">
            {summaryLabel(plan)}
            {hasFrontDesk ? " · 1 front desk" : " · south entrance"}
          </p>
        </header>
      ) : null}

      <div className="bb-office-canvas-stage">
        <canvas
          ref={canvasRef}
          aria-label={`${officeName}, ${count}-thread office${selectedAgentId === null ? "" : ", current thread highlighted"}`}
          onClick={onClick}
          onMouseLeave={onPointerLeave}
          onMouseMove={onPointerMove}
        />
        {status === "ready" && layoutKind === "compact" ? (
          <div ref={usageLayerRef} className="bb-office-canvas-usage-layer">
            {usagePosters.map((poster) => (
              <a
                key={poster.providerId}
                className="bb-office-canvas-usage-hotspot"
                href={usageSettingsHref}
                style={{
                  left: poster.placement.x - 2,
                  top: poster.placement.y - 4,
                  width: poster.placement.width + 4,
                  height: poster.placement.height + 8,
                }}
                aria-label={`${poster.displayName} usage: ${usagePosterSummary(poster)}. Open BB usage settings.`}
                onBlur={hideUsagePoster}
                onFocus={() => showUsagePoster(poster.providerId)}
                onMouseEnter={() => showUsagePoster(poster.providerId)}
                onMouseLeave={hideUsagePoster}
              />
            ))}
          </div>
        ) : null}
        {visibleUsagePoster ? (
          <aside
            ref={usageCueRef}
            className="bb-office-canvas-usage-cue"
            data-side="above"
            data-positioned="false"
            role="tooltip"
          >
            <strong>{visibleUsagePoster.displayName}</strong>
            <span>{usagePosterSummary(visibleUsagePoster)}</span>
          </aside>
        ) : null}
        {status === "loading" ? (
          <div className="bb-office-canvas-message">
            Loading the Pixel Agents office…
          </div>
        ) : null}
        {status === "error" ? (
          <div className="bb-office-canvas-message bb-office-canvas-message-error">
            The authored office failed its layout or asset validation.
          </div>
        ) : null}
        {status === "ready" && sourceStatus === "loading" ? (
          <div className="bb-office-canvas-message">
            Connecting live bb threads…
          </div>
        ) : null}
        {status === "ready" && sourceStatus === "error" ? (
          <div className="bb-office-canvas-message bb-office-canvas-message-error">
            Live thread data is temporarily unavailable.
          </div>
        ) : null}
        {chrome !== "preview" && visibleOccupant ? (
          <aside
            ref={cueRef}
            className="bb-office-canvas-hover-cue"
            data-side="above"
            data-positioned="false"
            role="tooltip"
            aria-label={`${visibleOccupant.name}, ${visibleOccupant.provider}`}
          >
            <strong title={visibleOccupant.name}>{visibleOccupant.name}</strong>
            <span>{visibleOccupant.provider}</span>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
