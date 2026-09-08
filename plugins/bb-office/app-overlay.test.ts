// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_OFFICE_CONFIG } from "./office-config-schema";

// Exercise the real overlay registration, SDK hooks, and lifecycle without
// starting the pixel renderer or loading sprite assets in jsdom.
vi.mock("./office-canvas", () => ({
  OfficeCanvas: ({ selectedThreadId, onOpenThread }: {
    selectedThreadId: string | null;
    onOpenThread: (id: string) => void;
  }) => createElement("button", {
    "data-testid": "office-canvas",
    "data-selected-thread": selectedThreadId ?? "",
    onClick: () => onOpenThread("thread-clicked"),
  }, "Open worker"),
}));
vi.mock("./floating-office-widget", () => ({
  FloatingOfficeWidget: ({ children, collapsedKind }: {
    children: (expanded: boolean) => ReactNode;
    collapsedKind: string;
  }) => createElement("div", {
    "data-testid": "office-widget",
    "data-collapsed-kind": collapsedKind,
  }, children(true)),
}));

const app = await loadPluginApp(() => import("./app"));
let compact = false;
let viewportListeners: Set<() => void>;

beforeEach(() => {
  compact = false;
  viewportListeners = new Set();
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    media: query,
    get matches() { return compact; },
    addEventListener: (_event: string, listener: () => void) => {
      viewportListeners.add(listener);
    },
    removeEventListener: (_event: string, listener: () => void) => {
      viewportListeners.delete(listener);
    },
  } as MediaQueryList)));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountOverlay(threadId: string | null = null) {
  return renderSlot(app.appOverlays[0]!, {}, {
    context: { projectId: null, threadId },
    rpc: {
      readOfficeConfig: () => ({ config: DEFAULT_OFFICE_CONFIG }),
    },
  });
}

async function setCompact(value: boolean) {
  await act(async () => {
    compact = value;
    for (const listener of viewportListeners) listener();
  });
}

describe("BB Office app overlay", () => {
  test("registers once without claiming a sidebar replacement", () => {
    expect(app.appOverlays.map((slot) => slot.id)).toEqual(["bb-office-floating"]);
    expect(app.threadLists).toEqual([]);
  });

  test("uses app context for selection and host navigation for worker clicks", async () => {
    const slot = mountOverlay("thread-selected");
    const canvas = await slot.findByTestId("office-canvas");
    expect(canvas.getAttribute("data-selected-thread")).toBe("thread-selected");
    // The body portal retains the host's plugin context.
    expect(slot.container.contains(canvas)).toBe(false);
    fireEvent.click(canvas);
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toThread", threadId: "thread-clicked" },
    ]);
    slot.lifecycle.unmount();
    expect(document.querySelector('[data-testid="office-widget"]')).toBeNull();
    expect(viewportListeners.size).toBe(0);
  });

  test("shows the floorplan on the new-thread route without sidebar props", async () => {
    const slot = mountOverlay();
    const widget = await slot.findByTestId("office-widget");
    expect(widget.getAttribute("data-collapsed-kind")).toBe("floorplan");
    slot.lifecycle.unmount();
  });

  test("does not load the office on compact screens and responds to resizing", async () => {
    compact = true;
    const slot = mountOverlay();
    expect(slot.queryByTestId("office-widget")).toBeNull();
    expect(slot.inspection.rpcCalls).toEqual([]);
    expect(viewportListeners.size).toBe(1);
    await setCompact(false);
    expect(await slot.findByTestId("office-widget")).toBeTruthy();
    await setCompact(true);
    expect(slot.queryByTestId("office-widget")).toBeNull();
    slot.lifecycle.unmount();
    expect(viewportListeners.size).toBe(0);
  });
});
