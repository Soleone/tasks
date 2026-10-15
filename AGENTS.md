# Working on Tasks

Read [PLAN.md](PLAN.md) for state, decisions and gates, [GUIDELINES.md](GUIDELINES.md) for product principles and [spec/README.md](spec/README.md) for how the app works.

## Scope

The owner is the only user. The app is moving completely to the new engine: no permanent coexistence, compatibility facades or adapter frameworks. Legacy code in `src/legacy/` ([src/LEGACY.md](src/LEGACY.md)) is deleted at cutover; don't extend it or copy its patterns. Only `src/migration/` reads schema 1.

A generic "proceed" authorizes at most the next approved stage or task in PLAN.md; SQ readiness is not approval. Stop at its checkpoint or at any unresolved host, contract or tooling blocker. Don't resume deferred work because an older handoff says to.

Use disposable data and the commands in [README.md](README.md). Never read, convert or select the owner's personal workspace without explicit permission. Browser checks are not desktop validation; record native blockers instead.

## Spec

[spec/](spec/README.md) has three layers: backend, ecosystem and client. Desktop and web are one client; their differences live only in `spec/client/platforms.md`. Each behavior is a table row with a slug like `capture.open`. Tests cite a rule by starting their title with `slug:`, and `scripts/check-spec-rules.mjs` rejects duplicate or unknown slugs. Change a rule and the tests that cite it together. The spec describes the target; it doesn't authorize building all of it. No status, evidence or counts in the spec.

Don't read `docs/evidence/` unless asked; it is frozen history.

## Code quality

Use the `clean-code` skill when writing, refactoring or reviewing code. Keep changes scoped, prefer simple concrete boundaries, and run its review checklist before declaring code work complete. Run `pnpm check`, `pnpm lint` and `pnpm test` and fix all errors.

Name by responsibility. Never add version-named files, identifiers, flags or env vars; `scripts/check-naming.mjs` enforces this. Stored format numbers and persisted names (cache tables, the local `taskdb-v2` folder) keep their names.

## Development tracking

Development tasks use pi-tasks with the `sq` backend, separate from the product's own task storage. Use `sq prime` for CLI guidance. Store pi-tasks metadata under `pi_tasks`, for example `--merge-metadata '{"pi_tasks":{"taskType":"TYPE"}}'`.
