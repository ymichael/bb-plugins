---
name: lame-duck
description: Drain a busy BB server before an update or restart by queuing sends, then resume queued work after maintenance. Use the CLI when managing BB servers for the user.
---

# Lame duck

Use Lame duck when BB needs an update or restart but active threads, agents
messaging each other, and incoming follow-ups keep it busy. Lame-duck mode
queues sends while active turns finish, creating a drained state for server
maintenance. Queued work and the pause survive a restart.

## Agent-managed maintenance

1. Run `bb lame-duck pause` to enter lame-duck mode.
2. Poll `bb lame-duck status --json` until `drained` is true.
3. Update and restart the target BB server using its normal management commands.
4. Check server health, then run `bb lame-duck resume` to leave lame-duck mode
   and release queued work.

Run this workflow from outside the BB instance being drained. If you are a
thread inside that instance, you count as active: hand off polling, restart,
and resume to an external maintenance process and finish your turn. Do not
wait indefinitely for your own thread to disappear from the running count.

`drained` means sends are paused and `runningCount` is zero. Existing turns
continue until they finish or require input. Threads waiting for queued replies
may need attention to finish draining. Lame duck does not stop threads, answer
interactions, or perform the update itself.

Restart and plugin reload do not automatically resume work. Repeating `resume`
is safe; scheduled times, thread ordering, and other dispatch limits still apply.
Keep the plugin enabled: disabling lame-duck mode means `resume`, not uninstalling
or disabling the plugin.

## Manual maintenance

The user can click the duck in the sidebar footer, choose **Pause sends**, wait
for **Ready to update**, update/restart BB, then choose **Resume**. The disclosure
shows active-thread and held-send counts and updates automatically.

## Queue behavior

The pause is server-wide. New threads, follow-ups, steering, scheduled sends,
and retries wait in BB's durable queue. Explicit **Send now** overrides plugin
holds, so avoid it during maintenance. Sends can only reach this queue while
BB is online; the plugin does not provide an offline client outbox.

`heldCount` includes queue rows whose current wait owner is Lame duck; rows
waiting on another plugin or a core condition are excluded.
