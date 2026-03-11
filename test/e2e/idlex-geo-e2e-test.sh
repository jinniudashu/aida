#!/usr/bin/env bash
# ============================================================
# IdleX GEO E2E Test Script
# ============================================================
# Tests the full AIDA lifecycle with IdleX GEO business scenario:
#   Install -> Seed -> Model -> Execute -> Management -> Approve -> Summary
#
# Usage:
#   bash idlex-geo-e2e-test.sh [--skip-install] [--skip-seed] [--phase N]
#
# Run on test server: root@47.236.109.62
# ============================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────

AIDA_HOME="${AIDA_HOME:-$HOME/.aida}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
AIDA_REPO="${AIDA_REPO:-$HOME/aida}"
DASHBOARD_URL="http://localhost:3456"
MOCK_PUBLISH="$AIDA_HOME/mock-publish"

SKIP_INSTALL=false
SKIP_SEED=false
START_PHASE=0
PASS_COUNT=0
FAIL_COUNT=0
TOTAL_TESTS=0

for arg in "$@"; do
  case $arg in
    --skip-install) SKIP_INSTALL=true ;;
    --skip-seed) SKIP_SEED=true ;;
    --phase) START_PHASE="${2:-0}"; shift ;;
  esac
done

# ── Helpers ────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
pass() { echo -e "  ${GREEN}PASS${NC} $*"; PASS_COUNT=$((PASS_COUNT + 1)); TOTAL_TESTS=$((TOTAL_TESTS + 1)); }
fail() { echo -e "  ${RED}FAIL${NC} $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); TOTAL_TESTS=$((TOTAL_TESTS + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC} $*"; }
section() { echo -e "\n${YELLOW}═══════════════════════════════════════════════════════${NC}"; echo -e "${YELLOW}  $*${NC}"; echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}\n"; }

check() {
  local desc="$1"
  shift
  if eval "$@" > /dev/null 2>&1; then
    pass "$desc"
  else
    fail "$desc"
  fi
}

api_get() {
  curl -s -f "$DASHBOARD_URL$1" 2>/dev/null
}

api_post() {
  curl -s -f -X POST -H "Content-Type: application/json" -d "$2" "$DASHBOARD_URL$1" 2>/dev/null
}

# ── Phase 0: Clean Environment + Install ───────────────────

if [ "$SKIP_INSTALL" = false ] && [ "$START_PHASE" -le 0 ]; then
  section "Phase 0: Clean Environment + Install"

  log "Stopping existing services..."
  systemctl stop bps-dashboard 2>/dev/null || true
  # Note: OpenClaw gateway stop depends on how it's managed
  pkill -f "openclaw" 2>/dev/null || true
  sleep 2

  log "Backing up existing data..."
  if [ -d "$AIDA_HOME" ]; then
    BACKUP="$AIDA_HOME.bak.$(date +%Y%m%d%H%M%S)"
    mv "$AIDA_HOME" "$BACKUP"
    log "Backed up ~/.aida/ to $BACKUP"
  fi

  log "Cleaning workspace (preserving MEMORY.md)..."
  if [ -f "$OPENCLAW_HOME/workspace/MEMORY.md" ]; then
    cp "$OPENCLAW_HOME/workspace/MEMORY.md" /tmp/aida-memory-backup.md
  fi
  rm -rf "$OPENCLAW_HOME/workspace/skills/" 2>/dev/null || true

  log "Updating repository..."
  cd "$AIDA_REPO"
  git pull --recurse-submodules
  git submodule update --init --recursive

  log "Running install-aida.sh..."
  bash packages/bps-engine/deploy/install-aida.sh

  # Restore memory if backed up
  if [ -f /tmp/aida-memory-backup.md ]; then
    cp /tmp/aida-memory-backup.md "$OPENCLAW_HOME/workspace/MEMORY.md"
    log "Restored MEMORY.md"
  fi

  log "Waiting for Dashboard to start..."
  sleep 5

  # Verification V0
  log "Verification V0: Post-install checks"
  check "V0.1 ~/.aida/blueprints exists" "test -d $AIDA_HOME/blueprints"
  check "V0.2 ~/.aida/data exists" "test -d $AIDA_HOME/data"
  check "V0.3 ~/.aida/context exists" "test -d $AIDA_HOME/context"
  check "V0.4 SOUL.md deployed" "test -f $OPENCLAW_HOME/workspace/SOUL.md"
  check "V0.5 AGENTS.md deployed" "test -f $OPENCLAW_HOME/workspace/AGENTS.md"
  check "V0.6 Skills >= 6" "test $(ls $OPENCLAW_HOME/workspace/skills/ 2>/dev/null | wc -l) -ge 6"
  check "V0.7 Dashboard responds" "curl -s -f $DASHBOARD_URL/api/overview"

  log "Phase 0 complete."
