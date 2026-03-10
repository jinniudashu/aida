#!/usr/bin/env bash
# ============================================================
# AIDA Benchmark — Single Model Runner
# ============================================================
# Full lifecycle for one model:
#   1. Write model-info.json + prepare API keys
#   2. Clean remote environment
#   3. Git pull + install (via install-benchmark.sh)
#   4. Run E2E test (configurable via --test-script)
#   5. Download session JSONL (before metrics — crash-safe)
#   6. Collect metrics from Dashboard API (non-fatal)
#   7. Download turn logs + snapshot to local results/{model-id}/
#
# Usage:
#   bash test/e2e/benchmark/run-single-model.sh <model-id> [options]
#
# Options:
#   --test-script <path>    E2E test script (relative to repo root)
#                           Default: test/e2e/idlex-geo-v3.sh
#   --test-log-dir <path>   Remote log directory for turn logs
#                           Default: /tmp/idlex-geo-e2e-v3
#
# Examples:
#   bash test/e2e/benchmark/run-single-model.sh kimi-k2.5
#   bash test/e2e/benchmark/run-single-model.sh kimi-k2.5 \
#     --test-script test/e2e/maor-preprocessing-e2e.sh \
#     --test-log-dir /tmp/maor-preprocessing-e2e
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

MODEL_ID="${1:?Usage: run-single-model.sh <model-id> [--test-script <path>] [--test-log-dir <dir>]}"
shift

# -- Optional flags --
TEST_SCRIPT="test/e2e/idlex-geo-v3.sh"
TEST_LOG_DIR="/tmp/idlex-geo-e2e-v3"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --test-script)  TEST_SCRIPT="${2:?--test-script requires a path}"; shift 2 ;;
    --test-log-dir) TEST_LOG_DIR="${2:?--test-log-dir requires a path}"; shift 2 ;;
    *) shift ;;
  esac
done

TEST_SCRIPT_NAME="$(basename "$TEST_SCRIPT" .sh)"

ensure_model_id "$MODEL_ID"
ensure_results_dir

NAME=$(model_name "$MODEL_ID")
PRIMARY=$(model_primary "$MODEL_ID")
PROVIDER=$(model_provider "$MODEL_ID")

OUT="$(result_dir "$MODEL_ID")"
mkdir -p "$OUT/raw" "$OUT/snapshot"

section "Benchmark: $NAME ($MODEL_ID)"
log "Primary: $PRIMARY"
log "Provider: $PROVIDER"
log "Test: $TEST_SCRIPT"
log "Results: $OUT"
START_TS=$(date +%s)

# ============================================================
# Step 1: Write model-info.json
# ============================================================
node -e '
  console.log(JSON.stringify({
    modelId: process.argv[1],
    name: process.argv[2],
    primary: process.argv[3],
    provider: process.argv[4],
    testScript: process.argv[5],
    startedAt: new Date().toISOString(),
    benchmarkVersion: "R7",
  }, null, 2));
' "$MODEL_ID" "$NAME" "$PRIMARY" "$PROVIDER" "$TEST_SCRIPT" > "$OUT/model-info.json"

# ============================================================
# Step 2: Prepare API keys for remote (SCP env file)
# ============================================================
log "Loading API keys for all providers..."
API_ENV_TMP="$BENCHMARK_DIR/.tmp-api-keys.env"
: > "$API_ENV_TMP"
for mid in "${MODELS[@]}"; do
  key=$(load_api_key "$mid" 2>/dev/null || echo "")
  if [[ -n "$key" ]]; then
    evar=$(model_env_var "$mid")
    echo "$evar=$key" >> "$API_ENV_TMP"
  fi
done

# ============================================================
# Step 3: Clean remote environment
# ============================================================
section "Step 1/7: Clean Remote Environment"
log "Stopping services + wiping state..."

# Kill stale test processes first (from previous model runs)
ssh_run 'ps aux | grep -E "idlex-geo|openclaw.agent" | grep -v grep | while read u p rest; do kill -9 "$p" 2>/dev/null; done; echo ok' || true

# Stop services (separate SSH calls to avoid pkill killing our own session)
ssh_run 'systemctl stop bps-dashboard 2>/dev/null; systemctl stop openclaw-gateway 2>/dev/null; echo ok' || true
ssh_run 'ps aux | grep -E "openclaw-gateway|openclaw-agent" | grep -v grep | while read u p rest; do kill -9 "$p" 2>/dev/null; done; echo ok' || true
sleep 3

