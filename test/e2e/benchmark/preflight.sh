#!/usr/bin/env bash
# ============================================================
# AIDA Benchmark — Preflight Checks
# ============================================================
# Validates all prerequisites before running the benchmark.
# Exits non-zero on any critical failure.
#
# Checks:
#   1. Local tool availability (ssh, python3, scp, node, curl)
#   2. config.json integrity (all model fields present)
#   3. API key presence (all 5 env files)
#   4. SSH connectivity to test server
#   5. Remote prerequisites (repo, openclaw, install script, e2e script)
#   6. Remote disk space (>= 2GB free)
#   7. API reachability (send "hello" to each provider)
#
# Usage:
#   bash test/e2e/benchmark/preflight.sh [--skip-api-probe]
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

SKIP_API_PROBE=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-api-probe) SKIP_API_PROBE=true; shift ;;
    *) shift ;;
  esac
done

REPORT="$BENCHMARK_DIR/preflight-report.md"
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

check_pass() { PASS_COUNT=$((PASS_COUNT+1)); pass "$1"; }
check_fail() { FAIL_COUNT=$((FAIL_COUNT+1)); fail "$1"; }
check_warn() { WARN_COUNT=$((WARN_COUNT+1)); warn_ "$1"; }

section "Preflight Checks"

# ============================================================
# 1. Local tools
# ============================================================
log "Checking local tools..."
for cmd in ssh scp python3 node curl; do
  if command -v "$cmd" >/dev/null 2>&1; then
    check_pass "Local tool: $cmd"
  else
    check_fail "Local tool: $cmd NOT FOUND"
  fi
done

# ============================================================
# 2. config.json integrity
# ============================================================
log "Validating config.json..."
CONFIG_OK=$(node -e "
  const fs = require('fs');
  try {
    const c = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
    const models = c.models;
    if (!models || models.length < 1) throw new Error('No models defined');
    const fields = ['id','name','provider','primary','envVar','envFile','providerConfig'];
    for (const m of models) {
      for (const f of fields) {
        if (!(f in m)) throw new Error('Model ' + (m.id||'?') + ' missing field: ' + f);
      }
    }
    if (!c.scoring) throw new Error('Missing scoring section');
    if (!c.server) throw new Error('Missing server section');
    console.log('OK');
  } catch (e) { console.log('FAIL: ' + e.message); }
" "$CONFIG_JSON" 2>&1)

if [[ "$CONFIG_OK" == "OK" ]]; then
  check_pass "config.json integrity (${#MODELS[@]} models)"
else
  check_fail "config.json: $CONFIG_OK"
fi

# ============================================================
# 3. API key presence
# ============================================================
log "Checking API keys..."
MISSING_KEYS=()
for model_id in "${MODELS[@]}"; do
  key=$(load_api_key "$model_id" 2>/dev/null || echo "")
  env_var=$(model_env_var "$model_id")
  if [[ -n "$key" ]]; then
    masked="${key:0:6}...${key: -4}"
    check_pass "API key $env_var ($model_id): $masked"
  else
    check_fail "API key $env_var ($model_id): MISSING"
    MISSING_KEYS+=("$model_id")
  fi
done

# ============================================================
# 4. SSH connectivity
# ============================================================
log "Checking SSH connectivity..."
if ssh_run "echo ok" >/dev/null 2>&1; then
  check_pass "SSH to $SSH_HOST"
else
  check_fail "SSH to $SSH_HOST — cannot connect"
  # Fatal: can't continue without SSH
  log "FATAL: SSH connectivity required. Aborting."
  exit 1
fi

# ============================================================
# 5. Remote prerequisites
# ============================================================
log "Checking remote prerequisites..."
REMOTE_STATUS=$(ssh_run "python3 -c \"
import json, os
print(json.dumps({
    'repo': os.path.isdir('$REMOTE_REPO'),
    'openclaw_config': os.path.isfile('$REMOTE_OPENCLAW_HOME/openclaw.json'),
    'install_script': os.path.isfile('$REMOTE_REPO/deploy/install-aida.sh'),
    'e2e_script': os.path.isfile('$REMOTE_REPO/test/e2e/idlex-geo-v3.sh'),
    'openclaw_cli': os.path.exists('/root/.local/share/pnpm/openclaw') or os.path.exists('/usr/local/bin/openclaw'),
    'node_version': os.popen('node --version 2>/dev/null').read().strip(),
}))
\"" 2>/dev/null || echo '{}')

node -e '
  const status = JSON.parse(process.argv[1] || "{}");
  const checks = {
    repo: "Remote repo ('"$REMOTE_REPO"')",
    openclaw_config: "Remote openclaw.json",
    install_script: "Remote install-aida.sh",
    e2e_script: "Remote idlex-geo-v3.sh",
    openclaw_cli: "Remote openclaw CLI",
  };
  for (const [key, desc] of Object.entries(checks)) {
    console.log((status[key] ? "PASS " : "FAIL ") + desc);
  }
  const nv = status.node_version || "";
  console.log(nv ? "PASS Node.js " + nv : "FAIL Node.js not found");
' "$REMOTE_STATUS" | while IFS= read -r line; do
  if [[ "$line" == PASS* ]]; then
    check_pass "${line#PASS }"
  else
    check_fail "${line#FAIL }"
  fi
done

# ============================================================
# 6. Remote disk space
# ============================================================
log "Checking remote disk space..."
FREE_GB=$(ssh_run "df -BG /root | tail -1 | awk '{print \$4}' | tr -d 'G'" 2>/dev/null || echo "0")
if [[ "$FREE_GB" -ge 2 ]]; then
  check_pass "Remote disk space: ${FREE_GB}GB free"
else
  check_warn "Remote disk space: ${FREE_GB}GB free (recommend >= 2GB)"
fi

# ============================================================
# 7. API reachability (optional, send minimal request)
# ============================================================
if [[ "$SKIP_API_PROBE" == "true" ]]; then
  log "Skipping API reachability probe (--skip-api-probe)"
else
  log "Probing API reachability (this may take 30-60s)..."

  for model_id in "${MODELS[@]}"; do
    key=$(load_api_key "$model_id" 2>/dev/null || echo "")
    if [[ -z "$key" ]]; then
      check_warn "API probe $model_id: skipped (no key)"
      continue
    fi

    provider=$(model_provider "$model_id")
    primary=$(model_primary "$model_id")

    PROBE_RESULT=$(python3 -c "
import json, urllib.request, urllib.error, ssl, sys

model_id = '$model_id'
provider = '$provider'
primary = '$primary'
api_key = '$key'
ctx = ssl.create_default_context()

try:
    if provider == 'google':
        # Gemini uses different API format
        url = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key={api_key}'
        body = json.dumps({'contents': [{'parts': [{'text': 'Reply OK'}]}], 'generationConfig': {'maxOutputTokens': 16}}).encode()
        req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'}, method='POST')
    elif provider == 'openrouter':
        url = 'https://openrouter.ai/api/v1/chat/completions'
        model_part = primary.split('/', 1)[1]  # remove 'openrouter/' prefix
        body = json.dumps({'model': model_part, 'messages': [{'role': 'user', 'content': 'Reply OK'}], 'max_tokens': 16}).encode()
        req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key}'}, method='POST')
    else:
        # OpenAI-compatible (moonshot, dashscope, zhipu)
        base_urls = {
            'moonshot': 'https://api.moonshot.ai/v1',
            'dashscope': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            'zhipu': 'https://api.z.ai/api/paas/v4',
        }
        url = base_urls[provider] + '/chat/completions'
        model_name = primary.split('/')[-1]
        body = json.dumps({'model': model_name, 'messages': [{'role': 'user', 'content': 'Reply OK'}], 'max_tokens': 16}).encode()
        req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key}'}, method='POST')

    resp = urllib.request.urlopen(req, timeout=30, context=ctx)
    data = json.loads(resp.read().decode())
    print('OK')
