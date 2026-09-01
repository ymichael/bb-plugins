import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { BB_OFFICE_ASSET_ROOT } from "./asset-loader";
import {
  clampFloatingOfficeState,
  defaultFloatingOfficeState,
  FLOATING_OFFICE_WORKER_SIZE,
  floatingOfficeFrame,
  moveFloatingOfficeState,
  parseFloatingOfficeState,
  redockFloatingOfficeState,
  resizeFloatingOfficeState,
  serializeFloatingOfficeState,
  setFloatingOfficeMode,
  snapFloatingOfficeState,
  type FloatingOfficeMode,
  type FloatingOfficePoint,
  type FloatingOfficeState,
} from "./floating-office-placement";
import type { FloatingOfficeCollapsedKind } from "./floating-office-collapsed";
import type { ThreadPresence } from "./office-allocator";

const FLOATING_OFFICE_STORAGE_KEY = "bb-office:floating-office-placement";
const LEGACY_COLLAPSED_STORAGE_KEY = "bb-office:office-collapsed";
const DRAG_ACTIVATION_DISTANCE_PX = 4;
const KEYBOARD_MOVE_DISTANCE_PX = 16;
const KEYBOARD_RESIZE_DISTANCE_PX = 16;

interface DragSession {
  pointerId: number;
  pointerStart: FloatingOfficePoint;
  stateStart: FloatingOfficeState;
  moved: boolean;
}

interface ResizeSession {
  pointerId: number;
  pointerStart: FloatingOfficePoint;
  stateStart: FloatingOfficeState;
}

interface FloatingOfficeWidgetProps {
  children: (expanded: boolean) => ReactNode;
  collapsedKind: FloatingOfficeCollapsedKind;
  currentWorker: ThreadPresence | null;
  workerCount: number;
}

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function readInitialState(): FloatingOfficeState {
  const viewport = viewportSize();
  try {
    const saved = parseFloatingOfficeState(
      window.localStorage.getItem(FLOATING_OFFICE_STORAGE_KEY),
      viewport,
    );
    if (saved) return saved;
    const legacyMode =
      window.localStorage.getItem(LEGACY_COLLAPSED_STORAGE_KEY) === "true"
        ? "worker"
        : "expanded";
    return defaultFloatingOfficeState(viewport, legacyMode);
  } catch {
    return defaultFloatingOfficeState(viewport, "expanded");
  }
}

function persistState(state: FloatingOfficeState): void {
  try {
    window.localStorage.setItem(
      FLOATING_OFFICE_STORAGE_KEY,
      serializeFloatingOfficeState(state),
    );
  } catch {
    return;
  }
}

function FloorPlanIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 9.5H13.5" />
      <path d="M17.5 9.5H21.5" />
      <path d="M9.5 21.5V9.5" />
      <path d="M9.5 6.5V2.5" />
      <path d="M17 17C15 17 13 18.6223 13 21.5H10.5C6.72876 21.5 4.84315 21.5 3.67157 20.3284C2.5 19.1569 2.5 17.2712 2.5 13.5V10.5C2.5 6.72876 2.5 4.84315 3.67157 3.67157C4.84315 2.5 6.72876 2.5 10.5 2.5H13.5C17.2712 2.5 19.1569 2.5 20.3284 3.67157C21.5 4.84315 21.5 6.72876 21.5 10.5V17.8432C21.5 19.8628 19.8628 21.5 17.8432 21.5" />
    </svg>
  );
}

function WorkerSprite({ worker }: { worker: ThreadPresence }) {
  return (
    <span
      className="bb-office-floating-worker-sprite"
      data-state={worker.status}
      style={{
        backgroundImage: `url(${BB_OFFICE_ASSET_ROOT}/characters/char_${worker.palette}.png)`,
        filter:
          worker.hueShift === 0
            ? undefined
            : `hue-rotate(${worker.hueShift}deg)`,
      }}
      aria-hidden="true"
    />
  );
}

