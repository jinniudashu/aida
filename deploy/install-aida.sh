#!/bin/bash
# ============================================================
# AIDA 一键部署脚本
#
# 环境前提：
#   - Node.js >= 22.5（node:sqlite 需要；推荐 24+）
#   - npm
#   - OpenClaw 已安装并初始化（~/.openclaw/ + openclaw.json）
#   - openclaw CLI（可选，缺失则跳过插件注册，提示手动操作）
#   - bash（Linux/macOS 原生；Windows 需 Git Bash 或 WSL）
#
# 部署内容：
#   1. ~/.aida/      业务项目数据（蓝图、种子数据、上下文）
#   2. Aida          主 Agent workspace（IDENTITY/SOUL/AGENTS + skills）
#   3. BPS 引擎      OpenClaw 插件注册
#   4. Dashboard     Hono API + Vue SPA（systemd 服务，port 3456）
#   5. 飞书 Channel  自动启用（需提供 FEISHU_APP_ID + FEISHU_APP_SECRET）
#   6. openclaw.json 配置自动合并
#
# 用法:
#   从 aida 父仓库首次部署:
#     git clone --recurse-submodules <aida-repo>
#     bash packages/bps-engine/deploy/install-aida.sh
#
#   从 bps-engine 独立仓库首次部署:
#     git clone <bps-engine-repo>
#     bash deploy/install-aida.sh
#
#   后续更新:
#     bash deploy/install-aida.sh  （幂等，自动 git pull + npm install）
# ============================================================

set -euo pipefail

# 配置
OC_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
AIDA_HOME="${AIDA_HOME:-$HOME/.aida}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENGINE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENTS_DIR="$ENGINE_DIR/agents"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!!]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1" >&2; exit 1; }
info() { echo -e "${CYAN}[..]${NC} $1"; }

echo ""
echo "========================================"
echo "  AIDA 一键部署"
echo "========================================"
echo ""

# ============================================================
# Section 0: 预检查
# ============================================================
info "预检查..."

# --- 0a: 基础工具 ---
command -v node >/dev/null 2>&1 || err "未找到 node 命令，请先安装 Node.js >= 22.5"
command -v npm >/dev/null 2>&1 || err "未找到 npm 命令，请先安装 Node.js"

# --- 0b: Node.js 版本（node:sqlite 需要 >= 22.5） ---
NODE_VERSION=$(node -e 'console.log(process.versions.node)')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
NODE_MINOR=$(echo "$NODE_VERSION" | cut -d. -f2)
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; }; then
  err "Node.js 版本过低: $NODE_VERSION（需要 >= 22.5，推荐 24+）"
fi
if [ "$NODE_MAJOR" -lt 24 ]; then
  warn "Node.js $NODE_VERSION — node:sqlite 为实验性功能，推荐升级到 24+"
else
  log "Node.js $NODE_VERSION"
fi

# --- 0c: OpenClaw ---
[ -d "$OC_HOME" ] || err "OpenClaw 目录不存在: $OC_HOME（请先安装并初始化 OpenClaw）"
[ -f "$OC_HOME/openclaw.json" ] || err "未找到 openclaw.json: $OC_HOME/openclaw.json"

# --- 0d: Agent workspace 源文件 ---
# 如果 agents/ 为空，可能是 git submodule 未初始化
if [ ! -d "$AGENTS_DIR/aida" ]; then
  # 检查是否在 aida 父仓库的 submodule 中
  PARENT_DIR="$(cd "$ENGINE_DIR/../.." 2>/dev/null && pwd)"
  if [ -f "$PARENT_DIR/.gitmodules" ] && grep -q "bps-engine" "$PARENT_DIR/.gitmodules" 2>/dev/null; then
    info "检测到 git submodule，正在初始化..."
    git -C "$PARENT_DIR" submodule update --init --recursive 2>&1 && log "submodule 初始化成功" || err "submodule 初始化失败，请手动运行: git submodule update --init --recursive"
  fi
fi

[ -d "$AGENTS_DIR/aida" ] || err "Aida workspace 源文件不存在: $AGENTS_DIR/aida"

log "预检查通过"

