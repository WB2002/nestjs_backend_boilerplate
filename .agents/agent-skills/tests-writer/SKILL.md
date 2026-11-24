---
name: tests-writer
description: 'Use after tests-planner or from an approved plan.md to implement deterministic unit, integration, contract, and mutation-killing tests (TST-NNN) following TDD and industry best practices. Do not use to plan test strategy (use tests-planner) or modify production application source code.'
disable-model-invocation: true
---

Invoke the `tests-writer` subagent via `invoke_subagent` with `TypeName: "tests-writer"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
