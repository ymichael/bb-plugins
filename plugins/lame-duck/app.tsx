import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  type ExperimentalSidebarFooterDisclosureProps,
} from "@get-bb/plugin-sdk/app";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, RubberDuckIcon } from "@hugeicons/core-free-icons";
import type { lameDuckContract, LameDuckStatus } from "./contract.js";

const duckWallpaper = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MCIgaGVpZ2h0PSI1MiIgdmlld0JveD0iMCAwIDYwIDUyIiBmaWxsPSJub25lIiBjb2xvcj0iIzgwODA4MCI+PGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMiAxKSByb3RhdGUoLTEyIDEwIDEwKSBzY2FsZSguODMpIj48cGF0aCBkPSJNNC42MjcyNCA2QzUuMDcxMjggNC4yNzQ3NyA2LjYzNzM4IDMgOC41MDEyMiAzQzEwLjcxMDQgMyAxMi41MDEyIDQuNzkwODYgMTIuNTAxMiA3QzEyLjUwMTIgOC4xOTQ2OSAxMS45Nzc1IDkuMjY3MDYgMTEuMTQ3IDEwSDE2Ljk3ODVDMTguMzU2OCAxMCAxOS4wMDEyIDguODgwNzEgMTkuMDAxMiA3LjVDMjIuNTAxMiAxMSAyMS45NyAxNSAyMS45NyAxNUMyMS45NyAxOC41IDE4LjUwMTIgMjEgMTMuMDAxMiAyMUg4Ljk5MTk1QzUuOTU5NSAyMSAzLjUwMTIyIDE4LjUzNzYgMy41MDEyMiAxNS41QzMuNTAxMjIgMTMuMzEwNSA0Ljc3ODQzIDExLjQxOTggNi42MjcyNiAxMC41MzQ4QzUuOTYzOTggMTAuMTgyNCA1LjQxMTY2IDkuNjQ4OCA1LjAzNjM1IDlNNC42MjcyNCA2TDIuMDAxMjIgN0MyLjE5MTMxIDggMy4wNjQ0NSA5IDUuMDM2MzUgOU00LjYyNzI0IDZMNS4yMTQzNyA2Ljg1NDY0QzUuNjcyMzEgNy41MjEyMiA1LjU5Nzg5IDguNDE4MDEgNS4wMzYzNSA5IiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2Utd2lkdGg9IjEuNSI+PC9wYXRoPjxwYXRoIGQ9Ik0xMS4wMDEyIDE4SDEyLjUwMTJDMTQuNzEwNCAxOCAxNy41MDEyIDE1LjIwOTEgMTcuNTAxMiAxM0gxMS4wMDEyQzkuNjIwNTEgMTMgOC41MDEyMiAxNC4xMTkzIDguNTAxMjIgMTUuNUM4LjUwMTIyIDE2Ljg4MDcgOS42MjA1MSAxOCAxMS4wMDEyIDE4WiIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgc3Ryb2tlLXdpZHRoPSIxLjUiPjwvcGF0aD48cGF0aCBkPSJNOC4yNDkyNyA2LjI1SDguMzc0MjdNOC40OTkyNyA2LjI1QzguNDk5MjcgNi4xMTE5MyA4LjM4NzM0IDYgOC4yNDkyNyA2QzguMTExMiA2IDcuOTk5MjcgNi4xMTE5MyA3Ljk5OTI3IDYuMjVDNy45OTkyNyA2LjM4ODA3IDguMTExMiA2LjUgOC4yNDkyNyA2LjVDOC4zODczNCA2LjUgOC40OTkyNyA2LjM4ODA3IDguNDk5MjcgNi4yNVoiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS13aWR0aD0iMS41Ij48L3BhdGg+PC9nPjxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDMyIDI3KSByb3RhdGUoMTIgMTAgMTApIHNjYWxlKC44MykiPjxwYXRoIGQ9Ik00LjYyNzI0IDZDNS4wNzEyOCA0LjI3NDc3IDYuNjM3MzggMyA4LjUwMTIyIDNDMTAuNzEwNCAzIDEyLjUwMTIgNC43OTA4NiAxMi41MDEyIDdDMTIuNTAxMiA4LjE5NDY5IDExLjk3NzUgOS4yNjcwNiAxMS4xNDcgMTBIMTYuOTc4NUMxOC4zNTY4IDEwIDE5LjAwMTIgOC44ODA3MSAxOS4wMDEyIDcuNUMyMi41MDEyIDExIDIxLjk3IDE1IDIxLjk3IDE1QzIxLjk3IDE4LjUgMTguNTAxMiAyMSAxMy4wMDEyIDIxSDguOTkxOTVDNS45NTk1IDIxIDMuNTAxMjIgMTguNTM3NiAzLjUwMTIyIDE1LjVDMy41MDEyMiAxMy4zMTA1IDQuNzc4NDMgMTEuNDE5OCA2LjYyNzI2IDEwLjUzNDhDNS45NjM5OCAxMC4xODI0IDUuNDExNjYgOS42NDg4IDUuMDM2MzUgOU00LjYyNzI0IDZMMi4wMDEyMiA3QzIuMTkxMzEgOCAzLjA2NDQ1IDkgNS4wMzYzNSA5TTQuNjI3MjQgNkw1LjIxNDM3IDYuODU0NjRDNS42NzIzMSA3LjUyMTIyIDUuNTk3ODkgOC40MTgwMSA1LjAzNjM1IDkiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIHN0cm9rZS13aWR0aD0iMS41Ij48L3BhdGg+PHBhdGggZD0iTTExLjAwMTIgMThIMTIuNTAxMkMxNC43MTA0IDE4IDE3LjUwMTIgMTUuMjA5MSAxNy41MDEyIDEzSDExLjAwMTJDOS42MjA1MSAxMyA4LjUwMTIyIDE0LjExOTMgOC41MDEyMiAxNS41QzguNTAxMjIgMTYuODgwNyA5LjYyMDUxIDE4IDExLjAwMTIgMThaIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2Utd2lkdGg9IjEuNSI+PC9wYXRoPjxwYXRoIGQ9Ik04LjI0OTI3IDYuMjVIOC4zNzQyN004LjQ5OTI3IDYuMjVDOC40OTkyNyA2LjExMTkzIDguMzg3MzQgNiA4LjI0OTI3IDZDOC4xMTEyIDYgNy45OTkyNyA2LjExMTkzIDcuOTk5MjcgNi4yNUM3Ljk5OTI3IDYuMzg4MDcgOC4xMTEyIDYuNSA4LjI0OTI3IDYuNUM4LjM4NzM0IDYuNSA4LjQ5OTI3IDYuMzg4MDcgOC40OTkyNyA2LjI1WiIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLXdpZHRoPSIxLjUiPjwvcGF0aD48L2c+PC9zdmc+";

