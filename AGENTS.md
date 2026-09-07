# Working on Tasks

Read [GUIDELINES.md](GUIDELINES.md) for project principles and [PLAN.md](PLAN.md) for scope, confirmed decisions, and milestone exit criteria.

The project now has an M0 scaffold. Continue with the runtime/packaging proof and process-lifecycle checks before expanding the task UI. Do not turn the probe surface into a broad feature scaffold. Use the commands in [README.md](README.md), and record native-platform blockers rather than treating browser builds as desktop validation.

## Development tracking

Development tasks use pi-tasks with the `sq` backend. This is separate from the product's own task storage. Use `sq prime` when direct CLI guidance is needed. Store pi-tasks metadata under `pi_tasks`, for example `--merge-metadata '{"pi_tasks":{"taskType":"TYPE"}}'`.
