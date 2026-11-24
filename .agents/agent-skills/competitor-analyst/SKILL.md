---
name: competitor-analyst
description: 'Maps direct competitors, indirect alternatives, open-source tools, and status-quo inertia. Report only.'
disable-model-invocation: true
---

Invoke the `competitor-analyst` subagent via `invoke_subagent` with `TypeName: "competitor-analyst"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
