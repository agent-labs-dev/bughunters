#!/usr/bin/env bash
# Bugpatrol's own must-pass test.
#
# M3's acceptance criterion: three consecutive runs against an UNCHANGED commit
# must produce zero diffs across every screen and every viewport. It is the
# property every competitor fails, and until it holds, nothing built on top of
# the signal can be trusted.
#
# Any diff between these runs is a determinism violation, not a regression in
# the fixture app -- nothing changed between them.
set -euo pipefail

RUNS="${RUNS:-3}"
CLI="$(cd "$(dirname "$0")/.." && pwd)/packages/cli/dist/bin.js"
APP="$(cd "$(dirname "$0")/.." && pwd)/examples/fixture-app"

cd "$APP"
# Keep the config in .bugpatrol/; start from no baselines and no local data.
rm -rf .bugpatrol/runs .bugpatrol/appmodel.json .bugpatrol/baselines.manifest.json .bugpatrol/intents.json

echo "== capturing baselines =="
node "$CLI" run --no-models >/dev/null

echo "== $RUNS consecutive runs against the same commit =="
for i in $(seq 1 "$RUNS"); do
  if node "$CLI" run --no-models > "/tmp/determinism-run-$i.log" 2>&1; then
    echo "  run $i: clean"
  else
    code=$?
    echo "  run $i: FAILED (exit $code)" >&2
    echo "--- output ---" >&2
    cat "/tmp/determinism-run-$i.log" >&2
    echo >&2
    echo "A diff across identical runs is a determinism violation. See docs/determinism-contract.md." >&2
    exit 1
  fi
done

echo "== determinism holds: $RUNS runs, zero diffs =="
