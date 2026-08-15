# Agent Guide: Creating Markdown Files

This file instructs AI agents on how to create well-structured, consistent Markdown files for any task in this project. Follow all rules and the workflow below before producing output.

---

## File Naming

- Use lowercase letters and underscores only — no spaces, no camelCase.
- Name should reflect the content clearly.
- Examples: `new_feature.md`, `auth_flow.md`, `dependency_overrides.md`

---

## Directory Placement

Place each file in the directory that matches its content type:

| Directory                | Use for                                              |
| ------------------------ | ---------------------------------------------------- |
| `docs/project_structure` | Architecture, modules, file hierarchy                |
| `docs/features`          | Feature descriptions, endpoints, business logic      |
| `docs/code`              | Reusable code, patterns, snippets, best practices    |
| `docs/security`          | Vulnerabilities, dependency issues, fixes, rationale |
| `docs/prompts`           | AI instructions, prompt templates, agent workflows   |

If no directory fits, create one with a lowercase underscore name and document it here.

---

## Agent Workflow

Follow these steps in order before producing any Markdown output:

1. **Identify the task type** — feature, code, security, prompt, or structure.
2. **Locate the correct directory** using the table above.
3. **Read 1–2 existing files** in that directory (or a related one) to calibrate:
   - Section names and ordering
   - Level of detail
   - Formatting conventions (tables vs lists vs code blocks)
4. **Draft the file** using the structure rules below.
5. **Run the quality checklist** (see end of this file) before finalizing.

---

## File Structure

Every Markdown file must follow this base structure:

```markdown
---
title: <Title>
directory: docs/<subdirectory>
task_type: feature | code | security | prompt | structure
created: YYYY-MM-DD
---

# <Title>

Brief description of what this file covers and why it exists.

---

## <Section>

...content...
```

The frontmatter block is optional but recommended — it helps agents locate and cross-reference files quickly.

---

## Required Sections by Task Type

### Feature

- **Overview** — what the feature does and why
- **Endpoints** — method, path, request/response shape
- **Business Logic** — rules, edge cases, validations
- **Usage Example** — curl, code snippet, or sequence
- **Related Files** — links to relevant modules or docs

### Code

- **Purpose** — what problem this code solves
- **Snippet** — fenced code block with language tag
- **Usage** — how and where to apply it
- **Best Practices** — dos and don'ts
- **Related Files** — where this pattern is used in the project

### Security

- **Vulnerability** — what the issue is and its severity
- **Affected Area** — file paths, packages, or versions
- **Fix** — exact steps or patch applied
- **Rationale** — why this fix was chosen
- **References** — CVE links, advisories, or package changelogs

### Prompt / AI Instruction

- **Purpose** — what task this prompt handles
- **Instruction** — the directive given to the agent
- **Input Format** — what context or data the agent expects
- **Output Format** — what the agent should produce
- **Example** — a concrete before/after or sample run

### Project Structure

- **Overview** — what part of the architecture this covers
- **Directory Tree** — fenced block showing relevant paths
- **Module Responsibilities** — what each part owns
- **Dependencies** — internal and external relationships

---

## Formatting Rules

- Title: `# Title` — one per file, at the top (below frontmatter)
- Sections: `##` — no deeper than `###` unless the content is genuinely nested
- Code blocks: always include a language tag (` ```ts `, ` ```bash `, ` ```json `)
- Lists: use `-` for unordered, `1.` for ordered steps
- Tables: use for comparisons, mappings, or multi-column data
- Links: use relative paths for internal files — `[auth module](../features/auth.md)`
- Keep files **self-contained** — a reader should not need another file to understand this one

---

## Quality Checklist

Before producing output, verify:

- [ ] File is placed in the correct `docs/` subdirectory
- [ ] File name is lowercase with underscores
- [ ] All required sections for the task type are present
- [ ] At least one existing file in the same directory was referenced for style
- [ ] Code blocks have language tags
- [ ] No section is empty or placeholder-only
- [ ] Related files are linked where relevant
- [ ] Frontmatter is filled in (if used)
- [ ] Output is Markdown only — no meta-commentary or explanations outside the file content