fi

# ── Phase 1: Business Data Seeding ─────────────────────────

if [ "$SKIP_SEED" = false ] && [ "$START_PHASE" -le 1 ]; then
  section "Phase 1: Business Data Seeding"

  # 1a. Create project.yaml
  log "Creating project.yaml..."
  cat > "$AIDA_HOME/project.yaml" << 'YAML'
version: "1.1"
name: "IdleX GEO Operations"
description: "IdleX partner store AI visibility (GEO) daily operations management"
language: "zh"
blueprints: []
knowledge: []
YAML

  # 1b. Create management.yaml
  log "Creating management.yaml..."
  cat > "$AIDA_HOME/management.yaml" << 'YAML'
# IdleX GEO -- Management Constraints
# Controls Agent write operations during GEO content management

policies:
  - id: p-geo-content
    label: "GEO Content Controls"
    constraints:
      - id: c-content-publish
        label: "Content publish requires approval"
        scope:
          tools: [bps_update_entity]
          entityTypes: [geo-content]
          dataFields: [publishReady]
        condition: "publishReady == 0"
        onViolation: REQUIRE_APPROVAL
        severity: HIGH
        approver: owner
        message: "GEO content publish requires approval: {entityId}"

      - id: c-no-archive-content
        label: "Cannot archive GEO content"
        scope:
          tools: [bps_update_entity]
          entityTypes: [geo-content]
          dataFields: [lifecycle]
        condition: "lifecycle != 'ARCHIVED'"
        onViolation: BLOCK
        severity: CRITICAL
        message: "Cannot archive GEO content: {entityId}"

  - id: p-geo-strategy
    label: "GEO Strategy Controls"
    constraints:
      - id: c-strategy-change
        label: "Strategy changes require approval"
        scope:
          tools: [bps_update_entity]
          entityTypes: [geo-strategy]
          dataFields: [majorChange]
        condition: "majorChange == 0"
        onViolation: REQUIRE_APPROVAL
        severity: HIGH
        approver: owner
        message: "GEO strategy change requires approval"

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

  # 1c. Create mock-publish directories
  log "Creating mock-publish directories..."
  mkdir -p "$MOCK_PUBLISH"/{douban,qianwen,yuanbao,general}

  # 1d. Copy IdleX business docs to context/
  log "Copying IdleX business docs to context/..."
  IDLEX_DOCS="$HOME/idlekr/docs"
  if [ -d "$IDLEX_DOCS" ]; then
    cp "$IDLEX_DOCS"/*.md "$AIDA_HOME/context/" 2>/dev/null || true
    log "Copied $(ls "$AIDA_HOME/context/"*.md 2>/dev/null | wc -l) docs"
  else
    warn "IdleX docs not found at $IDLEX_DOCS, creating placeholder..."
    cat > "$AIDA_HOME/context/idlex-overview.md" << 'EOF'
# IdleX Business Overview

IdleX is an AI-era urban third-space operating system infrastructure platform.
Mission: Transform idle time slots in self-service spaces into AI-discoverable,
AI-callable, AI-deliverable digital assets.

Core Market: Self-service KTV, tea rooms, mahjong parlors -- fully autonomous,
online bookable, paid-by-time spaces.

Three Principles:
1. AI can SEE it (structured, atomized data)
2. AI dares to CALL it (dense, real, stable supply)
3. AI can DELIVER it (booking -> payment -> verification -> in-store)

GEO Strategy: "Trustworthy space data provider"
- Truth: All data real, real-time, verifiable
- Model adaptation: Different LLMs get different interfaces
- Fulfillment closure: GEO endpoint is actual orders & revenue

Brand Goal: "When AI answers space questions, it thinks of IdleX first"
EOF
  fi

  # 1e. Seed store entities via TypeScript
  log "Seeding 5 store entities..."
  cd "$AIDA_REPO"

  cat > /tmp/seed-idlex-stores.ts << 'TYPESCRIPT'
import path from 'node:path'
import fs from 'node:fs'
import { createBpsEngine, createDatabase, ManagementStore, loadManagementFile } from '@aida/bps-engine'

const DB_PATH = path.resolve(process.env.HOME || '/root', '.aida', 'data', 'bps.db')
const GOV_PATH = path.resolve(process.env.HOME || '/root', '.aida', 'management.yaml')

console.log(`[seed] Database: ${DB_PATH}`)
const db = createDatabase(DB_PATH)
const engine = createBpsEngine({ db })
const { dossierStore } = engine

// ── 5 IdleX Partner Stores ──

const stores = [
  {
    id: 'store-cs-ktv-01',
    name: 'Voice KTV (Five-One Square)',
    nameCN: '声临其境KTV-五一广场店',
    city: '长沙', district: '天心区', businessCircle: '五一广场',
    address: '长沙市天心区五一广场地铁站C出口向南200米',
    spaceType: 'self-service-ktv',
    roomCount: 8,
    operatingHours: '14:00-02:00',
    roomTypes: [
      { type: '小包', capacity: 4, priceWeekday: 88, priceWeekend: 128 },
      { type: '中包', capacity: 8, priceWeekday: 128, priceWeekend: 188 },
      { type: '大包', capacity: 15, priceWeekday: 188, priceWeekend: 268 },
    ],
    features: ['24h自助', '高品质音响', '网红装修', '零食自选'],
    joinDate: '2026-01-15',
    status: 'active',
  },
  {
    id: 'store-cs-tea-01',
    name: 'Youran Tea Room (Furong Plaza)',
    nameCN: '悠然茶室-芙蓉广场店',
    city: '长沙', district: '芙蓉区', businessCircle: '芙蓉广场',
    address: '长沙市芙蓉区芙蓉中路二段88号3楼',
    spaceType: 'self-service-tearoom',
    roomCount: 6,
    operatingHours: '09:00-22:00',
    roomTypes: [
      { type: '商务间', capacity: 6, priceWeekday: 68, priceWeekend: 98 },
      { type: '休闲间', capacity: 4, priceWeekday: 48, priceWeekend: 68 },
    ],
    features: ['静谧环境', '品质茶具', '商务会客', '投影设备'],
    joinDate: '2026-02-01',
    status: 'active',
  },
  {
    id: 'store-cs-mj-01',
    name: 'Qi Le Mahjong (Yuelu Mountain)',
    nameCN: '棋乐无穷-岳麓山店',
    city: '长沙', district: '岳麓区', businessCircle: '岳麓山',
    address: '长沙市岳麓区麓山南路158号',
    spaceType: 'self-service-mahjong',
    roomCount: 10,
    operatingHours: '10:00-24:00',
    roomTypes: [
      { type: '标准间', capacity: 4, priceWeekday: 38, priceWeekend: 58 },
      { type: 'VIP间', capacity: 6, priceWeekday: 58, priceWeekend: 88 },
    ],
    features: ['全自动麻将机', '空调独立控制', '免费WiFi', '小食供应'],
    joinDate: '2026-02-10',
    status: 'active',
  },
  {
    id: 'store-wh-ktv-01',
    name: 'Music Box KTV (Jianghan Road)',
    nameCN: '音乐盒KTV-江汉路店',
    city: '武汉', district: '江汉区', businessCircle: '江汉路',
    address: '武汉市江汉区江汉路步行街89号4楼',
    spaceType: 'self-service-ktv',
    roomCount: 12,
    operatingHours: '12:00-02:00',
    roomTypes: [
      { type: '小包', capacity: 4, priceWeekday: 78, priceWeekend: 118 },
      { type: '中包', capacity: 8, priceWeekday: 118, priceWeekend: 168 },
      { type: '大包', capacity: 15, priceWeekday: 168, priceWeekend: 238 },
    ],
    features: ['步行街核心', 'KTV+桌游', '主题房间', '拍照打卡'],
    joinDate: '2026-01-20',
    status: 'active',
  },
  {
    id: 'store-wh-tea-01',
    name: 'Quiet Tea Space (Chu River Han Street)',
    nameCN: '静享茶空间-楚河汉街店',
    city: '武汉', district: '武昌区', businessCircle: '楚河汉街',
    address: '武汉市武昌区楚河汉街第二街区L2-12',
    spaceType: 'self-service-tearoom',
    roomCount: 8,
    operatingHours: '08:00-21:00',
    roomTypes: [
      { type: '独享间', capacity: 2, priceWeekday: 58, priceWeekend: 78 },
      { type: '商务间', capacity: 6, priceWeekday: 78, priceWeekend: 108 },
    ],
    features: ['湖景包间', '高端茶叶', '会议投屏', '安静办公'],
    joinDate: '2026-02-15',
    status: 'active',
  },
]

for (const store of stores) {
  const { id, ...data } = store
  const dossier = dossierStore.getOrCreate('store', id)
  dossierStore.commit(dossier.id, data, {
    committedBy: 'system',
    message: `Seeded partner store: ${data.nameCN}`,
  })
  console.log(`[seed] Created store: ${data.nameCN} (${id})`)
}

// ── Load Management Constraints ──

if (fs.existsSync(GOV_PATH)) {
  const mgmtStore = new ManagementStore(db)
  const result = loadManagementFile(GOV_PATH)
  if (result.errors.length > 0) {
    console.log(`[seed] WARNING: management errors: ${result.errors.join(', ')}`)
  }
  mgmtStore.loadConstraints(result.constraints)
  console.log(`[seed] Loaded ${result.constraints.length} management constraints`)
} else {
  console.log('[seed] WARNING: management.yaml not found')
}

// ── Summary ──

const allEntities = dossierStore.query({})
console.log(`\n[seed] Done! ${allEntities.length} entities in database.`)
TYPESCRIPT

  cd "$AIDA_REPO/packages/bps-dashboard"
  node --import tsx /tmp/seed-idlex-stores.ts
  cd "$AIDA_REPO"

  # Restart dashboard to pick up management + new data
  log "Restarting Dashboard..."
  systemctl restart bps-dashboard 2>/dev/null || true
  sleep 3

  # Verification V1
  log "Verification V1: Post-seed checks"
  STORE_COUNT=$(api_get "/api/entities?entityType=store" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  check "V1.1 5 store entities seeded" "test '$STORE_COUNT' -ge 5"

  GOV_COUNT=$(api_get "/api/management/constraints" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  check "V1.2 Management constraints loaded" "test '$GOV_COUNT' -ge 2"

  CONTEXT_COUNT=$(ls "$AIDA_HOME/context/"*.md 2>/dev/null | wc -l)
  check "V1.3 Context docs present" "test '$CONTEXT_COUNT' -ge 1"
  check "V1.4 Mock-publish dirs exist" "test -d $MOCK_PUBLISH/douban"
  check "V1.5 project.yaml exists" "test -f $AIDA_HOME/project.yaml"

  log "Phase 1 complete."
fi

# ── Phase 2: Business Modeling (Aida Conversation) ─────────

if [ "$START_PHASE" -le 2 ]; then
  section "Phase 2: Business Modeling"

  # Count entities before
  ENTITY_BEFORE=$(api_get "/api/entities" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

  # Turn 1: Business Background + Requirements
  log "Turn 1: Sending business requirements to Aida..."

  TURN1_MSG='我是闲氪的运营负责人。闲氪帮合作门店在AI时代"被看见"。

业务背景资料在 context/ 目录，请先了解一下。

我们现有5家合作门店（已录入系统），分布在长沙和武汉。我需要你帮我建立GEO日常运营体系，核心目标：让每家门店在主流AI Agent（豆包、千问、元宝）中的能见度持续上升。

我需要的运营能力：
1. 每天监测各门店在主流AI Agent中的能见度
2. 基于监测数据做洞察分析，制定能见度提升战略
3. 根据战略生成优化内容（门店描述、FAQ、场景故事等）
4. 内容分发（测试阶段输出到 ~/.aida/mock-publish/ 目录）
5. 每天做运营小结，每周做运营总结
6. 定期回顾，评估战略效果并优化

测试阶段，能见度探测可以使用模拟数据。
请帮我建立起这个运营体系。'

  TURN1_RESPONSE=$(openclaw agent --agent main --message "$TURN1_MSG" 2>&1) || true
  echo "$TURN1_RESPONSE" | tee "/tmp/idlex-geo-turn1.log"

  # Wait for processing
  sleep 5

  # Check what Aida created
  ENTITY_AFTER=$(api_get "/api/entities" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  NEW_ENTITIES=$((ENTITY_AFTER - ENTITY_BEFORE))

  log "Verification V2a: Post-modeling checks"
  check "V2a.1 New entities created (>= 1)" "test '$NEW_ENTITIES' -ge 1"
  check "V2a.2 Aida produced response" "test -s /tmp/idlex-geo-turn1.log"

  # Check for specific entity types
  for etype in "geo-strategy" "action-plan" "geo-probe" "geo-content"; do
    COUNT=$(api_get "/api/entities?entityType=$etype" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
    if [ "$COUNT" -gt 0 ]; then
      log "  Found $COUNT $etype entities"
    fi
  done

  log "New entities created: $NEW_ENTITIES"

  # Turn 2: Review request
  log "Turn 2: Requesting modeling review..."

  TURN2_MSG='很好。帮我检查一下建模结果——Dashboard上能看到什么？我想确认各项数据是否正确。'

  TURN2_RESPONSE=$(openclaw agent --agent main --message "$TURN2_MSG" 2>&1) || true
  echo "$TURN2_RESPONSE" | tee "/tmp/idlex-geo-turn2.log"

  check "V2b.1 Aida mentions Dashboard" "grep -qi 'dashboard\|3456\|面板' /tmp/idlex-geo-turn2.log"

  log "Phase 2 complete."
fi

# ── Phase 3: Execution ─────────────────────────────────────

if [ "$START_PHASE" -le 3 ]; then
  section "Phase 3: GEO Execution"

  # Count management records before
  GOV_VIOLATIONS_BEFORE=$(api_get "/api/management/violations" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

  # Turn 3: Start execution
  log "Turn 3: Starting GEO execution..."

  TURN3_MSG='确认没问题。开始执行今天的GEO运营工作——先做能见度探测，然后根据结果生成优化内容并尝试分发。'

  TURN3_RESPONSE=$(openclaw agent --agent main --message "$TURN3_MSG" 2>&1) || true
  echo "$TURN3_RESPONSE" | tee "/tmp/idlex-geo-turn3.log"

  sleep 5

  log "Verification V3: Post-execution checks"

  # Check for probe entities
  PROBE_COUNT=$(api_get "/api/entities?entityType=geo-probe" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  check "V3.1 GEO probe entities exist" "test '$PROBE_COUNT' -ge 1"

  # Check for content entities
  CONTENT_COUNT=$(api_get "/api/entities?entityType=geo-content" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  check "V3.2 GEO content entities exist" "test '$CONTENT_COUNT' -ge 1"

  # Check management violations
  GOV_VIOLATIONS_AFTER=$(api_get "/api/management/violations" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  NEW_VIOLATIONS=$((GOV_VIOLATIONS_AFTER - GOV_VIOLATIONS_BEFORE))
  check "V3.3 Management violation recorded" "test '$NEW_VIOLATIONS' -ge 1"

  # Check pending approvals
  PENDING=$(api_get "/api/management/approvals" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([a for a in d if a.get('status')=='PENDING']))" 2>/dev/null || echo "0")
  check "V3.4 Management approval pending" "test '$PENDING' -ge 1"

  # Check if Aida reported the block
  check "V3.5 Aida reported management interception" "grep -qi 'approval\|审批\|management\|blocked\|拦截' /tmp/idlex-geo-turn3.log"

  log "Phase 3 complete."
fi

# ── Phase 4: Dashboard Approval ────────────────────────────

if [ "$START_PHASE" -le 4 ]; then
  section "Phase 4: Dashboard Approval"

  # Turn 4: Acknowledge
  log "Turn 4: Acknowledging management block..."

  TURN4_MSG='明白了，我去Dashboard处理审批。'

  TURN4_RESPONSE=$(openclaw agent --agent main --message "$TURN4_MSG" 2>&1) || true
  echo "$TURN4_RESPONSE" | tee "/tmp/idlex-geo-turn4.log"

  # Get pending approvals
  log "Querying pending approvals..."
  APPROVALS_JSON=$(api_get "/api/management/approvals" || echo "[]")
  echo "$APPROVALS_JSON" | python3 -m json.tool 2>/dev/null || echo "$APPROVALS_JSON"

  # Approve the first pending approval
  APPROVAL_ID=$(echo "$APPROVALS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
pending = [a for a in data if a.get('status') == 'PENDING']
if pending:
    print(pending[0]['id'])
else:
    print('')
" 2>/dev/null || echo "")

  if [ -n "$APPROVAL_ID" ]; then
    log "Approving: $APPROVAL_ID"
    APPROVE_RESULT=$(api_post "/api/management/approvals/$APPROVAL_ID/decide" '{"decision":"APPROVED","decidedBy":"owner"}')
    echo "$APPROVE_RESULT" | python3 -m json.tool 2>/dev/null || echo "$APPROVE_RESULT"

    check "V4.1 Approval processed" "echo '$APPROVE_RESULT' | grep -qi 'APPROVED\|success'"

    # Check no more pending (or fewer)
    REMAINING=$(api_get "/api/management/approvals" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([a for a in d if a.get('status')=='PENDING']))" 2>/dev/null || echo "0")
    check "V4.2 Approval removed from queue" "test '$REMAINING' -lt '$PENDING'"
  else
    warn "No pending approvals found -- management may not have fired"
    fail "V4.1 No approval to process"
  fi

  log "Phase 4 complete."
fi

# ── Phase 5: Post-Approval Summary ────────────────────────

if [ "$START_PHASE" -le 5 ]; then
  section "Phase 5: Daily Summary"

  log "Turn 5: Requesting daily summary..."

  TURN5_MSG='内容发布审批已通过。请做一个今天的GEO运营小结。'

  TURN5_RESPONSE=$(openclaw agent --agent main --message "$TURN5_MSG" 2>&1) || true
  echo "$TURN5_RESPONSE" | tee "/tmp/idlex-geo-turn5.log"

  log "Verification V5: Summary checks"
  check "V5.1 Aida produced summary" "test -s /tmp/idlex-geo-turn5.log"
  check "V5.2 Summary mentions stores or GEO" "grep -qi 'store\|门店\|能见度\|GEO\|geo\|探测\|内容' /tmp/idlex-geo-turn5.log"

  log "Phase 5 complete."
fi

# ── Phase 6: Final Verification ────────────────────────────

if [ "$START_PHASE" -le 6 ]; then
  section "Phase 6: Final Verification"

  log "Running comprehensive checks..."

  # Entity counts
  TOTAL_ENTITIES=$(api_get "/api/entities" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  check "V6.1 Total entities >= 7 (5 stores + GEO)" "test '$TOTAL_ENTITIES' -ge 7"

  # Entity type breakdown
  log "Entity breakdown:"
  api_get "/api/entities" | python3 -c "
import sys, json
data = json.load(sys.stdin)
types = {}
for e in data:
    t = e.get('entityType', 'unknown')
    types[t] = types.get(t, 0) + 1
for t, c in sorted(types.items()):
    print(f'  {t}: {c}')
" 2>/dev/null || warn "Could not parse entities"

  # Management audit
  TOTAL_VIOLATIONS=$(api_get "/api/management/violations" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  check "V6.2 Management violations recorded" "test '$TOTAL_VIOLATIONS' -ge 1"

  TOTAL_APPROVALS=$(api_get "/api/management/approvals" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([a for a in d if a.get('status')=='APPROVED']))" 2>/dev/null || echo "0")
  check "V6.3 At least 1 approved approval" "test '$TOTAL_APPROVALS' -ge 1"

  # Dashboard pages
  for page in "/" "/business-goals" "/approvals" "/management" "/agent-log"; do
    check "V6.4 Dashboard page $page accessible" "curl -s -f $DASHBOARD_URL$page > /dev/null"
  done

  # Mock-publish directory
  PUBLISH_FILES=$(find "$MOCK_PUBLISH" -type f 2>/dev/null | wc -l)
  if [ "$PUBLISH_FILES" -gt 0 ]; then
    pass "V6.5 Mock-publish has $PUBLISH_FILES files"
  else
    warn "V6.5 No files in mock-publish (Aida may not have written files directly)"
  fi

  # Conversation logs
  log "Conversation logs saved to /tmp/idlex-geo-turn{1..5}.log"

  log "Phase 6 complete."
fi

# ── Test Report ────────────────────────────────────────────

section "Test Report"

echo "IdleX GEO E2E Test Results"
echo "=========================="
echo "Date: $(date)"
echo "Server: $(hostname)"
echo ""
echo "Results: $PASS_COUNT PASS / $FAIL_COUNT FAIL / $TOTAL_TESTS TOTAL"
echo ""

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}ALL TESTS PASSED${NC}"
else
  echo -e "${RED}$FAIL_COUNT TESTS FAILED${NC}"
  echo ""
  echo "Check logs:"
  echo "  /tmp/idlex-geo-turn{1..5}.log  -- Aida conversation logs"
  echo "  Dashboard: $DASHBOARD_URL       -- Visual verification"
fi

echo ""
echo "Dashboard pages to verify manually:"
echo "  $DASHBOARD_URL/                -- Overview (entities + management status)"
echo "  $DASHBOARD_URL/business-goals  -- Action plans"
echo "  $DASHBOARD_URL/management      -- Constraints + violations + approvals"
echo "  $DASHBOARD_URL/agent-log       -- Full audit trail"
echo ""

# Save report
cat > /tmp/idlex-geo-e2e-report.txt << EOF
IdleX GEO E2E Test Report
=========================
Date: $(date)
Server: $(hostname)
Results: $PASS_COUNT PASS / $FAIL_COUNT FAIL / $TOTAL_TESTS TOTAL

Entity counts:
$(api_get "/api/entities" | python3 -c "
import sys, json
data = json.load(sys.stdin)
types = {}
for e in data:
    t = e.get('entityType', 'unknown')
    types[t] = types.get(t, 0) + 1
print(f'  Total: {len(data)}')
for t, c in sorted(types.items()):
    print(f'  {t}: {c}')
" 2>/dev/null || echo "  (could not parse)")

Management:
  Violations: $TOTAL_VIOLATIONS
  Approved: $TOTAL_APPROVALS

Dashboard: $DASHBOARD_URL
EOF

log "Report saved to /tmp/idlex-geo-e2e-report.txt"

exit $FAIL_COUNT