# ============================================================
# Section 1: 拉取最新代码 + 安装依赖
# ============================================================
if [ -d "$ENGINE_DIR/.git" ]; then
  info "拉取最新代码..."
  git -C "$ENGINE_DIR" pull --ff-only 2>&1 && log "git pull 成功" || warn "git pull 失败，使用当前版本继续"
else
  warn "非 git 仓库，跳过 git pull"
fi

info "安装 npm 依赖..."
npm install --prefix "$ENGINE_DIR" 2>&1 | tail -1
log "npm install 完成"

info "编译 bps-engine..."
(cd "$ENGINE_DIR" && npx tsc) 2>&1 | tail -3
log "bps-engine 编译完成"

# ============================================================
# Section 2: 初始化 ~/.aida/ 业务项目目录
# ============================================================
info "初始化 AIDA 项目目录: $AIDA_HOME"

mkdir -p "$AIDA_HOME/blueprints" "$AIDA_HOME/data" "$AIDA_HOME/context"
log "目录结构就绪（项目初始化由 Aida 引导完成）"

# ============================================================
# Section 3: Agent workspace 部署
# ============================================================

# --- 3a: Aida → 主 Agent workspace ---
MAIN_WS="$OC_HOME/workspace"
info "合并 Aida → 主 Agent workspace: $MAIN_WS"
mkdir -p "$MAIN_WS"

for f in IDENTITY.md SOUL.md AGENTS.md HEARTBEAT.md BOOT.md USER.md TOOLS.md; do
  if [ -f "$AGENTS_DIR/aida/$f" ]; then
    if [ -f "$MAIN_WS/$f" ]; then
      cp "$MAIN_WS/$f" "$MAIN_WS/$f.bak.$TIMESTAMP"
    fi
    cp "$AGENTS_DIR/aida/$f" "$MAIN_WS/$f"
    log "  Aida/$f"
  else
    warn "  缺少 aida/$f，跳过"
  fi
done

