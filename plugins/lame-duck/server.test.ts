import {
  createFakePluginHost,
  makeMessageDispatchHookContext,
  makeThreadResponse,
  makeQueueEntry,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server.js";

async function setup() {
  const running = [{ id: "thr_running", hostId: "host_1" }];
  const fake = createFakePluginHost({
    pluginId: "lame-duck",
    sdk: { threads: { listRunning: async () => running, queue: { list: async () => [] } } },
  });
  await plugin(fake.bb);
  function dispatch(attempt: "start-turn" | "join-turn" = "start-turn") {
    const hook = fake.harness.registrations.hooks["message.dispatch"];
    if (!hook) throw new Error("Missing dispatch hook");
    return hook(makeMessageDispatchHookContext({ attempt }));
  }
  return Object.assign(fake, { running, dispatch });
}

describe("lame-duck", () => {
  it("reads the durable held queue on each status request", async () => {
    const state = await setup();
    const rows = [makeQueueEntry()];
    state.harness.sdk.stub("threads.queue.list", async (args) => {
      expect(args).toEqual({ waitHolder: "plugin:lame-duck" });
      return rows;
    });
    try {
      expect(await state.harness.behavior.callRpc("status", null)).toMatchObject({ heldCount: 1 });
      rows.length = 0;
      expect(await state.harness.behavior.callRpc("status", null)).toMatchObject({ heldCount: 0 });
    } finally { await state.harness.lifecycle.dispose(); }
  });

  it("holds starts and steering while existing turns drain, including after reload", async () => {
    const state = await setup();
    try {
      expect(await state.dispatch()).toEqual({ action: "proceed" });
      expect(await state.harness.behavior.callRpc("pause", null)).toEqual({
        heldCount: 0,
        paused: true,
        runningCount: 1,
        drained: false,
      });
      expect(await state.dispatch()).toMatchObject({ action: "wait" });
      expect(await state.dispatch("join-turn")).toMatchObject({
        action: "wait",
      });
      state.running.length = 0;
      await state.harness.behavior.emitThreadEvent("thread.idle", {
        thread: makeThreadResponse(),
        lastAssistantText: "done",
      });
      expect(await state.harness.behavior.callRpc("status", null)).toEqual({
        heldCount: 0,
        paused: true,
        runningCount: 0,
        drained: true,
      });
      Object.assign(state, await state.harness.lifecycle.reload(plugin));
      expect(await state.dispatch()).toMatchObject({ action: "wait" });
      expect(state.harness.recheckCount).toBe(0);
      expect(await state.harness.behavior.callRpc("resume", null)).toEqual({
        heldCount: 0,
        paused: false,
        runningCount: 0,
        drained: false,
      });
      expect(state.harness.recheckCount).toBe(1);
      expect(await state.dispatch()).toEqual({ action: "proceed" });
      Object.assign(state, await state.harness.lifecycle.reload(plugin));
      expect(await state.dispatch()).toEqual({ action: "proceed" });
    } finally {
      await state.harness.lifecycle.dispose();
    }
  });

  it("serializes competing changes and lets resume retry the queue recheck", async () => {
    const state = await setup();
    try {
      await Promise.all([
        state.harness.behavior.callRpc("pause", null),
        state.harness.behavior.callRpc("resume", null),
        state.harness.behavior.callRpc("pause", null),
      ]);
      expect(await state.dispatch()).toMatchObject({ action: "wait" });
      Object.assign(state, await state.harness.lifecycle.reload(plugin));
      expect(await state.dispatch()).toMatchObject({ action: "wait" });
      await state.harness.behavior.callRpc("resume", null);
      await state.harness.behavior.callRpc("resume", null);
      expect(state.harness.recheckCount).toBe(2);
    } finally {
      await state.harness.lifecycle.dispose();
    }
  });

  it("supports CLI pause/status/resume and rejects invalid commands without changing state", async () => {
    const state = await setup();
    try {
      expect(
        await state.harness.behavior.runCli(["pause", "--json"]),
      ).toMatchObject({
        exitCode: 0,
        stdout: JSON.stringify({
          paused: true,
          heldCount: 0,
          runningCount: 1,
          drained: false,
        }),
      });
      expect(
        await state.harness.behavior.runCli(["resume", "--typo"]),
      ).toMatchObject({ exitCode: 1 });
      expect(await state.dispatch()).toMatchObject({ action: "wait" });
      expect(await state.harness.behavior.runCli(["status"])).toMatchObject({
        stdout: "Sends paused. 1 running threads. 0 sends held.",
      });
      expect(await state.harness.behavior.runCli(["resume"])).toMatchObject({
        exitCode: 0,
      });
      expect(await state.dispatch()).toEqual({ action: "proceed" });
    } finally {
      await state.harness.lifecycle.dispose();
    }
  });

  it("rejects malformed persisted state instead of silently enabling sends", async () => {
    const fake = createFakePluginHost({ pluginId: "lame-duck" });
    try {
      await fake.bb.storage.kv.set("paused", "true");
      await expect(plugin(fake.bb)).rejects.toThrow();
    } finally {
      await fake.harness.lifecycle.dispose();
    }
  });
});
