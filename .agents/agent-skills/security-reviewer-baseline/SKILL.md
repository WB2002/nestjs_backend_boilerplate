---
name: security-reviewer-baseline
description: 'Review a diff or codebase for mandatory baseline application security controls against docs/threat-model.md, .cursor/policies/security.yaml, and OWASP Top 10. Required for Tier 2 (HIGH). Do not use for deep domain/infra/ops hardening (use security-reviewer-hardening) or applying fixes (use security-implementer). Report only.'
disable-model-invocation: true
---

Invoke the `security-reviewer-baseline` subagent via `invoke_subagent` with `TypeName: "security-reviewer-baseline"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
