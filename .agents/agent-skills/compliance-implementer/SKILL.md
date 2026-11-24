---
name: compliance-implementer
description: 'Use after human approval of intent/<slug>/reports/compliance-review.md to implement technical compliance controls (COMP-NNN) such as immutable audit logging, data retention/erasure jobs, DSAR export endpoints, field masking/encryption, and compliance runbooks. Do not use to audit compliance (use compliance-reviewer).'
disable-model-invocation: true
---

Invoke the `compliance-implementer` subagent via `invoke_subagent` with `TypeName: "compliance-implementer"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
