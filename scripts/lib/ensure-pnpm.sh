#!/usr/bin/env bash
# Non-interactive shells (Cursor hooks, cron, minimal CI) often omit user-local bins.

ensure_pnpm_on_path() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi

  local home="${HOME:-}"
  if [ -n "${home}" ]; then
    export PATH="${home}/.local/bin:${home}/.local/share/pnpm:${home}/Library/pnpm:/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}"
  fi

  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi

  if [ -n "${home}" ] && [ -s "${home}/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "${home}/.nvm/nvm.sh"
    if [ -f .nvmrc ]; then
      nvm use --silent >/dev/null 2>&1 || nvm use >/dev/null 2>&1 || true
    fi
  fi

  if command -v fnm >/dev/null 2>&1; then
    # shellcheck disable=SC2046
    eval "$(fnm env)"
    if [ -f .nvmrc ]; then
      fnm use --silent-if-unchanged >/dev/null 2>&1 || true
    fi
  fi

  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi

  if command -v node >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
  fi

  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi

  cat <<'EOF' >&2
pnpm: command not found.

Install pnpm (see package.json "packageManager") and ensure it is on PATH, e.g.:
  corepack enable
  # or a user-local install under ~/.local/bin (common on macOS)
EOF
  return 127
}