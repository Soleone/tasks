# Disposable Windows native task pilot (`m1p`)

This is actual Windows 11 / WebView2 evidence for the bounded replacement loop, not release or owner dogfood acceptance. It reuses the existing reader/editor UI and the existing embedded Node SEA. Default `pnpm dev:tauri` still starts v1. The temporary launcher/config and versioned application routing must be removed in `dvs`.

## Quickstart: Windows PowerShell

Use an isolated Windows checkout with the [native prerequisites](development.md#selected-windows-native-route-dh1-2026-10-04). Never use personal data for this pilot.

```powershell
pnpm install --frozen-lockfile
$pilot = Join-Path $env:TEMP ('Tasks-native-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory $pilot | Out-Null
Copy-Item -Recurse scripts\fixtures\taskdb-v2\root (Join-Path $pilot 'r')
New-Item -ItemType Directory (Join-Path $pilot 'p') | Out-Null
$root = Join-Path $pilot 'r'
$cache = Join-Path $pilot 'c.db'
$profile = Join-Path $pilot 'p'
pnpm dev:native --v2-root $root --database $cache --local-profile $profile
```

Only these six launcher arguments, in this order, are accepted. Root and profile directories and the cache parent must already exist. The launcher resolves physical paths, refuses overlapping scopes, requires fixed local NTFS, rejects device/UNC/relative/ambiguous paths, and checks complete SQLite cache and lock-journal paths against the short-path proof boundary. It does not shorten paths or discover another root.

The window shows all three resolved paths. Confirm them explicitly before any sidecar or backend query. The frontend uses the dedicated `127.0.0.1:5178` development origin with strict-port refusal, not an HTTP backend. Each launch has isolated disposable WebView storage. `.tmp` and `src-tauri` are excluded from frontend watching because Windows executable file locks can otherwise crash Vite.

One inline Windows-only, local-only, `main` capability is selected explicitly, outside capability discovery. There is one sidecar scope, not a second same-name default scope. No execute/open/system-Node permission is granted. The client reconstructs exactly:

```text
--stdio --v2-root ROOT --database CACHE --windows-task-proof --local-profile PROFILE
```

The shell plugin ignores extra caller arguments and substitutes fixed scope entries. Therefore its scope alone is not an argument-count validator. The launcher/client construct the exact eight-position array; variable positions use absolute Rust regex anchors and escaped exact paths. Actual IPC refused legacy `--stdio`, another selected root, arbitrary `node`, and ungranted shell execution.

## Walkthrough and observed result

On the confirmed folder:

1. Listbox autofocus; arrows/J/K navigate. Press **C**, enter a literal title, Markdown description, category and tags, then **Preview changes**. Preview consumed no receipt/history and changed no canonical bytes. Apply is a separate explicit action.
2. Capture selected and focused the new row. **Enter** opened content editing with title autofocus. Changing only its title preserved description/classification/priority/graph fields.
3. **T** opened status actions. Complete and eligible latest-local-status undo previewed/applied through the same SEA session. Undo restored open status and exact null closure without changing content edit time.
4. Mouse toolbar controls worked too. Parent controls and **M** were unavailable. Latest-status undo after an intervening content edit refused during preview with `UNDO_UNAVAILABLE`, no apply/retry-original action and no effect.
5. Literal search and external Windows SEA editing refreshed the visible list without restarting the app or sidecar. An unsubmitted search draft and search focus survived the refresh. Use a verified CLI copy **outside `src-tauri/binaries`**, which Tauri's native development watcher watches.
6. Leaving the folder killed the shared child. Actual native `WM_CLOSE` with a running reader also left zero sidecars. Relaunch required confirmation again and preserved task bytes, local receipts/history and authority.
7. Existing Windows CLI archive/restore controls produced two separate absent destinations with exact source bytes. Source selection/bytes stayed unchanged. Restored root authority was fresh, with zero imported receipts/operations; old source authority refused. Historical copy retries acknowledged the same result.

Actual window sizes: 1100×760 and native-owned-HWND 720×500 logical pixels at 200% DPI. No horizontal overflow; the minimum-size editor fitted the viewport and scrolled vertically, with title autofocus. One bounded screenshot review retained existing components/tokens. Native axe 4.12.1: zero violations/incomplete checks. Design detector: no findings.

## Declared native lost-reply cut

On the disposable debug target only, a separately built fault SEA changed the unique `executeV2Update` retirement statement to:

```js
if (retire) { retireV2Pending(root); process.exit(87); }
```

The cut is **after actual canonical replacement, receipt/history commit and intent retirement, before the stdio reply**. It is not a before-effect simulation. Historical replay does not take the cut. No production fault hook, extra runtime argument or alternate writer was added.

Two native content changes ran through this cut. The actual window reported exit 87, retained the original request and disabled edits. The reader could start another child with the same frozen paths; this did not retry the mutation or perform recovery. **Retry same request** returned the retained result without another effect/history entry. The second scene's complete original envelope was preserved from the readonly **Original protocol-2 envelope** textarea, not reconstructed from refreshed data. The normal Windows SEA replayed it twice with unchanged counts: **10 receipts, 8 meaningful operations** for the entire walkthrough. All four original task files and the original descriptor remained byte-exact throughout.

Harness corrections are not product passes: an early CLI source-binary execution triggered Tauri rebuild; Vite subsequently crashed watching a scratch `.exe` with `EBUSY`; both were diagnosed before repeating acceptance. Early waits used the wrong uncertainty heading. A first diagnostic read the path-summary `<pre>` rather than the full envelope, and a helper initially assumed its own correlation ID. The accepted replay uses the complete actual original envelope and its original correlation ID.

## Limits and friction

- Every mutation requires preview then apply. Slugs are separate fields, not shorthand. Details display raw Markdown. These are deliberate pilot affordances to review in `hzv`, not approved final daily-use choices.
- Executing failures retain the original request even when a refusal may be definite. Do not renew key/context/version/payload/actor/flags from current task data to make a retry succeed.
- Prepared requests and drafts are **memory-only**. Reload, native close, crash or dev reload can lose them. `beforeunload` is best-effort, not durable/native-close protection. Preserve the full envelope and root/cache/profile before manual reconciliation. Cold relaunch does not recover a lost UI request automatically.
- Pending work requires explicit CLI `workspace.recovery.resume`; the app does not expose recovery controls or automatically execute them. This cut proved committed lost reply, not every native pending-intent scene.
- The backend advertises the same proven 18-command Windows profile; app editing exposes only capture/content/six statuses/eligible status undo. Parent/dependency/order/batches/grouped inverses, migration/init/doctor/purge, Android/providers/network storage, long paths, power loss, hostile races, signing/installer/release and personal selection remain unaccepted.

## Evidence and validation

[Machine-readable report](windows-native-pilot.json). Source was transferred as an explicit dirty snapshot to a fresh isolated Windows checkout and verified; it was not represented as a synchronized owner checkout. The Windows and Linux backend bundles are **byte-identical** to the accepted `gxm` bundle: 514,246 bytes, SHA-256 `537687cb288209ff2c30164d2f8f2a720ce5c9d8c586c6e90c9da67cccce5f12`. The prior [182 copy + 156 status + 64 capture + 38 update groups](windows-copy-proof.md) remain backend evidence, separate from this native proof.

Final checks: `pnpm check`, `pnpm lint`, `pnpm test` (**1,657 passed / two known skips / zero failures**, 1,659 total), backend bundle and actual Windows native launch; 31 focused native tests passed on both hosts. Existing browser client behavior remains covered by regression, not expanded browser mutation work.

Next is **owner `hzv`**: at least three short realistic disposable native sessions across two days, then an agreed keep/replace/drop workflow checklist. Automated native interaction is not that human acceptance.
