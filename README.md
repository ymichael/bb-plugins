# BB plugins

Michael's BB plugins live in `plugins/`, with one independently releasable package per directory.

## Plugins

- [BB Office](plugins/bb-office) — a calm, living office overview of active BB threads.
- [Lame duck](plugins/lame-duck/PLUGIN_OVERVIEW.md) — pause sends, drain active threads, and resume queued work after maintenance.

## Development

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm test
corepack pnpm typecheck
bb plugin install path:. --plugin bb-office
```
