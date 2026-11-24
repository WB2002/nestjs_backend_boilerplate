---
name: infrastructure
description: 'Use to create or update declarative cloud and platform Infrastructure-as-Code (Terraform/OpenTofu, Pulumi, CloudFormation, Kubernetes manifests, Helm charts) from an approved plan.md and accepted architecture-gate.md. Do not use for CI/CD or release ordering (use devops) or applying live infrastructure changes.'
disable-model-invocation: true
---

Invoke the `infrastructure` subagent via `invoke_subagent` with `TypeName: "infrastructure"` to handle the user's request.

Pass the user's request, target paths/diff, and any relevant context in `Prompt`, then wait for the subagent to complete and present its result.
