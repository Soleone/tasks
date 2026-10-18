# Working on Tasks

Read [PLAN.md](PLAN.md) for state, decisions and gates, [GUIDELINES.md](GUIDELINES.md) for product principles and [spec/README.md](spec/README.md) for how the app works.

## Scope

The owner is the only user. The old engine is deleted; don't bring back coexistence, compatibility facades or adapter frameworks. Only `src/migration/` reads schema 1, through the owner-only `pnpm migrate`.

A generic "proceed" authorizes at most the next approved stage or task in PLAN.md; SQ readiness is not approval. Stop at its checkpoint or at any unresolved host, contract or tooling blocker. Don't resume deferred work because an older handoff says to.

Use disposable data and the commands in [README.md](README.md). Never read, convert or select the owner's personal workspace without explicit permission. `pnpm dev:web:real` copies it, so only the owner runs that. Browser checks are not desktop validation; record native blockers instead.

## Spec

[spec/](spec/README.md) has three layers: backend, ecosystem and client. Desktop, Android and web are one client; their differences live only in `spec/client/platforms.md`. Each behavior is a table row with a slug like `capture.open`. Tests cite a rule by starting their title with `slug:`, and `scripts/check-spec-rules.mjs` rejects duplicate or unknown slugs. Change a rule and the tests that cite it together. The spec describes the target; it doesn't authorize building all of it. No status, evidence or counts in the spec.

Don't read `docs/evidence/` unless asked; it is frozen history.

## Code quality

Use the `clean-code` skill when writing, refactoring or reviewing code. Keep changes scoped, prefer simple concrete boundaries, and run its review checklist before declaring code work complete. Run `pnpm check`, `pnpm lint`, `pnpm test` and `kit check` and fix all errors. `pnpm lint` includes knip: an unused file, export or dependency is a finding, so delete it rather than ignore it.

`pnpm check` stays free of warnings, including the React hook rules. Take `ref` as a prop instead of wrapping components in `forwardRef`: React 19.2 never refreshes `useEffectEvent` handlers inside `forwardRef` components, so their listeners see the first render forever.

Name by responsibility. Never add version-named files, identifiers, flags or env vars; `scripts/check-naming.mjs` enforces this. Stored format numbers and persisted names (cache tables, the local `taskdb-v2` folder) keep their names.

Crash tests inject faults by matching source or bundle text (`registerHooks` loaders). When a refactor or formatting change moves such a line, update the needle in the same change and keep it whitespace-tolerant.

## UI

The project follows the `web` template of `kit` (`.kit.json` records the revision; `kit upgrade` lists what changed since).

- shadcn on Base UI (`base-nova`). App code uses `src/components/ui`; direct `@base-ui/react` imports are lint errors.
- `src/components/ui` and `src/components/soleone` are vendored and stay upstream (with configured import aliases), so registry updates can replace them. Don't patch them locally; `kit check` fails when they drift. Shared components may own raw primitives internally; app code uses their high-level exports. Theme configuration lives in `src/theme/config.ts`; see [docs/themes.md](docs/themes.md).
- Style through tokens and component props, never raw colors, arbitrary values or className overrides on primitives. The lint rules in `vite.config.ts` enforce this.
- A look the stock variants don't have is a wrapper in `src/components/variants/` (for example `ToggleButton` around `Button`), named for its job and with a one-line reason. That folder is the only place allowed to restyle primitives or import `class-variance-authority`. Behavior that isn't styling, such as the palette search scorer in `components/commandFilter.ts`, lives outside both folders.

## Development tracking

Development tasks use pi-tasks with the `sq` backend, separate from the product's own task storage. Use `sq prime` for CLI guidance. Store pi-tasks metadata under `pi_tasks`, for example `--merge-metadata '{"pi_tasks":{"taskType":"TYPE"}}'`.
