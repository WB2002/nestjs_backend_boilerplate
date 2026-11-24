---
name: orchestrator
description: 'Sequences discovery, UX, planner, builders, QA verifier, and independent reviewers/implementers for one intent. Does not implement or approve.'
disable-model-invocation: true
---

Invoke the `orchestrator` subagent via `invoke_subagent` with `TypeName: "orchestrator"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
