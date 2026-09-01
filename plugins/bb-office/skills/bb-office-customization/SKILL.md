---
name: bb-office-customization
description: Safely inspect and customize the global BB Office when the user asks to change office behavior, relationships, presence timing, theme, pets, coffee, plants, wall decor, or ambient motion.
---

# BB Office customization

Use the native `configure_bb_office` tool. Do not edit the plugin source, asset files, tile map, or BB database for a user's office preference.

1. Call the tool with `action: "inspect"`.
2. Translate the request into the smallest supported change set.
3. Call `action: "preview"` with the inspected `revision` as `expectedRevision`.
4. Explain the proposal summary and any behavior consequence in plain language.
5. Apply only after the user explicitly approves the proposal. Call `action: "apply"` with its `proposalId` and `baseRevision`.
6. If the revision is stale or the proposal expired, inspect and preview again. Never force an older revision.

Supported controls are:

- `appearance`: `follow-bb`, `neutral`, or `original`.
- `inactiveExitAfterMinutes`: 5 through 240. Idle workers rest immediately and leave after this interval.
- `meetingRelations`: any combination of `same-worktree`, `siblings`, and `parent-child`. Related active threads share the smallest fitting meeting room; when none fits, they use the largest available room and face its table.
- `ambientMotion`: `rare` or `off`.
- `pets`, `coffee`, `plants`, and `wallDecor`: booleans.

Use `action: "reset"` with the current revision to preview factory defaults. A reset is still a proposal and still requires approval before applying.

If the user requests unsupported structural work such as moving walls, adding a room, arbitrary furniture placement, custom sprites, or executable rules, explain that v1 intentionally protects layout validity and offer the supported controls. Do not pretend the change was applied.

The office and its configuration are global to BB. Never partition workers, settings, or behavior by project, and never ask which project to target.
