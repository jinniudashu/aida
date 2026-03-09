#!/usr/bin/env bash
# ============================================================
# AIDA Six-Model Benchmark Test
# ============================================================
# Runs IdleX GEO E2E v3 test against 6 LLM models
# Each model: clean env -> test -> collect results -> commit
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AIDA_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESULTS_DIR="$AIDA_ROOT/test/e2e/benchmark-results"
SSH_KEY="$AIDA_ROOT/.dev/oc-alicloud.pem"
SSH_HOST="root@47.236.109.62"

# Model definitions (bash 3 compatible)
MODELS="claude-opus-4.6 gpt-5.4 gemini-3.1-pro kimi-k2.5 glm-5 qwen3.5-plus"

get_model_name() {
  case "$1" in
    claude-opus-4.6) echo "Claude Opus 4.6" ;;
    gpt-5.4) echo "GPT-5.4" ;;
    gemini-3.1-pro) echo "Gemini 3.1 Pro Preview" ;;
    kimi-k2.5) echo "Kimi K2.5" ;;
    glm-5) echo "GLM-5" ;;
    qwen3.5-plus) echo "Qwen3.5 Plus" ;;
    *) echo "$1" ;;
  esac
}

get_model_provider() {
  case "$1" in
    claude-opus-4.6) echo "openrouter" ;;
    gpt-5.4) echo "openrouter" ;;
    gemini-3.1-pro) echo "google" ;;
    kimi-k2.5) echo "moonshot" ;;
    glm-5) echo "zhipu" ;;
    qwen3.5-plus) echo "dashscope" ;;
    *) echo "unknown" ;;
  esac
}

# Returns the full model string for OpenClaw config: "provider/model-id"
get_model_config_string() {
  case "$1" in
    claude-opus-4.6) echo "openrouter/anthropic/claude-opus-4.6" ;;
    gpt-5.4) echo "openrouter/openai/gpt-5.4" ;;
    gemini-3.1-pro) echo "google/gemini-3.1-pro-preview" ;;
    kimi-k2.5) echo "moonshot/kimi-k2.5" ;;
    glm-5) echo "zhipu/glm-5" ;;
    qwen3.5-plus) echo "dashscope/qwen3.5-plus" ;;
    *) echo "$1" ;;
  esac
}

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()     { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
pass()    { echo -e "  ${GREEN}✓${NC} $*"; }
fail()    { echo -e "  ${RED}✗${NC} $*"; }
section() { echo -e "\n${BOLD}${YELLOW}══════════════════════════════════════════════${NC}\n${BOLD}$*${NC}\n"; }

# Parse args
TARGET_MODEL=""
SKIP_CLEANUP=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --model) TARGET_MODEL="$2"; shift 2 ;;
    --skip-cleanup) SKIP_CLEANUP=true; shift ;;
    *) shift ;;
  esac
done

# SSH helper
ssh_run() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=30 "$SSH_HOST" "bash -s"
}

ssh_cmd() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=30 "$SSH_HOST" "$*"
}

ssh_long() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=600 "$SSH_HOST" "bash -s"
}

# Generate openclaw.json model config (CORRECT FORMAT)
generate_openclaw_json() {
  local model_id="$1"
  local primary=$(get_model_config_string "$model_id")
  
  # Fallback models
  local fb1="dashscope/qwen3.5-plus"
  local fb2="moonshot/kimi-k2.5"

  cat << JSON
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "$primary",
        "fallbacks": ["$fb1", "$fb2"]
      }
    }
  }
}
JSON
}

# Clean test environment on remote server
clean_environment() {
  log "Cleaning test environment..."

  ssh_run << 'REMOTE'
set -e
AIDA_HOME="$HOME/.aida"
OPENCLAW_HOME="$HOME/.openclaw"

systemctl stop bps-dashboard 2>/dev/null || true
systemctl stop openclaw-gateway 2>/dev/null || true
pkill -f "openclaw gateway" 2>/dev/null || true
sleep 3

[ -d "$AIDA_HOME" ] && mv "$AIDA_HOME" "$AIDA_HOME.bak.$(date +%Y%m%d%H%M%S)"

rm -rf "$OPENCLAW_HOME/workspace/" 2>/dev/null || true
rm -rf "$OPENCLAW_HOME"/workspace-* 2>/dev/null || true
rm -rf "$OPENCLAW_HOME/agents/main/sessions/" 2>/dev/null || true
find "$OPENCLAW_HOME" \( -name "cron*.json" -o -name "cron*.jsonl" -o -name "sessions.json" \) -delete 2>/dev/null || true

echo "Environment cleaned"
REMOTE
}

