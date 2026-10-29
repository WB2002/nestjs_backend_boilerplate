#!/bin/bash
set -euo pipefail

fail=0
shopt -s nullglob

for skill in .cursor/skills/*/SKILL.md; do
  dir=$(basename "$(dirname "$skill")")
  name=$(awk '/^name: /{print $2; exit}' "$skill")
  if [[ -z "$name" ]]; then
    echo "missing name: $skill"
    fail=1
  elif [[ "$name" != "$dir" ]]; then
    echo "name mismatch: $skill has $name"
    fail=1
  fi
  if ! awk 'BEGIN{f=0} /^---$/{f++; next} f==1 && /^description: /{found=1} END{exit !found}' "$skill"; then
    echo "missing description: $skill"
    fail=1
  fi

  while IFS= read -r target; do
    [[ "$target" == http:* || "$target" == https:* || "$target" == mailto:* ]] && continue
    [[ "$target" == \#* ]] && continue
    path="${target%%#*}"
    [[ -z "$path" ]] && continue
    resolved="$(dirname "$skill")/$path"
    if [[ ! -e "$resolved" ]]; then
      echo "broken reference: $skill -> $path"
      fail=1
    fi
  done < <(grep -oE '\[[^]]+\]\([^)]+\)' "$skill" | sed -E 's/^\[[^]]+\]\(([^)]+)\)$/\1/' || true)
done

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
echo "skills: OK"
