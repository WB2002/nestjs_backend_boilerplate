---
name: market-problem-analyst
description: 'Researches target customer segments, jobs-to-be-done, pain points, workarounds, problem severity, and willingness to pay. Report only.'
disable-model-invocation: true
---

Invoke the `market-problem-analyst` subagent via `invoke_subagent` with `TypeName: "market-problem-analyst"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
