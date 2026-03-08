#!/usr/bin/env bash
# ============================================================
# IdleX GEO E2E Test v3
# ============================================================
# Full lifecycle: Install -> Seed -> Model -> Execute -> Govern -> Summary
# Tests: Two-Layer routing, self-evolution (Skill + Agent), new workspace files
#
# Usage:
#   bash test/e2e/idlex-geo-v3.sh [--skip-install] [--skip-seed] [--phase N]
#
# Test plan: test/e2e/idlex-geo-v3.md
# Run on: root@47.236.109.62
# ============================================================

set -euo pipefail

# -- Configuration --
AIDA_HOME="${AIDA_HOME:-$HOME/.aida}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
AIDA_REPO="${AIDA_REPO:-$HOME/aida}"
DASHBOARD_URL="http://localhost:3456"
MOCK_PUBLISH="$AIDA_HOME/mock-publish"
LOG_DIR="/tmp/idlex-geo-e2e-v3"
AGENT_TIMEOUT=300

IDLEX_DOCS="${IDLEX_DOCS:-$HOME/idlekr/docs}"

SKIP_INSTALL=false
SKIP_SEED=false
START_PHASE=0
PASS=0; FAIL=0; WARNS=0; TOTAL=0

# Session continuity: dmScope=main routes ALL turns to agent:main:main automatically.
# No --session-id needed. Clean session files before test to get fresh context + model.

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-install) SKIP_INSTALL=true; shift ;;
    --skip-seed)    SKIP_SEED=true; shift ;;
    --phase)        START_PHASE="${2:-0}"; shift 2 ;;
    *)              shift ;;
  esac
done

mkdir -p "$LOG_DIR"

# -- Helpers --
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()     { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
pass()    { echo -e "  ${GREEN}PASS${NC} $*"; PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); }
fail()    { echo -e "  ${RED}FAIL${NC} $*"; FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); }
warn_()   { echo -e "  ${YELLOW}WARN${NC} $*"; WARNS=$((WARNS+1)); }
section() { echo -e "\n${BOLD}${YELLOW}══════════════════════════════════════════════${NC}"; \
            echo -e "${BOLD}  Phase $*${NC}"; \
            echo -e "${BOLD}${YELLOW}══════════════════════════════════════════════${NC}\n"; }

check() { local desc="$1"; shift; if eval "$@" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi; }
soft()  { local desc="$1"; shift; if eval "$@" >/dev/null 2>&1; then pass "$desc"; else warn_ "$desc (non-critical)"; fi; }

api_get()  { curl -sf "$DASHBOARD_URL$1" 2>/dev/null; }
api_post() { curl -sf -X POST -H "Content-Type: application/json" -d "$2" "$DASHBOARD_URL$1" 2>/dev/null; }
jlen()     { node -e "try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(Array.isArray(d)?d.length:0)}catch{console.log(0)}"; }

aida_say() {
  local turn="$1"; shift; local msg="$1"
  log "Turn $turn: sending to Aida (dmScope=main, shared session)..."
  local out="$LOG_DIR/turn-$turn.log"
  timeout "$AGENT_TIMEOUT" openclaw agent --agent main --message "$msg" > "$out" 2>&1 || true
  echo -e "${CYAN}--- Aida response (turn $turn, first 30 lines) ---${NC}"
  head -30 "$out"
  echo -e "${CYAN}--- (full log: $out, $(wc -l < "$out") lines total) ---${NC}\n"
}

# ════════════════════════════════════════════════════════════
# Phase 0: Clean Environment + Install
# ════════════════════════════════════════════════════════════

