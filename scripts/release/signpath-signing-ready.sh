#!/usr/bin/env bash
# Return success when the SignPath inputs for Windows code signing are complete.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: signpath-signing-ready.sh

Checks whether the current environment has enough SignPath inputs to submit a
signing request for the Windows runtime binaries. Missing inputs are reported,
but incomplete signing is not a workflow error by itself: the release still
publishes an unsigned Windows bundle.
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

missing=()

# The signing action takes all four inputs and fails the request when it is
# handed a blank one, so a partial configuration has to read as "not
# configured" rather than fail the release. Whitespace counts as blank: the
# action cannot tell it apart from an unset variable either.
require_input() {
  local name="$1"
  local value="${!name:-}"
  if [ -z "${value//[[:space:]]/}" ]; then
    missing+=("$name")
  fi
}

require_input SIGNPATH_API_TOKEN
require_input SIGNPATH_ORGANIZATION_ID
require_input SIGNPATH_PROJECT_SLUG
require_input SIGNPATH_SIGNING_POLICY_SLUG

if [ "${#missing[@]}" -gt 0 ]; then
  printf 'SignPath signing inputs incomplete: %s.\n' "${missing[*]}" >&2
  exit 1
fi

printf 'SignPath signing inputs complete.\n'