function DuckIcon({ className }: { className?: string }) {
  return (
    <HugeiconsIcon
      icon={RubberDuckIcon}
      size={16}
      strokeWidth={1.5}
      className={className}
      aria-hidden="true"
    />
  );
}

function LameDuckDisclosure({ dismiss }: ExperimentalSidebarFooterDisclosureProps) {
  const rpc = useRpc<typeof lameDuckContract>();
  const [status, setStatus] = useState<LameDuckStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const changing = useRef(false);

  const refresh = useCallback(() => {
    if (changing.current) return;
    const request = ++generation.current;
    void rpc.call("status").then(
      (view) => {
        if (request !== generation.current) return;
        setStatus(view);
        setError(null);
      },
      (cause: unknown) => {
        if (request === generation.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  }, [rpc]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [refresh]);
  useRealtime("status-changed", refresh);

  async function change(command: "pause" | "resume") {
    if (changing.current) return;
    changing.current = true;
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const view = await rpc.call(command);
      if (request === generation.current) setStatus(view);
    } catch (cause) {
      if (request === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      changing.current = false;
      if (request === generation.current) setBusy(false);
    }
  }

  const paused = status?.paused === true;
  const ready = paused && status?.drained === true;
  const modeLabel = status === null ? "Loading…" : ready ? "Ready to update" : paused ? "Sends paused" : "Sends enabled";
  const statusLabel = status === null ? "Checking status" : ready ? "All ducks accounted for" : paused ? "Getting ducks in a row" : "Smooth sailing";

  return (
    <div className="relative isolate overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ backgroundImage: `url("${duckWallpaper}")`, backgroundSize: "60px 52px", opacity: 0.12 }} />
      <div className="flex min-w-0 items-center gap-1 border-b border-sidebar-border px-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1 py-2.5">
          <h3 className="text-xs font-medium text-sidebar-foreground">Lame duck</h3>
        </div>
        <span role="status" aria-live="polite" className={`text-[11px] ${ready ? "text-destructive" : "text-muted-foreground"}`}>{modeLabel}</span>
        <button
          type="button"
          aria-label="Collapse Lame duck"
          onClick={dismiss}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={16}
            strokeWidth={1.5}
            className="size-4 shrink-0"
            aria-hidden="true"
          />
        </button>
      </div>
      <div className="p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div role="status" aria-live="polite" className="min-w-0 text-xs">
            <p className="font-medium text-sidebar-foreground">{statusLabel}</p>
            <p className="mt-0.5 text-muted-foreground">
              {status === null ? "Loading…" : <><span>{status.runningCount} active</span>{" · "}<span>{status.heldCount} {status.heldCount === 1 ? "send" : "sends"} held</span></>}
            </p>
          </div>
          <button
            type="button"
            disabled={busy || status === null}
            aria-label={paused ? "Resume queued work" : "Pause sends"}
            onClick={() => void change(paused ? "resume" : "pause")}
            className="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-transparent px-2 text-xs font-medium text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {busy ? (paused ? "Resuming…" : "Pausing…") : paused ? "Resume" : "Pause sends"}
          </button>
        </div>
        {error !== null && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: "lame-duck/duck", component: DuckIcon });
  app.experimental_sidebarFooter.register({
    kind: "disclosure",
    id: "lame-duck",
    label: "Lame duck",
    icon: "lame-duck/duck",
    component: LameDuckDisclosure,
  });
});
