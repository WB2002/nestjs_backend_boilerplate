---
name: backend-engineer
description: 'Use to implement approved server, domain logic, data access, and API tasks (TASK-NNN) from an approved intent/<slug>/plan.md following framework best practices. Do not use for frontend UI (use frontend-engineer), IaC (use infrastructure), CI/CD (use devops), or reviewing your own diff.'
disable-model-invocation: true
---

Invoke the `backend-engineer` subagent via `invoke_subagent` with `TypeName: "backend-engineer"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
