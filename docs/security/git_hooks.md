---
title: Git Hooks (Husky, ESLint, Prettier, Gitleaks)
directory: docs/security
task_type: security
created: 2026-08-21
---

# Git Hooks (Husky, ESLint, Prettier, Gitleaks)

Prevents accidental commits of secrets and unformatted or lint-failing code by running checks on every `git commit`.

---

## Vulnerability

Commits that land secrets in git history (API keys, tokens, private keys) or merge style/lint regressions are high severity for a shared boilerplate. Once secrets are in history they are hard to scrub and may already be cloned.

Severity: **High** for secret leakage; **Medium** for lint/format drift.

---

## Affected Area

| Path                                                      | Role                                        |
| --------------------------------------------------------- | ------------------------------------------- |
| `.husky/pre-commit`                                       | Hook entrypoint                             |
| `.lintstagedrc.json`                                      | Staged-file ESLint + Prettier               |
| `scripts/gitleaks-pre-commit.sh`                          | Secrets scan wrapper                        |
| `.gitleaks.toml`                                          | Allowlists for fixtures/placeholders        |
| `package.json` (`prepare`, `lint:staged`, `secrets:scan`) | Installs Husky; manual scripts              |
| `eslint.config.mjs`                                       | Flat ESLint + `eslint-config-prettier` last |

Packages: `husky`, `lint-staged`, `eslint-config-prettier` (devDependencies). Gitleaks is a host binary (Homebrew) or Docker image `zricethezav/gitleaks:latest`, not an npm dependency.

---

## Fix

1. Run `pnpm install` — the `prepare` script installs Husky git hooks.
2. Install Gitleaks for local commits:
   ```bash
   brew install gitleaks
   ```
   If Gitleaks is missing but Docker is available, the wrapper uses `zricethezav/gitleaks:latest`.
   When Docker cannot mount the repo (for example a macOS repo under `~/Documents`), the wrapper
   rsyncs a lightweight copy under `/tmp` and scans that mount instead.
3. On each commit, `.husky/pre-commit` runs:
   1. `pnpm exec lint-staged` — Prettier + `eslint --fix` on staged files only
   2. `./scripts/gitleaks-pre-commit.sh` — `gitleaks protect --staged --redact`

Manual equivalents:

```bash
pnpm run lint:staged
pnpm run secrets:scan
```

Do not use `git commit --no-verify` except in a documented emergency; it skips both lint and secrets scanning.

---

## Rationale

- **Staged-only lint** keeps commits fast and avoids reformatting the whole tree.
- **Gitleaks `protect --staged`** scans only the commit index, not full history.
- **Fail closed** when neither Gitleaks nor Docker is available — silent skip would defeat the control.
- **Allowlists** in `.gitleaks.toml` cover `.env.example` placeholders and `*.spec.ts` test tokens so legitimate fixtures do not block commits.
- **`eslint-config-prettier` last** turns off ESLint rules that conflict with Prettier while `eslint-plugin-prettier` still reports format issues.

---

## References

- [Husky](https://typicode.github.io/husky/)
- [lint-staged](https://github.com/lint-staged/lint-staged)
- [Gitleaks](https://github.com/gitleaks/gitleaks)
- [eslint-config-prettier](https://github.com/prettier/eslint-config-prettier)