export function FloatingOfficeWidget({
  children,
  collapsedKind,
  currentWorker,
  workerCount,
}: FloatingOfficeWidgetProps) {
  const [state, setState] = useState<FloatingOfficeState>(readInitialState);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const stateRef = useRef(state);
  const preferredStateRef = useRef(state);
  const dragSessionRef = useRef<DragSession | null>(null);
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const suppressActivationRef = useRef(false);
  const previousModeRef = useRef(state.mode);
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const workerButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (previousModeRef.current === state.mode) return;
    previousModeRef.current = state.mode;
    const frameId = window.requestAnimationFrame(() => {
      const control =
        state.mode === "worker"
          ? collapsedKind === "hidden"
            ? null
            : workerButtonRef.current
          : collapseButtonRef.current;
      control?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [collapsedKind, state.mode]);

  useEffect(() => {
    const workerButton = workerButtonRef.current;
    if (
      state.mode === "worker" &&
      collapsedKind === "hidden" &&
      workerButton !== null &&
      document.activeElement === workerButton
    ) {
      workerButton.blur();
    }
  }, [collapsedKind, state.mode]);

  useEffect(() => {
    const reclamp = () => {
      const next = clampFloatingOfficeState(
        preferredStateRef.current,
        viewportSize(),
      );
      stateRef.current = next;
      setState(next);
    };
    window.addEventListener("resize", reclamp);
    window.visualViewport?.addEventListener("resize", reclamp);
    reclamp();
    return () => {
      window.removeEventListener("resize", reclamp);
      window.visualViewport?.removeEventListener("resize", reclamp);
    };
  }, []);

  const commit = useCallback((next: FloatingOfficeState) => {
    stateRef.current = next;
    preferredStateRef.current = next;
    setState(next);
    persistState(next);
  }, []);

  const beginDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragSessionRef.current = {
      pointerId: event.pointerId,
      pointerStart: { x: event.clientX, y: event.clientY },
      stateStart: stateRef.current,
      moved: false,
    };
    setIsDragging(true);
    suppressActivationRef.current = false;
  }, []);

  const continueDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const delta = {
      x: event.clientX - session.pointerStart.x,
      y: event.clientY - session.pointerStart.y,
    };
    if (Math.hypot(delta.x, delta.y) >= DRAG_ACTIVATION_DISTANCE_PX) {
      session.moved = true;
    }
    if (!session.moved) return;
    const next = moveFloatingOfficeState(
      session.stateStart,
      delta,
      viewportSize(),
    );
    stateRef.current = next;
    setState(next);
  }, []);

  const endDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      suppressActivationRef.current = session.moved;
      dragSessionRef.current = null;
      setIsDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      commit(snapFloatingOfficeState(stateRef.current, viewportSize()));
    },
    [commit],
  );

  const moveWithKeyboard = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const deltas: Partial<Record<string, FloatingOfficePoint>> = {
        ArrowDown: { x: 0, y: KEYBOARD_MOVE_DISTANCE_PX },
        ArrowLeft: { x: -KEYBOARD_MOVE_DISTANCE_PX, y: 0 },
        ArrowRight: { x: KEYBOARD_MOVE_DISTANCE_PX, y: 0 },
        ArrowUp: { x: 0, y: -KEYBOARD_MOVE_DISTANCE_PX },
      };
      const delta = deltas[event.key];
      if (!delta) return;
      event.preventDefault();
      const multiplier = event.shiftKey ? 4 : 1;
      let next = moveFloatingOfficeState(
        stateRef.current,
        { x: delta.x * multiplier, y: delta.y * multiplier },
        viewportSize(),
      );
      if (next.mode === "worker") {
        next = redockFloatingOfficeState(next, viewportSize());
      }
      commit(next);
    },
    [commit],
  );

  const setMode = useCallback(
    (mode: FloatingOfficeMode) => {
      commit(setFloatingOfficeMode(stateRef.current, mode));
    },
    [commit],
  );

  const expand = useCallback(() => {
    if (suppressActivationRef.current) {
      suppressActivationRef.current = false;
      return;
    }
    setMode("expanded");
  }, [setMode]);

  const beginResize = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeSessionRef.current = {
      pointerId: event.pointerId,
      pointerStart: { x: event.clientX, y: event.clientY },
      stateStart: stateRef.current,
    };
    setIsResizing(true);
  }, []);

  const continueResize = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const session = resizeSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      const horizontalDelta =
        (event.clientX - session.pointerStart.x) *
        (session.stateStart.anchorHorizontal === "left" ? 1 : -1);
      const verticalDelta =
        (event.clientY - session.pointerStart.y) *
        (session.stateStart.anchorVertical === "top" ? 25 / 26 : -25 / 26);
      const widthDelta =
        Math.abs(horizontalDelta) >= Math.abs(verticalDelta)
          ? horizontalDelta
          : verticalDelta;
      const next = resizeFloatingOfficeState(
        session.stateStart,
        session.stateStart.expandedWidth + widthDelta,
        viewportSize(),
      );
      stateRef.current = next;
      setState(next);
    },
    [],
  );

  const endResize = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const session = resizeSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      resizeSessionRef.current = null;
      setIsResizing(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      commit(stateRef.current);
    },
    [commit],
  );

  const resizeWithKeyboard = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const directions: Partial<Record<string, number>> = {
        ArrowDown: 1,
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -1,
      };
      const direction = directions[event.key];
      if (direction === undefined) return;
      event.preventDefault();
      const multiplier = event.shiftKey ? 4 : 1;
      commit(
        resizeFloatingOfficeState(
          stateRef.current,
          stateRef.current.expandedWidth +
            direction * KEYBOARD_RESIZE_DISTANCE_PX * multiplier,
          viewportSize(),
        ),
      );
    },
    [commit],
  );

  const frame = floatingOfficeFrame(state, viewportSize());
  const workerPosition = {
    width: FLOATING_OFFICE_WORKER_SIZE.width,
    height: FLOATING_OFFICE_WORKER_SIZE.height,
    transform: `translate3d(${state.anchorX}px, ${state.anchorY}px, 0)`,
  };
  const widgetPosition = {
    width: frame.width,
    height: frame.height,
    transform: `translate3d(${frame.x}px, ${frame.y}px, 0)`,
    transformOrigin: `${frame.originX}px ${frame.originY}px`,
  };
  const isExpanded = state.mode === "expanded";
  const isCollapsedVisible = !isExpanded && collapsedKind !== "hidden";

  return (
    <div
      className="bb-office-floating-root"
      data-dragging={isDragging}
      data-resizing={isResizing}
      aria-live="off"
    >
      <aside
        className="bb-office-floating-widget"
        data-anchor-horizontal={state.anchorHorizontal}
        data-anchor-vertical={state.anchorVertical}
        data-mode={state.mode}
        style={widgetPosition}
        aria-label="BB Office"
      >
        <div
          id="bb-office-floating-office-canvas"
          className="bb-office-floating-office-canvas"
          data-visible={isExpanded}
          aria-hidden={!isExpanded}
        >
          {children(isExpanded)}
        </div>
        <button
          type="button"
          className="bb-office-floating-drag-handle"
          aria-label="Move BB Office"
          aria-hidden={!isExpanded}
          tabIndex={isExpanded ? 0 : -1}
          title="Drag to move the office"
          onKeyDown={moveWithKeyboard}
          onPointerCancel={endDrag}
          onPointerDown={beginDrag}
          onPointerMove={continueDrag}
          onPointerUp={endDrag}
        >
          <span />
        </button>
        <button
          ref={collapseButtonRef}
          type="button"
          className="bb-office-floating-collapse"
          aria-label="Collapse office to current worker"
          aria-expanded="true"
          aria-hidden={!isExpanded}
          tabIndex={isExpanded ? 0 : -1}
          title="Collapse office"
          onClick={() => setMode("worker")}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        <button
          type="button"
          className="bb-office-floating-resize"
          aria-label="Resize BB Office"
          aria-hidden={!isExpanded}
          tabIndex={isExpanded ? 0 : -1}
          title="Drag or use arrow keys to resize"
          onKeyDown={resizeWithKeyboard}
          onPointerCancel={endResize}
          onPointerDown={beginResize}
          onPointerMove={continueResize}
          onPointerUp={endResize}
        />
      </aside>
      <button
        ref={workerButtonRef}
        type="button"
        className="bb-office-floating-worker"
        data-collapsed-kind={collapsedKind}
        data-visible={isCollapsedVisible}
        style={workerPosition}
        aria-controls="bb-office-floating-office-canvas"
        aria-expanded="false"
        aria-hidden={!isCollapsedVisible}
        tabIndex={isCollapsedVisible ? 0 : -1}
        aria-label={
          collapsedKind === "worker" && currentWorker
            ? `Show BB Office. Current worker: ${currentWorker.name}`
            : `Show BB Office. ${workerCount} workers present.`
        }
        title="Show BB Office"
        onClick={expand}
        onKeyDown={moveWithKeyboard}
        onPointerCancel={endDrag}
        onPointerDown={beginDrag}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
      >
        {collapsedKind === "worker" && currentWorker ? (
          <WorkerSprite worker={currentWorker} />
        ) : collapsedKind === "floorplan" ? (
          <span className="bb-office-floating-floorplan">
            <FloorPlanIcon />
          </span>
        ) : null}
      </button>
    </div>
  );
}