if [ "$SKIP_INSTALL" = false ] && [ "$START_PHASE" -le 0 ]; then
  section "0: Clean Environment + Install"

  log "Stopping existing services..."
  systemctl stop bps-dashboard 2>/dev/null || true
  systemctl stop openclaw-gateway 2>/dev/null || true
  # Fallback: kill any orphan gateway processes
  pkill -f "openclaw gateway" 2>/dev/null || true
  sleep 3

  log "Backing up ~/.aida/ ..."
  [ -d "$AIDA_HOME" ] && mv "$AIDA_HOME" "$AIDA_HOME.bak.$(date +%Y%m%d%H%M%S)"

  # Full OpenClaw state wipe — start from clean slate
  # Keep agents/main/agent/models.json (auth + model routing) but wipe sessions
  log "Wiping OpenClaw state (workspace, sessions, cron, memory)..."
  rm -rf "$OPENCLAW_HOME/workspace/" 2>/dev/null || true
  rm -rf "$OPENCLAW_HOME"/workspace-* 2>/dev/null || true
  # Wipe session data (but keep agent auth/models config)
  rm -rf "$OPENCLAW_HOME/agents/main/sessions/" 2>/dev/null || true
  # Remove cron and other state files
  find "$OPENCLAW_HOME" -name "cron*.json" -o -name "cron*.jsonl" \
    -o -name "sessions.json" -o -name "*.session" 2>/dev/null | while read -r sf; do
    rm -f "$sf"
  done
  log "  State wiped (plugins, config, and auth preserved)"

  # Load API keys before install so install-aida.sh can write auth-profiles.json
  log "Loading API keys..."
  if [ -f /etc/environment ]; then
    eval "$(grep OPENROUTER /etc/environment 2>/dev/null)" || true
  fi
  if [ -f "$HOME/aida/.dev/openrouter-api.env" ]; then
    source "$HOME/aida/.dev/openrouter-api.env" 2>/dev/null || true
  fi
  if [ -n "${OPENROUTER_API_KEY:-}" ]; then
    export OPENROUTER_API_KEY
    log "  OPENROUTER_API_KEY loaded (${#OPENROUTER_API_KEY} chars)"
  else
    warn_ "OPENROUTER_API_KEY not found — GPT-5.4 will fail, fallback models will be used"
  fi

  log "Updating repo..."
  cd "$AIDA_REPO"
  git pull --recurse-submodules 2>&1 | tail -3 || true

  log "Running install-aida.sh (includes Gateway auth setup)..."
  bash deploy/install-aida.sh

  log "Starting OpenClaw gateway..."
  openclaw gateway start 2>/dev/null || warn_ "Gateway start returned non-zero"

  # Wait for gateway health with polling
  log "Waiting for gateway health..."
  for i in $(seq 1 12); do
    if openclaw gateway status 2>/dev/null | grep -qi "running\|healthy\|active"; then
      log "  Gateway healthy after ${i}x5s"
      break
    fi
    sleep 5
  done

  # Verify model config
  log "Verifying model config..."
  if [ -f "$OPENCLAW_HOME/openclaw.json" ]; then
    node -e "const c=JSON.parse(require('fs').readFileSync('$OPENCLAW_HOME/openclaw.json','utf8'));
    console.log('  Primary model:', c.agents?.defaults?.model?.primary || 'not set');
    console.log('  Fallbacks:', JSON.stringify(c.agents?.defaults?.model?.fallbacks || []))" 2>/dev/null || true
  fi

  # Verify no stale sessions exist
  SESSION_FILES=$(find "$OPENCLAW_HOME" -name "*.jsonl" -path "*/sessions/*" 2>/dev/null | wc -l)
  if [ "$SESSION_FILES" -eq 0 ]; then
    log "  No stale session files — clean start confirmed"
  else
    warn_ "Found $SESSION_FILES stale session files after cleanup"
  fi

  log "V0: Post-install checks"
  check "V0.1 ~/.aida/blueprints/"  "test -d $AIDA_HOME/blueprints"
  check "V0.2 ~/.aida/data/"        "test -d $AIDA_HOME/data"
  check "V0.3 ~/.aida/context/"     "test -d $AIDA_HOME/context"
  check "V0.4 SOUL.md"              "test -f $OPENCLAW_HOME/workspace/SOUL.md"
  check "V0.5 AGENTS.md"            "test -f $OPENCLAW_HOME/workspace/AGENTS.md"
  check "V0.6 HEARTBEAT.md"         "test -f $OPENCLAW_HOME/workspace/HEARTBEAT.md"
  check "V0.7 BOOT.md"              "test -f $OPENCLAW_HOME/workspace/BOOT.md"
  check "V0.8 USER.md"              "test -f $OPENCLAW_HOME/workspace/USER.md"
  check "V0.9 TOOLS.md"             "test -f $OPENCLAW_HOME/workspace/TOOLS.md"

  SKILL_N=$(find "$OPENCLAW_HOME/workspace/skills/" -name SKILL.md 2>/dev/null | wc -l)
  check "V0.10 Skills >= 7 (found $SKILL_N)" "test $SKILL_N -ge 7"
  check "V0.11 Dashboard /api/overview" "curl -sf $DASHBOARD_URL/api/overview >/dev/null"

  # Verify USER.md content
  soft "V0.12 USER.md has timezone" "grep -q 'Asia/Shanghai' $OPENCLAW_HOME/workspace/USER.md"
  soft "V0.13 TOOLS.md has BPS tools" "grep -q 'bps_update_entity' $OPENCLAW_HOME/workspace/TOOLS.md"

  # Verify Gateway auth (P0 fix: auth-profiles.json must have OpenRouter key)
  check "V0.15 Gateway auth-profiles.json" "test -f $OPENCLAW_HOME/agents/main/agent/auth-profiles.json"
  soft  "V0.16 OpenRouter auth configured" "grep -q 'openrouter' $OPENCLAW_HOME/agents/main/agent/auth-profiles.json"

  # Verify SOUL.md Two-Layer is condensed (not full routing table)
  soft "V0.14 SOUL.md Two-Layer condensed" "grep -q 'See AGENTS.md' $OPENCLAW_HOME/workspace/SOUL.md"

  log "Phase 0 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 1: Data Seeding