ssh_run '
  AIDA_HOME=${AIDA_HOME:-$HOME/.aida}
  OPENCLAW_HOME=${OPENCLAW_HOME:-$HOME/.openclaw}
  [ -d "$AIDA_HOME" ] && mv "$AIDA_HOME" "$AIDA_HOME.bak.$(date +%Y%m%d%H%M%S)" || true

  rm -rf "$OPENCLAW_HOME/workspace/" 2>/dev/null || true
  rm -rf "$OPENCLAW_HOME"/workspace-* 2>/dev/null || true
  rm -rf "$OPENCLAW_HOME/agents/main/sessions/" 2>/dev/null || true
  rm -rf "$OPENCLAW_HOME/cron/" 2>/dev/null || true
  find "$OPENCLAW_HOME" \( -name "sessions.json" -o -name "*.session" \) -delete 2>/dev/null || true
  echo "Environment cleaned"
'
log "Remote environment cleaned."

# ============================================================
# Step 4: Install + configure model
# ============================================================
section "Step 2/7: Install + Configure ($NAME)"
log "Pulling latest code (discarding remote local changes)..."
ssh_run "cd $REMOTE_REPO && git checkout -- . && git pull --no-recurse-submodules 2>&1 | tail -5"

log "Generating models.json..."
MODELS_JSON_TMP="$BENCHMARK_DIR/.tmp-models.json"
generate_models_json > "$MODELS_JSON_TMP"
FALLBACKS_JSON=$(get_fallbacks_json)

log "Uploading models.json + API keys to remote..."
REMOTE_MODELS_JSON="$REMOTE_OPENCLAW_HOME/agents/main/agent/models.json"
ssh_run "mkdir -p $(dirname "$REMOTE_MODELS_JSON") $REMOTE_TMP"
scp_to_remote "$MODELS_JSON_TMP" "$REMOTE_MODELS_JSON"
scp_to_remote "$API_ENV_TMP" "$REMOTE_TMP/api-keys.env"
rm -f "$MODELS_JSON_TMP" "$API_ENV_TMP"

log "Running install-benchmark.sh on remote (includes install-aida.sh)..."
ssh_long "cd $REMOTE_REPO && set -a && source $REMOTE_TMP/api-keys.env && set +a && BENCHMARK_PRIMARY='$PRIMARY' BENCHMARK_FALLBACK='$FALLBACKS_JSON' bash test/e2e/benchmark/install-benchmark.sh && echo '[benchmark] Install complete'"

log "Starting OpenClaw gateway..."
ssh_run "openclaw gateway start 2>/dev/null; echo started"

log "Waiting for gateway health..."
for i in $(seq 1 12); do
  if ssh_run "openclaw gateway status 2>/dev/null" | grep -qiE "running|healthy|active"; then
    log "  Gateway healthy (${i}x5s)"
    break
  fi
  sleep 5
done

# Verify model config
log "Verifying model config..."
ssh_run 'OC=${OPENCLAW_HOME:-$HOME/.openclaw}; node -e "const c=JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\")); console.log(\"  Primary:\",c.agents?.defaults?.model?.primary||\"NOT SET\"); console.log(\"  Fallbacks:\",JSON.stringify(c.agents?.defaults?.model?.fallbacks||[]))" "$OC/openclaw.json" 2>/dev/null || echo "  Config read failed"'

# ============================================================
# Step 5: Run E2E test
# ============================================================
section "Step 3/7: Run E2E Test ($TEST_SCRIPT_NAME)"
log "Running $TEST_SCRIPT (timeout: ${AGENT_TIMEOUT}s per turn)..."
log "This will take ~15-30 minutes..."

E2E_OUTPUT=$(ssh_long "cd $REMOTE_REPO && set -a && source $REMOTE_TMP/api-keys.env && set +a && BENCHMARK_MODE=1 bash $TEST_SCRIPT 2>&1" 2>&1 || true)

# Save full e2e output
echo "$E2E_OUTPUT" > "$OUT/e2e-test.log"
log "E2E test log: $(wc -l < "$OUT/e2e-test.log") lines"

# Extract pass/fail counts from test output
E2E_RESULT=$(echo "$E2E_OUTPUT" | grep -oE '[0-9]+ PASS / [0-9]+ FAIL / [0-9]+ WARN' | tail -1 || echo "? PASS / ? FAIL / ? WARN")
log "E2E result: $E2E_RESULT"

