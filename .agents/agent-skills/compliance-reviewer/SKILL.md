---
name: compliance-reviewer
description: 'Use to review the project or an intent against applicable regulatory and compliance standards (GDPR, HIPAA, SOC 2, PCI-DSS, ISO 27001, CCPA, WCAG/EAA) and generate a report of required, covered, partially covered, and missing controls. Do not use to implement controls (use compliance-implementer). Report only.'
disable-model-invocation: true
---

Invoke the `compliance-reviewer` subagent via `invoke_subagent` with `TypeName: "compliance-reviewer"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
