#!/usr/bin/env bash
# ============================================================
# AIDA Unified Evaluation Runner
# ============================================================
# Single entry point for all AIDA evaluation schemes.
#
# Usage:
#   aida-eval.sh --scheme <name> [flags...]
#
# Schemes:
#   structural-v2   D1-D11 + IdleX GEO business (15 min)
#   aef-v1          Σ1-Σ11 + IdleX GEO business (20 min)
#   quick           Engine-only structural (3 sec)
#   benchmark       Multi-model comparison (2-3 hours)
#
# Flags (forwarded to underlying test script):
#   --skip-install  Reuse existing deployment
#   --engine-only   Skip Agent turns (structural/aef only)
#   --phase N       Start from phase N
#
# Examples:
#   aida-eval.sh --scheme quick                    # Fast engine regression
#   aida-eval.sh --scheme structural-v2            # Full validation
#   aida-eval.sh --scheme structural-v2 --skip-install  # Reuse deployment
#   aida-eval.sh --scheme aef-v1 --engine-only     # AEF checks, no Agent
#   aida-eval.sh --scheme benchmark                # 6-model comparison
#
# Output:
#   - Test report (PASS/FAIL/WARN)
#   - Composite score + per-dimension breakdown
#   - Gap-to-target analysis
#   - results.tsv trend tracking
# ============================================================

set -euo pipefail

# -- Resolve paths --
EVAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$EVAL_DIR/lib"
SCHEMES_DIR="$EVAL_DIR/schemes"
RUBRICS_DIR="$EVAL_DIR/rubrics"
RESULTS_TSV="$EVAL_DIR/results.tsv"

# shellcheck source=lib/helpers.sh
source "$LIB_DIR/helpers.sh"

# -- Parse arguments --
SCHEME=""
PASSTHROUGH_ARGS=()
NOTES=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --scheme)
      SCHEME="$2"; shift 2 ;;
    --notes)
      NOTES="$2"; shift 2 ;;
    --list)
      echo "Available schemes:"
      for f in "$SCHEMES_DIR"/*.conf; do
        # shellcheck disable=SC1090
        (source "$f" && echo "  $(basename "$f" .conf)  — ${description:-no description}")
      done
      exit 0 ;;
    --help|-h)
      head -35 "${BASH_SOURCE[0]}" | grep '^#' | sed 's/^# \?//'
      exit 0 ;;
    *)
      PASSTHROUGH_ARGS+=("$1"); shift ;;
  esac
done

# -- Validate scheme --
if [ -z "$SCHEME" ]; then
  echo "Error: --scheme is required. Use --list to see available schemes."
  exit 1
fi

SCHEME_FILE="$SCHEMES_DIR/${SCHEME}.conf"
if [ ! -f "$SCHEME_FILE" ]; then
  echo "Error: scheme '$SCHEME' not found at $SCHEME_FILE"
  echo "Available schemes:"
  ls "$SCHEMES_DIR"/*.conf 2>/dev/null | xargs -I{} basename {} .conf | sed 's/^/  /'
  exit 1
fi

# -- Load scheme config --
load_scheme "$SCHEME_FILE"
log "Scheme: $name — ${description:-}"

# -- Resolve paths from scheme --
TEST_SCRIPT="$EVAL_DIR/$script"
RUBRIC_FILE="$RUBRICS_DIR/$rubric"
METRICS_LOG_DIR="${log_dir}"

if [ ! -f "$TEST_SCRIPT" ]; then
  echo "Error: test script not found: $TEST_SCRIPT"
  exit 1
fi
if [ ! -f "$RUBRIC_FILE" ]; then
  echo "Error: rubric not found: $RUBRIC_FILE"
  exit 1
fi

# -- Get current git commit --
GIT_COMMIT=$(git -C "$EVAL_DIR/../.." rev-parse --short HEAD 2>/dev/null || echo "unknown")

# -- Get model --
MODEL="${!model_env:-${model_default:-unknown}}"

# -- Build extra args --
EXTRA=()
if [ -n "${extra_args:-}" ]; then
  # shellcheck disable=SC2206
  EXTRA=($extra_args)
fi

# ════════════════════════════════════════════════════════════
# Run the test
# ════════════════════════════════════════════════════════════

section "AIDA Evaluation: $name"
log "Script:  $TEST_SCRIPT"
log "Rubric:  $RUBRIC_FILE"
log "Model:   $MODEL"
log "Commit:  $GIT_COMMIT"
log "Args:    ${EXTRA[*]:-} ${PASSTHROUGH_ARGS[*]:-}"
echo ""

EVAL_START=$(date +%s)

# Run the underlying test script
# AIDA_EVAL_WRAPPER=1 tells scripts to skip inline scoring (we score here)
# Exit code 0 = all pass, non-zero = has failures (we still score)
set +e
AIDA_EVAL_WRAPPER=1 bash "$TEST_SCRIPT" ${EXTRA[@]+"${EXTRA[@]}"} ${PASSTHROUGH_ARGS[@]+"${PASSTHROUGH_ARGS[@]}"}
TEST_EXIT=$?
set -e

EVAL_END=$(date +%s)
EVAL_DURATION=$((EVAL_END - EVAL_START))

# ════════════════════════════════════════════════════════════
# Score the results
# ════════════════════════════════════════════════════════════

METRICS_FILE="$METRICS_LOG_DIR/metrics.json"

if [ -f "$METRICS_FILE" ]; then
  section "Evaluation Score"

  node "$LIB_DIR/score-calculator.cjs" \
    --metrics "$METRICS_FILE" \
    --rubric "$RUBRIC_FILE" \
    --results "$RESULTS_TSV" \
    --scheme "$name" \
    --commit "$GIT_COMMIT" \
    --model "$MODEL" \
    --notes "$NOTES"

  log "Total evaluation time: ${EVAL_DURATION}s"
else
  log "No metrics.json found at $METRICS_FILE — scoring skipped"
  log "  (This is expected for benchmark scheme or if the test failed early)"
fi

# Forward the test exit code
exit "$TEST_EXIT"
