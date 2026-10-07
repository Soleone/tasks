# Windows native launch argv proof (`3rp`)

## Result and supported invocation

The recorded package-script failure is reproduced on **actual Windows 10.0.26300, Node v24.19.0, pnpm 11.22.0**. The bare `pnpm dev:native` script-runner boundary doubles every Windows backslash before Node receives the six arguments. The launcher correctly refuses the resulting empty path components. Adding `--` also forwards an unwanted seventh argument; it is not a fix.

**Prefer direct Node**, which bypasses this package-runner boundary:

```powershell
node .\scripts\dev-native.mjs --v2-root $root --database $cache --local-profile $profile
```

These alternatives also preserved exact arguments in the preparation proof:

```powershell
pnpm exec node .\scripts\dev-native.mjs --v2-root $root --database $cache --local-profile $profile
pnpm --config.shell-emulator=true dev:native --v2-root $root --database $cache --local-profile $profile
```

The emulator flag applies to **that invocation only**. No global/project shell setting, package manager version, dependency or native capability changed. Do not strip/deduplicate backslashes, accept forward slashes, ignore a leading `--`, or otherwise repair the selection in the launcher. Original path identity and strict refusal stay required. The bare package-script route remains a known package-runner limitation on this declared host; this task fixes the invocation guidance, not pnpm itself.

## Actual evidence

[Machine-readable scene/argv/source evidence](windows-launch-argv.json) records:

- A minimal package with the same `dev:native` script first observed the exact incoming argv using the production parser/resolver: direct Node and `pnpm exec node` preserve it; bare package invocation doubles separators; adding `--` forwards it literally. Both plain and spaced paths were exercised. Cache remained absent and selected profiles empty.
- The reproducible [Windows checker](../scripts/check-native-launch-argv.mjs) then exercised the **actual production `dev-native.mjs` entry point** in **15 scenes**: plain paths, spaces, and Unicode/shell-significant characters, each through direct Node, pnpm exec, explicit emulator, bare script and script separator.
- **Nine successful preparations** preserve all six argv positions and exact physically resolved root/cache/profile. They construct the unchanged Windows/local/main capability in memory, including all eight sidecar positions and exact escaped absolute-anchor path validators. **Six expected refusals** stop malformed script-runner input; no fallback or repair occurs.
- A test-only module loader stops at the unique `ensure:sidecar` boundary, **after real NTFS/path/scope admission but before build, persisted overlay, Tauri, sidecar or any query**. Selected roots/profiles remain empty and caches absent. It adds no production flag or fault hook.
- Launcher, parser/resolver and frontend selection source hashes match this repository and the owned Windows proof checkout byte-for-byte. The owner's D: source copy/native session was not opened, changed or stopped.

This is **Windows launch-preparation/argv evidence**, not a new GUI launch, write/recovery proof, owner session, installer/signing or expanded platform acceptance. Prior direct-Node native launch evidence remains in [restored-main-client](restored-main-client.md). Selection still requires existing separate short local NTFS paths and explicit GUI confirmation before a backend/query starts.

## Reproduce safely

On a disposable actual Windows checkout with dependencies installed:

```powershell
node .\scripts\check-native-launch-argv.mjs
```

The checker creates fresh Windows temp directories and retains its report for inspection. It never starts Tauri/SEA or reads task data. Do not run it through WSL Node against mounted Windows files. An exit code alone is not proof: accepted scenes require the structured preparation marker and exact argv/selection/scope checks.

Accepted artifact: `C:\Users\soleone\AppData\Local\Temp\Tasks-argv-BJXzE8\argv-report.json`, with hash in the linked report. Logs: `/tmp/tasks-3rp-{argv-probe-fixed,shell-probe,real-launcher-proof-pass,windows-final,check,lint,full}.log`. Synthetic fixture/report directories are retained outside the product tree.

## Validation, failures and limits

- **39 focused native/client tests passed on actual Windows**, using injected client transports rather than a live webview. Three new checks refuse doubled leading/interior separators and any forwarded leading `--`, without silently normalizing paths. The same tests remain in full Linux regression.
- Full regression: **1,673 passed, two known skips, zero failures** (1,675 total). Types/lint pass. No product UI/writer/launcher implementation or capability changed; corpus stays 101/112.
- The first PowerShell observer stopped because pnpm's normal stderr script banner became a terminating error under `ErrorActionPreference=Stop`. The probe now captures that stream with a scoped preference; no failed run was counted as argument acceptance.
- The first actual-entry-point test fixture passed a Windows absolute path to Node's `--import`, which needs a `file://` URL on this host. Fixed only the test loader path. A subsequent expected-refusal assertion lost the message behind a huge data-URL stack in its bounded stderr tail; the report now removes data-URL lines before bounding diagnostics. Final accepted scenes use these corrected checks.
- An exploratory custom `cmd.exe` script-shell override returned exit 0 without the observer marker, so it was **not accepted or recommended**. The supported commands above were proven by exact output, not exit status alone.

No app/window was launched or attached, no personal root/cache selected, no owner session counted, and no canonical/state authority created. This does not change `hzv` or permit `dvs` cutover. The temporary native launcher remains removable at the clean cut.
