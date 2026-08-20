#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/.gitleaks.toml"
ARGS=(protect --staged --redact --no-banner --config "${CONFIG_FILE}")

if command -v gitleaks >/dev/null 2>&1; then
  cd "${ROOT_DIR}"
  exec gitleaks "${ARGS[@]}"
fi

if command -v docker >/dev/null 2>&1; then
  GIT_DIR="$(cd "$(git -C "${ROOT_DIR}" rev-parse --git-dir)" && pwd -P)"
  GIT_COMMON="$(cd "$(git -C "${ROOT_DIR}" rev-parse --git-common-dir)" && pwd -P)"

  if [[ "${GIT_DIR}" == "${GIT_COMMON}" ]]; then
    # Normal checkout: repo root contains a real .git directory.
    exec docker run --rm \
      -v "${ROOT_DIR}:/repo" \
      -w /repo \
      zricethezav/gitleaks:latest \
      "${ARGS[@]}"
  fi

  # Linked worktree: .git is a pointer file. Mount the worktree and the
  # shared git object store, and point GIT_DIR at the worktree metadata.
  WORKTREE_NAME="$(basename "${GIT_DIR}")"
  exec docker run --rm \
    -v "${ROOT_DIR}:/repo" \
    -v "${GIT_COMMON}:/git" \
    -e GIT_DIR="/git/worktrees/${WORKTREE_NAME}" \
    -e GIT_COMMON_DIR=/git \
    -e GIT_WORK_TREE=/repo \
    -w /repo \
    zricethezav/gitleaks:latest \
    "${ARGS[@]}"
fi

cat <<'EOF' >&2
gitleaks is required for pre-commit secrets scanning but was not found.

Install one of:
  brew install gitleaks
  # or use Docker (zricethezav/gitleaks:latest) and ensure `docker` is on PATH

Then re-run your commit.
EOF
exit 1
