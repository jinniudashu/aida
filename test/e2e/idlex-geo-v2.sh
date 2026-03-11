#!/usr/bin/env bash
# ============================================================
# IdleX GEO E2E Test v2
# ============================================================
# Full lifecycle: Install → Seed → Model → Execute → Govern → Summary
# Tests self-evolution: prospective Skill gap + Agent creation
#
# Usage:
#   bash test/e2e/idlex-geo-v2.sh [--skip-install] [--skip-seed] [--phase N]
#
# Test plan: test/e2e/idlex-geo-v2.md
# Run on: root@47.236.109.62
# ============================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────

AIDA_HOME="${AIDA_HOME:-$HOME/.aida}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
AIDA_REPO="${AIDA_REPO:-$HOME/aida}"
DASHBOARD_URL="http://localhost:3456"
MOCK_PUBLISH="$AIDA_HOME/mock-publish"
LOG_DIR="/tmp/idlex-geo-e2e-v2"
AGENT_TIMEOUT=300  # 5 minutes per turn

# Business context source (闲氪 docs)
IDLEX_DOCS="${IDLEX_DOCS:-$HOME/idlekr/docs}"

SKIP_INSTALL=false
SKIP_SEED=false
START_PHASE=0
PASS=0
FAIL=0
WARNS=0
TOTAL=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-install) SKIP_INSTALL=true; shift ;;
    --skip-seed)    SKIP_SEED=true; shift ;;
    --phase)        START_PHASE="${2:-0}"; shift 2 ;;
    *)              shift ;;
  esac
done

mkdir -p "$LOG_DIR"

# ── Helpers ──────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()     { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
pass()    { echo -e "  ${GREEN}PASS${NC} $*"; PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); }
fail()    { echo -e "  ${RED}FAIL${NC} $*"; FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); }
warn_()   { echo -e "  ${YELLOW}WARN${NC} $*"; WARNS=$((WARNS+1)); }
section() { echo -e "\n${BOLD}${YELLOW}══════════════════════════════════════════════${NC}"; \
            echo -e "${BOLD}  Phase $*${NC}"; \
            echo -e "${BOLD}${YELLOW}══════════════════════════════════════════════${NC}\n"; }

check() {
  local desc="$1"; shift
  if eval "$@" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi
}

soft() {
  local desc="$1"; shift
  if eval "$@" >/dev/null 2>&1; then pass "$desc"; else warn_ "$desc (non-critical)"; fi
}

api_get()  { curl -sf "$DASHBOARD_URL$1" 2>/dev/null; }
api_post() { curl -sf -X POST -H "Content-Type: application/json" -d "$2" "$DASHBOARD_URL$1" 2>/dev/null; }

# Parse JSON array length via Node
jlen() { node -e "try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(Array.isArray(d)?d.length:0)}catch{console.log(0)}"; }

# Send message to Aida, save log
aida_say() {
  local turn="$1"; shift
  local msg="$1"
  log "Turn $turn: sending to Aida..."
  local out="$LOG_DIR/turn-$turn.log"
  timeout "$AGENT_TIMEOUT" openclaw agent --agent main --message "$msg" > "$out" 2>&1 || true
  # Show first 20 lines of response
  echo -e "${CYAN}--- Aida response (turn $turn, first 20 lines) ---${NC}"
  head -20 "$out"
  echo -e "${CYAN}--- (full log: $out) ---${NC}\n"
}

# ════════════════════════════════════════════════════════════
# Phase 0: Clean Environment + Install
# ════════════════════════════════════════════════════════════

