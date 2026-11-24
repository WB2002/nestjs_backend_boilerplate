---
name: ux-reviewer
description: 'Review a draft experience, Figma design spec, or verified user-visible implementation against accepted product and UX contracts (UX-NNN). Use before human UX acceptance and after frontend verification. Do not use to research competitors (use ui-ux-researcher), design screens (use ui-ux-designer), or edit code. Report only.'
disable-model-invocation: true
---

Invoke the `ux-reviewer` subagent via `invoke_subagent` with `TypeName: "ux-reviewer"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
