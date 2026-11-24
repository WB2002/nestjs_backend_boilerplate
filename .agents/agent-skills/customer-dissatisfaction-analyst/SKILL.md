---
name: customer-dissatisfaction-analyst
description: 'Researches public reviews, forums, issue trackers, and communities for recurring customer frustrations and unmet needs. Report only.'
disable-model-invocation: true
---

Invoke the `customer-dissatisfaction-analyst` subagent via `invoke_subagent` with `TypeName: "customer-dissatisfaction-analyst"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
