# Quality Toolchain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship script-first `pnpm quality:*` commands and parallel GitHub Actions jobs that hard-gate PRs on lint, types, unit/integration tests, property/contract/mutation checks, supply-chain (pnpm audit + Trivy), and CodeQL—plus optional AI review docs/workflow.

**Architecture:** Each CI job calls one npm script; shell helpers under `scripts/ci/` implement changed-file mutation scope, audit, and Trivy. Extended tests live under `test/type`, `test/property`, and `test/contracts` with dedicated Jest configs where needed. Contract tests reuse slim Nest bootstrap patterns from `health.ready.http.spec.ts`.

**Tech Stack:** NestJS 12, Jest 30, pnpm 10, Node 24.18, tsd, fast-check, Stryker + jest-runner, AJV, @graphql-inspector/cli, GitHub Actions, Aqua Trivy, CodeQL.

## Global Constraints

- **Runtime:** Node **24.18.0** (`.nvmrc`); package manager **pnpm** only.
- **Imports:** Top of file only (no inline imports).
- **Switch exhaustiveness:** `never` in default cases for enums/unions.
- **CI scripts:** `set -euo pipefail` in all `scripts/ci/*.sh`.
- **Spec:** `intent/quality-toolchain/spec.md` is authoritative for scope.

---

## File map

| Responsibility  | Create                                                                                                                                                                                                                                                                                              | Modify                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| CI scripts      | `scripts/ci/changed-ts-files.sh`, `run-pnpm-audit.sh`, `run-trivy.sh`, `run-gitleaks-ci.sh`, `run-mutation.sh`, `merge-graphql-sdl.sh`                                                                                                                                                              | —                           |
| Quality scripts | —                                                                                                                                                                                                                                                                                                   | `package.json`              |
| GHA             | `.github/workflows/quality.yml`, `codeql.yml`, `ai-review.yml`                                                                                                                                                                                                                                      | —                           |
| Dependabot      | `.github/dependabot.yml`                                                                                                                                                                                                                                                                            | —                           |
| Type tests      | `test/type/overload-utilization.test-d.ts`, `tsd.json`                                                                                                                                                                                                                                              | —                           |
| Property tests  | `test/property/compute-inbound-utilization.property.spec.ts`, `jest.property.config.ts`                                                                                                                                                                                                             | —                           |
| Contract tests  | `test/contracts/rest/health-ready.contract.spec.ts`, `test/contracts/rest/schemas/health-ready.schema.json`, `test/contracts/graphql/schema.snapshot.graphql`, `test/contracts/graphql/schema-drift.spec.ts`, `test/contracts/graphql/categories-query.contract.spec.ts`, `jest.contract.config.ts` | —                           |
| Mutation        | `stryker.config.mjs`                                                                                                                                                                                                                                                                                | —                           |
| Hooks           | `.husky/pre-push`                                                                                                                                                                                                                                                                                   | —                           |
| Docs            | `docs/quality/README.md`                                                                                                                                                                                                                                                                            | `docs/features/features.md` |

---

### Task 1: Supply-chain and changed-files CI scripts

**Files:**

- Create: `scripts/ci/changed-ts-files.sh`
- Create: `scripts/ci/run-pnpm-audit.sh`
- Create: `scripts/ci/run-trivy.sh`
- Modify: `package.json`

**Interfaces:**

- Produces: `scripts/ci/changed-ts-files.sh` prints one TS path per line (stdout) for files under `src/` eligible for mutation.
- Produces: `pnpm quality:supply-chain` exits non-zero on high/critical audit or Trivy findings.

- [ ] **Step 1: Create `scripts/ci/changed-ts-files.sh`**

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

