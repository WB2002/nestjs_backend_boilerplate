---
name: gtm-strategist
description: 'Investigates discovery channels, buyer procurement paths, the route to the first 10 customers, and acquisition experiments. Report only.'
disable-model-invocation: true
---

Invoke the `gtm-strategist` subagent via `invoke_subagent` with `TypeName: "gtm-strategist"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
