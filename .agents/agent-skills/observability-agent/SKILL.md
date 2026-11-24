---
name: observability-agent
description: 'Use to implement or update structured logging, RED/business metrics, distributed tracing spans, alert definitions, and operational runbooks according to docs/observability.md and intent/<slug>/plan.md. Do not use for read-only production debugging (use debugger) or modifying core business logic.'
disable-model-invocation: true
---

Invoke the `observability` subagent via `invoke_subagent` with `TypeName: "observability"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