git diff --name-only --diff-filter=ACMRT "${MERGE_BASE}...HEAD" -- 'src/**/*.ts' \
  | while IFS= read -r file; do
      case "${file}" in
        *.spec.ts|*.integration.spec.ts|*.module.ts|src/main.ts|src/instrumentation.ts|src/graphql.ts)
          continue
          ;;
        src/*.ts)
          printf '%s\n' "${file}"
          ;;
      esac
    done
```

- [ ] **Step 2: Make executable**

Run: `chmod +x scripts/ci/changed-ts-files.sh scripts/ci/run-pnpm-audit.sh scripts/ci/run-trivy.sh`

- [ ] **Step 3: Create `scripts/ci/run-pnpm-audit.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

# pnpm audit exits 1 when vulnerabilities match --audit-level
pnpm audit --audit-level=high
```

- [ ] **Step 4: Create `scripts/ci/run-trivy.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

if command -v trivy >/dev/null 2>&1; then
  exec trivy fs --scanners vuln --severity HIGH,CRITICAL --exit-code 1 "${ROOT_DIR}"
fi

if command -v docker >/dev/null 2>&1; then
  exec docker run --rm \
    -v "${ROOT_DIR}:/repo" \
    aquasec/trivy:latest \
    fs --scanners vuln --severity HIGH,CRITICAL --exit-code 1 /repo
fi

echo "trivy: install trivy CLI or Docker to run locally" >&2
exit 1
```

- [ ] **Step 5: Add initial quality scripts to `package.json`**

In `"scripts"`, add (keep existing scripts):

```json
"quality:lint": "eslint \"{src,apps,libs}/**/*.ts\"",
"quality:types": "tsc -p tsconfig.json --noEmit",
"quality:unit": "pnpm test:unit",
"quality:integration": "pnpm test:integration",
"quality:supply-chain": "pnpm install --frozen-lockfile && ./scripts/ci/run-pnpm-audit.sh && ./scripts/ci/run-trivy.sh",
"quality": "pnpm quality:lint && pnpm quality:types && pnpm quality:unit && pnpm quality:integration && pnpm quality:supply-chain"
```

(Additional `quality:*` scripts added in later tasks; extend `quality` meta-script in Task 8.)

- [ ] **Step 6: Verify audit script**

Run: `pnpm quality:supply-chain`  
Expected: PASS if lockfile clean and no HIGH/CRITICAL audit/Trivy issues; otherwise fix overrides or document known exceptions before merging plan work.

- [ ] **Step 7: Commit**

```bash
git add scripts/ci/changed-ts-files.sh scripts/ci/run-pnpm-audit.sh scripts/ci/run-trivy.sh package.json
git commit -m "chore: add supply-chain CI scripts and quality entrypoints"
```

---

### Task 2: GitHub Actions quality workflow

**Files:**

- Create: `.github/workflows/quality.yml`

**Interfaces:**

- Consumes: `pnpm quality:*` from Task 1 (and later tasks).
- Produces: Job names `lint`, `types`, `supply-chain`, `unit`, `integration`, `property`, `contract`, `mutation`, `secrets` (Gitleaks).

- [ ] **Step 1: Create `.github/workflows/quality.yml`**

```yaml
name: Quality

on:
  pull_request:
  push:
    branches: [main, master]

concurrency:
  group: quality-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.13.1
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm quality:lint

  types:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.13.1
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm quality:types

  supply-chain:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.13.1
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile && ./scripts/ci/run-pnpm-audit.sh
      - name: Trivy scan
        uses: aquasecurity/trivy-action@0.28.0
        with:
          scan-type: fs
          scan-ref: .
          severity: HIGH,CRITICAL
          exit-code: 1

  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.13.1
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm quality:unit

  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.13.1
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm quality:integration

  property:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.13.1
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm quality:property

  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.13.1
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm quality:contract

  mutation:
    runs-on: ubuntu-latest
    env:
      QUALITY_BASE_REF: origin/${{ github.event.pull_request.base.ref || 'main' }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: 10.13.1
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm quality:mutation
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: stryker-report
          path: reports/mutation/

  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Note: `property`, `contract`, and `mutation` jobs require scripts from Tasks 4–6; until then, add temporary no-op scripts or implement tasks in order before enabling workflow on main.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/quality.yml
git commit -m "ci: add parallel quality workflow"
```

---

### Task 3: Type tests with tsd

**Files:**

- Create: `tsd.json`
- Create: `test/type/overload-utilization.test-d.ts`
- Modify: `package.json` (devDependency `tsd`, update `quality:types`)

**Interfaces:**

- Produces: `pnpm quality:types` runs `tsc --noEmit && tsd`.

- [ ] **Step 1: Install tsd**

Run: `pnpm add -D tsd`

- [ ] **Step 2: Create `tsd.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsd.json",
  "directory": "test/type"
}
```

- [ ] **Step 3: Create `test/type/overload-utilization.test-d.ts`**

```typescript
import { expectType } from 'tsd';
import {
  computeInboundUtilization,
  shouldShedPriorityRequest,
} from '../../src/core/overload/priority/should-shed-priority-request';
import { ApiPriorityLevel } from '../../src/core/overload/priority/api-priority-level.enum';

