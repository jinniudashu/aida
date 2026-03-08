#!/usr/bin/env bash
# ============================================================
# AIDA Multi-Model Benchmark Runner
# ============================================================
# Runs the IdleX GEO E2E test (v3) with different LLMs and
# collects results for a comparative assessment.
#
# Usage:
#   bash test/e2e/model-benchmark.sh                    # run all models
#   bash test/e2e/model-benchmark.sh --model gemini     # run one model
#   bash test/e2e/model-benchmark.sh --list              # list models
#   bash test/e2e/model-benchmark.sh --report            # generate comparison report
#
# Prerequisites:
#   - OPENROUTER_API_KEY set (all models route through OpenRouter)
#   - Or individual provider API keys in .dev/*.env
#
# Run on: root@47.236.109.62
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AIDA_REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
BENCHMARK_DIR="/tmp/aida-model-benchmark"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OC_CONFIG="$OPENCLAW_HOME/openclaw.json"

# -- Color --
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()     { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
section() { echo -e "\n${BOLD}${YELLOW}═══════════════════════════════════════════════${NC}"; \
            echo -e "${BOLD}  $*${NC}"; \
            echo -e "${BOLD}${YELLOW}═══════════════════════════════════════════════${NC}\n"; }

# ============================================================
# Model Registry
# ============================================================
# Format: SHORT_NAME|DISPLAY_NAME|OPENCLAW_MODEL_ID|PROVIDER|FALLBACK_1|FALLBACK_2
MODELS=(
  "gpt54|GPT-5.4|openrouter/openai/gpt-5.4|openrouter|openrouter/anthropic/claude-sonnet-4.6|openrouter/google/gemini-3.1-pro-preview"
  "gemini|Gemini 3.1 Pro Preview|openrouter/google/gemini-3.1-pro-preview|openrouter|openrouter/anthropic/claude-sonnet-4.6|openrouter/openai/gpt-5.4"
  "kimi|Kimi K2.5|openrouter/moonshotai/kimi-k2.5|openrouter|openrouter/anthropic/claude-sonnet-4.6|openrouter/google/gemini-3.1-pro-preview"
  "glm5|GLM-5|openrouter/z-ai/glm-5|openrouter|openrouter/anthropic/claude-sonnet-4.6|openrouter/google/gemini-3.1-pro-preview"
  "minimax|MiniMax-M2.5|openrouter/minimax/minimax-m2.5|openrouter|openrouter/anthropic/claude-sonnet-4.6|openrouter/google/gemini-3.1-pro-preview"
  "qwen|Qwen3.5-Plus|openrouter/qwen/qwen3.5-plus-02-15|openrouter|openrouter/anthropic/claude-sonnet-4.6|openrouter/google/gemini-3.1-pro-preview"
)

get_field() { echo "$1" | cut -d'|' -f"$2"; }

list_models() {
  echo "Available models:"
  echo ""
  printf "  %-10s %-25s %s\n" "SHORT" "DISPLAY" "OPENCLAW ID"
  echo "  ---------------------------------------------------------------"
  for m in "${MODELS[@]}"; do
    printf "  %-10s %-25s %s\n" "$(get_field "$m" 1)" "$(get_field "$m" 2)" "$(get_field "$m" 3)"
  done
  echo ""
  echo "GPT-5.4 already tested (v3.2, 89/100). Remaining: gemini kimi glm5 minimax qwen"
}

find_model() {
  local key="$1"
  for m in "${MODELS[@]}"; do
    if [ "$(get_field "$m" 1)" = "$key" ]; then
      echo "$m"
      return 0
    fi
  done
  return 1
}

# ============================================================
# Switch Model Config
# ============================================================
switch_model() {
  local model_id="$1"
  local display="$2"
  local fallback1="$3"
  local fallback2="$4"

  log "Switching model to: $display ($model_id)"

  # Update openclaw.json
  node -e '
const fs = require("fs");
const config = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
const modelId = process.argv[2];
const displayName = process.argv[3];
const fb1 = process.argv[4];
const fb2 = process.argv[5];

if (!config.agents) config.agents = {};
if (!config.agents.defaults) config.agents.defaults = {};
config.agents.defaults.model = {
  primary: modelId,
  fallbacks: [fb1, fb2]
};
config.agents.defaults.models = {};
config.agents.defaults.models[modelId] = { alias: displayName };

fs.writeFileSync(process.argv[1], JSON.stringify(config, null, 2) + "\n");
console.log("  Primary:", modelId);
console.log("  Fallbacks:", fb1, ",", fb2);
' "$OC_CONFIG" "$model_id" "$display" "$fallback1" "$fallback2"

  # Clear sessions so new model is picked up
  rm -rf "$OPENCLAW_HOME/agents/main/sessions/" 2>/dev/null || true
  mkdir -p "$OPENCLAW_HOME/agents/main/sessions"
  log "  Sessions cleared for fresh model assignment"
}

# ============================================================
# Run single model benchmark
# ============================================================
run_benchmark() {
  local model_entry="$1"
  local short=$(get_field "$model_entry" 1)
  local display=$(get_field "$model_entry" 2)
  local model_id=$(get_field "$model_entry" 3)
  local provider=$(get_field "$model_entry" 4)
  local fb1=$(get_field "$model_entry" 5)
  local fb2=$(get_field "$model_entry" 6)

  local result_dir="$BENCHMARK_DIR/$short"
  mkdir -p "$result_dir"

  section "Benchmark: $display ($short)"

  local start_ts=$(date +%s)

  # Switch model
  switch_model "$model_id" "$display" "$fb1" "$fb2"

  # Run E2E test (skip install — reuse existing install, just re-seed)
  log "Running E2E test with $display..."
  export LOG_DIR="/tmp/idlex-geo-e2e-v3"
  rm -rf "$LOG_DIR" 2>/dev/null || true
  mkdir -p "$LOG_DIR"

  # We skip install but re-seed data (clean state for fair comparison)
  cd "$AIDA_REPO"
  bash test/e2e/idlex-geo-v3.sh --skip-install 2>&1 | tee "$result_dir/full-output.log"
  local exit_code=${PIPESTATUS[0]}

  local end_ts=$(date +%s)
  local duration=$((end_ts - start_ts))

  # Copy turn logs
  cp "$LOG_DIR"/turn-*.log "$result_dir/" 2>/dev/null || true
  cp "$LOG_DIR/report.txt" "$result_dir/" 2>/dev/null || true
  cp "$LOG_DIR/all-turns.log" "$result_dir/" 2>/dev/null || true

  # Extract metrics
  local pass=$(grep -c "PASS" "$result_dir/full-output.log" 2>/dev/null || echo 0)
  local fail=$(grep -c "FAIL" "$result_dir/full-output.log" 2>/dev/null || echo 0)
  local warn=$(grep -c "WARN" "$result_dir/full-output.log" 2>/dev/null || echo 0)

  # Count entities
  local entities=$(curl -sf http://localhost:3456/api/entities 2>/dev/null | \
    node -e "try{console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).length)}catch{console.log('?')}" 2>/dev/null || echo "?")

  # Count turn lines (proxy for response quality)
  local turn_lines=0
  for t in 1 2 3 4 5 6; do
    if [ -f "$result_dir/turn-$t.log" ]; then
      local tl=$(grep -v "Config warnings\|plugins\]\|Gateway agent failed\|diagnostic\]" "$result_dir/turn-$t.log" | wc -l)
      turn_lines=$((turn_lines + tl))
    fi
  done

  # Save summary
  cat > "$result_dir/summary.json" << SUMEOF
{
  "model": "$short",
  "display": "$display",
  "modelId": "$model_id",
  "pass": $pass,
  "fail": $fail,
  "warn": $warn,
  "entities": "$entities",
  "turnLines": $turn_lines,
  "durationSeconds": $duration,
  "exitCode": $exit_code,
  "timestamp": "$(date -Iseconds)"
}
SUMEOF

  log "Result: $pass PASS / $fail FAIL / $warn WARN | Entities: $entities | Duration: ${duration}s | Turn lines: $turn_lines"

  # Restore model to default after test
  return $exit_code
}

# ============================================================
# Generate comparison report
# ============================================================
generate_report() {
  section "Generating Comparison Report"

  echo ""
  printf "%-20s %6s %6s %6s %8s %8s %10s\n" "MODEL" "PASS" "FAIL" "WARN" "ENTITIES" "LINES" "DURATION"
  echo "--------------------------------------------------------------------------"

  for m in "${MODELS[@]}"; do
    local short=$(get_field "$m" 1)
    local display=$(get_field "$m" 2)
    local summary="$BENCHMARK_DIR/$short/summary.json"
    if [ -f "$summary" ]; then
      local pass=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$summary','utf8')).pass)" 2>/dev/null)
      local fail=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$summary','utf8')).fail)" 2>/dev/null)
      local warn=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$summary','utf8')).warn)" 2>/dev/null)
      local entities=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$summary','utf8')).entities)" 2>/dev/null)
      local lines=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$summary','utf8')).turnLines)" 2>/dev/null)
      local dur=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$summary','utf8')).durationSeconds)" 2>/dev/null)
      printf "%-20s %6s %6s %6s %8s %8s %8ss\n" "$display" "$pass" "$fail" "$warn" "$entities" "$lines" "$dur"
    else
      printf "%-20s %6s\n" "$display" "(not run)"
    fi
  done

  echo ""
  log "Detailed results: $BENCHMARK_DIR/<model>/summary.json"
  log "Turn logs: $BENCHMARK_DIR/<model>/turn-{1..6}.log"
}

# ============================================================
# API connectivity test
# ============================================================
test_api() {
  local model_entry="$1"
  local short=$(get_field "$model_entry" 1)
  local display=$(get_field "$model_entry" 2)
  local model_id=$(get_field "$model_entry" 3)

  # Extract the OpenRouter model name (strip openrouter/ prefix)
  local or_model="${model_id#openrouter/}"

  log "Testing $display ($or_model)..."

  local response
  response=$(curl -s --max-time 30 \
    -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$or_model\",\"messages\":[{\"role\":\"user\",\"content\":\"Say OK\"}],\"max_tokens\":10}" \
    https://openrouter.ai/api/v1/chat/completions 2>&1)

  local content
  content=$(echo "$response" | node -e "
    try {
      const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
      if (d.error) { console.log('ERROR: ' + (d.error.message || JSON.stringify(d.error))); process.exit(1); }
      console.log(d.choices?.[0]?.message?.content || 'no content');
    } catch(e) { console.log('PARSE_ERROR: ' + e.message); process.exit(1); }
  " 2>/dev/null)

  if [ $? -eq 0 ]; then
    echo -e "  ${GREEN}OK${NC} $display → $content"
    return 0
  else
    echo -e "  ${RED}FAIL${NC} $display → $content"
    return 1
  fi
}

# ============================================================
# Main
# ============================================================
mkdir -p "$BENCHMARK_DIR"

# Parse args
ACTION="run_all"
TARGET_MODEL=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --list)     ACTION="list"; shift ;;
    --report)   ACTION="report"; shift ;;
    --test-api) ACTION="test_api"; shift ;;
    --model)    ACTION="run_one"; TARGET_MODEL="$2"; shift 2 ;;
    *)          shift ;;
  esac
