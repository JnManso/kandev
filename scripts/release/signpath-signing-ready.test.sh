#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/release/signpath-signing-ready.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

required=(
  SIGNPATH_API_TOKEN
  SIGNPATH_ORGANIZATION_ID
  SIGNPATH_PROJECT_SLUG
  SIGNPATH_SIGNING_POLICY_SLUG
)

run_with_complete_inputs() {
  env \
    SIGNPATH_API_TOKEN=test-token \
    SIGNPATH_ORGANIZATION_ID=test-org \
    SIGNPATH_PROJECT_SLUG=test-project \
    SIGNPATH_SIGNING_POLICY_SLUG=test-policy \
    "$@" bash "$SCRIPT"
}

run_with_complete_inputs >"$TMP_DIR/out" 2>"$TMP_DIR/err" ||
  fail "complete SignPath inputs were rejected"
grep -q "SignPath signing inputs complete." "$TMP_DIR/out" ||
  fail "complete SignPath inputs were not confirmed on stdout"

# Every input is load-bearing on its own: the signing action takes all four and
# fails the release when handed a blank one, so a partial configuration has to
# read as "not configured" rather than as "configured".
for name in "${required[@]}"; do
  if run_with_complete_inputs "$name=" >"$TMP_DIR/out" 2>"$TMP_DIR/err"; then
    fail "an empty $name was accepted as complete SignPath configuration"
  fi
  grep -q "$name" "$TMP_DIR/err" ||
    fail "the incomplete-input error did not name $name"
  grep -q "SignPath signing inputs incomplete" "$TMP_DIR/err" ||
    fail "the incomplete-input error was not actionable for $name"
done

# A variable set to whitespace is the same misconfiguration as an unset one,
# and the action cannot tell them apart either.
for name in "${required[@]}"; do
  if run_with_complete_inputs "$name=   " >"$TMP_DIR/out" 2>"$TMP_DIR/err"; then
    fail "a whitespace-only $name was accepted as complete SignPath configuration"
  fi
  grep -q "$name" "$TMP_DIR/err" ||
    fail "the whitespace-input error did not name $name"
done

if env -u SIGNPATH_API_TOKEN -u SIGNPATH_ORGANIZATION_ID \
  -u SIGNPATH_PROJECT_SLUG -u SIGNPATH_SIGNING_POLICY_SLUG \
  bash "$SCRIPT" >"$TMP_DIR/out" 2>"$TMP_DIR/err"; then
  fail "an entirely unconfigured environment was accepted"
fi
for name in "${required[@]}"; do
  grep -q "$name" "$TMP_DIR/err" ||
    fail "the unconfigured-environment error did not name $name"
done

echo "PASS: SignPath signing readiness requires all four inputs to be non-blank"
