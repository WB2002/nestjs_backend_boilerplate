---
name: ui-ux-designer
description: 'Use after ui-ux-researcher or from an accepted intent.md to design UI screens, component hierarchies, design tokens, and interaction states in Figma (via Figma MCP) and intent/<slug>/reports/figma-design-spec.md. Do not use for UX competitor research (use ui-ux-researcher), writing frontend framework code (use frontend-engineer), or reviewing UX (use ux-reviewer).'
disable-model-invocation: true
---

Invoke the `ui-ux-designer` subagent via `invoke_subagent` with `TypeName: "ui-ux-designer"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
