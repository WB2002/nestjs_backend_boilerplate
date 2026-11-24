---
name: code-reviewer
description: 'Review a diff for structural, AI-specific, and operational debt. Find failures first. Report only.'
disable-model-invocation: true
---

Invoke the `code-reviewer` subagent via `invoke_subagent` with `TypeName: "code-reviewer"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
