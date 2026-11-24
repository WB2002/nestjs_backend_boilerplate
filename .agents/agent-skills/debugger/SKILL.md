---
name: debugger
description: 'Use to diagnose production or staging incidents, bugs, alerts, metric breaches, trace anomalies, or stack traces using the observability setup and codebase. Always read-only. Do not use to edit code (use /fix-bug or builder agents) or execute live production rollbacks. Report only.'
disable-model-invocation: true
---

Invoke the `debugger` subagent via `invoke_subagent` with `TypeName: "debugger"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
