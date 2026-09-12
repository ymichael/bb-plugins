# Verification

`corepack pnpm exec turbo run typecheck test build --filter=bb-plugin-lame-duck`
passes with eight tests (five server and three frontend).

Coverage includes dispatch holds, durable pause state, drain and held-send
counts, resume rechecks, CLI validation, duck icon registration, automatic
status refresh, pause/resume controls, and recovery from an RPC failure.

The plugin was installed from this checkout and reloaded successfully. The
footer uses the registered RubberDuckIcon and a compact disclosure with duck
wallpaper, active/held counts, and pause/resume. Only the Ready to update label
uses the destructive color token; all other styling follows the host theme.

An earlier isolated-server check verified that a held message retained its ID
and contents across process restart, then dispatched after explicit resume.
An actual BB version upgrade was not tested. Restart does not auto-resume.

## SDK dependency

The plugin uses published `@get-bb/plugin-sdk@0.4.84` for the shared icon API.
