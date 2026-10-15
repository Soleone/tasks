# Implementation evidence

Dated reports support specific implementation and platform claims. They are not current setup instructions, another task queue or permission to resume deferred work. [Current support](../support.md) owns live capabilities and blockers; [PLAN](../../PLAN.md) owns gates. Use [development](../development.md) and [usage](../usage-guide.md) for current guidance.

## Reports

| Subject | Retained evidence |
| --- | --- |
| Consolidation inventory | [Audited assets and dispositions](refactor-inventory.md); findings are pinned to its original audit, not a live workflow matrix |
| Cache growth | [Measurements and retained-authority checks](cache-growth.md) |
| Concrete update request | [Request trace](update-request-trace.md), [Windows rerun](update-request-proof.json) |
| Windows content update | [Original process report](windows-update-proof.json); [original narrative at the pre-cleanup revision](https://github.com/Soleone/tasks/blob/f762b50c8739b994629c68e4ab62a3a01142aaae/docs/development.md#windows-content-update-proof-fcf-2026-10-04) |
| Windows capture | [Historical journaled proof and pending simplified-route proof](windows-create-proof.md), [report](windows-create-proof.json) |
| Windows status/inverse | [Report](windows-status-proof.md), [scenes](windows-status-proof.json), retained [capture](windows-status-retained-create-proof.json) and [update](windows-status-retained-update-proof.json) |
| Windows copy | [Absent-destination proof](windows-copy-proof.md), [scenes](windows-copy-proof.json), retained [status](windows-copy-retained-status-proof.json), [capture](windows-copy-retained-create-proof.json) and [update](windows-copy-retained-update-proof.json) |
| Native launch preparation | [Argv proof](windows-launch-argv.md), [structured report](windows-launch-argv.json); not a window launch |
| Native basic loop | [Launch recipe and historical walkthrough](windows-native-pilot.md), [structured report](windows-native-pilot.json), [established-client restoration](restored-main-client.md) |
| Settings and Windows blocker | [Component checks and owner-deferred host observations](settings-and-windows-host.md) |
| Unattended UI QA | [Harness isolation and original regression boundary](unattended-qa.md) |
| Legacy Android SAF | [Historical read-performance record](android-saf-performance.md); not schema-2 integration |

JSON artifacts remain byte-identical. Embedded source paths, hashes, dates, test counts and old capability names identify what was actually exercised, not today's source layout or supported surface. Do not rewrite them to imply later acceptance. Earlier creation proofs do not validate the simplified native-rename route.

The [migration runbook](../migration-rehearsal.md) retains conversion/recovery evidence because it is still actionable. Linux/browser/process tests are not Windows, Android/provider, power-loss, owner-session or release acceptance.

## Retired documentation

Git retains obsolete v1 operational guides, old milestone instructions and superseded audits. They are not kept as parallel current documentation. To inspect the exact pre-cleanup text locally:

```bash
git show f762b50:docs/canonical-workspace.md
git show f762b50:docs/syncthing.md
git show f762b50:docs/taskdb-audit.md
git show f762b50:docs/refactor-reset.md
git show f762b50:docs/development.md
```

The still-active legacy receive UI links to the pinned historical Syncthing guide until runtime cutover. That exception preserves its existing help link; it does not make legacy receive supported on the replacement route. The temporary legacy specification remains until the approved sole-default cutover. Conversion support, independent backups and local recovery authority must survive it.
