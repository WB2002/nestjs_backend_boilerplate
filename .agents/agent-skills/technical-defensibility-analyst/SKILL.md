---
name: technical-defensibility-analyst
description: 'Evaluates technical feasibility, API dependencies, data access, compliance requirements, and architectural defensibility. Report only.'
disable-model-invocation: true
---

Invoke the `technical-defensibility-analyst` subagent via `invoke_subagent` with `TypeName: "technical-defensibility-analyst"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
