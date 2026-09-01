# BB plugins

Michael's BB plugins live in `plugins/`, with one independently releasable package per directory.

## Plugins

- [BB Office](plugins/bb-office) — a calm, living office overview of active BB threads.

## Development

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm test
corepack pnpm typecheck
bb plugin install path:. --plugin bb-office
```
