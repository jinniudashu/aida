#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
SSH_KEY="$ROOT_DIR/.dev/oc-alicloud.pem"
SSH_HOST="root@47.236.109.62"
REMOTE_REPO="/root/aida"
REMOTE_AIDA_HOME="/root/.aida"
REMOTE_OPENCLAW_HOME="/root/.openclaw"
REMOTE_OUTPUT_BASE="/tmp/model-benchmark-gpt5.4"

MODELS=(
  "claude-opus-4.6"
  "gpt-5.4"
  "gemini-3.1-pro"
  "kimi-k2.5"
  "qwen3.5-plus"
  "glm-5"
)

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

model_name() {
  case "$1" in
    claude-opus-4.6) printf 'Claude Opus 4.6' ;;
    gpt-5.4) printf 'GPT-5.4' ;;
    gemini-3.1-pro) printf 'Gemini 3.1 Pro Preview' ;;
    kimi-k2.5) printf 'Kimi K2.5' ;;
    qwen3.5-plus) printf 'Qwen3.5-Plus' ;;
    glm-5) printf 'GLM-5' ;;
    *) die "Unknown model id: $1" ;;
  esac
}

model_provider() {
  case "$1" in
    claude-opus-4.6|gpt-5.4) printf 'openrouter' ;;
    gemini-3.1-pro) printf 'google' ;;
    kimi-k2.5) printf 'moonshot' ;;
    qwen3.5-plus) printf 'dashscope' ;;
    glm-5) printf 'zhipu' ;;
    *) die "Unknown model id: $1" ;;
  esac
}

model_primary() {
  case "$1" in
    claude-opus-4.6) printf 'openrouter/anthropic/claude-opus-4.6' ;;
    gpt-5.4) printf 'openrouter/openai/gpt-5.4' ;;
    gemini-3.1-pro) printf 'google/gemini-3.1-pro-preview' ;;
    kimi-k2.5) printf 'kimi/kimi-for-coding' ;;
    qwen3.5-plus) printf 'dashscope/qwen3.5-plus' ;;
    glm-5) printf 'zhipu/glm-5' ;;
    *) die "Unknown model id: $1" ;;
  esac
}

model_env_var() {
  case "$1" in
    claude-opus-4.6|gpt-5.4) printf 'OPENROUTER_API_KEY' ;;
    gemini-3.1-pro) printf 'GOOGLE_API_KEY' ;;
    kimi-k2.5) printf 'MOONSHOT_API_KEY' ;;
    qwen3.5-plus) printf 'DASHSCOPE_API_KEY' ;;
    glm-5) printf 'ZHIPU_API_KEY' ;;
    *) die "Unknown model id: $1" ;;
  esac
}

provider_env_file() {
  case "$1" in
    openrouter) printf '%s/.dev/openrouter-api.env' "$ROOT_DIR" ;;
    google) printf '%s/.dev/google-gemini-api.env' "$ROOT_DIR" ;;
    moonshot|dashscope|zhipu) printf '%s/.dev/model-api-keys.env' "$ROOT_DIR" ;;
    *) die "Unknown provider: $1" ;;
  esac
}

ensure_model_id() {
  local model_id="$1"
  local candidate
  for candidate in "${MODELS[@]}"; do
    if [ "$candidate" = "$model_id" ]; then
      return 0
    fi
  done
  die "Unsupported model id: $model_id"
}

result_dir() {
  printf '%s/%s' "$RESULTS_DIR" "$1"
}

ssh_base() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=30 "$SSH_HOST" "$@"
}

scp_from_remote() {
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_HOST:$1" "$2"
}

ensure_results_dir() {
  mkdir -p "$RESULTS_DIR"
}

compose_preflight_probe() {
  local model_id="$1"
  local primary
  local provider
  local env_var
  primary="$(model_primary "$model_id")"
  provider="$(model_provider "$model_id")"
  env_var="$(model_env_var "$model_id")"

  python3 - <<PY
import json
primary = ${primary@Q}
provider = ${provider@Q}
env_var = ${env_var@Q}
probe = {
  "primary": primary,
  "messages": [{"role": "user", "content": "Reply with OK only."}],
  "max_output_tokens": 16,
}
if provider in {"moonshot", "dashscope", "zhipu", "openrouter"}:
    probe = {
      "model": primary.split('/', 1)[1] if provider != "openrouter" else primary.split('/', 1)[1],
      "messages": [{"role": "user", "content": "Reply with OK only."}],
      "max_tokens": 16,
    }
print(json.dumps({"provider": provider, "envVar": env_var, "payload": probe}))
PY
}
