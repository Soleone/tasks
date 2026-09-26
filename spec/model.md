# Task model and ownership

## Current v1 task

A task has a stable ID, nonempty title, Markdown description, status, priority, optional parent, dependency IDs, created/updated and completion/cancellation timestamps. The command response additionally has a local optimistic `version`, derived `category` and `tags`, and derived `blockedByIds`. See `TaskRecord` in `src/backend/protocol.ts`. The canonical task file is a different shape; see [storage](storage-v1.md).

| Field | Current behavior |
| --- | --- |
| `status` | `open`, `in_progress`, `paused`, `done`, or `canceled`. `task.delete` means cancel; permanent cleanup is a separate purge. |
| `priority` | P0 through P4; P0 is highest and new tasks default to P2. |
| `@category` | At most one in the **title**; derived from task text rather than stored as a separate project object. |
| `#tag` | Zero or more title-derived tags. Slugs are case-folded; display labels retain entered spelling. |
| `parentId` / `dependencyIds` | Same-workspace relationships; cycles are rejected. A canceled dependency stays linked but stops blocking. |
| Sibling order | Each parent scope, including root, has its own durable order. New tasks are first in their sibling scope. |
| `version` | Local optimistic token. It changes on real mutations and may be invalidated when a cache is rebuilt or restored; it is **not** the canonical file revision or hash. |

Classification skips code spans/fences and rejects more than one distinct `@category`. Changes to a title recalculate the category and tags. A repeated status transition to the same status is a no-op, not a new task version; `task.reopen` targets `open`. The exact allowed transition matrix is currently enforced in `src/backend/tasks.ts` and must be pinned by conformance cases before declaring a platform-neutral v0 contract.

The `@category` slug is sufficient as the initial project/scope dimension. It is not a separate project with membership, permissions, metadata or a namespace. pi-tasks' project-to-category mapping is a client adapter policy, not a second canonical classification rule. Do not elevate its normalized `closed` status into this model: TaskDB distinguishes `done` from `canceled`.

## 2.0 target: source-scoped references

A **source** is a configured connection to one authority: a TaskDB v1 workspace, one project-local store, or a writable external task collection. A source's stable local key and the task ID supplied by that source together identify an item **in the combined client**. Neither the key nor external IDs have to be written into canonical v1 task files. A v1 workspace already stores a `workspaceId` in its own records. Detect mounting the same workspace twice rather than displaying duplicates. The frozen `TaskRef` shape and source-key rules are defined in the [combined-source v0 contract](contract-v0.md); they are not a deployed format.

```text
Combined task reference: (source key, source task ID)
Owner of a mutation:      exactly that source's adapter
Existing v1 file identity: workspaceId + task ID, unchanged
```

The local source registry is client/controller configuration, not another task authority. A normalized response is a **projection**; storing it as a cache does not transfer ownership or make it a bidirectional mirror. Per-source capabilities state which advanced relationships, order and transitions the source supports. Relationships and manual order remain within one source until there is a separate, tested cross-source design.

A new task uses a configured default destination unless the person/agent explicitly overrides it. A task's origin can be inspected in details, not on every list row. Existing-task mutations always route to its source. A separate transfer operation, added after a writable adapter pilot, must create and verify the destination task, account for unrepresentable fields, and only then remove the origin with recovery for partial failure. Changing a source reference by itself does not move data.

## 2.0 target: combined category views

Category names are **not** prefixed with source keys. Two sources with `@planning` contribute to the same category filter. This is a query across authorities, not a new parent/list object.

| Category choice | Result |
| --- | --- |
| **All** | Tasks from every configured source, regardless of whether they have a category. Other filters, such as status or search, can still apply. |
| **`@planning`** | Only tasks whose derived/projected category slug is `planning`, from any configured source. |
| **Uncategorized** | Only tasks with no category, from any configured source. This is a virtual filter, not a stored `@uncategorized` token or a reserved category slug. |

Today the v1 `task.list` command accepts a category slug and no category argument means no category constraint. It has **no distinct Uncategorized query** yet. The combined-query shape, cross-source sorting, pagination and freshness rules must be specified and tested in Stage 2. The ordinary UI need not show a source filter by default; one can be added to a Sources view after use justifies it.
