#!/usr/bin/env bash
# ============================================================
# AIDA Benchmark Framework — Shared Functions
# ============================================================
# Sourced by all benchmark scripts. All paths derived from
# SCRIPT_DIR (no hardcoded absolute paths).
# Uses node for JSON parsing (cross-platform, no /c/ path issues).
# ============================================================

set -euo pipefail

# -- Path setup (portable) --
BENCHMARK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$BENCHMARK_DIR/../../.." && pwd)"
RESULTS_DIR="$BENCHMARK_DIR/results"
CONFIG_JSON="$BENCHMARK_DIR/config.json"

# -- JSON helper (node-based, works on Windows Git Bash + Linux) --
# Uses process.argv for path (not require() with /c/ prefix) to be cross-platform
_cfg() {
  node -e "const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf-8')); console.log(eval('c.'+process.argv[2]))" "$CONFIG_JSON" "$1" 2>/dev/null
}

_cfg_arr() {
  node -e "const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf-8')); console.log(eval('c.'+process.argv[2]).join(' '))" "$CONFIG_JSON" "$1" 2>/dev/null
}

# -- Remote server (read from config.json) --
SSH_KEY="$ROOT_DIR/$(_cfg 'server.sshKey')"
SSH_HOST="$(_cfg 'server.host')"
REMOTE_REPO="$(_cfg 'server.repo')"
REMOTE_AIDA_HOME="$(_cfg 'server.aidaHome')"
REMOTE_OPENCLAW_HOME="$(_cfg 'server.openclawHome')"
AGENT_TIMEOUT="$(_cfg 'agentTimeout')"
DASHBOARD_URL="$(_cfg 'dashboardUrl')"
REMOTE_TMP="/tmp/aida-benchmark"

# -- Model list (from config.json) --
read -r -a MODELS <<< "$(_cfg_arr 'models.map(m=>m.id)')"

# ============================================================
# Logging
# ============================================================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()     { printf "${CYAN}[%s]${NC} %s\n" "$(date '+%H:%M:%S')" "$*"; }
pass()    { printf "  ${GREEN}PASS${NC} %s\n" "$*"; }
fail()    { printf "  ${RED}FAIL${NC} %s\n" "$*"; }
warn_()   { printf "  ${YELLOW}WARN${NC} %s\n" "$*"; }
section() { printf "\n${BOLD}${YELLOW}══════════════════════════════════════════════${NC}\n${BOLD}  %s${NC}\n\n" "$*"; }
die()     { printf "${RED}ERROR:${NC} %s\n" "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

# ============================================================
# Model config lookups (from config.json via node)
# ============================================================
_model_field() {
  local model_id="$1" field="$2"
  node -e "
    const c = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf-8'));
    const m = c.models.find(x => x.id === process.argv[2]);
    if (!m) process.exit(1);
    console.log(m[process.argv[3]]);
  " "$CONFIG_JSON" "$model_id" "$field"
}

model_name()     { _model_field "$1" "name"; }
model_provider() { _model_field "$1" "provider"; }
model_primary()  { _model_field "$1" "primary"; }
model_env_var()  { _model_field "$1" "envVar"; }
model_env_file() { echo "$ROOT_DIR/$(_model_field "$1" "envFile")"; }

ensure_model_id() {
  local model_id="$1"
  for candidate in "${MODELS[@]}"; do
    [[ "$candidate" == "$model_id" ]] && return 0
  done
  die "Unsupported model id: $model_id. Valid: ${MODELS[*]}"
}

result_dir() { echo "$RESULTS_DIR/$1"; }

ensure_results_dir() { mkdir -p "$RESULTS_DIR"; }

# ============================================================
# SSH / SCP helpers
# ============================================================
ssh_run() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=30 "$SSH_HOST" "$@"
}

ssh_long() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=600 -o ServerAliveInterval=30 "$SSH_HOST" "$@"
}

scp_to_remote() {
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$1" "$SSH_HOST:$2"
}

scp_from_remote() {
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_HOST:$1" "$2"
}

# ============================================================
# API key loading (pure bash, no python/node path issues)
# ============================================================
load_api_key() {
  local model_id="$1"
  local env_file env_var
  env_file="$(model_env_file "$model_id")"
  env_var="$(model_env_var "$model_id")"
  if [[ ! -f "$env_file" ]]; then
    return 1
  fi
  # Parse KEY=VALUE from env file using bash
  while IFS= read -r line; do
    # Skip comments and empty lines
    [[ -z "$line" || "$line" == \#* ]] && continue
    # Split on first =
    local key="${line%%=*}"
    local val="${line#*=}"
    # Trim whitespace
    key="${key// /}"
    val="${val## }"
    val="${val%% }"
    # Strip quotes
    val="${val#\"}"
    val="${val%\"}"
    val="${val#\'}"
    val="${val%\'}"
    if [[ "$key" == "$env_var" ]]; then
      echo "$val"
      return 0
    fi
  done < "$env_file"
  return 1
}

# ============================================================
# Provider config — generate models.json content via node
# ============================================================
generate_models_json() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const config = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
    const root = process.argv[2];

    function parseEnv(filePath) {
      const vals = {};
      try {
        for (const raw of fs.readFileSync(filePath, "utf-8").split("\n")) {
          const line = raw.trim();
          if (!line || line.startsWith("#") || !line.includes("=")) continue;
          const idx = line.indexOf("=");
          const k = line.slice(0, idx).trim();
          let v = line.slice(idx + 1).trim().replace(/^["'"'"']|["'"'"']$/g, "");
          vals[k] = v;
        }
      } catch {}
      return vals;
    }

    const envCache = {};
    function getKey(envFile, envVar) {
      const fp = path.join(root, envFile);
      if (!envCache[fp]) envCache[fp] = parseEnv(fp);
      return envCache[fp][envVar] || "";
    }

    const providers = {};
    for (const m of config.models) {
      const pid = m.provider;
      const key = getKey(m.envFile, m.envVar);
      if (!providers[pid]) {
        providers[pid] = {
          baseUrl: m.providerConfig.baseUrl,
          api: m.providerConfig.api,
          models: [],
          apiKey: key || m.envVar
        };
      }
      const spec = m.modelSpec || {};
      providers[pid].models.push({
        id: m.primary.split("/").pop(),
        name: m.name,
        reasoning: spec.reasoning || false,
        input: spec.input || ["text"],
        cost: spec.cost || {input:0,output:0,cacheRead:0,cacheWrite:0},
        contextWindow: spec.contextWindow || 128000,
        maxTokens: spec.maxTokens || 8192,
      });
    }

    console.log(JSON.stringify({providers}, null, 2));
  ' "$CONFIG_JSON" "$ROOT_DIR"
}

# ============================================================
# Fallback config
# ============================================================
get_fallbacks_json() {
  node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8")); console.log(JSON.stringify(c.fallbacks))' "$CONFIG_JSON"
}
