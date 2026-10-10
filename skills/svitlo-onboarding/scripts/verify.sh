#!/usr/bin/env bash
# Runs the standard Svitlo checks and prints a one-screen summary.
# Usage (from repo root): bash skills/svitlo-onboarding/scripts/verify.sh [--build] [--docker]
# It never stops at the first failure: you get the full picture.
set -u
BUILD=0; DOCKER=0
for a in "$@"; do
  case "$a" in --build) BUILD=1;; --docker) DOCKER=1;; esac
done

if [ ! -f package.json ] || [ ! -d apps ]; then
  echo "Run this from the repository root (package.json and apps/ must exist)."; exit 2
fi

declare -a NAMES=() CODES=()
run() {
  local name="$1"; shift
  echo "── $name"
  local log; log="$(mktemp)"
  "$@" >"$log" 2>&1; local code=$?
  tail -n 12 "$log"
  NAMES+=("$name"); CODES+=("$code")
  rm -f "$log"
}

run "api typecheck" pnpm --filter @svitlo/api lint
run "web typecheck" pnpm --filter @svitlo/web lint
run "api tests"     pnpm --filter @svitlo/api test
run "web tests"     pnpm --filter @svitlo/web test
if [ "$BUILD" = 1 ]; then
  run "api build" pnpm --filter @svitlo/api build
  run "web build" pnpm --filter @svitlo/web build
fi
if [ "$DOCKER" = 1 ]; then
  run "compose config" docker compose config -q
  run "compose ps"     docker compose ps
  run "api health"     curl -fsS localhost:3001/api/v1/health
fi

echo; echo "════ SUMMARY ════"
fail=0
for i in "${!NAMES[@]}"; do
  if [ "${CODES[$i]}" = 0 ]; then s="PASS"; else s="FAIL"; fail=1; fi
  printf '%-18s %s\n' "${NAMES[$i]}" "$s"
done
exit $fail