expectType<number>(computeInboundUtilization(1, 10));

expectType<boolean>(
  shouldShedPriorityRequest({
    active: 1,
    maxInFlight: 10,
    priority: ApiPriorityLevel.Normal,
    thresholds: { critical: 1, high: 0.9, normal: 0.8, low: 0.7 },
  }),
);
```

- [ ] **Step 4: Update `quality:types` in `package.json`**

```json
"quality:types": "tsc -p tsconfig.json --noEmit && tsd"
```

- [ ] **Step 5: Run type tests**

Run: `pnpm quality:types`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tsd.json test/type/overload-utilization.test-d.ts package.json pnpm-lock.yaml
git commit -m "test: add tsd type tests for overload helpers"
```

---

### Task 4: Property tests with fast-check

**Files:**

- Create: `jest.property.config.ts`
- Create: `test/property/compute-inbound-utilization.property.spec.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `pnpm quality:property` runs Jest with property config only.

- [ ] **Step 1: Install fast-check**

Run: `pnpm add -D fast-check`

- [ ] **Step 2: Create `jest.property.config.ts`**

```typescript
import type { Config } from 'jest';
import base from './jest.config';

const config: Config = {
  ...base,
  roots: ['<rootDir>/test/property'],
  testRegex: '.*\\.property\\.spec\\.ts$',
  collectCoverageFrom: [],
};

export default config;
```

- [ ] **Step 3: Create `test/property/compute-inbound-utilization.property.spec.ts`**

```typescript
import * as fc from 'fast-check';
import { computeInboundUtilization } from '../../src/core/overload/priority/should-shed-priority-request';

describe('computeInboundUtilization (property)', () => {
  it('returns 1 when maxInFlight <= 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ max: 0 }),
        (active, maxInFlight) => {
          expect(computeInboundUtilization(active, maxInFlight)).toBe(1);
        },
      ),
    );
  });

  it('returns active/maxInFlight for positive maxInFlight', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        (active, maxInFlight) => {
          expect(computeInboundUtilization(active, maxInFlight)).toBeCloseTo(
            active / maxInFlight,
            10,
          );
        },
      ),
    );
  });
});
```

- [ ] **Step 4: Add script**

```json
"quality:property": "node --experimental-vm-modules ./node_modules/jest/bin/jest.js --watchman=false -c jest.property.config.ts"
```

- [ ] **Step 5: Run**

Run: `pnpm quality:property`  
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add jest.property.config.ts test/property/compute-inbound-utilization.property.spec.ts package.json pnpm-lock.yaml
git commit -m "test: add fast-check property suite for utilization"
```

---

### Task 5: REST contract tests

**Files:**

- Create: `jest.contract.config.ts`
- Create: `test/contracts/rest/health-ready.contract.spec.ts`
- Create: `test/contracts/rest/schemas/health-ready.schema.json`
- Modify: `package.json`

**Interfaces:**

- Produces: `pnpm quality:contract` (REST portion; GraphQL added Task 6).

- [ ] **Step 1: Create `jest.contract.config.ts`**

```typescript
import type { Config } from 'jest';
import base from './jest.config';

const config: Config = {
  ...base,
  roots: ['<rootDir>/test/contracts'],
  testRegex: '.*\\.(contract|drift)\\.spec\\.ts$',
  collectCoverageFrom: [],
};

export default config;
```

- [ ] **Step 2: Create `test/contracts/rest/schemas/health-ready.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["status"],
  "properties": {
    "status": { "type": "string" },
    "info": { "type": "object" },
    "error": { "type": "object" },
    "details": { "type": "object" }
  },
  "additionalProperties": true
}
```

- [ ] **Step 3: Create `test/contracts/rest/health-ready.contract.spec.ts`**

Reuse provider overrides from `src/health/health.ready.http.spec.ts` (Terminus + mocked indicators). After `GET /health/ready`, validate JSON body with Ajv:

```typescript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// ... same Nest Test.createTestingModule setup as health.ready.http.spec.ts ...

describe('REST contract: GET /health/ready', () => {
  it('response matches health-ready JSON schema', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    const schema = JSON.parse(
      readFileSync(join(__dirname, 'schemas/health-ready.schema.json'), 'utf8'),
    );
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const body = response.json();
    expect(validate(body)).toBe(true);
  });
});
```

Add devDependency if needed: `pnpm add -D ajv` (ajv-formats already in dependencies).

- [ ] **Step 4: Add interim script**