# --- 3a-skills: Aida skills ---
if [ -d "$AGENTS_DIR/aida/skills" ]; then
  info "安装 Aida skills → $MAIN_WS/skills/"
  mkdir -p "$MAIN_WS/skills"
  SKILL_COUNT=0
  for skill_dir in "$AGENTS_DIR/aida/skills"/*/; do
    skill_name="$(basename "$skill_dir")"
    if [ -f "$skill_dir/SKILL.md" ]; then
      mkdir -p "$MAIN_WS/skills/$skill_name"
      cp "$skill_dir/SKILL.md" "$MAIN_WS/skills/$skill_name/SKILL.md"
      SKILL_COUNT=$((SKILL_COUNT + 1))
      log "  skill/$skill_name"
    fi
  done
  log "$SKILL_COUNT skill(s) 已安装"
else
  warn "未找到 aida/skills/，跳过 skill 安装"
fi

# ============================================================
# Section 4: BPS 引擎扩展注册
# ============================================================
info "安装 BPS 引擎扩展..."

# 清理旧的手动 symlink（如有）
BPS_EXT="$OC_HOME/extensions/bps-engine"
if [ -L "$BPS_EXT" ]; then
  rm "$BPS_EXT"
  warn "  移除旧手动 symlink"
fi

# 清理 openclaw.json 中残留的旧 plugin 路径（如 packages/bps-engine）
OC_CONFIG_CLEAN="$OC_HOME/openclaw.json"
if [ -f "$OC_CONFIG_CLEAN" ]; then
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const c = JSON.parse(fs.readFileSync(p, "utf-8"));
    let cleaned = false;
    if (c.plugins?.load?.paths && Array.isArray(c.plugins.load.paths)) {
      const before = c.plugins.load.paths.length;
      c.plugins.load.paths = c.plugins.load.paths.filter(p => !p.includes("packages/bps-engine") && !p.includes("packages\\\\bps-engine"));
      if (c.plugins.load.paths.length < before) {
        cleaned = true;
        if (c.plugins.load.paths.length === 0) delete c.plugins.load.paths;
        if (c.plugins.load && Object.keys(c.plugins.load).length === 0) delete c.plugins.load;
      }
    }
    if (cleaned) {
      fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
      console.error("cleaned stale plugin paths");
    }
  ' "$OC_CONFIG_CLEAN" 2>&1 && log "  清理旧 plugin 路径完成" || true
fi

if command -v openclaw >/dev/null 2>&1; then
  openclaw plugins install --link "$ENGINE_DIR" 2>&1 && log "openclaw plugins install --link 成功" || {
    warn "  已安装，尝试重新安装..."
    openclaw plugins uninstall bps-engine 2>/dev/null
    openclaw plugins install --link "$ENGINE_DIR" 2>&1 && log "  重新安装成功" || warn "  安装失败，请手动运行: openclaw plugins install --link $ENGINE_DIR"
  }
else
  warn "未找到 openclaw 命令，请手动运行: openclaw plugins install --link $ENGINE_DIR"
fi

# ============================================================
# Section 4b: Dashboard 构建与部署（dashboard/ 子目录，已合并入 bps-engine）
# ============================================================
DASHBOARD_DIR="$ENGINE_DIR/dashboard"

if [ -d "$DASHBOARD_DIR" ]; then
  info "构建 Dashboard..."
  npm run build:dashboard --prefix "$ENGINE_DIR" 2>&1 | tail -1
  log "Dashboard 构建完成"

  # 安装 systemd 服务
  if command -v systemctl >/dev/null 2>&1; then
    cat > /etc/systemd/system/bps-dashboard.service <<SVCEOF
[Unit]
Description=BPS Dashboard (Hono API + Vue SPA)
After=network.target

[Service]
Type=simple
WorkingDirectory=$ENGINE_DIR
ExecStart=/usr/bin/node --import tsx dashboard/server/index.ts
Environment=BPS_DB_PATH=$AIDA_HOME/data/bps.db
Environment=BPS_API_PORT=3456
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF
    systemctl daemon-reload
    systemctl enable bps-dashboard
    systemctl restart bps-dashboard
    log "bps-dashboard systemd 服务已启动"
  fi
else
  warn "未找到 Dashboard 目录: $DASHBOARD_DIR，跳过 Dashboard 部署"
fi

# ============================================================
# Section 5: 自动合并 openclaw.json 配置
# ============================================================
OC_CONFIG="$OC_HOME/openclaw.json"

info "合并 Agent 配置到 $OC_CONFIG"

# 备份
cp "$OC_CONFIG" "$OC_CONFIG.bak.$TIMESTAMP"

# 飞书凭据：从环境变量或 ~/.aida/.env 读取
if [ -z "${FEISHU_APP_ID:-}" ] && [ -f "$AIDA_HOME/.env" ]; then
  # shellcheck source=/dev/null
  source "$AIDA_HOME/.env" 2>/dev/null || true
fi

node -e '
const fs = require("fs");
const configPath = process.argv[1];
const feishuAppId = process.argv[2] || "";
const feishuAppSecret = process.argv[3] || "";
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// 1. agents.defaults — set default model + compaction
if (!config.agents) config.agents = {};
if (!config.agents.defaults) config.agents.defaults = {};
config.agents.defaults.model = { primary: "dashscope/qwen3.5-plus" };
config.agents.defaults.models = { "dashscope/qwen3.5-plus": { alias: "Qwen3.5-Plus via DashScope" } };

// 2. agents.list — upsert Aida (main agent only)
if (!Array.isArray(config.agents.list)) config.agents.list = [];

const aidaDef = {
  id: "main",
  default: true,
  workspace: "~/.openclaw/workspace",
  identity: {
    name: "Aida",
    theme: "Chief management assistant, the personification of the intelligent orchestration layer",
    emoji: "\uD83C\uDF1F"
  }
};

const idx = config.agents.list.findIndex(a => a.id === "main");
if (idx >= 0) {
  config.agents.list[idx] = aidaDef;
} else {
  config.agents.list.push(aidaDef);
}

// 3. Remove legacy mainAgent key (incompatible with OC >= 2026.3)
delete config.mainAgent;

// 4. Clean up stale agent entries (bps-expert, org-architect)
config.agents.list = config.agents.list.filter(a => a.id !== "bps-expert" && a.id !== "org-architect");
if (Array.isArray(config.bindings)) {
  config.bindings = config.bindings.filter(b => b.agentId !== "bps-expert" && b.agentId !== "org-architect");
}

// 5. Feishu channel — enable plugin + configure channel
if (!config.plugins) config.plugins = {};
if (!config.plugins.entries) config.plugins.entries = {};
if (!config.channels) config.channels = {};

if (feishuAppId && feishuAppSecret) {
  // Enable feishu plugin, disable telegram (feishu is the default channel)
  config.plugins.entries.feishu = { enabled: true };
  delete config.plugins.entries.telegram;

  // Configure feishu channel (preserve existing groups if any)
  const existingFeishu = config.channels.feishu || {};
  config.channels.feishu = {
    enabled: true,
    dmPolicy: "pairing",
    groupPolicy: existingFeishu.groupPolicy || "open",
    streaming: true,
    blockStreaming: true,
    ...existingFeishu,
    enabled: true,  // always force enabled
    accounts: {
      ...(existingFeishu.accounts || {}),
      main: {
        appId: feishuAppId,
        appSecret: feishuAppSecret,
        botName: "Aida",
        ...(existingFeishu.accounts?.main || {}),
        appId: feishuAppId,   // always update credentials
        appSecret: feishuAppSecret,
      }
    }
  };

  // Disable telegram when feishu is configured
  if (config.channels.telegram) {
    config.channels.telegram.enabled = false;
  }

  console.error("[feishu] channel configured as default (appId: " + feishuAppId + ")");
  console.error("[telegram] disabled (feishu is default channel)");
} else {
  console.error("[feishu] FEISHU_APP_ID / FEISHU_APP_SECRET not set, skipping feishu config");
}

// 6. Model fallback chain (P0: production availability)
if (typeof config.agents.defaults.model === "string") {
  config.agents.defaults.model = { primary: config.agents.defaults.model };
}
config.agents.defaults.model.fallbacks = [
  "kimi/kimi-for-coding"
];

// 7. Hooks — enable internal hooks so BOOT.md executes on Gateway restart (P1)
if (!config.hooks) config.hooks = {};
if (!config.hooks.internal) config.hooks.internal = {};
if (config.hooks.internal.enabled === undefined) {
  config.hooks.internal.enabled = true;
}

// 8. Security baseline (P0: prevent management bypass via native tools)
if (!config.tools) config.tools = {};
// Exec security: require allowlist approval for shell commands
if (!config.tools.exec) config.tools.exec = {};
if (!config.tools.exec.security) {
  config.tools.exec.security = "allowlist";
  config.tools.exec.ask = "on-miss";
}

// NOTE: loopDetection, compaction, contextPruning removed — OpenClaw 2026.3.x
// rejects these as unrecognized keys, blocking agent startup.

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
' "$OC_CONFIG" "${FEISHU_APP_ID:-}" "${FEISHU_APP_SECRET:-}" && log "openclaw.json 配置已自动合并" || {
  warn "自动合并失败，已备份到 $OC_CONFIG.bak.$TIMESTAMP"
  warn "请手动配置 agents.list 和 bindings"
}

# ============================================================
# Section 5b: Custom Model Providers (models.json)
# ============================================================
# Default models (dashscope/qwen3.5-plus, kimi/kimi-for-coding) are custom providers
# not built into OpenClaw. models.json defines baseUrl, API format, and model specs.
# API keys are read from env vars: DASHSCOPE_API_KEY, KIMI_API_KEY
AGENT_AUTH_DIR="$OC_HOME/agents/main/agent"
MODELS_JSON="$AGENT_AUTH_DIR/models.json"

mkdir -p "$AGENT_AUTH_DIR"
node -e '
const fs = require("fs");
const modelsPath = process.argv[1];
const dashscopeKey = process.argv[2] || "";
const kimiKey = process.argv[3] || "";

let data = {};
if (fs.existsSync(modelsPath)) {
  try { data = JSON.parse(fs.readFileSync(modelsPath, "utf-8")); } catch {}
}
if (!data.providers) data.providers = {};

// DashScope (Qwen) — primary model
if (dashscopeKey) {
  data.providers.dashscope = {
    baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    api: "openai-completions",
    models: [{
      id: "qwen3.5-plus",
      name: "Qwen3.5 Plus",
      reasoning: true,
      input: ["text"],
      cost: { input: 3, output: 12, cacheRead: 1, cacheWrite: 2 },
      contextWindow: 131072,
      maxTokens: 8192
    }],
    apiKey: dashscopeKey
  };
  console.error("[models] dashscope provider configured (qwen3.5-plus)");
} else {
  console.error("[models] DASHSCOPE_API_KEY not set, skipping dashscope provider");
}

// Kimi Coding Plan — fallback model
if (kimiKey) {
  data.providers.kimi = {
    baseUrl: "https://api.kimi.com/coding/v1",
    api: "openai-completions",
    models: [{
      id: "kimi-for-coding",
      name: "Kimi for Coding",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 256000,
      maxTokens: 8192
    }],
    apiKey: kimiKey
  };
  console.error("[models] kimi provider configured (kimi-for-coding)");
} else {
  console.error("[models] KIMI_API_KEY not set, skipping kimi provider");
}

// Remove legacy moonshot provider if present
delete data.providers.moonshot;

fs.writeFileSync(modelsPath, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
' "$MODELS_JSON" "${DASHSCOPE_API_KEY:-}" "${KIMI_API_KEY:-}" && \
  log "models.json 已更新" || warn "models.json 写入失败"

if [ -z "${DASHSCOPE_API_KEY:-}" ] && [ -z "${KIMI_API_KEY:-}" ]; then
  warn "DASHSCOPE_API_KEY 和 KIMI_API_KEY 均未设置"
  info "  设置方法: export DASHSCOPE_API_KEY=sk-... KIMI_API_KEY=sk-... && bash deploy/install-aida.sh"
fi

# ============================================================
# Section 5c: Gateway Auth (auth-profiles.json)
# ============================================================
# Optional: OpenRouter auth for fallback or alternative models.
AUTH_PROFILES="$AGENT_AUTH_DIR/auth-profiles.json"

node -e '
const fs = require("fs");
const authPath = process.argv[1];
const modelsPath = process.argv[2];
const orKey = process.argv[3] || "";

let data = { version: 1, profiles: {}, lastGood: {}, usageStats: {} };
if (fs.existsSync(authPath)) {
  try { data = JSON.parse(fs.readFileSync(authPath, "utf-8")); } catch {}
}

// OpenRouter (from env)
if (orKey) {
  data.profiles["openrouter:manual"] = { type: "api_key", provider: "openrouter", key: orKey };
  data.lastGood.openrouter = "openrouter:manual";
}

// Sync provider keys from models.json → auth-profiles.json
if (fs.existsSync(modelsPath)) {
  try {
    const models = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
    for (const [name, provider] of Object.entries(models.providers || {})) {
      if (provider.apiKey) {
        const profileId = name + ":manual";
        data.profiles[profileId] = { type: "api_key", provider: name, key: provider.apiKey };
        data.lastGood[name] = profileId;
        // Clear any stale cooldown/errors
        if (data.usageStats[profileId]) {
          delete data.usageStats[profileId].failureCounts;
          delete data.usageStats[profileId].cooldownUntil;
          delete data.usageStats[profileId].lastFailureAt;
          data.usageStats[profileId].errorCount = 0;
        }
      }
    }
  } catch {}
}

// Remove legacy moonshot
delete data.profiles["moonshot:manual"];
delete data.lastGood.moonshot;
delete data.usageStats["moonshot:manual"];

fs.writeFileSync(authPath, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
console.error("[auth] auth-profiles.json synced from models.json");
' "$AUTH_PROFILES" "$MODELS_JSON" "${OPENROUTER_API_KEY:-}" && \
    log "Gateway auth: auth-profiles.json 已同步" || \
    warn "auth-profiles.json 写入失败"

# ============================================================
# Section 6: 验证
# ============================================================
echo ""
info "部署验证..."

ERRORS=0

# 验证 ~/.aida/
if [ -f "$AIDA_HOME/project.yaml" ]; then
  log "~/.aida/project.yaml 存在"
else
  log "~/.aida/project.yaml 尚未创建（首次启动时由 Aida 引导生成）"
fi

# 验证主 workspace
for f in IDENTITY.md SOUL.md AGENTS.md HEARTBEAT.md BOOT.md USER.md TOOLS.md; do
  if [ ! -f "$MAIN_WS/$f" ]; then
    warn "主 workspace 缺少 $f"
    ERRORS=$((ERRORS + 1))
  fi
done
[ "$ERRORS" -eq 0 ] && log "Aida 主 workspace 完整"

# 验证 skills
SKILL_INSTALLED=$(find "$MAIN_WS/skills" -name "SKILL.md" 2>/dev/null | wc -l)
if [ "$SKILL_INSTALLED" -ge 6 ]; then
  log "Aida skills 完整 ($SKILL_INSTALLED skill(s))"
else
  warn "Aida skills 不完整: 期望 >= 6，实际 $SKILL_INSTALLED"
  ERRORS=$((ERRORS + 1))
fi

# 验证 Dashboard
if [ -d "$DASHBOARD_DIR" ]; then
  if [ -f "$DASHBOARD_DIR/dist/client/index.html" ]; then
    log "Dashboard 构建产物完整"
  else
    warn "Dashboard 构建产物缺失: dashboard/dist/client/index.html"
    ERRORS=$((ERRORS + 1))
  fi
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active bps-dashboard >/dev/null 2>&1; then
    log "Dashboard 服务运行中"
  elif command -v systemctl >/dev/null 2>&1; then
    warn "Dashboard 服务未运行"
    ERRORS=$((ERRORS + 1))
  fi
fi

# 验证扩展注册
if command -v openclaw >/dev/null 2>&1; then
  if openclaw plugins info bps-engine >/dev/null 2>&1; then
    log "BPS 引擎扩展已注册"
  else
    warn "BPS 引擎扩展未注册"
    ERRORS=$((ERRORS + 1))
  fi
fi

# 验证 openclaw.json 配置
if node -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8"));
  const ok = Array.isArray(c.agents?.list)
    && c.agents.list.some(a => a.id === "main" && a.default === true);
  process.exit(ok ? 0 : 1);
' "$OC_CONFIG" 2>/dev/null; then
  log "openclaw.json 配置正确"
else
  warn "openclaw.json 配置不完整"
  ERRORS=$((ERRORS + 1))
fi

# 验证飞书 Channel
if node -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8"));
  const ok = c.channels?.feishu?.enabled === true
    && c.channels.feishu.accounts?.main?.appId;
  process.exit(ok ? 0 : 1);
' "$OC_CONFIG" 2>/dev/null; then
  log "飞书 Channel 已配置"
else
  warn "飞书 Channel 未配置（设置 FEISHU_APP_ID + FEISHU_APP_SECRET 后重新运行）"
fi

# ============================================================
# 完成
# ============================================================
echo ""
echo "========================================"
if [ "$ERRORS" -eq 0 ]; then
  echo -e "  ${GREEN}部署完成${NC}"
else
  echo -e "  ${YELLOW}部署完成（$ERRORS 个警告）${NC}"
fi
echo "========================================"
echo ""
log "已部署："
echo "  ~/.aida/                   ← 业务项目数据"
echo "  Aida（主 Agent + skills）  ← $MAIN_WS"
echo "  BPS 引擎扩展              ← openclaw plugins"
echo "  openclaw.json              ← 配置已自动合并"
if [ -d "$DASHBOARD_DIR" ]; then
  echo "  Dashboard                  ← $DASHBOARD_DIR (port 3456)"
fi
if [ -n "${FEISHU_APP_ID:-}" ]; then
  echo "  飞书 Channel               ← 已配置（重启 gateway 生效）"
fi
echo ""
if [ "$ERRORS" -eq 0 ]; then
  log "重启 OpenClaw 实例即可生效"
  echo "  验证：发送 '你是谁？' 确认 Aida 已激活"
  if [ -n "${FEISHU_APP_ID:-}" ]; then
    echo "  飞书：在飞书中找到 Aida 机器人发送消息，然后运行："
    echo "    openclaw pairing approve feishu <CODE>"
  fi
else
  warn "请检查上方警告信息"
fi
echo ""
