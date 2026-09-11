---
name: lame-duck
description: Pause BB sends, inspect whether running threads have drained, and resume queued work after server maintenance.
---

# Lame duck

Enable the Lame duck plugin, then use:

```sh
bb lame-duck pause
bb lame-duck status --json
bb lame-duck resume
```

Pause is global to this BB server and persists across server restarts. New
threads, follow-ups, steering, scheduled sends, and retries wait in BB's durable
message queue. Existing turns continue until they finish or require input.
Check `status` until `drained` is true (`paused` and zero `runningCount`) before
updating the server. A thread running this command counts too: finish its turn
before expecting the server to drain. Perform the update outside an agent turn.

After updating and checking server health, run `resume` once to release the
maintenance hold on all queued work. Repeating it is safe. Core rechecks queues
in order; scheduled times, per-thread ordering, and other plugin limits still
apply. Neither restart nor plugin reload automatically resumes work.

Click the Lame duck icon in the sidebar footer to open its disclosure with
pause, drain status, and resume controls. Click the footer icon again or the header chevron to
collapse it.
SDK clients can use the typed RPC contract in `contract.ts` with
`sdk.plugins.callRpc({ pluginId: "lame-duck", method: "status", input: null, outputSchema: lameDuckContract.status.output })`
(and the `pause` / `resume` methods).

Keep the plugin enabled throughout maintenance. Disabling or removing it removes
its dispatch hook. Explicit **Send now** on a queued row overrides plugin holds;
avoid it while draining. Messages can only be accepted while the server is
online; this plugin does not add an offline client outbox. It does not perform
server updates, stop threads, or answer interactions on their behalf.

`heldCount` counts durable queue rows whose current wait owner is Lame duck.
Messages currently owned by another plugin or a core wait are not included.
The disclosure refreshes on queue events and periodically while open.
