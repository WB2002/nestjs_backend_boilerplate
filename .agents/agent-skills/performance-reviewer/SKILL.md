---
name: performance-reviewer
description: 'Review a diff or codebase module against docs/nfr.md for memory leaks, DB connection pool exhaustion, excessive I/O, N+1 queries, blocking operations, and latency/SLO breaches. Do not use to implement optimizations (use performance-implementer). Report only.'
disable-model-invocation: true
---

Invoke the `performance-reviewer` subagent via `invoke_subagent` with `TypeName: "performance-reviewer"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
