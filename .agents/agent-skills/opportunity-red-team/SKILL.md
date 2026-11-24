---
name: opportunity-red-team
description: 'Independently attempts to disprove the market opportunity, challenge unverified assumptions, and stress-test failure conditions. Report only.'
disable-model-invocation: true
---

Invoke the `opportunity-red-team` subagent via `invoke_subagent` with `TypeName: "opportunity-red-team"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