# ════════════════════════════════════════════════════════════

if [ "$SKIP_SEED" = false ] && [ "$START_PHASE" -le 1 ]; then
  section "1: Data Seeding"

  # 1a. project.yaml
  log "Creating project.yaml..."
  cat > "$AIDA_HOME/project.yaml" << 'YAML'
version: "1.1"
name: "IdleX GEO Operations"
projectId: "idlex-geo"
description: "IdleX partner store AI visibility (GEO) daily operations"
language: "zh"
blueprints: []
knowledge: []
YAML

  # 1b. governance.yaml
  log "Creating governance.yaml..."
  cat > "$AIDA_HOME/governance.yaml" << 'YAML'
policies:
  - id: p-content
    label: "Content Publication Controls"
    constraints:
      - id: c-content-publish
        label: "Publishing content requires human approval"
        scope:
          tools: [bps_update_entity]
          entityTypes: [geo-content, content]
          dataFields: [publishReady]
        condition: "publishReady == 0"
        onViolation: REQUIRE_APPROVAL
        severity: HIGH
        approver: owner
        message: "Content publish requires approval: {entityId}"

      - id: c-no-archive
        label: "Cannot archive content entities"
        scope:
          tools: [bps_update_entity]
          entityTypes: [geo-content, content]
          dataFields: [lifecycle]
        condition: "lifecycle != 'ARCHIVED'"
        onViolation: BLOCK
        severity: CRITICAL
        message: "Cannot archive content: {entityId}"

  - id: p-strategy
    label: "Strategy Change Controls"
    constraints:
      - id: c-strategy-change
        label: "Strategy changes require human approval"
        scope:
          tools: [bps_update_entity]
          entityTypes: [geo-strategy, strategy]
          dataFields: [majorChange]
        condition: "majorChange == 0"
        onViolation: REQUIRE_APPROVAL
        severity: HIGH
        approver: owner
        message: "Strategy change requires approval"

circuit_breaker:
  thresholds:
    - severity: CRITICAL
      max_violations: 1
      window: 1h
      action: DISCONNECTED
    - severity: HIGH
      max_violations: 5
      window: 1h
      action: RESTRICTED
  cooldown: 30m
