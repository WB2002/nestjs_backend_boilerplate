---
name: teacher
description: "Use when the user asks for an explanation of how part of the codebase works, how features relate, how data flows end-to-end, or what a feature's requirements (intent, experience, spec) mean. Do not use to modify code or create multi-session HTML courses (use /teach for HTML lesson workspaces). Report only."
disable-model-invocation: true
---

Invoke the `teacher` subagent via `invoke_subagent` with `TypeName: "teacher"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
