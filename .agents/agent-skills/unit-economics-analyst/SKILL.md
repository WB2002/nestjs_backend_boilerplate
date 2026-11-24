---
name: unit-economics-analyst
description: 'Models pricing hypotheses, cost of goods sold (COGS), margins, and unit economics scenarios. Report only.'
disable-model-invocation: true
---

Invoke the `unit-economics-analyst` subagent via `invoke_subagent` with `TypeName: "unit-economics-analyst"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
