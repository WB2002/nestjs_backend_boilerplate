---
name: security-reviewer-hardening
description: 'Use for Tier 2/CRITICAL features, pre-production audits, or domain-specific security reviews to generate a defense-in-depth hardening report across Application, Infrastructure, and Operations. Do not use for routine PR baseline checks (use security-reviewer-baseline) or implementing fixes (use security-implementer). Report only.'
disable-model-invocation: true
---

Invoke the `security-reviewer-hardening` subagent via `invoke_subagent` with `TypeName: "security-reviewer-hardening"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