# ============================================================
# Step 6: Download session JSONL (before metrics — R6 P1 fix)
# ============================================================
section "Step 4/7: Download Session JSONL"
log "Downloading session JSONL (before metrics collection)..."
REMOTE_SESS='${OPENCLAW_HOME:-$HOME/.openclaw}/agents/main/sessions'
JSONL_FILE=$(ssh_run "ls -t $REMOTE_SESS/*.jsonl 2>/dev/null | head -1" || true)
if [[ -n "$JSONL_FILE" ]]; then
  scp_from_remote "$JSONL_FILE" "$OUT/raw/session.jsonl" 2>/dev/null || true
  log "  Session JSONL downloaded"
else
  log "  No session JSONL found"
fi

# ============================================================
# Step 7: Collect metrics (non-fatal — R6 P0 fix)
# ============================================================
section "Step 5/7: Collect Metrics"
if ! bash "$SCRIPT_DIR/collect-metrics.sh" "$MODEL_ID" "$OUT"; then
  log "  WARNING: collect-metrics.sh failed (non-fatal, continuing)"
fi

# ============================================================
# Step 8: Download raw turn logs + snapshot
# ============================================================
section "Step 6/7: Download Artifacts"

# Clean stale local results from previous runs (R6 P2 fix)
log "Cleaning stale raw/ files..."
rm -f "$OUT/raw"/turn-*.log "$OUT/raw"/all-turns.log "$OUT/raw"/report.txt "$OUT/raw"/skills-*.txt 2>/dev/null || true

log "Downloading turn logs from $TEST_LOG_DIR..."

# Discover all files in the remote log directory and download them
REMOTE_FILES=$(ssh_run "ls $TEST_LOG_DIR/ 2>/dev/null" || true)
DL_COUNT=0
for f in $REMOTE_FILES; do
  if scp_from_remote "$TEST_LOG_DIR/$f" "$OUT/raw/$f" 2>/dev/null; then
    DL_COUNT=$((DL_COUNT + 1))
  fi
done

TURN_COUNT=$(ls "$OUT/raw"/turn-*.log 2>/dev/null | wc -l || echo 0)
log "  Downloaded $DL_COUNT files ($TURN_COUNT turn logs)"

log "Creating remote snapshots..."
ssh_run '
  AIDA_HOME=${AIDA_HOME:-$HOME/.aida}
  OPENCLAW_HOME=${OPENCLAW_HOME:-$HOME/.openclaw}
  mkdir -p /tmp/aida-benchmark

  tar czf /tmp/aida-benchmark/aida-data.tar.gz \
    -C "$AIDA_HOME" data/ blueprints/ governance.yaml project.yaml 2>/dev/null || true

  tar czf /tmp/aida-benchmark/workspace.tar.gz \
    -C "$OPENCLAW_HOME" workspace/ 2>/dev/null || true

  for ws in "$OPENCLAW_HOME"/workspace-*; do
    [ -d "$ws" ] && tar czf /tmp/aida-benchmark/$(basename "$ws").tar.gz -C "$OPENCLAW_HOME" $(basename "$ws")/ 2>/dev/null || true
  done

  ls -la /tmp/aida-benchmark/
'

scp_from_remote "/tmp/aida-benchmark/aida-data.tar.gz" "$OUT/snapshot/aida-data.tar.gz" 2>/dev/null || true
scp_from_remote "/tmp/aida-benchmark/workspace.tar.gz" "$OUT/snapshot/workspace.tar.gz" 2>/dev/null || true

# Any extra workspace snapshots
for ws_file in $(ssh_run "ls /tmp/aida-benchmark/workspace-*.tar.gz 2>/dev/null" || true); do
  [ -n "$ws_file" ] && scp_from_remote "$ws_file" "$OUT/snapshot/$(basename "$ws_file")" 2>/dev/null || true
done

# ============================================================
# Step 7/7: Finalize
# ============================================================
END_TS=$(date +%s)
DURATION=$((END_TS - START_TS))

# Update model-info.json with completion data
node -e '
  const fs = require("fs");
  const info = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
  info.completedAt = new Date().toISOString();
  info.durationSeconds = parseInt(process.argv[2]);
  info.e2eResult = process.argv[3];
  fs.writeFileSync(process.argv[1], JSON.stringify(info, null, 2) + "\n");
' "$OUT/model-info.json" "$DURATION" "$E2E_RESULT"

section "Complete: $NAME"
log "Duration: ${DURATION}s (~$((DURATION / 60))m)"
log "E2E: $E2E_RESULT"
log "Results: $OUT/"
log "Files:"
ls -la "$OUT/"
echo ""
log "Next: Evaluate in Claude Code session (read $OUT/ and score per scoring-rubric.md)"
