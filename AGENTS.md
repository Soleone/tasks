# Working on Tasks

Read [GUIDELINES.md](GUIDELINES.md) for project principles and [PLAN.md](PLAN.md) for scope, confirmed decisions, and milestone exit criteria. Read [docs/usage-guide.md](docs/usage-guide.md) for the keyboard-first home-screen contract and UI focus behavior.

M0 is complete, but native lifecycle/recovery acceptance remains open for the replacement app. The 2026-10-04 clean-cut plan in [PLAN.md](PLAN.md) supersedes the open-ended feature sequence: fix cache growth, choose a native proof, trace one real update path, prove/dogfood the basic native loop, rehearse one-time migration, then consolidate into one default application. The owner is the only existing user: do not build permanent v1/v2 coexistence, compatibility facades or a strangler framework. Retain useful new-model work, reuse useful UI, and remove the legacy runtime/versioned production names at cutover. Keep only isolated migration support and preserve data/backups. Do not add browser mutations, broad ports or generic recovery frameworks because an older handoff says to continue. A generic “proceed” authorizes at most the next unblocked task. Stop at its review checkpoint or any unresolved host/contract/tooling blocker.

Root [spec/](spec/overview.md) currently describes implemented legacy behavior. [spec/v2/](spec/v2/overview.md) contains accepted targets; conformance records bounded evidence, not full native acceptance. This temporary split must become one current specification at cutover. Schema/protocol version numbers and historical evidence are not parallel product architectures. [ideas/](ideas/overview.md) preserves proposal reasoning. An accepted target does not authorize implementing its whole surface. Use disposable data and the commands in [README.md](README.md); record native-platform blockers rather than treating browser builds as desktop validation. [The reset inventory](docs/refactor-reset.md) explains the audit and queue reconciliation.

## Android emulator

On Omarchy, run from the project root after `eval "$(mise env --shell bash)"`. Use Google's `android` CLI; `sdkmanager` and `avdmanager` are deprecated, and `sdkmanager --licenses` is unnecessary. Check the SDK with `android info`. One-time setup, if the packages are missing: `android sdk install emulator system-images/android-36/google_apis/x86_64`. Create an AVD if needed with `android emulator create medium_phone`, then check `android emulator list` and start it with `android emulator start medium_phone`.

Build and run the app on the emulator with `pnpm tauri android build --debug --apk -t x86_64`, then `android run --apks=src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`. Exercise the changed flow in a disposable workspace and inspect its output and recovery path. This validates the standard Android document picker only; it is not physical-device or third-party document-provider acceptance.

## Code quality

Use the `clean-code` skill when writing, refactoring, or reviewing code. Keep changes scoped, prefer simple concrete boundaries, and run its review checklist before declaring code work complete. After making changes, run `pnpm lint` and fix all errors.

## Development tracking

Development tasks use pi-tasks with the `sq` backend. This is separate from the product's own task storage. Use `sq prime` when direct CLI guidance is needed. Store pi-tasks metadata under `pi_tasks`, for example `--merge-metadata '{"pi_tasks":{"taskType":"TYPE"}}'`.