```json
"quality:contract": "node --experimental-vm-modules ./node_modules/jest/bin/jest.js --watchman=false -c jest.contract.config.ts"
```

- [ ] **Step 5: Run**

Run: `pnpm quality:contract`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add jest.contract.config.ts test/contracts/rest package.json pnpm-lock.yaml
git commit -m "test: add REST health readiness contract test"
```

---

### Task 6: GraphQL schema snapshot and operation contract

**Files:**

- Create: `scripts/ci/merge-graphql-sdl.sh`
- Create: `test/contracts/graphql/schema.snapshot.graphql`
- Create: `test/contracts/graphql/schema-drift.spec.ts`
- Create: `test/contracts/graphql/categories-query.contract.spec.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `pnpm quality:contract:update-snapshot` refreshes `schema.snapshot.graphql`.
- Consumes: `src/**/*.graphql` SDL files.

- [ ] **Step 1: Create `scripts/ci/merge-graphql-sdl.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
find "${ROOT_DIR}/src" -name '*.graphql' -print | sort | while IFS= read -r f; do
  echo "# --- ${f#${ROOT_DIR}/} ---"
  cat "${f}"
  echo
done
```

- [ ] **Step 2: Generate initial snapshot**

Run: `chmod +x scripts/ci/merge-graphql-sdl.sh && ./scripts/ci/merge-graphql-sdl.sh > test/contracts/graphql/schema.snapshot.graphql`

- [ ] **Step 3: Create `test/contracts/graphql/schema-drift.spec.ts`**

```typescript
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('GraphQL SDL snapshot', () => {
  it('matches committed schema.snapshot.graphql', () => {
    const current = execSync('./scripts/ci/merge-graphql-sdl.sh', {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    const expected = readFileSync(
      join(__dirname, 'schema.snapshot.graphql'),
      'utf8',
    );
    expect(current).toBe(expected);
  });
});
```

- [ ] **Step 4: Add `quality:contract:update-snapshot`**

```json
"quality:contract:update-snapshot": "./scripts/ci/merge-graphql-sdl.sh > test/contracts/graphql/schema.snapshot.graphql"
```

- [ ] **Step 5: GraphQL operation smoke test**

Bootstrap minimal app module slice or full `AppModule` with mocked DB if needed; POST `/graphql`:

```typescript
const response = await app.inject({
  method: 'POST',
  url: '/graphql',
  payload: {
    query: '{ categories { id name } }',
  },
});
expect(response.statusCode).toBe(200);
const body = response.json();
expect(body.errors).toBeUndefined();
expect(Array.isArray(body.data?.categories)).toBe(true);
```

If full app bootstrap is too heavy, use `CategoriesModule` + `GraphQLModule.forRoot` test module mirroring `app.module.ts` GraphQL config with mocked `CategoriesService`.

- [ ] **Step 6: Run contract suite**

Run: `pnpm quality:contract`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/ci/merge-graphql-sdl.sh test/contracts/graphql package.json
git commit -m "test: add GraphQL schema snapshot and query contract"
```

---

### Task 7: Incremental mutation testing (Stryker)

**Files:**

- Create: `stryker.config.mjs`
- Create: `scripts/ci/run-mutation.sh`
- Modify: `package.json`

**Interfaces:**

- Consumes: `scripts/ci/changed-ts-files.sh` stdout.
- Produces: `pnpm quality:mutation` — exit 0 with log when no files; else Stryker with `mutate` array from env.

- [ ] **Step 1: Install Stryker packages**

Run: `pnpm add -D @stryker-mutator/core @stryker-mutator/jest-runner`

- [ ] **Step 2: Create `stryker.config.mjs`**

```javascript
/** @type {import('@stryker-mutator/api').PartialStrykerOptions} */
const mutateFiles = process.env.MUTATE_FILES
  ? process.env.MUTATE_FILES.split(',').filter(Boolean)
  : [];

export default {
  packageManager: 'pnpm',
  testRunner: 'jest',
  jest: {
    configFile: 'jest.config.ts',
  },
  mutate:
    mutateFiles.length > 0
      ? mutateFiles
      : ['src/core/overload/priority/should-shed-priority-request.ts'],
  reporters: ['html', 'clear-text', 'progress'],
  htmlReporter: {
    fileName: 'reports/mutation/mutation.html',
  },
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
  timeoutMS: 60000,
};
```

- [ ] **Step 3: Create `scripts/ci/run-mutation.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

mapfile -t files < <(./scripts/ci/changed-ts-files.sh)

