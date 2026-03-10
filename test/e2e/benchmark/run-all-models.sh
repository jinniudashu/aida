#!/usr/bin/env bash
# ============================================================
# AIDA Benchmark — Run All Models
# ============================================================
# Orchestrator: preflight → loop all 6 models → summary
#
# Usage:
#   bash test/e2e/benchmark/run-all-models.sh [--skip-preflight] [--models "id1 id2"]
#
# Options:
#   --skip-preflight   Skip preflight checks (if already validated)
#   --models "a b c"   Run only specified models (space-separated)
#
# Example:
#   bash test/e2e/benchmark/run-all-models.sh --models "kimi-k2.5 qwen3.5-plus"
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

SKIP_PREFLIGHT=false
SELECTED_MODELS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-preflight) SKIP_PREFLIGHT=true; shift ;;
    --models) IFS=' ' read -r -a SELECTED_MODELS <<< "$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Use all models if none selected
if [[ ${#SELECTED_MODELS[@]} -eq 0 ]]; then
  SELECTED_MODELS=("${MODELS[@]}")
fi

section "AIDA Multi-Model Benchmark R5"
log "Models: ${SELECTED_MODELS[*]}"
log "Date: $(date -Iseconds)"
log "Results: $RESULTS_DIR/"

# ============================================================
# Preflight
# ============================================================
if [[ "$SKIP_PREFLIGHT" == "false" ]]; then
  section "Preflight Checks"
  bash "$SCRIPT_DIR/preflight.sh" --skip-api-probe
  log "Preflight passed."
else
  log "Preflight skipped (--skip-preflight)"
fi

# ============================================================
# Run each model
# ============================================================
TOTAL_MODELS=${#SELECTED_MODELS[@]}
COMPLETED=0
FAILED_MODELS=()
RESULTS_SUMMARY=()

for model_id in "${SELECTED_MODELS[@]}"; do
  COMPLETED=$((COMPLETED + 1))
  section "Model $COMPLETED/$TOTAL_MODELS: $model_id"

  NAME=$(model_name "$model_id")
  log "Starting: $NAME ($model_id)"

  MODEL_START=$(date +%s)

  if bash "$SCRIPT_DIR/run-single-model.sh" "$model_id"; then
    MODEL_END=$(date +%s)
    MODEL_DURATION=$((MODEL_END - MODEL_START))
    log "$model_id completed in ${MODEL_DURATION}s"
    RESULTS_SUMMARY+=("$model_id: DONE (${MODEL_DURATION}s)")
  else
    MODEL_END=$(date +%s)
    MODEL_DURATION=$((MODEL_END - MODEL_START))
    log "$model_id FAILED after ${MODEL_DURATION}s"
    FAILED_MODELS+=("$model_id")
    RESULTS_SUMMARY+=("$model_id: FAILED (${MODEL_DURATION}s)")
  fi

  # Brief pause between models to let server settle
  if [[ "$COMPLETED" -lt "$TOTAL_MODELS" ]]; then
    log "Pausing 30s before next model..."
    sleep 30
  fi
done

# ============================================================
# Summary
# ============================================================
section "Benchmark Summary"

log "Completed: $COMPLETED/$TOTAL_MODELS"
log ""

for line in "${RESULTS_SUMMARY[@]}"; do
  if [[ "$line" == *"FAILED"* ]]; then
    fail "$line"
  else
    pass "$line"
  fi
done

echo ""
log "Results directory: $RESULTS_DIR/"
ls -d "$RESULTS_DIR"/*/ 2>/dev/null | while read d; do
  echo "  $(basename "$d")/: $(ls "$d" 2>/dev/null | wc -l) files"
done

if [[ ${#FAILED_MODELS[@]} -gt 0 ]]; then
  echo ""
  warn_ "Failed models: ${FAILED_MODELS[*]}"
  log "Re-run failed models with:"
  log "  bash test/e2e/benchmark/run-all-models.sh --skip-preflight --models \"${FAILED_MODELS[*]}\""
fi

echo ""
log "Next: Open Claude Code session and evaluate each model's results."
log "  For each model: read results/{model-id}/ and score per scoring-rubric.md"
