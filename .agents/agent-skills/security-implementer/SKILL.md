---
name: security-implementer
description: 'Use after human review of security-baseline-review.md or security-hardening-review.md to implement approved security findings (SEC-BASE-NNN, SEC-HARD-NNN) using industry-vetted security approaches. Do not use to review your own changes or apply live cloud infrastructure mutations.'
disable-model-invocation: true
---

Invoke the `security-implementer` subagent via `invoke_subagent` with `TypeName: "security-implementer"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
