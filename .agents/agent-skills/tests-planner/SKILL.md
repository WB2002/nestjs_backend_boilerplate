---
name: tests-planner
description: 'Use before or after implementation to plan high-signal unit, integration, contract, and mutation/adversarial tests that mimic real production breakages and prioritize test quality over quantity. Also audits existing tests for tautological mocks. Do not use to write test code (use tests-writer). Report only.'
disable-model-invocation: true
---

Invoke the `tests-planner` subagent via `invoke_subagent` with `TypeName: "tests-planner"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
