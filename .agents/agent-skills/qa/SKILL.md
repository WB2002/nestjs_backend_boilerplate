---
name: qa
description: 'Independently verifies a finished change and performs exploratory QA. Classifies changes as frontend, backend, or both, runs scripts/verify.sh and browser tests, and reports bugs in intent/<slug>/reports/qa-bug-report.md. Use after implementation, before reporting done. Do not use to fix code or edit tests. Report only.'
disable-model-invocation: true
---

Invoke the `qa` subagent via `invoke_subagent` with `TypeName: "qa"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
