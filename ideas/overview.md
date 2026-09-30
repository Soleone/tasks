# Ideas and proposals

This directory contains aspirational designs and deferred roadmap material. It does not describe current behavior or create implementation commitments. For the implemented system, start at [the current specification](../spec/overview.md).

## V2 contract boundaries

Keep each proposal at the level of the contract it defines, and state each rule authoritatively in one place:

- **Data model:** canonical fields and their meanings belong in [TaskDB v2 data model](task-model-v2.md).
- **Domain behavior:** lifecycle rules and timestamp mutation semantics belong in [TaskDB v2 behavior](task-behavior-v2.md), independent of the calling client.
- **Actions and protocol:** the current command contract is in [mutations](../spec/mutations.md) and [protocol](../spec/protocol.md). Add v2 action details only when a command or externally visible operation changes.
- **UI and user experience:** current user-visible behavior is in [the UI specification](../spec/ui/overview.md). Keep proposed UI changes in ideas until the design is concrete.
- **Storage and synchronization:** implemented storage and platform behavior are in [storage](../spec/storage.md) and the [canonical workspace guide](../docs/canonical-workspace.md). The v2 Syncthing-specific proposal is in [sync and ordering](syncthing-sync-ordering.md).

The UI calls application actions; controllers route and adapt those calls but do not own domain rules. Node and Android adapters may differ internally, but should implement the same domain and action contracts unless a documented capability difference is intentional. Keep implementation architecture in development/architecture docs rather than treating controller internals as user-facing requirements.

## Current proposals

- [TaskDB v2 data model](task-model-v2.md): candidate manifest and task fields.
- [TaskDB v2 domain behavior](task-behavior-v2.md): lifecycle and timestamp rules.
- [Syncthing sync and ordering direction](syncthing-sync-ordering.md): workspace identity, local file observation, conflict risks, and sparse ordering.
- [TaskDB 2.0 pivot roadmap](taskdb-2.0-roadmap.md): the earlier multi-source-led plan, retained as historical context.
- [Combined-source v0 contract](multi-source-v0-contract.md): the broader design draft; implemented behavior is separated into the current [source specification](../spec/sources.md).
