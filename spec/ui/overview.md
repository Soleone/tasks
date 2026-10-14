# First-party UI overview

This describes the current Tasks desktop/web interface. It is a product behavior contract, not a requirement for CLI or third-party clients. Practical setup and shortcut help remain in the [usage guide](../../docs/usage-guide.md).

## Interaction principles

- The saved-task list is the home screen. The product is keyboard-first, but every action also has an accessible mouse path.
- Keep the surface calm: use progressive disclosure, compact toolbars, menus, and details rather than duplicating controls on every row.
- A task is selected and edited from the list; there is no separate dashboard or required workspace-switching flow.
- Refreshes preserve focus, selection where possible, and unsaved editor content.
- Dialogs return focus to the surface that opened them. Shortcuts are disabled while typing in inputs or while a modal editor owns focus.

## Current UI boundary

Legacy-only source-registry boundary: the default first-party UI uses the single-workspace command path and does not carry source refs through selection/writes; the opt-in Node registry is not supported there. [Sources](../sources.md) describes that legacy implementation. The retained main-client interaction contract also applies to the explicitly selected replacement route, whose available subset is recorded in [current support](../../docs/support.md).

For list navigation and filters see [Home list](home-list.md). For capture and editing see [Capture and edit](capture-edit.md). The usage guide includes the complete current shortcut table and testing guidance.
