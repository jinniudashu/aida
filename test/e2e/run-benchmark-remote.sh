#!/usr/bin/env bash
# Remote script to run single model benchmark
# Usage: bash run-benchmark-remote.sh <model-id>

set -euo pipefail

MODEL_ID="$1"
AIDA_HOME="$HOME/.aida"
OPENCLAW_HOME="$HOME/.openclaw"
AIDA_REPO="$HOME/aida"
LOG_DIR="/tmp/benchmark-$MODEL_ID"

# Model configs
get_model_config() {
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

log() { echo "[$(date +%H:%M:%S)] $*"; }

# 1. Clean environment
log "=== Phase 1: Clean Environment ==="
systemctl stop bps-dashboard 2>/dev/null || true
systemctl stop openclaw-gateway 2>/dev/null || true
pkill -f "openclaw gateway" 2>/dev/null || true
sleep 3

[ -d "$AIDA_HOME" ] && mv "$AIDA_HOME" "$AIDA_HOME.bak.$(date +%Y%m%d%H%M%S)"
rm -rf "$OPENCLAW_HOME/workspace/" 2>/dev/null || true
rm -rf "$OPENCLAW_HOME"/workspace-* 2>/dev/null || true
rm -rf "$OPENCLAW_HOME/agents/main/sessions/" 2>/dev/null || true
find "$OPENCLAW_HOME" \( -name "cron*.json" -o -name "sessions.json" \) -delete 2>/dev/null || true
log "Environment cleaned"

# 2. Configure model
log "=== Phase 2: Configure Model ==="
PRIMARY=$(get_model_config "$MODEL_ID")
cp "$OPENCLAW_HOME/openclaw.json" "$OPENCLAW_HOME/openclaw.json.bak" 2>/dev/null || true

node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$OPENCLAW_HOME/openclaw.json.bak', 'utf8'));
config.agents = config.agents || {};
config.agents.defaults = config.agents.defaults || {};
config.agents.defaults.model = {
  primary: '$PRIMARY',
  fallbacks: ['dashscope/qwen3.5-plus', 'moonshot/kimi-k2.5']
};
fs.writeFileSync('$OPENCLAW_HOME/openclaw.json', JSON.stringify(config, null, 2));
console.log('Model configured: $PRIMARY');
"

# 3. Run install
log "=== Phase 3: Install AIDA ==="
cd "$AIDA_REPO"
git pull --recurse-submodules 2>&1 | tail -3 || true

if [ -f "$AIDA_REPO/.dev/openrouter-api.env" ]; then
  source "$AIDA_REPO/.dev/openrouter-api.env" 2>/dev/null || true
  export OPENROUTER_API_KEY
fi

bash deploy/install-aida.sh 2>&1 | tail -20

# 4. Start gateway
log "=== Phase 4: Start Gateway ==="
openclaw gateway start 2>/dev/null || true
for i in $(seq 1 12); do
  if openclaw gateway status 2>/dev/null | grep -qiE "running|healthy|active"; then
    log "Gateway ready"
    break
  fi
  sleep 5
done

# 5. Run E2E test
log "=== Phase 5: Run E2E Test ==="
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

bash test/e2e/idlex-geo-v3.sh 2>&1 | tee "$LOG_DIR/e2e-test.log"
TEST_EXIT=$?

# 6. Collect metrics
log "=== Phase 6: Collect Metrics ==="
PASS_N=$(grep -oE '[0-9]+ PASS' "$LOG_DIR/e2e-test.log" 2>/dev/null | grep -oE '[0-9]+' | tail -1 || echo 0)
FAIL_N=$(grep -oE '[0-9]+ FAIL' "$LOG_DIR/e2e-test.log" 2>/dev/null | grep -oE '[0-9]+' | tail -1 || echo 0)
WARN_N=$(grep -oE '[0-9]+ WARN' "$LOG_DIR/e2e-test.log" 2>/dev/null | grep -oE '[0-9]+' | tail -1 || echo 0)
ENTITIES=$(curl -sf http://localhost:3456/api/entities 2>/dev/null | node -e "try{console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).length)}catch{console.log(0)}" || echo 0)
SKILLS=$(find "$OPENCLAW_HOME/workspace/skills/" -name SKILL.md 2>/dev/null | wc -l || echo 0)
VIOLATIONS=$(curl -sf http://localhost:3456/api/management/violations 2>/dev/null | node -e "try{console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).length)}catch{console.log(0)}" || echo 0)
APPROVALS=$(curl -sf http://localhost:3456/api/management/approvals 2>/dev/null | node -e "try{console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).filter(a=>a.status==='APPROVED').length)}catch{console.log(0)}" || echo 0)

cat > "$LOG_DIR/metrics.json" << METRICS
{
  "modelId": "$MODEL_ID",
  "primary": "$PRIMARY",
  "timestamp": "$(date -Iseconds)",
  "pass": ${PASS_N:-0},
  "fail": ${FAIL_N:-0},
  "warn": ${WARN_N:-0},
  "entities": ${ENTITIES:-0},
  "skills": ${SKILLS:-0},
  "violations": ${VIOLATIONS:-0},
  "approvals": ${APPROVALS:-0},
  "testExit": $TEST_EXIT
}
METRICS

# Copy turn logs
cp /tmp/idlex-geo-e2e-v3/*.log "$LOG_DIR/" 2>/dev/null || true
cp /tmp/idlex-geo-e2e-v3/report.txt "$LOG_DIR/" 2>/dev/null || true

log "=== Done: $MODEL_ID ==="
log "Results: $LOG_DIR"
cat "$LOG_DIR/metrics.json"

echo "BENCHMARK_COMPLETE"
