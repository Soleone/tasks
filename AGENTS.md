# Working on Tasks

Read [GUIDELINES.md](GUIDELINES.md) for project principles and [PLAN.md](PLAN.md) for scope, confirmed decisions, and milestone exit criteria. Read [docs/usage-guide.md](docs/usage-guide.md) for the keyboard-first home-screen contract and UI focus behavior.

M0 is complete, but M1 native lifecycle/recovery acceptance remains open. The current priority is a spec-driven, single-directory TaskDB contract, not expansion of the opt-in multi-source controller. Root [spec/](spec/overview.md) describes implemented v1 behavior. [spec/v2/](spec/v2/overview.md) now contains accepted targets and declarative fixtures, not implemented/conformance claims; [ideas/](ideas/overview.md) preserves proposal reasoning. Implement only a bounded recoverable slice against those contracts on disposable data, with unsupported capabilities explicit. Follow the current gates in [PLAN.md](PLAN.md). Use the commands in [README.md](README.md), work on disposable data, and record native-platform blockers rather than treating browser builds as desktop validation.

## Android emulator

On Omarchy, run from the project root after `eval "$(mise env --shell bash)"`. Use Google's `android` CLI; `sdkmanager` and `avdmanager` are deprecated, and `sdkmanager --licenses` is unnecessary. Check the SDK with `android info`. One-time setup, if the packages are missing: `android sdk install emulator system-images/android-36/google_apis/x86_64`. Create an AVD if needed with `android emulator create medium_phone`, then check `android emulator list` and start it with `android emulator start medium_phone`.

Build and run the app on the emulator with `pnpm tauri android build --debug --apk -t x86_64`, then `android run --apks=src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`. Exercise the changed flow in a disposable workspace and inspect its output and recovery path. This validates the standard Android document picker only; it is not physical-device or third-party document-provider acceptance.

## Code quality

Use the `clean-code` skill when writing, refactoring, or reviewing code. Keep changes scoped, prefer simple concrete boundaries, and run its review checklist before declaring code work complete. After making changes, run `pnpm lint` and fix all errors.

## Development tracking

Development tasks use pi-tasks with the `sq` backend. This is separate from the product's own task storage. Use `sq prime` when direct CLI guidance is needed. Store pi-tasks metadata under `pi_tasks`, for example `--merge-metadata '{"pi_tasks":{"taskType":"TYPE"}}'`.
