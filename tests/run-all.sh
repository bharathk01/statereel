#!/usr/bin/env bash
# Runs every check against ../statereel.html.
#   tests/run-all.sh            node suites + browser e2e (if Playwright is installed)
#   tests/run-all.sh --no-e2e   node suites only (what most PRs need)
cd "$(dirname "$0")"
fail=0
for t in parse render sample insights frameworks samples unseen real cost; do
  printf '%-22s ' "$t.test.js"
  if out=$(node "$t.test.js" 2>&1); then echo "$out" | tail -1; else echo "FAILED"; echo "$out" | grep '^FAIL'; fail=1; fi
done
# every real capture replicated into multi-run files: counts must stay exact
printf '%-22s ' "scale.js (quick)"
if out=$(node scale.js --quick 2>&1); then echo "$out" | tail -1; else echo "FAILED"; echo "$out" | grep '^FAIL'; fail=1; fi
if [ "$1" != "--no-e2e" ]; then
  if python -c "import playwright" 2>/dev/null; then
    printf '%-22s ' "e2e.py (browser)"
    if out=$(python e2e.py 2>&1); then echo "$out" | tail -1; else echo "FAILED"; echo "$out" | grep -E '^FAIL|Error'; fail=1; fi
  else
    echo "e2e.py (browser)       skipped - pip install -r requirements-dev.txt to enable"
  fi
fi
exit $fail