if [ "${#files[@]}" -eq 0 ]; then
  echo "mutation skipped: no eligible changed files"
  exit 0
fi

export MUTATE_FILES
MUTATE_FILES="$(IFS=,; echo "${files[*]}")"

pnpm exec stryker run
```

- [ ] **Step 4: Add script**

```json
"quality:mutation": "./scripts/ci/run-mutation.sh"
```

- [ ] **Step 5: Run locally (touch a core file or set MUTATE_FILES)**

Run: `MUTATE_FILES=src/core/overload/priority/should-shed-priority-request.ts pnpm exec stryker run`  
Expected: Completes with mutation score above `thresholds.break` for that file.

- [ ] **Step 6: Commit**

```bash
git add stryker.config.mjs scripts/ci/run-mutation.sh package.json pnpm-lock.yaml
git commit -m "test: add incremental Stryker mutation pipeline"
```

---

### Task 8: CodeQL, Dependabot, AI workflow, docs, hooks

**Files:**

- Create: `.github/workflows/codeql.yml`
- Create: `.github/workflows/ai-review.yml`
- Create: `.github/dependabot.yml`
- Create: `docs/quality/README.md`
- Create: `.husky/pre-push`
- Modify: `docs/features/features.md`
- Modify: `package.json` (`quality` meta-script)

- [ ] **Step 1: Create `.github/workflows/codeql.yml`**

Use GitHub default template: `languages: javascript-typescript`, triggers on `pull_request` and `push` to `main`/`master`, `category: /language:javascript`.

- [ ] **Step 2: Create `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 10
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

- [ ] **Step 3: Create `.github/workflows/ai-review.yml`**

```yaml
name: AI Review (optional)

on:
  pull_request:
  workflow_dispatch:

jobs:
  note:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - run: |
          echo "Enable Cursor Bugbot or CodeRabbit in GitHub repo settings."
          echo "This job is informational and does not block merge."
```

- [ ] **Step 4: Create `docs/quality/README.md`**

Document: each `pnpm quality:*` command, branch protection job list, Trivy local install, `quality:contract:update-snapshot`, audit override remediation, optional AI apps.

- [ ] **Step 5: Update `docs/features/features.md`**

Set CI/CD and dependency scanning to **Done** with link to `docs/quality/README.md`; add notes for type/property/mutation/contract/CodeQL.

- [ ] **Step 6: Create `.husky/pre-push`**

```bash
pnpm quality:lint
pnpm quality:types
pnpm quality:unit
```

- [ ] **Step 7: Finalize `quality` meta-script in `package.json`**

```json
"quality": "pnpm quality:lint && pnpm quality:types && pnpm quality:unit && pnpm quality:integration && pnpm quality:property && pnpm quality:contract && pnpm quality:mutation && pnpm quality:supply-chain"
```

- [ ] **Step 8: Run full local quality (best effort)**

Run: `pnpm quality`  
Expected: PASS (integration requires Docker).

- [ ] **Step 9: Commit**

```bash
git add .github docs/quality .husky/pre-push docs/features/features.md package.json
git commit -m "docs: quality toolchain CI, CodeQL, Dependabot, and contributor guide"
```

---

## Spec coverage self-review

| Spec requirement                       | Task                   |
| -------------------------------------- | ---------------------- |
| Script-first `pnpm quality:*`          | Tasks 1, 3–8           |
| Parallel GHA jobs                      | Task 2                 |
| Hard gates lint/types/unit/integration | Tasks 1–2              |
| Trivy + pnpm audit                     | Task 1–2               |
| Type tests (tsd)                       | Task 3                 |
| Property tests (fast-check)            | Task 4                 |
| REST + GraphQL contracts               | Tasks 5–6              |
| Stryker incremental                    | Task 7                 |
| CodeQL required                        | Task 8                 |
| Dependabot                             | Task 8                 |
| Optional AI workflow                   | Task 8                 |
| Gitleaks CI                            | Task 2 (`secrets` job) |
| docs/features + README                 | Task 8                 |
| Pre-push hook                          | Task 8                 |
| GraphQL snapshot update script         | Task 6                 |

## Placeholder scan

No TBD steps; REST contract Step 3 references concrete pattern from `health.ready.http.spec.ts`—implementer must copy full module setup from that file when writing the spec file body.

## Type consistency

- `computeInboundUtilization` / `shouldShedPriorityRequest` used across type, property, and mutation exemplars — same module path throughout.
