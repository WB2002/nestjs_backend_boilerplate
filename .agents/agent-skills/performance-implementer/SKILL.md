---
name: performance-implementer
description: 'Use after human approval of intent/<slug>/reports/performance-review.md to implement specific performance optimizations (PERF-NNN) such as fixing memory leaks, releasing DB connections, batching I/O, or eliminating N+1 queries. Do not use for auditing performance (use performance-reviewer) or changing functional product behavior.'
disable-model-invocation: true
---

Invoke the `performance-implementer` subagent via `invoke_subagent` with `TypeName: "performance-implementer"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
