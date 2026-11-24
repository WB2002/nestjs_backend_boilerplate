---
name: ui-ux-researcher
description: 'Use before /design-experience or UI design to research domain UI patterns, competitor interaction flows, and user UX praise/complaints from public reviews. Do not use for commercial market sizing (use market-opportunity-research), designing Figma screens (use ui-ux-designer), or reviewing implemented UI (use ux-reviewer). Report only.'
disable-model-invocation: true
---

Invoke the `ui-ux-researcher` subagent via `invoke_subagent` with `TypeName: "ui-ux-researcher"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
