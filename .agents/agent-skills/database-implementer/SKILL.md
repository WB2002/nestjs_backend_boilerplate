---
name: database-implementer
description: 'Use after human approval of intent/<slug>/reports/database-review.md or an approved plan.md task to implement schema migrations, index optimizations, constraints, and query rewrites using expand-migrate-contract best practices. Do not use to review your own changes or run migrations against production databases.'
disable-model-invocation: true
---

Invoke the `database-implementer` subagent via `invoke_subagent` with `TypeName: "database-implementer"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
