#!/usr/bin/env bash
# ============================================================
# AIDA Benchmark — Dedicated Installer
# ============================================================
# Wraps the production install-aida.sh, then overlays benchmark-
# specific model config. Does NOT modify production scripts.
#
# Usage (on test server):
#   BENCHMARK_PRIMARY="openrouter/openai/gpt-5.4" \
#   bash test/e2e/benchmark/install-benchmark.sh
#
# Env vars:
#   BENCHMARK_PRIMARY   — required, the model to test
#   BENCHMARK_FALLBACK  — optional JSON array, defaults to config.json fallbacks
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Can run on remote where lib.sh paths differ — detect context
if [[ -f "$SCRIPT_DIR/lib.sh" ]]; then
  source "$SCRIPT_DIR/lib.sh"
else
  # Running on remote server, minimal setup
  REMOTE_REPO="${REMOTE_REPO:-/root/aida}"
  REMOTE_AIDA_HOME="${AIDA_HOME:-/root/.aida}"
  REMOTE_OPENCLAW_HOME="${OPENCLAW_HOME:-/root/.openclaw}"
fi

PRIMARY="${BENCHMARK_PRIMARY:?BENCHMARK_PRIMARY must be set}"
FALLBACKS="${BENCHMARK_FALLBACK:-}"

# ============================================================
# Step 1: Run production install-aida.sh
# ============================================================
log "Running production install-aida.sh..."
REPO_DIR="${REMOTE_REPO:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
bash "$REPO_DIR/deploy/install-aida.sh"

# ============================================================
# Step 2: Overlay model config in openclaw.json
# ============================================================
OC_CONFIG="${REMOTE_OPENCLAW_HOME:-$HOME/.openclaw}/openclaw.json"

log "Overlaying benchmark model config: $PRIMARY"

node -e '
const fs = require("fs");
const configPath = process.argv[1];
const primary = process.argv[2];
const fallbacksRaw = process.argv[3] || "";

const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Set primary model
if (!config.agents) config.agents = {};
if (!config.agents.defaults) config.agents.defaults = {};
config.agents.defaults.model = {
  primary: primary,
  fallbacks: fallbacksRaw ? JSON.parse(fallbacksRaw) : ["dashscope/qwen3.5-plus", "moonshot/kimi-k2.5"]
};

// Register model alias so OpenClaw recognizes it
if (!config.agents.defaults.models) config.agents.defaults.models = {};
config.agents.defaults.models[primary] = { alias: "Benchmark: " + primary };

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
console.log("[benchmark] openclaw.json updated — primary:", primary);
' "$OC_CONFIG" "$PRIMARY" "$FALLBACKS"

# ============================================================
# Step 3: Write complete models.json with all providers + keys
# ============================================================
MODELS_JSON="${REMOTE_OPENCLAW_HOME:-$HOME/.openclaw}/agents/main/agent/models.json"
mkdir -p "$(dirname "$MODELS_JSON")"

log "Writing models.json with all provider configs..."

# Source all API key env files
for envfile in \
  "$REPO_DIR/.dev/openrouter-api.env" \
  "$REPO_DIR/.dev/google-gemini-api.env" \
  "$REPO_DIR/.dev/model-api-keys.env"; do
  if [[ -f "$envfile" ]]; then
    set +u
    # shellcheck source=/dev/null
    source "$envfile" 2>/dev/null || true
    set -u
  fi
done

node -e '
const fs = require("fs");
const modelsPath = process.argv[1];

// Read existing or start fresh
let data = {};
if (fs.existsSync(modelsPath)) {
  try { data = JSON.parse(fs.readFileSync(modelsPath, "utf-8")); } catch {}
}
if (!data.providers) data.providers = {};

const env = process.env;

// OpenRouter (Claude Opus, GPT-5.4)
if (env.OPENROUTER_API_KEY) {
  data.providers.openrouter = {
    baseUrl: "https://openrouter.ai/api/v1",
    api: "openai-completions",
    models: [
      { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6", reasoning: false, input: ["text", "image"], cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 3.75 }, contextWindow: 200000, maxTokens: 8192 },
      { id: "openai/gpt-5.4", name: "GPT-5.4", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 }
    ],
    apiKey: env.OPENROUTER_API_KEY
  };
}

// Google (Gemini)
if (env.GOOGLE_API_KEY) {
  data.providers.google = {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "google-generative-ai",
    models: [
      { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 8192 }
    ],
    apiKey: env.GOOGLE_API_KEY
  };
}

// Moonshot (Kimi)
if (env.MOONSHOT_API_KEY) {
  data.providers.moonshot = {
    baseUrl: "https://api.moonshot.ai/v1",
    api: "openai-completions",
    models: [
      { id: "kimi-k2.5", name: "Kimi K2.5", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256000, maxTokens: 8192 }
    ],
    apiKey: env.MOONSHOT_API_KEY
  };
}

// DashScope (Qwen) — domestic endpoint
if (env.DASHSCOPE_API_KEY) {
  data.providers.dashscope = {
    baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    api: "openai-completions",
    models: [
      { id: "qwen3.5-plus", name: "Qwen3.5 Plus", reasoning: true, input: ["text"], cost: { input: 3, output: 12, cacheRead: 1, cacheWrite: 2 }, contextWindow: 131072, maxTokens: 8192 }
    ],
    apiKey: env.DASHSCOPE_API_KEY
  };
}

// Zhipu (GLM)
if (env.ZHIPU_API_KEY) {
  data.providers.zhipu = {
    baseUrl: "https://api.z.ai/api/paas/v4",
    api: "openai-completions",
    models: [
      { id: "glm-5", name: "GLM-5", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 }
    ],
    apiKey: env.ZHIPU_API_KEY
  };
}

fs.writeFileSync(modelsPath, JSON.stringify(data, null, 2) + "\n");

const providers = Object.keys(data.providers);
console.log("[benchmark] models.json written — providers:", providers.join(", "));
' "$MODELS_JSON"

log "Benchmark installation complete. Primary model: $PRIMARY"