if [ "$SKIP_INSTALL" = false ] && [ "$START_PHASE" -le 0 ]; then
  section "0: Clean Environment + Install"

  log "Stopping existing services..."
  systemctl stop bps-dashboard 2>/dev/null || true
  pkill -f "openclaw gateway" 2>/dev/null || true
  sleep 2

  log "Backing up ~/.aida/ ..."
  [ -d "$AIDA_HOME" ] && mv "$AIDA_HOME" "$AIDA_HOME.bak.$(date +%Y%m%d%H%M%S)"

  log "Cleaning workspace (preserving MEMORY.md)..."
  [ -f "$OPENCLAW_HOME/workspace/MEMORY.md" ] && \
    cp "$OPENCLAW_HOME/workspace/MEMORY.md" /tmp/aida-memory-backup.md 2>/dev/null || true
  rm -rf "$OPENCLAW_HOME/workspace/skills/" 2>/dev/null || true
  rm -rf "$OPENCLAW_HOME"/workspace-* 2>/dev/null || true

  log "Updating repo..."
  cd "$AIDA_REPO"
  git pull --recurse-submodules 2>&1 | tail -3 || true

  log "Running install-aida.sh..."
  bash deploy/install-aida.sh

  # Restore memory
  [ -f /tmp/aida-memory-backup.md ] && \
    cp /tmp/aida-memory-backup.md "$OPENCLAW_HOME/workspace/MEMORY.md" 2>/dev/null || true

  log "Starting OpenClaw gateway..."
  openclaw gateway start 2>/dev/null || warn_ "Gateway start returned non-zero (may already be running)"
  sleep 5

  log "V0: Post-install checks"
  check "V0.1 ~/.aida/blueprints/"  "test -d $AIDA_HOME/blueprints"
  check "V0.2 ~/.aida/data/"        "test -d $AIDA_HOME/data"
  check "V0.3 ~/.aida/context/"     "test -d $AIDA_HOME/context"
  check "V0.4 SOUL.md"              "test -f $OPENCLAW_HOME/workspace/SOUL.md"
  check "V0.5 AGENTS.md"            "test -f $OPENCLAW_HOME/workspace/AGENTS.md"
  check "V0.6 HEARTBEAT.md"         "test -f $OPENCLAW_HOME/workspace/HEARTBEAT.md"
  check "V0.7 BOOT.md"              "test -f $OPENCLAW_HOME/workspace/BOOT.md"

  SKILL_N=$(find "$OPENCLAW_HOME/workspace/skills/" -name SKILL.md 2>/dev/null | wc -l)
  check "V0.8 Skills >= 7 (found $SKILL_N)" "test $SKILL_N -ge 7"
  check "V0.9 Dashboard /api/overview" "curl -sf $DASHBOARD_URL/api/overview >/dev/null"

  log "Phase 0 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 1: Data Seeding
# ════════════════════════════════════════════════════════════

if [ "$SKIP_SEED" = false ] && [ "$START_PHASE" -le 1 ]; then
  section "1: Data Seeding"

  # ── 1a. project.yaml ──
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

  # ── 1b. management.yaml ──
  log "Creating management.yaml..."
  cat > "$AIDA_HOME/management.yaml" << 'YAML'
