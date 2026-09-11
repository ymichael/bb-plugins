// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("lame duck footer disclosure", () => {
  it("registers duck artwork for the footer icon name", async () => {
    const app = await loadPluginApp(() => import("./app.js"));
    const footer = app.experimentalSidebarFooterItems[0];
    const icon = app.icons.find((entry) => entry.name === footer?.icon);
    if (!icon) throw new Error("Missing footer artwork");
    expect(icon.name).toBe("lame-duck/duck");
    const slot = renderSlot(icon, { className: "size-4" });
    try {
      expect(slot.container.querySelector("svg")?.getAttribute("class")).toBe("size-4");
      expect(slot.container.querySelectorAll("svg path")).toHaveLength(3);
    } finally {
      slot.lifecycle.unmount();
    }
  });

  it("pauses, reflects draining, and resumes through RPC", async () => {
    const app = await loadPluginApp(() => import("./app.js"));
    let paused = false;
    let runningCount = 1;
    const status = () => ({
      heldCount: 4,
      paused,
      runningCount,
      drained: paused && runningCount === 0,
    });
    const panel = app.experimentalSidebarFooterItems[0];
    if (panel?.kind !== "disclosure") throw new Error("Missing disclosure");
    const dismiss = vi.fn();
    const slot = renderSlot(
      panel,
      { dismiss },
      {
        rpc: {
          status,
          pause: () => {
            paused = true;
            return status();
          },
          resume: () => {
            paused = false;
            return status();
          },
        },
      },
    );
    try {
      fireEvent.click(await slot.findByRole("button", { name: "Pause sends" }));
      await slot.findByText("4 sends held");
      runningCount = 0;
      await slot.findByText("Ready to update", {}, { timeout: 4500 });
      fireEvent.click(slot.getByRole("button", { name: "Resume queued work" }));
      await slot.findByText("Sends enabled");
      expect(paused).toBe(false);
      fireEvent.click(slot.getByRole("button", { name: "Collapse Lame duck" }));
      expect(dismiss).toHaveBeenCalledOnce();
    } finally {
      slot.lifecycle.unmount();
    }
  });

  it("shows save failures and permits retry", async () => {
    const app = await loadPluginApp(() => import("./app.js"));
    const panel = app.experimentalSidebarFooterItems[0];
    if (panel?.kind !== "disclosure") throw new Error("Missing disclosure");
    const dismiss = vi.fn();
    let fail = true;
    const slot = renderSlot(
      panel,
      { dismiss },
      {
        rpc: {
          status: () => ({ heldCount: 0, paused: true, runningCount: 0, drained: true }),
          resume: () => {
            if (fail) throw new Error("Server restarting");
            return { heldCount: 0, paused: false, runningCount: 0, drained: false };
          },
        },
      },
    );
    try {
      fireEvent.click(await slot.findByRole("button", { name: "Resume queued work" }));
      await waitFor(() =>
        expect(slot.getByRole("alert").textContent).toContain("Server restarting"),
      );
      fail = false;
      fireEvent.click(slot.getByRole("button", { name: "Resume queued work" }));
      await slot.findByText("Sends enabled");
    } finally {
      slot.lifecycle.unmount();
    }
  });
});
