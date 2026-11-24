---
name: database-reviewer
description: 'Use when schemas, migrations, ORM models, or queries are added or modified to check against the database engine in use for anti-patterns, indexing gaps, lock contention, isolation bugs, and expand-migrate-contract compliance. Do not use to implement migrations or query fixes (use database-implementer). Report only.'
disable-model-invocation: true
---

Invoke the `database-reviewer` subagent via `invoke_subagent` with `TypeName: "database-reviewer"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