# IdleX GEO Management Constraints
# Broader entityType matching to handle Aida's naming variations

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

  # ── 1c. Business context docs ──
  log "Copying business context docs..."
  if [ -d "$IDLEX_DOCS" ]; then
    cp "$IDLEX_DOCS"/*.md "$AIDA_HOME/context/" 2>/dev/null || true
    DOC_COUNT=$(ls "$AIDA_HOME/context/"*.md 2>/dev/null | wc -l)
    log "  Copied $DOC_COUNT docs from $IDLEX_DOCS"
  else
    warn_ "IdleX docs not found at $IDLEX_DOCS — creating fallback context"
    cat > "$AIDA_HOME/context/idlex-overview.md" << 'CTXEOF'
# IdleX (闲氪) Business Overview

IdleX is an AI-era urban third-space operating system infrastructure platform.
Mission: Transform idle time slots in self-service spaces into AI-discoverable,
AI-callable, AI-deliverable digital assets.

Core Market: Self-service KTV, tea rooms, mahjong parlors — fully autonomous,
online bookable, pay-by-time spaces.

## Three Core Principles
1. **AI can SEE it** (真/Truth): All data real, real-time, verifiable
2. **AI dares to CALL it** (模/Model Adaptation): Different LLMs get different interfaces
3. **AI can DELIVER it** (履约/Fulfillment): Booking → payment → verification → in-store

## GEO Strategy: "一模一策" (One Model, One Strategy)
Each AI model (豆包/千问/元宝) has different preferences — optimize specifically for each.
Content types: StoreDescription, FAQ, ScenarioStory, StructuredData.

## Brand Goal
"When AI answers space questions, it thinks of IdleX first"

## Key Differentiators
- "0服务员推销" (zero staff sales pressure)
- "微信一键预约开门" (WeChat one-tap booking + door unlock)
- "按小时计费, 走时结算" (hourly billing, pay when you leave)
CTXEOF
  fi

  # ── 1d. Mock-publish dirs ──
  log "Creating mock-publish directories..."
  mkdir -p "$MOCK_PUBLISH"/{doubao,qianwen,yuanbao,general}

  # ── 1e. Seed 5 store entities ──
  log "Seeding 5 store entities via TypeScript..."
  cd "$AIDA_REPO"

  cat > .tmp-seed.ts << 'TYPESCRIPT'
import path from 'node:path';
import fs from 'node:fs';
import { createBpsEngine, createDatabase, ManagementStore, loadManagementFile } from './src/index.js';

const HOME = process.env.HOME || '/root';
const DB_PATH = path.resolve(HOME, '.aida', 'data', 'bps.db');
const GOV_PATH = path.resolve(HOME, '.aida', 'management.yaml');

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
    coordinates: { lat: 28.1941, lng: 112.9715 },
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
    address: '长沙市芙蓉区芙蓉中路二段88号3楼',
    coordinates: { lat: 28.1968, lng: 112.9834 },
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
    address: '长沙市岳麓区麓山南路158号',
    coordinates: { lat: 28.1760, lng: 112.9340 },
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
    address: '武汉市江汉区江汉路步行街89号4楼',
    coordinates: { lat: 30.5810, lng: 114.2836 },
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
    address: '武汉市武昌区楚河汉街第二街区L2-12',
    coordinates: { lat: 30.5555, lng: 114.3527 },
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

// Load management
if (fs.existsSync(GOV_PATH)) {
  const mgmtStore = new ManagementStore(db);
  const result = loadManagementFile(GOV_PATH);
  if (result.errors.length > 0) console.log(`[seed] WARN: ${result.errors.join(', ')}`);
  mgmtStore.loadConstraints(result.constraints);
  console.log(`[seed] + ${result.constraints.length} management constraints`);
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

  GC=$(api_get "/api/management/constraints" | jlen)
  check "V1.2 >= 3 management constraints (got $GC)" "test $GC -ge 3"

  CC=$(ls "$AIDA_HOME/context/"*.md 2>/dev/null | wc -l)
  check "V1.3 Context docs present (got $CC)" "test $CC -ge 1"
  check "V1.4 Mock-publish dirs" "test -d $MOCK_PUBLISH/doubao"
  check "V1.5 project.yaml" "test -f $AIDA_HOME/project.yaml"

  log "Phase 1 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 2: Business Requirements — Turn 1
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 2 ]; then
  section "2: Business Requirements (Turn 1)"

  # Snapshot entity count & skill list before modeling
  ENTITY_BEFORE=$(api_get "/api/entities" | jlen)
  find "$OPENCLAW_HOME/workspace/skills/" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort > "$LOG_DIR/skills-before.txt"
  log "Baseline: $ENTITY_BEFORE entities, $(wc -l < "$LOG_DIR/skills-before.txt") skills"

  aida_say 1 '我是闲氪的运营负责人。闲氪帮自助休闲空间合作门店在AI时代被看见。
请先看一下 ~/.aida/context/ 里的业务资料。系统里已有5家合作门店（长沙3家+武汉2家）。

我的目标是建立完整的GEO日常运营体系，需要这些能力：
1. 每天监测各门店在主流AI（豆包、千问、元宝）中的能见度
2. 分析监测数据，制定"一模一策"的提升战略
3. 为每家门店生成针对不同AI模型的优化内容（门店描述、FAQ、场景故事等）
4. 内容发布到 ~/.aida/mock-publish/ 目录（测试阶段），发布前需我审批
5. 每天运营小结，每周深度复盘
6. 我还想要一个24小时在线的门店咨询bot，语气亲切活泼，能自主回答顾客关于门店的各种问题——这跟你的管理风格完全不同

测试阶段的能见度探测用模拟数据就行。请帮我规划这套运营体系。'

  check "V2.1 Aida produced response" "test -s $LOG_DIR/turn-1.log"
  soft  "V2.2 Mentions plan/strategy" "grep -qiE '计划|方案|action.plan|strategy|战略|规划' $LOG_DIR/turn-1.log"
  soft  "V2.3 Mentions skill gap or new skill" "grep -qiE 'skill|技能|能力' $LOG_DIR/turn-1.log"
  soft  "V2.4 Mentions agent/bot for chatbot" "grep -qiE 'agent|bot|助手|客服|独立' $LOG_DIR/turn-1.log"

  log "Phase 2 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 3: Modeling — Turn 2 (full authorization)
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 3 ]; then
  section "3: Modeling (Turn 2)"

  aida_say 2 '方案我认可。现在就落地吧——需要创建什么实体就创建，需要什么Skill就建，需要独立Agent就建，需要蓝图就写蓝图，需要定时任务就注册。全权交给你。'

  sleep 5  # let async ops settle

  log "V3: Post-modeling checks"

  ENTITY_AFTER=$(api_get "/api/entities" | jlen)
  NEW_E=$((ENTITY_AFTER - ${ENTITY_BEFORE:-5}))
  check "V3.1 New entities created >= 2 (got $NEW_E)" "test $NEW_E -ge 2"

  # Check for action-plan and strategy entities
  AP=$(api_get "/api/entities?entityType=action-plan" | jlen)
  ST1=$(api_get "/api/entities?entityType=geo-strategy" | jlen)
  ST2=$(api_get "/api/entities?entityType=strategy" | jlen)
  ST=$((ST1 + ST2))
  soft "V3.2 Action plan entity (got $AP)" "test $AP -ge 1"
  soft "V3.3 Strategy entity (got $ST)" "test $ST -ge 1"

  # Entity type breakdown
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
  BP=$(ls "$AIDA_HOME/blueprints/"*.yaml 2>/dev/null | wc -l)
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

  aida_say 3 '带我检查一下建模成果。你创建了哪些实体、Skill、Agent、蓝图？Dashboard上能看到什么？'

  check "V4.1 Aida produced review" "test -s $LOG_DIR/turn-3.log"
  soft  "V4.2 Mentions Dashboard" "grep -qiE 'dashboard|3456|面板' $LOG_DIR/turn-3.log"

  log "Phase 4 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 5: Execution — Turn 4
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 5 ]; then
  section "5: GEO Execution (Turn 4)"

  VIO_BEFORE=$(api_get "/api/management/violations" | jlen)

  aida_say 4 '确认没问题，开始今天的GEO日常运营工作吧。'

  sleep 5

  log "V5: Post-execution checks"

  # Check management trigger
  VIO_AFTER=$(api_get "/api/management/violations" | jlen)
  NEW_VIO=$((VIO_AFTER - VIO_BEFORE))
  PENDING=$(api_get "/api/management/approvals" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(d.filter(a=>a.status==='PENDING').length)}catch{console.log(0)}" 2>/dev/null)

  if [ "$NEW_VIO" -ge 1 ] || [ "${PENDING:-0}" -ge 1 ]; then
    pass "V5.1 Management triggered (violations: +$NEW_VIO, pending: $PENDING)"
  else
    warn_ "V5.1 No management trigger (Aida may not have attempted publish)"
  fi

  soft "V5.2 Aida reported management interception" \
    "grep -qiE 'approval|审批|management|blocked|拦截|治理' $LOG_DIR/turn-4.log"

  # Check for content/probe entities
  log "GEO entity scan:"
  for et in geo-probe probe geo-content content; do
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

  # Programmatic approval of all pending items
  APPROVALS=$(api_get "/api/management/approvals" || echo "[]")
  PENDING_IDS=$(echo "$APPROVALS" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    d.filter(a=>a.status==='PENDING').forEach(a=>console.log(a.id))}catch{}" 2>/dev/null)

  APPROVED_N=0
  if [ -n "$PENDING_IDS" ]; then
    while IFS= read -r aid; do
      [ -z "$aid" ] && continue
      log "Approving: $aid"
      RESULT=$(api_post "/api/management/approvals/$aid/decide" '{"decision":"APPROVED","decidedBy":"owner"}' || echo "{}")
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

  aida_say 6 '审批处理完毕。做个今天的运营小结。'

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

  # Management
  TV=$(api_get "/api/management/violations" | jlen)
  TA=$(api_get "/api/management/approvals" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(d.filter(a=>a.status==='APPROVED').length)}catch{console.log(0)}" 2>/dev/null)
  log "  Violations: $TV, Approved: $TA"

  # Dashboard pages
  for page in "/" "/business-goals" "/approvals" "/management" "/agent-log"; do
    check "V8.2 Dashboard $page" "curl -sf $DASHBOARD_URL$page >/dev/null"
  done

  # Skills
  TS=$(find "$OPENCLAW_HOME/workspace/skills/" -name SKILL.md 2>/dev/null | wc -l)
  check "V8.3 Skills >= 7 (got $TS)" "test $TS -ge 7"
  log "Skills:"
  find "$OPENCLAW_HOME/workspace/skills/" -maxdepth 1 -mindepth 1 -type d -printf '  %f\n' 2>/dev/null || true

  # Agent workspaces
  log "Agent workspaces:"
  ls -d "$OPENCLAW_HOME"/workspace* 2>/dev/null | while read d; do echo "  $(basename "$d")"; done

  # Blueprints & mock-publish
  BF=$(ls "$AIDA_HOME/blueprints/"*.yaml 2>/dev/null | wc -l)
  PF=$(find "$MOCK_PUBLISH" -type f 2>/dev/null | wc -l)
  log "  Blueprints: $BF, Mock-publish files: $PF"

  log "Phase 8 complete."
fi

# ════════════════════════════════════════════════════════════
# Test Report
# ════════════════════════════════════════════════════════════

section "Test Report"

echo "IdleX GEO E2E Test v2"
echo "====================="
echo "Date:    $(date)"
echo "Server:  $(hostname)"
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
echo "Manual verification:"
echo "  $DASHBOARD_URL/              — Overview (entities + management)"
echo "  $DASHBOARD_URL/business-goals — Action plans"
echo "  $DASHBOARD_URL/management     — Constraints + violations + approvals"
echo "  $DASHBOARD_URL/agent-log      — Audit trail"
echo ""

# Save report
cat > "$LOG_DIR/report.txt" << REPORT
IdleX GEO E2E Test v2
=====================
Date:    $(date)
Server:  $(hostname)
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

log "Report: $LOG_DIR/report.txt"

exit "$FAIL"