done

case $ACTION in
  list)
    list_models
    ;;

  test_api)
    section "API Connectivity Test"
    if [ -z "${OPENROUTER_API_KEY:-}" ]; then
      echo "OPENROUTER_API_KEY not set. Loading from /etc/environment..."
      eval "$(grep OPENROUTER /etc/environment 2>/dev/null)" || true
      export OPENROUTER_API_KEY
    fi
    FAILED=0
    for m in "${MODELS[@]}"; do
      test_api "$m" || FAILED=$((FAILED + 1))
    done
    echo ""
    if [ "$FAILED" -eq 0 ]; then
      echo -e "${GREEN}All models accessible${NC}"
    else
      echo -e "${RED}$FAILED model(s) failed${NC}"
    fi
    ;;

  run_one)
    model_entry=$(find_model "$TARGET_MODEL") || {
      echo "Unknown model: $TARGET_MODEL"
      list_models
      exit 1
    }
    run_benchmark "$model_entry"
    generate_report
    ;;

  run_all)
    section "AIDA Multi-Model Benchmark"
    log "Models: gemini, kimi, glm5, minimax, qwen (GPT-5.4 already tested)"
    log "Results dir: $BENCHMARK_DIR"
    echo ""

    # Skip GPT-5.4 (already tested as v3.2)
    for short in gemini kimi glm5 minimax qwen; do
      model_entry=$(find_model "$short")
      run_benchmark "$model_entry" || true
    done

    # Restore GPT-5.4 as default
    gpt_entry=$(find_model "gpt54")
    switch_model \
      "$(get_field "$gpt_entry" 3)" \
      "$(get_field "$gpt_entry" 2)" \
      "$(get_field "$gpt_entry" 5)" \
      "$(get_field "$gpt_entry" 6)"

    generate_report
    ;;

  report)
    generate_report
    ;;
esac
