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

Development dependencies live in the workspace root. Keep each plugin package
limited to its runtime dependencies: BB installs a plugin directory with
`npm install --omit=dev`, and npm still resolves any development dependencies
listed in that directory, which can fail on unrelated tooling peer dependencies.
Run development commands from this workspace after `corepack pnpm install`.

The development tools are the BB SDK and CLI, TypeScript and Node/React types,
Turbo, and Vitest with jsdom and React Testing Library. React and React DOM
support local UI tests; BB supplies them when the plugin runs in the app.
