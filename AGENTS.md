# Working on Tasks

Read [PLAN.md](PLAN.md) for what's next, [GUIDELINES.md](GUIDELINES.md) for product principles and [spec/README.md](spec/README.md) for how the app works. Skip `docs/evidence/`; it is frozen history.

Use disposable data. Never touch the owner's personal workspace; `pnpm dev:web:real` is theirs to run.

Before finishing, `pnpm check`, `pnpm lint`, `pnpm test` and `kit check` pass with no warnings. Delete what knip flags rather than ignoring it.

Take `ref` as a prop, not `forwardRef`: React 19.2 never refreshes `useEffectEvent` handlers inside `forwardRef` components, so their listeners see the first render forever.

Commits are Conventional Commits. Only `feat`, `fix` and `perf` reach the changelog and release notes, so word those for users.
