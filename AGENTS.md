# Working on Tasks

Read [GUIDELINES.md](GUIDELINES.md) for project principles and [PLAN.md](PLAN.md) for scope, confirmed decisions, and milestone exit criteria. Read [spec/README.md](spec/README.md) for how the app works.

M0 is complete, but native lifecycle/recovery acceptance remains open for the replacement app. Follow [PLAN.md](PLAN.md)'s work order and gates. The owner is the only existing user: do not build permanent v1/v2 coexistence, compatibility facades or a strangler framework. Retain useful new-model work, reuse useful UI, and remove the legacy runtime/versioned production names at cutover. Keep only isolated migration support and preserve data/backups. Do not add browser mutations, broad ports or generic recovery frameworks because an older handoff says to continue. A generic “proceed” authorizes at most the next task or stage you have approved in PLAN.md; SQ readiness is not approval. Stop at its review checkpoint or any unresolved host/contract/tooling blocker.

[spec/](spec/README.md) is the one specification, in three layers: backend (data, commands, rules, safety), ecosystem (CLI, sharing, backup, migration) and client (desktop and web as one client; differences only in `spec/client/platforms.md`). Rules are table rows with a slug like `capture.open`; tests cite a rule by starting their title with `slug:`, and `scripts/check-spec-rules.mjs` (in `pnpm lint`) rejects duplicate or unknown slugs. When behavior changes, change its rule and the test that cites it together. The spec describes the target app; it doesn't authorize implementing its whole surface. Evidence, status and counts never go in the spec. Use disposable data and the commands in [README.md](README.md); record native-platform blockers rather than treating browser builds as desktop validation. [The refactor inventory](docs/evidence/refactor-inventory.md) maps audited assets and cutover dispositions. Dated reports live in [docs/evidence/](docs/evidence/README.md); retired v1 guides and reset/audit narratives are preserved in Git history, not current instructions.

## Android emulator

On Omarchy, run from the project root after `eval "$(mise env --shell bash)"`. Use Google's `android` CLI; `sdkmanager` and `avdmanager` are deprecated, and `sdkmanager --licenses` is unnecessary. Check the SDK with `android info`. One-time setup, if the packages are missing: `android sdk install emulator system-images/android-36/google_apis/x86_64`. Create an AVD if needed with `android emulator create medium_phone`, then check `android emulator list` and start it with `android emulator start medium_phone`.

Build and run the app on the emulator with `pnpm tauri android build --debug --apk -t x86_64`, then `android run --apks=src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`. Exercise the changed flow in a disposable workspace and inspect its output and recovery path. This validates the standard Android document picker only; it is not physical-device or third-party document-provider acceptance.

## Code quality

Use the `clean-code` skill when writing, refactoring, or reviewing code. Keep changes scoped, prefer simple concrete boundaries, and run its review checklist before declaring code work complete. After making changes, run `pnpm lint` and fix all errors.

Name by responsibility. Never add version-named files, identifiers, flags or env vars; `scripts/check-naming.mjs` enforces this. Files listed in [src/LEGACY.md](src/LEGACY.md) are being deleted at cutover: don't extend them or copy their patterns.

## Development tracking

Development tasks use pi-tasks with the `sq` backend. This is separate from the product's own task storage. Use `sq prime` when direct CLI guidance is needed. Store pi-tasks metadata under `pi_tasks`, for example `--merge-metadata '{"pi_tasks":{"taskType":"TYPE"}}'`.
