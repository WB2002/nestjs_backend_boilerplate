---
name: frontend-engineer
description: "Use to implement approved UI tasks (TASK-NNN) from an approved intent/<slug>/plan.md and accepted experience.md using the project's frontend framework best practices. Do not use to design UX (use ui-ux-designer), implement backend services (use backend-engineer), or review your own diff (use ux-reviewer and code-reviewer)."
disable-model-invocation: true
---

Invoke the `frontend-engineer` subagent via `invoke_subagent` with `TypeName: "frontend-engineer"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