# Configure model on remote server
configure_model() {
  local model_id="$1"
  local openclaw_json

  log "Configuring model: $model_id ($(get_model_name "$model_id"))"

  # Backup existing config
  ssh_cmd "cp /root/.openclaw/openclaw.json /root/.openclaw/openclaw.json.bak 2>/dev/null || true"
  
  # Read existing config and merge model settings
  openclaw_json=$(generate_openclaw_json "$model_id")
  
  # Use node to merge configs
  ssh_run << REMOTE
set -e
cat > /tmp/model-merge.js << 'NODESCRIPT'
const fs = require('fs');
const existing = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json.bak', 'utf8'));
const modelConfig = $openclaw_json;

// Deep merge - only update model settings
existing.agents = existing.agents || {};
existing.agents.defaults = existing.agents.defaults || {};
existing.agents.defaults.model = modelConfig.agents.defaults.model;

fs.writeFileSync('/root/.openclaw/openclaw.json', JSON.stringify(existing, null, 2));
console.log('Config merged successfully');
NODESCRIPT
node /tmp/model-merge.js
REMOTE

  log "Model config written: $(get_model_config_string "$model_id")"
}

# Run single model test
run_model_test() {
  local model_id="$1"
  local result_dir="$RESULTS_DIR/$model_id"

  section "Testing: $(get_model_name "$model_id") ($model_id)"

  mkdir -p "$result_dir"

  # 1. Clean environment
  if [ "$SKIP_CLEANUP" = false ]; then
    clean_environment
  fi

  # 2. Configure model
  configure_model "$model_id"

  # 3. Run install + seed + test
  log "Running E2E test on remote server..."

  ssh_long << 'REMOTE_TEST'
set -e
cd $HOME/aida
git pull --recurse-submodules 2>&1 | tail -3 || true

# Load API keys
if [ -f "$HOME/aida/.dev/openrouter-api.env" ]; then
  source "$HOME/aida/.dev/openrouter-api.env" 2>/dev/null || true
  export OPENROUTER_API_KEY
fi

# Verify config
echo "=== Current model config ==="
node -e "const c=require('/root/.openclaw/openclaw.json');console.log('Primary:', c.agents?.defaults?.model?.primary || 'not set')"

# Run install
echo "=== Running install-aida.sh ==="
bash deploy/install-aida.sh 2>&1 | tail -30

# Start gateway
echo "=== Starting gateway ==="
openclaw gateway start 2>/dev/null || true
for i in $(seq 1 12); do
  if openclaw gateway status 2>/dev/null | grep -qiE "running|healthy|active"; then
    echo "Gateway ready after ${i}x5s"
    break
  fi
  sleep 5
done

# Run E2E test
echo "=== Running E2E test ==="
bash test/e2e/idlex-geo-v3.sh 2>&1 | tee /tmp/e2e-test.log
TEST_EXIT=$?

# Collect results
mkdir -p /tmp/benchmark-output
cp /tmp/idlex-geo-e2e-v3/report.txt /tmp/benchmark-output/ 2>/dev/null || true
cp /tmp/idlex-geo-e2e-v3/*.log /tmp/benchmark-output/ 2>/dev/null || true

# Extract metrics
PASS_N=$(grep -oE '[0-9]+ PASS' /tmp/e2e-test.log 2>/dev/null | grep -oE '[0-9]+' | tail -1 || echo 0)
FAIL_N=$(grep -oE '[0-9]+ FAIL' /tmp/e2e-test.log 2>/dev/null | grep -oE '[0-9]+' | tail -1 || echo 0)
WARN_N=$(grep -oE '[0-9]+ WARN' /tmp/e2e-test.log 2>/dev/null | grep -oE '[0-9]+' | tail -1 || echo 0)
ENTITIES=$(curl -sf http://localhost:3456/api/entities 2>/dev/null | node -e "try{console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).length)}catch{console.log(0)}" || echo 0)
SKILLS=$(find $HOME/.openclaw/workspace/skills/ -name SKILL.md 2>/dev/null | wc -l || echo 0)
VIOLATIONS=$(curl -sf http://localhost:3456/api/governance/violations 2>/dev/null | node -e "try{console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).length)}catch{console.log(0)}" || echo 0)
APPROVALS=$(curl -sf http://localhost:3456/api/governance/approvals 2>/dev/null | node -e "try{console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).filter(a=>a.status==='APPROVED').length)}catch{console.log(0)}" || echo 0)

cat > /tmp/benchmark-output/metrics.json << METRICS
{
  "timestamp": "$(date -Iseconds)",
  "pass": ${PASS_N:-0},
  "fail": ${FAIL_N:-0},
  "warn": ${WARN_N:-0},
  "entities": ${ENTITIES:-0},
  "skills": ${SKILLS:-0},
  "violations": ${VIOLATIONS:-0},
  "approvals": ${APPROVALS:-0}
}
METRICS

echo "TEST_COMPLETE (exit: $TEST_EXIT)"
REMOTE_TEST

  # 4. Collect results from remote
  log "Collecting results..."
  ssh_cmd "tar -czf /tmp/benchmark-$model_id.tar.gz -C /tmp/benchmark-output ."
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_HOST:/tmp/benchmark-$model_id.tar.gz" "$result_dir/results.tar.gz"

  if [ -f "$result_dir/results.tar.gz" ]; then
    tar -xzf "$result_dir/results.tar.gz" -C "$result_dir"
    pass "Results collected: $result_dir"
    cat "$result_dir/metrics.json" 2>/dev/null || true
  else
    fail "Failed to collect results"
  fi

  # 5. Save model info
  cat > "$result_dir/model-info.json" << INFO
{
  "id": "$model_id",
  "name": "$(get_model_name "$model_id")",
  "provider": "$(get_model_provider "$model_id")",
  "modelConfig": "$(get_model_config_string "$model_id")",
  "timestamp": "$(date -Iseconds)"
}
INFO

  log "Model test complete: $model_id"
}

# Commit results for a model
commit_results() {
  local model_id="$1"

  log "Committing results for $model_id..."

  cd "$AIDA_ROOT"
  git add "test/e2e/benchmark-results/$model_id/"
  git add "test/e2e/model-benchmark-config.json"
  git add "test/e2e/model-benchmark.sh"

  if git diff --cached --quiet 2>/dev/null; then
    log "No changes to commit"
  else
    git commit -m "test: add benchmark results for $(get_model_name "$model_id") ($model_id)

$(date '+%Y-%m-%d %H:%M') - IdleX GEO E2E v3 test

Model: $(get_model_name "$model_id")
Provider: $(get_model_provider "$model_id")

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
    git push origin main 2>/dev/null || log "Push skipped"
    pass "Committed and pushed"
  fi
}

# Generate comparison report
generate_comparison_report() {
  local report_file="$RESULTS_DIR/comparison-report.md"

  section "Generating Comparison Report"

  cat > "$report_file" << HEADER
# AIDA Six-Model Benchmark Comparison Report

**Test Date:** $(date '+%Y-%m-%d')
**Test Suite:** IdleX GEO E2E v3
**Server:** $SSH_HOST

## Models Tested

| Model | Provider | Pass | Fail | Warn | Entities | Skills | Violations | Approvals |
|-------|----------|------|------|------|----------|--------|------------|-----------|
HEADER

  for model_id in $MODELS; do
    local result_dir="$RESULTS_DIR/$model_id"
    local metrics_file="$result_dir/metrics.json"

    if [ -f "$metrics_file" ]; then
      local pass_n=$(node -e "const m=require('$metrics_file');console.log(m.pass||0)" 2>/dev/null || echo 0)
      local fail_n=$(node -e "const m=require('$metrics_file');console.log(m.fail||0)" 2>/dev/null || echo 0)
      local warn_n=$(node -e "const m=require('$metrics_file');console.log(m.warn||0)" 2>/dev/null || echo 0)
      local entities=$(node -e "const m=require('$metrics_file');console.log(m.entities||0)" 2>/dev/null || echo 0)
      local skills=$(node -e "const m=require('$metrics_file');console.log(m.skills||0)" 2>/dev/null || echo 0)
      local violations=$(node -e "const m=require('$metrics_file');console.log(m.violations||0)" 2>/dev/null || echo 0)
      local approvals=$(node -e "const m=require('$metrics_file');console.log(m.approvals||0)" 2>/dev/null || echo 0)

      echo "| $(get_model_name "$model_id") | $(get_model_provider "$model_id") | $pass_n | $fail_n | $warn_n | $entities | $skills | $violations | $approvals |" >> "$report_file"
    else
      echo "| $(get_model_name "$model_id") | $(get_model_provider "$model_id") | - | - | - | - | - | - | - |" >> "$report_file"
    fi
  done

  cat >> "$report_file" << FOOTER

## Evaluation Criteria

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Business Understanding | 25% | Understands IdleX business, GEO strategy, store context |
| Tool Calling | 30% | Correctly calls BPS tools to execute operations |
| Two-Layer Routing | 15% | Correctly distinguishes Governance vs Operations |
| Governance Compliance | 15% | Handles governance constraints and approval flows |
| Self-Evolution | 10% | Creates Skills and Agents for recurring patterns |
| Response Quality | 5% | Natural language quality, clarity, actionability |

## Detailed Analysis

See individual model reports in \`benchmark-results/<model-id>/\` directories.

---
*Generated by AIDA Model Benchmark Framework*
FOOTER

  log "Comparison report: $report_file"
  cat "$report_file"
}

# ════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════

mkdir -p "$RESULTS_DIR"

log "Available models: $MODELS"

if [ -n "$TARGET_MODEL" ]; then
  run_model_test "$TARGET_MODEL"
  commit_results "$TARGET_MODEL"
else
  # Run all models
  for model_id in $MODELS; do
    run_model_test "$model_id"
    commit_results "$model_id"
  done

  generate_comparison_report

  # Final commit
  cd "$AIDA_ROOT"
  git add "test/e2e/benchmark-results/comparison-report.md"
  if ! git diff --cached --quiet 2>/dev/null; then
    git commit -m "test: add six-model benchmark comparison report

$(date '+%Y-%m-%d %H:%M') - Comprehensive comparison of 6 LLM models

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
    git push origin main 2>/dev/null || true
  fi
fi

section "Benchmark Complete"
log "Results directory: $RESULTS_DIR"
