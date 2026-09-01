import { describe, expect, test } from "vitest";
import { resolveFloatingOfficeCollapsedKind } from "./floating-office-collapsed";

describe("floating office collapsed content", () => {
  test("shows the current worker on a thread route when present", () => {
    expect(
      resolveFloatingOfficeCollapsedKind({
        activeThreadId: "thread-1",
        hasCurrentWorker: true,
        pathname: "/threads/thread-1",
      }),
    ).toBe("worker");
  });

  test("hides on a thread route when its worker is absent", () => {
    expect(
      resolveFloatingOfficeCollapsedKind({
        activeThreadId: "thread-1",
        hasCurrentWorker: false,
        pathname: "/threads/thread-1",
      }),
    ).toBe("hidden");
  });

  test("shows the floor plan on the new-thread route", () => {
    expect(
      resolveFloatingOfficeCollapsedKind({
        activeThreadId: null,
        hasCurrentWorker: false,
        pathname: "/",
      }),
    ).toBe("floorplan");
  });

  test.each(["/settings", "/plugins/tasks/board", "/tools"])(
    "hides on the non-thread route %s",
    (pathname) => {
      expect(
        resolveFloatingOfficeCollapsedKind({
          activeThreadId: null,
          hasCurrentWorker: false,
          pathname,
        }),
      ).toBe("hidden");
    },
  );
});
