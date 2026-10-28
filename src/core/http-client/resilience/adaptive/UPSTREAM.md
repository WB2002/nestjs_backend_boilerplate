# Adaptive concurrency limiter (vendored)

- **Upstream:** [fortify-ts `packages/adaptive`](https://github.com/klarlabs-studio/fortify-ts/tree/main/packages/adaptive)
- **Pinned npm release:** `@klarlabs-studio/fortify-adaptive@0.1.0` (tarball shasum `1462a5301d0ed9c536d63b05c6e40861352b7489`)
- **License:** MIT — see `LICENSE` in this directory
- **Why in-repo:** Avoid runtime dependency on `@klarlabs-studio/*` packages (supply-chain review in git only)

## Re-sync procedure

1. Download the tagged upstream source or npm tarball for the target version.
2. Diff `adaptive-limiter.ts` and `adaptive-config.ts` against upstream `src/adaptive.ts` / `src/config.ts`.
3. Re-run `pnpm exec jest src/core/http-client/resilience/adaptive/tests/adaptive-limiter.spec.ts --watchman=false --testPathIgnorePatterns='.worktrees'`.
4. Update this file’s pinned version and shasum.