YAML

  # 1c. Business context docs
  log "Copying business context docs..."
  if [ -d "$IDLEX_DOCS" ]; then
    cp "$IDLEX_DOCS"/*.md "$AIDA_HOME/context/" 2>/dev/null || true
    DOC_COUNT=$(ls "$AIDA_HOME/context/"*.md 2>/dev/null | wc -l)
    log "  Copied $DOC_COUNT docs from $IDLEX_DOCS"
  else
    warn_ "IdleX docs not found at $IDLEX_DOCS — creating fallback context"
    cat > "$AIDA_HOME/context/idlex-overview.md" << 'CTXEOF'
# IdleX Business Overview

IdleX (闲氪) is an AI-era urban third-space infrastructure platform.
Mission: Transform idle time slots in self-service spaces into AI-discoverable digital assets.

## Core Market
Self-service KTV, tea rooms, mahjong parlors — fully autonomous, online bookable, pay-by-time spaces.

## Three Core Principles
1. AI can SEE it (真/Truth): All data real, real-time, verifiable
2. AI dares to CALL it (一模一策): Different LLMs get different interfaces
3. AI can DELIVER it (履约): Booking -> payment -> verification -> in-store

## GEO Strategy: One Model One Strategy
Each AI model (豆包/千问/元宝) has different preferences — optimize specifically for each.
Content types: StoreDescription, FAQ, ScenarioStory, StructuredData.

## Brand Goal
"When AI answers space questions, it thinks of IdleX first"
CTXEOF
  fi

  # 1d. Mock-publish dirs
  log "Creating mock-publish directories..."
  mkdir -p "$MOCK_PUBLISH"/{doubao,qianwen,yuanbao,general}

  # 1e. Seed 5 store entities
  log "Seeding 5 store entities + governance via TypeScript..."
  cd "$AIDA_REPO"

  cat > .tmp-seed.ts << 'TYPESCRIPT'
import path from 'node:path';
import fs from 'node:fs';
import { createBpsEngine, createDatabase, GovernanceStore, loadGovernanceFile } from './src/index.js';

const HOME = process.env.HOME || '/root';
const DB_PATH = path.resolve(HOME, '.aida', 'data', 'bps.db');
const GOV_PATH = path.resolve(HOME, '.aida', 'governance.yaml');

console.log(`[seed] DB: ${DB_PATH}`);
const db = createDatabase(DB_PATH);
const engine = createBpsEngine({ db });
const { dossierStore } = engine;

const stores = [
  {
    id: 'store-cs-ktv-01',
    nameCN: '声临其境KTV-五一广场店', nameEN: 'Voice KTV (Wuyi Square)',
    city: '长沙', district: '天心区', businessCircle: '五一广场',
    address: '长沙市天心区五一广场地铁站C出口向南200米',
    spaceType: 'self-service-ktv', roomCount: 8,
    operatingHours: '14:00-02:00',
    roomTypes: [
      { type: '小包', capacity: 4, priceWeekday: 88, priceWeekend: 128 },
      { type: '中包', capacity: 8, priceWeekday: 128, priceWeekend: 188 },
      { type: '大包', capacity: 15, priceWeekday: 188, priceWeekend: 268 },
    ],
    features: ['24h自助', '高品质音响', '网红装修', '零食自选'],
    joinDate: '2026-01-15', status: 'active',
  },
  {
    id: 'store-cs-tea-01',
    nameCN: '悠然茶室-芙蓉广场店', nameEN: 'Youran Tea Room (Furong Plaza)',
    city: '长沙', district: '芙蓉区', businessCircle: '芙蓉广场',
    spaceType: 'self-service-tearoom', roomCount: 6,
    operatingHours: '09:00-22:00',
    roomTypes: [
      { type: '商务间', capacity: 6, priceWeekday: 68, priceWeekend: 98 },
      { type: '休闲间', capacity: 4, priceWeekday: 48, priceWeekend: 68 },
    ],
    features: ['静谧环境', '品质茶具', '商务会客', '投影设备'],
    joinDate: '2026-02-01', status: 'active',
  },
  {
    id: 'store-cs-mj-01',
    nameCN: '棋乐无穷-岳麓山店', nameEN: 'Qi Le Mahjong (Yuelu Mountain)',
    city: '长沙', district: '岳麓区', businessCircle: '岳麓山',
    spaceType: 'self-service-mahjong', roomCount: 10,
    operatingHours: '10:00-24:00',
    roomTypes: [
      { type: '标准间', capacity: 4, priceWeekday: 38, priceWeekend: 58 },
      { type: 'VIP间', capacity: 6, priceWeekday: 58, priceWeekend: 88 },
    ],
    features: ['全自动麻将机', '空调独立控制', '免费WiFi', '小食供应'],
    joinDate: '2026-02-10', status: 'active',
  },
  {
    id: 'store-wh-ktv-01',
    nameCN: '音乐盒KTV-江汉路店', nameEN: 'Music Box KTV (Jianghan Road)',
    city: '武汉', district: '江汉区', businessCircle: '江汉路',
    spaceType: 'self-service-ktv', roomCount: 12,
    operatingHours: '12:00-02:00',
    roomTypes: [
      { type: '小包', capacity: 4, priceWeekday: 78, priceWeekend: 118 },
      { type: '中包', capacity: 8, priceWeekday: 118, priceWeekend: 168 },
      { type: '大包', capacity: 15, priceWeekday: 168, priceWeekend: 238 },
    ],
    features: ['步行街核心', 'KTV+桌游', '主题房间', '拍照打卡'],
    joinDate: '2026-01-20', status: 'active',
  },
  {
    id: 'store-wh-tea-01',
    nameCN: '静享茶空间-楚河汉街店', nameEN: 'Quiet Tea Space (Chu River Han Street)',
    city: '武汉', district: '武昌区', businessCircle: '楚河汉街',
    spaceType: 'self-service-tearoom', roomCount: 8,
    operatingHours: '08:00-21:00',
    roomTypes: [
      { type: '独享间', capacity: 2, priceWeekday: 58, priceWeekend: 78 },
      { type: '商务间', capacity: 6, priceWeekday: 78, priceWeekend: 108 },
    ],
    features: ['湖景包间', '高端茶叶', '会议投屏', '安静办公'],
    joinDate: '2026-02-15', status: 'active',
  },
];

for (const store of stores) {
  const { id, ...data } = store;
  const dossier = dossierStore.getOrCreate('store', id);
  dossierStore.commit(dossier.id, data, {
    committedBy: 'project-loader:idlex-geo',
    message: `Seed store: ${data.nameCN}`,
  });
  console.log(`[seed] + ${data.nameCN} (${id})`);
}

// Load governance
if (fs.existsSync(GOV_PATH)) {
  const govStore = new GovernanceStore(db);
  const result = loadGovernanceFile(GOV_PATH);
  if (result.errors.length > 0) console.log(`[seed] WARN: ${result.errors.join(', ')}`);
  govStore.loadConstraints(result.constraints);
  console.log(`[seed] + ${result.constraints.length} governance constraints`);
}

console.log(`[seed] Done: ${dossierStore.query({}).length} entities total`);
TYPESCRIPT

  node --import tsx .tmp-seed.ts
  rm -f .tmp-seed.ts

  # Restart dashboard
  log "Restarting Dashboard..."
  systemctl restart bps-dashboard 2>/dev/null || true
  sleep 3

  # V1: Post-seed checks
  log "V1: Post-seed checks"
  SC=$(api_get "/api/entities?entityType=store" | jlen)
  check "V1.1 5 store entities (got $SC)" "test $SC -ge 5"

  GC=$(api_get "/api/governance/constraints" | jlen)
  check "V1.2 >= 3 governance constraints (got $GC)" "test $GC -ge 3"

  CC=$(find "$AIDA_HOME/context/" -name "*.md" 2>/dev/null | wc -l)
  check "V1.3 Context docs present (got $CC)" "test $CC -ge 1"
  check "V1.4 Mock-publish dirs" "test -d $MOCK_PUBLISH/doubao"
  check "V1.5 project.yaml" "test -f $AIDA_HOME/project.yaml"

  log "Phase 1 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 2: Business Requirements — Turn 1
# (Mixed governance + operations to test Two-Layer routing)
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 2 ]; then
  section "2: Business Requirements (Turn 1)"

  ENTITY_BEFORE=$(api_get "/api/entities" | jlen)
  (find "$OPENCLAW_HOME/workspace/skills/" -maxdepth 1 -mindepth 1 -type d 2>/dev/null || true) | sort > "$LOG_DIR/skills-before.txt"
  log "Baseline: $ENTITY_BEFORE entities, $(wc -l < "$LOG_DIR/skills-before.txt") skills"

  aida_say 1 '我是闲氪的GEO负责人。闲氪帮合作门店在AI时代"被看见"。
请先看一下 ~/.aida/context/ 里的业务资料，系统里已有5家合作门店（长沙3家+武汉2家）。

我需要一套完整的GEO日常运营体系：
1. 每天监测门店在主流AI（豆包、千问、元宝）中的能见度
2. 分析数据制定"一模一策"战略
3. 针对每家门店、每个AI模型生成优化内容
4. 内容分发到 ~/.aida/mock-publish/ 目录（测试环境）
5. 每日运营小结，每周深度复盘
6. 我还需要一个面向顾客的24h在线门店咨询bot，语气要亲切活泼——跟你的管理风格完全不同

另外有两条规矩必须遵守：
- 所有对外发布的内容，发布前必须经过我审批
- 战略方向的重大调整也需要我确认才能执行

能见度探测测试阶段用模拟数据即可。帮我规划一下。'

  check "V2.1 Aida produced response" "test -s $LOG_DIR/turn-1.log"
  soft  "V2.2 Mentions plan/strategy" "grep -qiE '计划|方案|action.plan|strategy|战略|规划' $LOG_DIR/turn-1.log"
  soft  "V2.3 Identifies skill/agent gap" "grep -qiE 'skill|技能|agent|bot|助手|独立' $LOG_DIR/turn-1.log"
  soft  "V2.4 Two-Layer: governance vs operations" "grep -qiE '治理|governance|审批|approval|规矩|约束|constraint' $LOG_DIR/turn-1.log"

  log "Phase 2 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 3: Modeling — Turn 2 (full authorization)
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 3 ]; then
  section "3: Modeling (Turn 2)"

  aida_say 2 '方案可以。全权交给你落地——实体、Skill、Agent、蓝图、定时任务，需要什么就建什么。'

  sleep 5

  log "V3: Post-modeling checks"

  ENTITY_AFTER=$(api_get "/api/entities" | jlen)
  NEW_E=$((ENTITY_AFTER - ${ENTITY_BEFORE:-5}))
  check "V3.1 New entities created >= 2 (got $NEW_E)" "test $NEW_E -ge 2"

  AP=$(api_get "/api/entities?entityType=action-plan" | jlen)
  ST1=$(api_get "/api/entities?entityType=geo-strategy" | jlen)
  ST2=$(api_get "/api/entities?entityType=strategy" | jlen)
  ST=$((ST1 + ST2))
  soft "V3.2 Action plan entity (got $AP)" "test $AP -ge 1"
  soft "V3.3 Strategy entity (got $ST)" "test $ST -ge 1"

  # Entity breakdown
  log "Entity breakdown:"
  api_get "/api/entities" | node -e "
    const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    const t={};d.forEach(e=>{const k=e.entityType||'?';t[k]=(t[k]||0)+1});
    Object.entries(t).sort().forEach(([k,v])=>console.log('  '+k+': '+v))
  " 2>/dev/null || true

  # New Skills?
  find "$OPENCLAW_HOME/workspace/skills/" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort > "$LOG_DIR/skills-after.txt"
  NEW_SKILLS=$(comm -13 "$LOG_DIR/skills-before.txt" "$LOG_DIR/skills-after.txt" 2>/dev/null || true)
  if [ -n "$NEW_SKILLS" ]; then
    pass "V3.4 New Skill(s) created"
    echo "$NEW_SKILLS" | while read s; do log "  + $(basename "$s")"; done
  else
    warn_ "V3.4 No new Skills created (non-critical)"
  fi

  # New Agent workspace?
  AGENT_WS=$(find "$OPENCLAW_HOME" -maxdepth 1 -name "workspace-*" -type d 2>/dev/null)
  if [ -n "$AGENT_WS" ]; then
    pass "V3.5 Agent workspace(s) created"
    echo "$AGENT_WS" | while read d; do log "  + $(basename "$d")"; done
  else
    warn_ "V3.5 No Agent workspace created (non-critical)"
  fi

  # Blueprints?
  BP=$(find "$AIDA_HOME/blueprints/" -name "*.yaml" 2>/dev/null | wc -l)
  if [ "$BP" -gt 0 ]; then
    pass "V3.6 Blueprint file(s) created ($BP)"
  else
    warn_ "V3.6 No blueprints created (Entity+Skill path preferred)"
  fi

  log "Phase 3 complete. Entities: +$NEW_E"
fi

# ════════════════════════════════════════════════════════════
# Phase 4: Review — Turn 3
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 4 ]; then
  section "4: Review (Turn 3)"

  aida_say 3 '建模完成了吗？带我看看你创建了哪些东西，Dashboard上能看到什么？'

  check "V4.1 Aida produced review" "test -s $LOG_DIR/turn-3.log"
  soft  "V4.2 Mentions Dashboard" "grep -qiE 'dashboard|3456|面板' $LOG_DIR/turn-3.log"

  log "Phase 4 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 5: Execution — Turn 4
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 5 ]; then
  section "5: GEO Execution (Turn 4)"

  VIO_BEFORE=$(api_get "/api/governance/violations" | jlen)

  aida_say 4 '确认没问题。开始今天的GEO运营工作——先做能见度探测，然后生成内容。'

  sleep 5

  log "V5: Post-execution checks"

  VIO_AFTER=$(api_get "/api/governance/violations" | jlen)
  NEW_VIO=$((VIO_AFTER - VIO_BEFORE))
  PENDING=$(api_get "/api/governance/approvals" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(d.filter(a=>a.status==='PENDING').length)}catch{console.log(0)}" 2>/dev/null)

  if [ "$NEW_VIO" -ge 1 ] || [ "${PENDING:-0}" -ge 1 ]; then
    pass "V5.1 Governance triggered (violations: +$NEW_VIO, pending: $PENDING)"
  else
    warn_ "V5.1 No governance trigger (Aida may not have attempted publish)"
  fi

  soft "V5.2 Aida reported governance interception" \
    "grep -qiE 'approval|审批|governance|blocked|拦截|治理' $LOG_DIR/turn-4.log"

  # Content entities scan
  log "GEO entity scan:"
  for et in geo-probe probe geo-content content geo-strategy strategy action-plan; do
    C=$(api_get "/api/entities?entityType=$et" | jlen)
    [ "$C" -gt 0 ] && log "  $et: $C"
  done

  log "Phase 5 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 6: Dashboard Approval
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 6 ]; then
  section "6: Dashboard Approval"

  aida_say 5 '收到，我去Dashboard处理审批。'

  # Programmatic approval
  APPROVALS=$(api_get "/api/governance/approvals" || echo "[]")
  PENDING_IDS=$(echo "$APPROVALS" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    d.filter(a=>a.status==='PENDING').forEach(a=>console.log(a.id))}catch{}" 2>/dev/null)

  APPROVED_N=0
  if [ -n "$PENDING_IDS" ]; then
    while IFS= read -r aid; do
      [ -z "$aid" ] && continue
      log "Approving: $aid"
      RESULT=$(api_post "/api/governance/approvals/$aid/decide" '{"decision":"APPROVED","decidedBy":"owner"}' || echo "{}")
      if echo "$RESULT" | grep -qiE 'APPROVED|success|approved'; then
        APPROVED_N=$((APPROVED_N + 1))
      else
        log "  Approval response: $RESULT"
      fi
    done <<< "$PENDING_IDS"
    pass "V6.1 Approved $APPROVED_N item(s)"
  else
    warn_ "V6.1 No pending approvals to process"
  fi

  log "Phase 6 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 7: Daily Summary — Turn 6
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 7 ]; then
  section "7: Daily Summary (Turn 6)"

  aida_say 6 '审批都处理好了。做个今天的运营小结。'

  check "V7.1 Aida produced summary" "test -s $LOG_DIR/turn-6.log"
  soft  "V7.2 Summary has business content" \
    "grep -qiE '门店|能见度|GEO|geo|内容|store|content|visibility|运营' $LOG_DIR/turn-6.log"

  log "Phase 7 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 8: Final Verification
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 8 ]; then
  section "8: Final Verification"

  log "Comprehensive checks..."

  # Entities
  TE=$(api_get "/api/entities" | jlen)
  check "V8.1 Total entities >= 7 (got $TE)" "test $TE -ge 7"

  log "Entity breakdown:"
  api_get "/api/entities" | node -e "
    const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    const t={};d.forEach(e=>{const k=e.entityType||'?';t[k]=(t[k]||0)+1});
    console.log('  Total: '+d.length);
    Object.entries(t).sort().forEach(([k,v])=>console.log('  '+k+': '+v))
  " 2>/dev/null || true

  # Governance
  TV=$(api_get "/api/governance/violations" | jlen)
  TA=$(api_get "/api/governance/approvals" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(d.filter(a=>a.status==='APPROVED').length)}catch{console.log(0)}" 2>/dev/null)
  log "  Violations: $TV, Approved: $TA"

  # Dashboard pages
  for page in "/" "/business-goals" "/approvals" "/governance" "/agent-log"; do
    check "V8.2 Dashboard $page" "curl -sf $DASHBOARD_URL$page >/dev/null"
  done

  # Skills
  TS=$(find "$OPENCLAW_HOME/workspace/skills/" -name SKILL.md 2>/dev/null | wc -l)
  check "V8.3 Skills >= 7 (got $TS)" "test $TS -ge 7"
  log "Skills:"
  find "$OPENCLAW_HOME/workspace/skills/" -maxdepth 1 -mindepth 1 -type d -printf '  %f\n' 2>/dev/null || \
    find "$OPENCLAW_HOME/workspace/skills/" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | while read d; do echo "  $(basename "$d")"; done

  # Agent workspaces
  log "Agent workspaces:"
  ls -d "$OPENCLAW_HOME"/workspace* 2>/dev/null | while read d; do echo "  $(basename "$d")"; done

  # Blueprints & mock-publish
  BF=$(find "$AIDA_HOME/blueprints/" -name "*.yaml" 2>/dev/null | wc -l)
  PF=$(find "$MOCK_PUBLISH" -type f 2>/dev/null | wc -l)
  log "  Blueprints: $BF, Mock-publish files: $PF"

  log "Phase 8 complete."
fi

# ════════════════════════════════════════════════════════════
# Test Report
# ════════════════════════════════════════════════════════════

section "Test Report"

echo "IdleX GEO E2E Test v3"
echo "====================="
echo "Date:    $(date)"
echo "Server:  $(hostname)"
echo "Session: agent:main:main (dmScope=main)"
echo ""
echo "Results: $PASS PASS / $FAIL FAIL / $WARNS WARN / $TOTAL TOTAL"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}ALL REQUIRED CHECKS PASSED${NC}"
elif [ "$FAIL" -le 2 ]; then
  echo -e "${YELLOW}MOSTLY PASSED ($FAIL minor failures)${NC}"
else
  echo -e "${RED}$FAIL CHECKS FAILED${NC}"
fi

echo ""
echo "Logs:      $LOG_DIR/turn-{1..6}.log"
echo "Dashboard: $DASHBOARD_URL"
echo ""

# Save report
cat > "$LOG_DIR/report.txt" << REPORT
IdleX GEO E2E Test v3
=====================
Date:    $(date)
Server:  $(hostname)
Session: agent:main:main (dmScope=main)
Results: $PASS PASS / $FAIL FAIL / $WARNS WARN / $TOTAL TOTAL

Entities:   ${TE:-?}
Skills:     ${TS:-?}
Violations: ${TV:-?}
Approvals:  ${TA:-?}
Blueprints: ${BF:-?}
Publish:    ${PF:-?}

Logs: $LOG_DIR/
Dashboard: $DASHBOARD_URL
REPORT

log "Report saved: $LOG_DIR/report.txt"

# Save all turn logs to a combined file for analysis
echo "=== Combined Turn Logs ===" > "$LOG_DIR/all-turns.log"
for i in 1 2 3 4 5 6; do
  if [ -f "$LOG_DIR/turn-$i.log" ]; then
    echo -e "\n=== TURN $i ===" >> "$LOG_DIR/all-turns.log"
    cat "$LOG_DIR/turn-$i.log" >> "$LOG_DIR/all-turns.log"
  fi
done
log "Combined logs: $LOG_DIR/all-turns.log"

exit "$FAIL"
