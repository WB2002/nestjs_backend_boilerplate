---
name: devops
description: 'Use to author or update CI/CD pipelines, Dockerfiles, container builds, and release/rollback scripts, or to analyze backward and forward compatibility, report breaking changes, and prescribe exact release ordering. Do not use for cloud IaC provisioning (use infrastructure) or executing live production deployments without approval.'
disable-model-invocation: true
---

Invoke the `devops` subagent via `invoke_subagent` with `TypeName: "devops"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