except urllib.error.HTTPError as e:
    body = e.read().decode()[:200]
    print(f'HTTP {e.code}: {body}')
except Exception as e:
    print(f'ERROR: {e}')
" 2>&1)

    if [[ "$PROBE_RESULT" == "OK" ]]; then
      check_pass "API probe $model_id ($provider): reachable"
    elif [[ "$PROBE_RESULT" == HTTP\ 4* ]]; then
      # 4xx usually means auth issue or quota
      check_fail "API probe $model_id: $PROBE_RESULT"
    else
      check_warn "API probe $model_id: $PROBE_RESULT"
    fi
  done
fi

# ============================================================
# Report
# ============================================================
echo ""
log "Preflight summary: $PASS_COUNT PASS / $FAIL_COUNT FAIL / $WARN_COUNT WARN"

# Write report
cat > "$REPORT" << EOF
# Benchmark Preflight Report

**Generated**: $(date -Iseconds)
**Server**: $SSH_HOST

## Summary

- PASS: $PASS_COUNT
- FAIL: $FAIL_COUNT
- WARN: $WARN_COUNT

## Models

| Model | Provider | Primary | API Key |
|-------|----------|---------|---------|
EOF

for model_id in "${MODELS[@]}"; do
  key=$(load_api_key "$model_id" 2>/dev/null || echo "")
  masked=""
  if [[ -n "$key" ]]; then
    masked="${key:0:6}...${key: -4}"
  else
    masked="MISSING"
  fi
  echo "| $model_id | $(model_provider "$model_id") | $(model_primary "$model_id") | $masked |" >> "$REPORT"
done

echo "" >> "$REPORT"
echo "## Remote" >> "$REPORT"
echo "" >> "$REPORT"
echo "- SSH: OK" >> "$REPORT"
echo "- Disk: ${FREE_GB}GB free" >> "$REPORT"

log "Report: $REPORT"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  die "Preflight failed with $FAIL_COUNT errors. Fix issues before running benchmark."
fi

log "All preflight checks passed."
