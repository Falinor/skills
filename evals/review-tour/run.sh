#!/usr/bin/env bash
# Agent eval for review-tour: runs the whole skill headless with a coding
# agent on a fresh synthetic repository, then grades the tour plan it wrote.
# Every run is a paid model call: run it by hand, never in CI.
#
# Usage: evals/review-tour/run.sh [--agent claude|codex|opencode] [--runs <n>]
set -euo pipefail

usage() {
  echo 'usage: evals/review-tour/run.sh [--agent claude|codex|opencode] [--runs <n>]' >&2
  exit 2
}

agent=claude
runs=3
while [ $# -gt 0 ]; do
  case "$1" in
    --agent) [ $# -ge 2 ] || usage; agent="$2"; shift 2 ;;
    --runs) [ $# -ge 2 ] || usage; runs="$2"; shift 2 ;;
    *) usage ;;
  esac
done
case "$agent" in claude | codex | opencode) ;; *) usage ;; esac
[[ "$runs" =~ ^[1-9][0-9]*$ ]] || usage

if [ -n "${CI:-}" ]; then
  echo 'run.sh: every run is a paid model call; the eval never runs in CI.' >&2
  exit 1
fi
if ! command -v "$agent" >/dev/null; then
  echo "run.sh: $agent is not on PATH." >&2
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
skill="$here/../../skills/review-tour"
results="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/review-tour-eval.XXXXXX")" && pwd -P)"

# The fixture's branches (fixture.ts): review `feature` against `trunk`.
arguments='feature base trunk'

# Runs the agent headless from the fixture, allowed to write under $1, where the work folder lands.
run_agent() {
  local tmp="$1"
  case "$agent" in
    claude)
      claude -p "/review-tour $arguments" --permission-mode acceptEdits \
        --allowedTools 'Bash(node *)' 'Bash(git *)' --add-dir "$tmp" --no-session-persistence
      ;;
    codex)
      codex exec --sandbox workspace-write --add-dir "$tmp" "\$review-tour $arguments"
      ;;
    opencode)
      OPENCODE_PERMISSION="{\"external_directory\":{\"$tmp/**\":\"allow\"}}" \
        opencode run "Load the review-tour skill and run it with these arguments: $arguments"
      ;;
  esac
}

echo "review-tour eval: $agent, $runs runs. Every run is a paid model call."
passed=0
for run in $(seq 1 "$runs"); do
  dir="$results/run-$run"
  repo="$dir/shop"
  tmp="$dir/tmp"
  mkdir -p "$tmp"
  node "$here/fixture.ts" "$repo"
  # Installed as `npx skills add` does: under .agents/skills, where Codex and
  # OpenCode find it, and linked into .claude/skills for Claude Code.
  mkdir -p "$repo/.agents/skills" "$repo/.claude/skills"
  cp -R "$skill" "$repo/.agents/skills/review-tour"
  ln -s ../../.agents/skills/review-tour "$repo/.claude/skills/review-tour"
  printf '/.agents/\n/.claude/\n' >>"$repo/.git/info/exclude"

  status=0
  # REVIEW_TOUR_NO_OPEN keeps `render --open` from opening a browser tab per run.
  (cd "$repo" && TMPDIR="$tmp" REVIEW_TOUR_NO_OPEN=1 run_agent "$tmp") </dev/null >"$dir/agent.log" 2>&1 || status=$?

  # The work folder of the `shop` repository's `feature` target.
  if node "$here/grade.ts" "$tmp/review-tour/shop-feature" >"$dir/grade.log" 2>&1; then
    passed=$((passed + 1))
    echo "run $run/$runs: pass"
  else
    echo "run $run/$runs: fail"
    grep '^fail' "$dir/grade.log" | sed 's/^/  /' || sed 's/^/  /' "$dir/grade.log"
  fi
  if [ "$status" -ne 0 ]; then echo "  $agent exited with status $status (see $dir/agent.log)"; fi
done

echo "pass rate: $passed/$runs ($(((200 * passed + runs) / (2 * runs)))%)"
echo "logs: $results"
[ "$passed" -eq "$runs" ]
