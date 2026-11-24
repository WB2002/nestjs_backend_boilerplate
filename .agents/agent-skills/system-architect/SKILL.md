---
name: system-architect
description: 'Use after spec.md (and architecture-gate.md for HIGH tier 2) is accepted to create the technical implementation plan in intent/<slug>/plan.md. Do not use to run the PASS/FAIL architecture gate (use /architecture-gate), write application code (use frontend-engineer or backend-engineer), or plan CRITICAL changes (human-owned).'
disable-model-invocation: true
---

Invoke the `system-architect` subagent via `invoke_subagent` with `TypeName: "system-architect"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
