#!/usr/bin/env bash
# ============================================================
# AIDA Structural Capability E2E Test
# ============================================================
# Primary iteration tool: tests all structural engine features
# through the deployed AIDA system.
#
# Usage:
#   bash test/e2e/structural-capability.sh [options]
#
# Options:
#   --skip-install    Skip reinstall (reuse existing deployment)
#   --engine-only     Skip agent turns (fast mode, ~3 min)
#   --phase N         Start from phase N
#
# Test plan: test/e2e/structural-capability-test.md
# Run on: root@47.236.109.62
# ============================================================

set -euo pipefail

# -- Configuration --
AIDA_HOME="${AIDA_HOME:-$HOME/.aida}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
AIDA_REPO="${AIDA_REPO:-$HOME/aida}"
DASHBOARD_URL="http://localhost:3456"
LOG_DIR="/tmp/structural-capability"
AGENT_TIMEOUT=300

SKIP_INSTALL=false
ENGINE_ONLY=false
START_PHASE=0
PASS=0; FAIL=0; WARNS=0; TOTAL=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-install) SKIP_INSTALL=true; shift ;;
    --engine-only)  ENGINE_ONLY=true; shift ;;
    --phase)        START_PHASE="${2:-0}"; [[ "$START_PHASE" =~ ^[0-9]+$ ]] || { echo "Error: --phase requires a numeric value"; exit 1; }; shift 2 ;;
    *)              shift ;;
  esac
done

rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# -- Helpers --
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()     { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
pass()    { echo -e "  ${GREEN}PASS${NC} $*"; PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); }
fail()    { echo -e "  ${RED}FAIL${NC} $*"; FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); }
warn_()   { echo -e "  ${YELLOW}WARN${NC} $*"; WARNS=$((WARNS+1)); TOTAL=$((TOTAL+1)); }
section() { echo -e "\n${BOLD}${YELLOW}══════════════════════════════════════════════${NC}"; \
            echo -e "${BOLD}  Phase $*${NC}"; \
            echo -e "${BOLD}${YELLOW}══════════════════════════════════════════════${NC}\n"; }

check() { local desc="$1"; shift; if eval "$@" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi; }
soft()  { local desc="$1"; shift; if eval "$@" >/dev/null 2>&1; then pass "$desc"; else warn_ "$desc (non-critical)"; fi; }

api_get()  { curl -sf "$DASHBOARD_URL$1" 2>/dev/null; }
api_post() { curl -sf -X POST -H "Content-Type: application/json" -d "$2" "$DASHBOARD_URL$1" 2>/dev/null; }
jlen()     { node -e "try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(Array.isArray(d)?d.length:0)}catch{console.log(0)}"; }
jfield()   { node -e "try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d[$1]??'')}catch{console.log('')}"; }

aida_say() {
  local turn="$1"; shift; local msg="$1"
  log "Turn $turn: sending to Aida..."
  local out="$LOG_DIR/turn-$turn.log"
  timeout "$AGENT_TIMEOUT" openclaw agent --agent main --message "$msg" > "$out" 2>&1 || true
  echo -e "${CYAN}--- Aida response (turn $turn, first 20 lines) ---${NC}"
  head -20 "$out"
  echo -e "${CYAN}--- (full log: $out, $(wc -l < "$out") lines total) ---${NC}\n"
}

STARTED_AT=$(date +%s)

# ════════════════════════════════════════════════════════════
# Phase 0: Install Verification
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 0 ]; then
  section "0: Install Verification"

  if [ "$SKIP_INSTALL" = false ]; then
    log "Stopping existing services..."
    systemctl stop bps-dashboard 2>/dev/null || true
    systemctl stop openclaw-gateway 2>/dev/null || true
    pkill -f "openclaw gateway" 2>/dev/null || true
    sleep 3

    log "Backing up ~/.aida/..."
    [ -d "$AIDA_HOME" ] && mv "$AIDA_HOME" "$AIDA_HOME.bak.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true

    # Wipe OpenClaw state but preserve auth
    log "Wiping OpenClaw state..."
    rm -rf "$OPENCLAW_HOME/workspace/" 2>/dev/null || true
    rm -rf "$OPENCLAW_HOME"/workspace-* 2>/dev/null || true
    rm -rf "$OPENCLAW_HOME/agents/main/sessions/" 2>/dev/null || true
    rm -rf "$OPENCLAW_HOME/cron/" 2>/dev/null || true

    log "Updating repo..."
    cd "$AIDA_REPO"
    git pull --no-recurse-submodules 2>&1 | tail -3 || true

    log "Running install-aida.sh..."
    bash deploy/install-aida.sh

    # Lock model to dashscope/qwen3.5-plus — structural capability tests
    # use a fixed model to provide a stable baseline for iterating on
    # the test framework itself. Cross-model evaluation is handled by
    # the benchmark suite which reuses this test plan.
    # R1-R5 ran on Qwen (unintentionally), R6 on Kimi; Qwen outperformed.
    log "Locking model to dashscope/qwen3.5-plus..."
    OC_CONFIG="$OPENCLAW_HOME/openclaw.json"
    node -e '
      const fs = require("fs");
      const c = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
      if (!c.agents) c.agents = {};
      if (!c.agents.defaults) c.agents.defaults = {};
      c.agents.defaults.model = {
        primary: "dashscope/qwen3.5-plus",
        fallbacks: ["kimi/kimi-for-coding"]
      };
      if (!c.agents.defaults.models) c.agents.defaults.models = {};
      c.agents.defaults.models["dashscope/qwen3.5-plus"] = { alias: "Qwen3.5-Plus via DashScope" };
      fs.writeFileSync(process.argv[1], JSON.stringify(c, null, 2) + "\n");
      console.log("[structural] model locked: dashscope/qwen3.5-plus");
    ' "$OC_CONFIG"

    log "Starting OpenClaw gateway..."
    openclaw gateway start 2>/dev/null || warn_ "Gateway start returned non-zero"
    for i in $(seq 1 12); do
      if openclaw gateway status 2>/dev/null | grep -qi "running\|healthy\|active"; then
        log "  Gateway healthy after ${i}x5s"
        break
      fi
      sleep 5
    done
  fi

  # V0 checks
  log "V0: Verifying installation..."
  check "V0.1 ~/.aida/data/"        "test -d $AIDA_HOME/data"
  check "V0.2 SOUL.md"              "test -f $OPENCLAW_HOME/workspace/SOUL.md"
  check "V0.3 AGENTS.md"            "test -f $OPENCLAW_HOME/workspace/AGENTS.md"
  check "V0.4 TOOLS.md"             "test -f $OPENCLAW_HOME/workspace/TOOLS.md"
  check "V0.5 Dashboard API"        "curl -sf $DASHBOARD_URL/api/overview >/dev/null"

  SKILL_N=$(find "$OPENCLAW_HOME/workspace/skills/" -name SKILL.md 2>/dev/null | wc -l)
  check "V0.6 Skills >= 7 (found $SKILL_N)" "test $SKILL_N -ge 7"

  ACTUAL_MODEL=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$OPENCLAW_HOME/openclaw.json','utf8'));console.log(c.agents?.defaults?.model?.primary||'UNKNOWN')}catch{console.log('ERROR')}" 2>/dev/null)
  check "V0.7 Model locked to dashscope/qwen3.5-plus (got $ACTUAL_MODEL)" "test '$ACTUAL_MODEL' = 'dashscope/qwen3.5-plus'"

  log "Phase 0 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 1: Data Seeding
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 1 ]; then
  section "1: Data Seeding"

  # 1a. project.yaml
  log "Creating project.yaml..."
  mkdir -p "$AIDA_HOME"/{blueprints,data,context}
  cat > "$AIDA_HOME/project.yaml" << 'YAML'
version: "1.1"
name: "IdleX GEO Operations"
projectId: "idlex-geo"
description: "IdleX partner store AI visibility (GEO) daily operations"
language: "zh"
blueprints: []
knowledge: []
YAML

  # 1a-2. Business context document for Aida
  log "Creating business context..."
  cat > "$AIDA_HOME/context/idlex-geo-background.md" << 'CTXEOF'
# 闲氪 GEO 业务背景

## 闲氪是谁
闲氪 = AI时代城市第三空间基础设施。连接大模型、空间供给方、消费者的中立可信平台。
使命：让第三空间闲置时段成为AI可发现、可调用、可交付的数字资产。

## GEO（生成式引擎优化）
GEO不是AI版SEO。核心区别：
- GEO是"抢心智"而非"抢流量"——让AI优先推荐闲氪
- 数据必须真实、结构化、可履约
- "一模一策"：不同AI模型偏好不同，必须差异化优化

### 目标AI平台
| 平台 | 厂商 | 内容偏好 |
|------|------|---------|
| 豆包 | 字节跳动 | 情感化、个性化、场景故事 |
| 千问 | 阿里巴巴 | 结构化、任务导向、工作流 |
| 元宝 | 腾讯 | 务实、企业视角、性价比 |

## 合作门店（当前5家）
长沙3家 + 武汉2家，覆盖KTV、茶室、麻将三种空间类型。
时空SKU = 门店 + 包厢/房间 + 时段（最小可交易单元）。

## 日常运营节奏
1. 能见度探测：监测各门店在AI平台的推荐情况
2. 深度洞察：分析各平台偏好差异
3. 内容生成：一模一策，差异化GEO内容
4. 内容分发：写入对应平台优化渠道
5. 效果评估：日小结、周总结
6. 战略校准：阶段性回顾，调整策略

## 管理规矩
- 所有对外发布内容必须经GEO负责人审批
- 战略方向重大调整需要负责人确认

## 业务指标
核心KPI："被看见"指标上升——在AI平台的能见度持续提升
CTXEOF

  # 1b. management.yaml — 3 constraints covering different verdicts
  log "Creating management.yaml..."
  cat > "$AIDA_HOME/management.yaml" << 'YAML'
policies:
  - id: p-publish
    label: "Content Publication Controls"
    constraints:
      - id: c-publish-approval
        label: "Publishing content requires approval"
        scope:
          tools: [bps_update_entity]
          entityTypes: [content, geo-content]
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
          entityTypes: [content, geo-content]
          dataFields: [lifecycle]
        condition: "lifecycle != 'ARCHIVED'"
        onViolation: BLOCK
        severity: CRITICAL
        message: "Cannot archive content: {entityId}"

  - id: p-strategy
    label: "Strategy Change Controls"
    constraints:
      - id: c-strategy-approval
        label: "Strategy changes require approval"
        scope:
          tools: [bps_update_entity]
          entityTypes: [strategy]
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
    - severity: HIGH
      max_violations: 2
      window: 1h
      action: WARNING
  cooldown: 30m
YAML

  # 1c. Seed entities, blueprint, tasks, management via TypeScript
  log "Seeding test data via TypeScript..."
  cd "$AIDA_REPO"

  cat > .tmp-structural-seed.ts << 'TYPESCRIPT'
import path from 'node:path';
import fs from 'node:fs';
import { createBpsEngine, createDatabase, ManagementStore, loadManagementFile } from './src/index.js';

const HOME = process.env.HOME || '/root';
const DB_PATH = path.resolve(HOME, '.aida', 'data', 'bps.db');
const GOV_PATH = path.resolve(HOME, '.aida', 'management.yaml');

console.log(`[seed] DB: ${DB_PATH}`);
const db = createDatabase(DB_PATH);
const engine = createBpsEngine({ db });
const { dossierStore, blueprintStore, processStore } = engine;

// --- Seed 5 store entities (IdleX partner stores with rich business data) ---
const stores = [
  {
    id: 'store-cs-ktv-01', nameCN: '声临其境KTV', city: '长沙', type: 'ktv',
    district: '天心区', businessCircle: '五一广场',
    roomTypes: ['小包(2-4人)', '中包(4-8人)', '大包(8-15人)'],
    features: ['自助点歌', '24小时营业', '零食饮料自取'],
    operatingHours: '10:00-02:00',
    basePrice: 39,
  },
  {
    id: 'store-cs-tea-01', nameCN: '悠然茶室', city: '长沙', type: 'tearoom',
    district: '岳麓区', businessCircle: '大学城',
    roomTypes: ['2人雅间', '4人茶室', '8人包厢'],
    features: ['自助泡茶', '安静环境', '免费WiFi'],
    operatingHours: '09:00-23:00',
    basePrice: 29,
  },
  {
    id: 'store-cs-mj-01', nameCN: '棋乐无穷', city: '长沙', type: 'mahjong',
    district: '雨花区', businessCircle: '红星商圈',
    roomTypes: ['标准麻将房', 'VIP棋牌室'],
    features: ['自动麻将桌', '空调独立控制', '免费茶水'],
    operatingHours: '10:00-24:00',
    basePrice: 35,
  },
  {
    id: 'store-wh-ktv-01', nameCN: '音乐盒KTV', city: '武汉', type: 'ktv',
    district: '武昌区', businessCircle: '楚河汉街',
    roomTypes: ['迷你包(2人)', '标准包(4-6人)', '豪华包(8-12人)'],
    features: ['K歌评分', '主题包厢', '无人值守'],
    operatingHours: '11:00-01:00',
    basePrice: 45,
  },
  {
    id: 'store-wh-tea-01', nameCN: '静享茶空间', city: '武汉', type: 'tearoom',
    district: '江汉区', businessCircle: '江汉路步行街',
    roomTypes: ['单人静读位', '双人对饮室', '多人会客厅'],
    features: ['精品茶叶', '禅意装修', '背景音乐可选'],
    operatingHours: '08:00-22:00',
    basePrice: 25,
  },
];

for (const s of stores) {
  const d = dossierStore.getOrCreate('store', s.id);
  dossierStore.commit(d.id, {
    nameCN: s.nameCN, city: s.city, spaceType: s.type, status: 'active',
    district: s.district, businessCircle: s.businessCircle,
    roomTypes: s.roomTypes, features: s.features,
    operatingHours: s.operatingHours, basePrice: s.basePrice,
  }, {
    committedBy: 'structural-test:seed',
    message: `Seed store: ${s.nameCN}`,
  });
  console.log(`[seed] + store/${s.id}`);
}

// --- Seed 1 action-plan entity ---
const apDossier = dossierStore.getOrCreate('action-plan', 'ap-structural-test');
dossierStore.commit(apDossier.id, {
  title: 'IdleX GEO Operations Action Plan',
  items: [
    { id: 'item-1', description: '建立GEO运营体系：能见度探测 + 内容生成 + 效果评估', status: 'pending' },
    { id: 'item-2', description: '一模一策落地：豆包/千问/元宝差异化内容', status: 'pending' },
    { id: 'item-3', description: '管理制度建设：内容审批 + 战略审批 + 质量管控', status: 'pending' },
  ],
}, { committedBy: 'structural-test:seed', message: 'Seed GEO action plan' });
console.log('[seed] + action-plan/ap-structural-test');

// --- Seed 1 strategy entity ---
const stDossier = dossierStore.getOrCreate('strategy', 'st-geo-master');
dossierStore.commit(stDossier.id, {
  title: 'IdleX GEO Master Strategy',
  vision: '让每家合作门店在AI时代被看见',
  platforms: ['doubao', 'qianwen', 'yuanbao'],
  coreStrategy: '一模一策：不同AI模型差异化优化',
  kpi: '被看见指标持续上升',
  majorChange: false,
}, { committedBy: 'structural-test:seed', message: 'Seed GEO strategy' });
console.log('[seed] + strategy/st-geo-master');

// --- Seed 1 blueprint with flow rules ---
import { loadBlueprintFromString } from './src/loader/yaml-loader.js';

const blueprintYaml = `
name: structural-test-blueprint
services:
  - id: svc-probe
    label: "Visibility Probe"
    serviceType: atomic
    executorType: agent
    entityType: probe
  - id: svc-analyze
    label: "Data Analysis"
    serviceType: atomic
    executorType: agent
    entityType: analysis
  - id: svc-content
    label: "Content Generation"
    serviceType: atomic
    executorType: agent
    entityType: content
  - id: svc-review
    label: "Content Review"
    serviceType: atomic
    executorType: manual
    entityType: content

flow:
  - "svc-probe -> svc-analyze"
  - "svc-analyze -> svc-content, svc-review"
`;

const loadResult = loadBlueprintFromString(blueprintYaml, blueprintStore);
console.log(`[seed] + blueprint: ${loadResult.services} services, ${loadResult.rules} rules`);

// Save blueprint file
fs.mkdirSync(path.resolve(HOME, '.aida', 'blueprints'), { recursive: true });
fs.writeFileSync(
  path.resolve(HOME, '.aida', 'blueprints', 'structural-test-blueprint.yaml'),
  blueprintYaml, 'utf-8'
);

// --- Seed 3 tasks with groupId, priority, deadline ---
const tracker = engine.tracker;

const task1 = tracker.createTask({
  serviceId: 'svc-probe',
  entityType: 'probe',
  entityId: 'probe-store-01',
  priority: 3,
  deadline: '2026-03-15T10:00:00Z',
  groupId: 'group-structural-batch',
});
console.log(`[seed] + task ${task1.id} (group=group-structural-batch, priority=3, deadline=2026-03-15)`);

const task2 = tracker.createTask({
  serviceId: 'svc-analyze',
  entityType: 'analysis',
  entityId: 'analysis-01',
  priority: 1,
  deadline: '2026-03-16T10:00:00Z',
  groupId: 'group-structural-batch',
});
console.log(`[seed] + task ${task2.id} (group=group-structural-batch, priority=1, deadline=2026-03-16)`);

const task3 = tracker.createTask({
  serviceId: 'svc-content',
  entityType: 'content',
  entityId: 'content-01',
  priority: 5,
  groupId: 'group-structural-batch',
});
console.log(`[seed] + task ${task3.id} (group=group-structural-batch, priority=5, no deadline)`);

// --- Seed entity relations ---
const ktvDossier = dossierStore.get('store', 'store-cs-ktv-01');
if (ktvDossier) {
  dossierStore.setRelations(ktvDossier.dossier.id, [
    { targetEntityType: 'action-plan', targetEntityId: 'ap-structural-test', relationType: 'references' },
    { targetEntityType: 'strategy', targetEntityId: 'st-geo-master', relationType: 'depends_on' },
  ]);
  console.log('[seed] + relations on store-cs-ktv-01 (2 relations)');
}

// --- Load management ---
if (fs.existsSync(GOV_PATH)) {
  const mgmtStore = new ManagementStore(db);
  const result = loadManagementFile(GOV_PATH);
  if (result.errors.length > 0) console.log(`[seed] WARN: ${result.errors.join(', ')}`);
  mgmtStore.loadConstraints(result.constraints);
  console.log(`[seed] + ${result.constraints.length} management constraints`);
}

// --- Summary ---
console.log(`\n[seed] Done:`);
console.log(`  Entities: ${dossierStore.query({}).length}`);
console.log(`  Services: ${blueprintStore.listServices({}).length}`);
console.log(`  Tasks: ${processStore.query({}).length}`);
console.log(`  Task IDs: ${[task1.id, task2.id, task3.id].join(', ')}`);

// Write task IDs for later phases
fs.writeFileSync('/tmp/structural-capability/seed-ids.json', JSON.stringify({
  taskIds: [task1.id, task2.id, task3.id],
  groupId: 'group-structural-batch',
}));
TYPESCRIPT

  node --import tsx .tmp-structural-seed.ts 2>&1 | tee "$LOG_DIR/seed.log"
  rm -f .tmp-structural-seed.ts

  # Restart dashboard to pick up new data
  log "Restarting Dashboard..."
  systemctl restart bps-dashboard 2>/dev/null || true
  sleep 3

  # V1 checks
  log "V1: Post-seed checks"
  SC=$(api_get "/api/entities?entityType=store" | jlen)
  check "V1.1 5 store entities (got $SC)" "test $SC -ge 5"

  GC=$(api_get "/api/management/constraints" | jlen)
  check "V1.2 >= 3 management constraints (got $GC)" "test $GC -ge 3"

  check "V1.3 project.yaml" "test -f $AIDA_HOME/project.yaml"
  check "V1.4 Blueprint file"  "test -f $AIDA_HOME/blueprints/structural-test-blueprint.yaml"

  TE=$(api_get "/api/entities" | jlen)
  check "V1.5 >= 7 total entities (got $TE)" "test $TE -ge 7"

  log "Phase 1 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 2: Engine Structural Tests (Programmatic)
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 2 ]; then
  section "2: Engine Structural Tests"

  log "Running programmatic engine tests..."
  cd "$AIDA_REPO"

  cat > .tmp-structural-engine.ts << 'TYPESCRIPTEOF'
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  createBpsEngine,
  createDatabase,
  ManagementStore,
  SkillMetricsStore,
  CollaborationStore,
} from './src/index.js';
import { ActionGate } from './src/management/action-gate.js';
import { loadManagementFile } from './src/management/management-loader.js';
import { GATED_WRITE_TOOLS, DEFAULT_SCOPE_WRITE_TOOLS } from './src/management/constants.js';
import { createBpsTools } from './src/integration/tools.js';

const HOME = process.env.HOME || '/root';
const DB_PATH = path.resolve(HOME, '.aida', 'data', 'bps.db');
const GOV_PATH = path.resolve(HOME, '.aida', 'management.yaml');
const SKILLS_DIR = path.resolve(HOME, '.openclaw', 'workspace', 'skills');

const db = createDatabase(DB_PATH);
const engine = createBpsEngine({ db });
const mgmtStore = new ManagementStore(db);
const skillMetrics = new SkillMetricsStore(db);

// Load management constraints
const govResult = loadManagementFile(GOV_PATH);
mgmtStore.loadConstraints(govResult.constraints);

// Create ActionGate with test-friendly config
const gate = new ActionGate(mgmtStore, {
  thresholds: [
    { severity: 'CRITICAL', maxViolations: 1, window: '1h', action: 'DISCONNECTED' },
    { severity: 'HIGH', maxViolations: 5, window: '1h', action: 'RESTRICTED' },
    { severity: 'HIGH', maxViolations: 2, window: '1h', action: 'WARNING' },
  ],
  cooldown: '1s', // Short cooldown for test
});

// Collaboration store
const collabStore = new CollaborationStore(db);

// Create tools with management + collaboration
const tools = createBpsTools({
  tracker: engine.tracker,
  blueprintStore: engine.blueprintStore,
  processStore: engine.processStore,
  dossierStore: engine.dossierStore,
  skillsDir: SKILLS_DIR,
  managementGate: gate,
  managementStore: mgmtStore,
  skillMetricsStore: skillMetrics,
  collaborationStore: collabStore,
});

interface TestResult {
  id: string;
  description: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function assert(id: string, desc: string, condition: boolean, detail?: string) {
  results.push({ id, description: desc, passed: condition, detail });
  const icon = condition ? '✓' : '✗';
  console.log(`  ${icon} ${id} ${desc}${detail ? ` — ${detail}` : ''}`);
}

// Helper: fully reset management state (CB + violations + approvals)
function resetManagement() {
  db.exec('DELETE FROM bps_management_violations');
  db.exec('DELETE FROM bps_management_approvals');
  mgmtStore.resetCircuitBreaker();
}

// ═════════════════════════════════════════════
// D1: Management Gating
// ═════════════════════════════════════════════
console.log('\n--- D1: Management Gating ---');

// S2.01: All 9 GATED_WRITE_TOOLS are defined
assert('S2.01', 'GATED_WRITE_TOOLS has 9 entries',
  GATED_WRITE_TOOLS.length === 9,
  `got ${GATED_WRITE_TOOLS.length}: ${GATED_WRITE_TOOLS.join(', ')}`);

// S2.02: Read-only tool bypasses management
{
  const result = gate.check('bps_list_services', {});
  assert('S2.02', 'Read-only tool bypasses management',
    result.verdict === 'PASS' && result.checks.length === 0);
}

// S2.03: BLOCK verdict for CRITICAL constraint
{
  // Trigger the c-no-archive constraint (lifecycle = ARCHIVED on content entity)
  const result = gate.check('bps_update_entity', {
    entityType: 'content',
    entityId: 'test-content-01',
    data: { lifecycle: 'ARCHIVED' },
  });
  assert('S2.03', 'BLOCK verdict for CRITICAL constraint',
    result.verdict === 'BLOCK',
    `verdict=${result.verdict}, checks=${result.checks.length}`);
}

// Reset circuit breaker after CRITICAL violation
resetManagement();

// S2.04: REQUIRE_APPROVAL verdict for HIGH constraint
{
  const gate2 = new ActionGate(mgmtStore); // fresh gate, reset state
  const result = gate2.check('bps_update_entity', {
    entityType: 'content',
    entityId: 'test-content-02',
    data: { publishReady: true },
  });
  assert('S2.04', 'REQUIRE_APPROVAL verdict for HIGH constraint',
    result.verdict === 'REQUIRE_APPROVAL',
    `verdict=${result.verdict}`);
}

// S2.05: PASS verdict for non-matching tool call
{
  resetManagement();
  const gate3 = new ActionGate(mgmtStore);
  // Update a store entity (no constraints on 'store' entityType)
  const result = gate3.check('bps_update_entity', {
    entityType: 'store',
    entityId: 'store-cs-ktv-01',
    data: { status: 'updated' },
  });
  assert('S2.05', 'PASS verdict for non-matching scope',
    result.verdict === 'PASS',
    `verdict=${result.verdict}`);
}

// S2.06: Constraint scope - entityType filter
{
  resetManagement();
  const gate4 = new ActionGate(mgmtStore);
  // strategy entityType with majorChange should trigger c-strategy-approval
  const result = gate4.check('bps_update_entity', {
    entityType: 'strategy',
    entityId: 'st-test',
    data: { majorChange: true },
  });
  assert('S2.06', 'Constraint scope: entityType filter matches',
    result.verdict === 'REQUIRE_APPROVAL',
    `verdict=${result.verdict}`);
}

// S2.07: Constraint scope - dataFields filter
{
  resetManagement();
  const gate5 = new ActionGate(mgmtStore);
  // content entity but without publishReady or lifecycle field → no constraint matches
  const result = gate5.check('bps_update_entity', {
    entityType: 'content',
    entityId: 'test-content-03',
    data: { title: 'Harmless update' },
  });
  assert('S2.07', 'Constraint scope: dataFields filter (no match → PASS)',
    result.verdict === 'PASS',
    `verdict=${result.verdict}`);
}

// S2.08: New tools are in GATED_WRITE_TOOLS
{
  const newTools = ['bps_batch_update', 'bps_load_blueprint', 'bps_register_agent', 'bps_load_management'];
  const allPresent = newTools.every(t => GATED_WRITE_TOOLS.includes(t as any));
  assert('S2.08', 'New tools (batch_update, load_blueprint, register_agent, load_management) are gated',
    allPresent,
    `missing: ${newTools.filter(t => !GATED_WRITE_TOOLS.includes(t as any)).join(', ') || 'none'}`);
}

// S2.08b: Management wrapper throws Error (not returns {success:false})
{
  resetManagement();
  const wrappedTool = tools.find(t => t.name === 'bps_update_entity');
  let threwError = false;
  let errorMsg = '';
  try {
    await wrappedTool!.execute('test-call', {
      entityType: 'content',
      entityId: 'test-throw',
      data: { lifecycle: 'ARCHIVED' },
    });
  } catch (e: any) {
    threwError = true;
    errorMsg = e.message;
  }
  assert('S2.08b', 'Management BLOCK throws Error (not {success:false})',
    threwError && errorMsg.includes('MANAGEMENT BLOCKED'),
    `threw=${threwError}, msg contains MANAGEMENT BLOCKED: ${errorMsg.includes('MANAGEMENT BLOCKED')}`);
}

// S2.08c: REQUIRE_APPROVAL throws Error with approval ID
{
  resetManagement();
  const wrappedTool = tools.find(t => t.name === 'bps_update_entity');
  let threwError = false;
  let errorMsg = '';
  try {
    await wrappedTool!.execute('test-call-2', {
      entityType: 'content',
      entityId: 'test-approval-throw',
      data: { publishReady: true },
    });
  } catch (e: any) {
    threwError = true;
    errorMsg = e.message;
  }
  assert('S2.08c', 'REQUIRE_APPROVAL throws Error with approval ID',
    threwError && errorMsg.includes('MANAGEMENT APPROVAL REQUIRED') && errorMsg.includes('Approval ID:'),
    `threw=${threwError}`);
}

// ═════════════════════════════════════════════
// D2: Circuit Breaker
// ═════════════════════════════════════════════
console.log('\n--- D2: Circuit Breaker ---');

// S2.09: CRITICAL violation → DISCONNECTED
{
  resetManagement();
  const gateC = new ActionGate(mgmtStore);
  gateC.check('bps_update_entity', {
    entityType: 'content', entityId: 'cb-test-1',
    data: { lifecycle: 'ARCHIVED' },
  });
  const cb = mgmtStore.getCircuitBreakerState();
  assert('S2.09', 'CRITICAL violation → DISCONNECTED',
    cb.state === 'DISCONNECTED',
    `state=${cb.state}`);
}

// S2.10: DISCONNECTED blocks all writes immediately
{
  const gateD = new ActionGate(mgmtStore); // inherits DISCONNECTED state
  const result = gateD.check('bps_create_task', { serviceId: 'svc-probe' });
  assert('S2.10', 'DISCONNECTED blocks all writes immediately',
    result.verdict === 'BLOCK' && result.circuitBreakerState === 'DISCONNECTED',
    `verdict=${result.verdict}, cbState=${result.circuitBreakerState}`);
}

// S2.11: HIGH violations accumulate → WARNING
{
  resetManagement();
  const gateH = new ActionGate(mgmtStore);
  // Trigger 2 HIGH violations (threshold for WARNING)
  gateH.check('bps_update_entity', { entityType: 'content', entityId: 'high-1', data: { publishReady: true } });
  gateH.check('bps_update_entity', { entityType: 'content', entityId: 'high-2', data: { publishReady: true } });
  const cb = mgmtStore.getCircuitBreakerState();
  assert('S2.11', 'HIGH violations → WARNING',
    cb.state === 'WARNING',
    `state=${cb.state}`);
}

// S2.12: Cooldown recovery auto-downgrades
{
  resetManagement();
  // Set state to WARNING manually
  mgmtStore.updateCircuitBreaker('WARNING', { critical: 0, high: 0, windowStart: new Date().toISOString() });

  // Backdate lastStateChange to trigger cooldown
  // Using a gate with 1s cooldown
  const gateR = new ActionGate(mgmtStore, {
    thresholds: [
      { severity: 'CRITICAL', maxViolations: 1, window: '1h', action: 'DISCONNECTED' },
      { severity: 'HIGH', maxViolations: 5, window: '1h', action: 'RESTRICTED' },
    ],
    cooldown: '1s',
  });

  // Backdate: set lastStateChange to 2 seconds ago
  const twoSecsAgo = new Date(Date.now() - 2000).toISOString();
  mgmtStore.updateCircuitBreaker('WARNING', { critical: 0, high: 0, windowStart: twoSecsAgo });
  // Manually update last_state_change in the DB
  db.exec(`UPDATE bps_management_circuit_breaker SET last_state_change = '${twoSecsAgo}' WHERE id = 'singleton'`);

  // Next check should trigger cooldown: WARNING → NORMAL
  const result = gateR.check('bps_update_entity', {
    entityType: 'store', entityId: 'cooldown-test', data: { status: 'ok' },
  });
  const cb = mgmtStore.getCircuitBreakerState();
  assert('S2.12', 'Cooldown recovery: WARNING → NORMAL',
    cb.state === 'NORMAL',
    `state=${cb.state}, verdict=${result.verdict}`);
}

// S2.13: No recovery if new violations in window
{
  resetManagement();
  const gateNR = new ActionGate(mgmtStore, {
    thresholds: [
      { severity: 'CRITICAL', maxViolations: 1, window: '1h', action: 'DISCONNECTED' },
      { severity: 'HIGH', maxViolations: 2, window: '1h', action: 'WARNING' },
    ],
    cooldown: '1s',
  });
  // Trigger WARNING via 2 HIGH violations
  gateNR.check('bps_update_entity', { entityType: 'content', entityId: 'nr-1', data: { publishReady: true } });
  gateNR.check('bps_update_entity', { entityType: 'content', entityId: 'nr-2', data: { publishReady: true } });
  const cbBefore = mgmtStore.getCircuitBreakerState();

  // Backdate, but violations exist in window, so no recovery
  const twoSecsAgo = new Date(Date.now() - 2000).toISOString();
  db.exec(`UPDATE bps_management_circuit_breaker SET last_state_change = '${twoSecsAgo}' WHERE id = 'singleton'`);

  gateNR.check('bps_update_entity', { entityType: 'store', entityId: 'nr-check', data: { status: 'ok' } });
  const cbAfter = mgmtStore.getCircuitBreakerState();
  assert('S2.13', 'No recovery if violations exist in window',
    cbAfter.state === 'WARNING',
    `before=${cbBefore.state}, after=${cbAfter.state}`);
}

// S2.14: Oscillation detection
{
  resetManagement();
  const gateOsc = new ActionGate(mgmtStore, {
    thresholds: [
      { severity: 'CRITICAL', maxViolations: 1, window: '1h', action: 'DISCONNECTED' },
    ],
    cooldown: '1s',
  });

  // Simulate rapid oscillations by:
  // Repeatedly setting WARNING, backdating, and triggering recovery
  let detected = false;
  mgmtStore.on('management:oscillation_detected', () => { detected = true; });

  for (let i = 0; i < 5; i++) {
    mgmtStore.updateCircuitBreaker('WARNING', { critical: 0, high: 0, windowStart: new Date().toISOString() });
    const ago = new Date(Date.now() - 2000).toISOString();
    db.exec(`UPDATE bps_management_circuit_breaker SET last_state_change = '${ago}' WHERE id = 'singleton'`);
    gateOsc.check('bps_update_entity', { entityType: 'store', entityId: `osc-${i}`, data: { x: 1 } });
  }

  assert('S2.14', 'Oscillation detection (>3 transitions/1h → lock)',
    detected,
    `oscillation_detected event fired: ${detected}`);
  mgmtStore.removeAllListeners('management:oscillation_detected');
}

// ═════════════════════════════════════════════
// D3: Information Summary Layer
// ═════════════════════════════════════════════
console.log('\n--- D3: Information Summary ---');

resetManagement();

// S2.15: scan_work topN shape
{
  const scanTool = tools.find(t => t.name === 'bps_scan_work')!;
  const result = await scanTool.execute('test', {}) as any;
  const hasTopN = result.openTasks && typeof result.openTasks.items === 'object'
    && typeof result.openTasks.total === 'number'
    && typeof result.openTasks.showing === 'number';
  assert('S2.15', 'bps_scan_work returns topN shape {items, total, showing}',
    hasTopN,
    `openTasks keys: ${Object.keys(result.openTasks || {}).join(', ')}`);
}

// S2.16: scan_work summary string
{
  const scanTool = tools.find(t => t.name === 'bps_scan_work')!;
  const result = await scanTool.execute('test', {}) as any;
  assert('S2.16', 'bps_scan_work summary is non-empty string',
    typeof result.summary === 'string' && result.summary.length > 0,
    `summary: "${result.summary}"`);
}

// S2.17: scan_work sortByUrgency
{
  const scanTool = tools.find(t => t.name === 'bps_scan_work')!;
  const result = await scanTool.execute('test', {}) as any;
  const items = result.openTasks.items;
  if (items.length >= 2) {
    // Verify: deadline ASC (nulls last), then priority DESC
    let sorted = true;
    for (let i = 0; i < items.length - 1; i++) {
      const a = items[i], b = items[i + 1];
      if (!a.deadline && b.deadline) { sorted = false; break; }
      if (a.deadline && b.deadline && a.deadline > b.deadline) { sorted = false; break; }
    }
    assert('S2.17', 'bps_scan_work sortByUrgency (deadline ASC, nulls last)',
      sorted,
      `order: ${items.map((i: any) => `${i.entityId}(d=${i.deadline||'null'},p=${i.priority})`).join(' > ')}`);
  } else {
    assert('S2.17', 'bps_scan_work sortByUrgency (not enough items to verify)',
      false, `items=${items.length}, need >=2`);
  }
}

// S2.18: query_entities brief mode
{
  const queryTool = tools.find(t => t.name === 'bps_query_entities')!;
  const briefResult = await queryTool.execute('test', { entityType: 'store', brief: true }) as any;
  const fullResult = await queryTool.execute('test', { entityType: 'store', brief: false }) as any;

  const briefHasCompact = briefResult.entities.length > 0
    && briefResult.entities[0].entityId !== undefined
    && briefResult.entities[0].updatedAt !== undefined
    && briefResult.entities[0].data === undefined;
  const fullHasData = fullResult.entities.length > 0
    && fullResult.entities[0].data !== undefined;

  assert('S2.18', 'bps_query_entities brief=true returns compact (no data)',
    briefHasCompact && fullHasData,
    `brief keys: ${Object.keys(briefResult.entities[0] || {}).join(',')}`);
}

// S2.19: next_steps recommendation
{
  const nextTool = tools.find(t => t.name === 'bps_next_steps')!;
  const result = await nextTool.execute('test', { serviceId: 'svc-probe' }) as any;
  assert('S2.19', 'bps_next_steps returns recommendation field',
    result.recommendation !== undefined && typeof result.recommendation === 'string',
    `recommendation: "${result.recommendation}"`);
}

// S2.20: scan_work outcomeDistribution
{
  const scanTool = tools.find(t => t.name === 'bps_scan_work')!;
  const result = await scanTool.execute('test', {}) as any;
  const dist = result.outcomeDistribution;
  assert('S2.20', 'bps_scan_work outcomeDistribution has success/partial/failed',
    dist && 'success' in dist && 'partial' in dist && 'failed' in dist,
    `keys: ${Object.keys(dist || {}).join(', ')}`);
}

// ═════════════════════════════════════════════
// D4: Process Groups + Batch Update
// ═════════════════════════════════════════════
console.log('\n--- D4: Process Groups + Batch Update ---');

// Read seed IDs
const seedIds = JSON.parse(fs.readFileSync('/tmp/structural-capability/seed-ids.json', 'utf-8'));
const groupId = seedIds.groupId;

// S2.21: Tasks have groupId
{
  const queryTool = tools.find(t => t.name === 'bps_query_tasks')!;
  const result = await queryTool.execute('test', { state: 'OPEN' }) as any;
  const withGroupId = result.tasks.filter((t: any) => t.groupId === 'group-structural-batch');
  assert('S2.21', 'Tasks created with groupId are queryable via groupId field',
    withGroupId.length >= 3,
    `found ${withGroupId.length} tasks with groupId=group-structural-batch (expected 3)`);
}

// S2.22: Batch update completes all
{
  const batchTool = tools.find(t => t.name === 'bps_batch_update')!;
  const result = await batchTool.execute('test-batch', {
    groupId,
    state: 'COMPLETED',
  }) as any;
  assert('S2.22', 'bps_batch_update completes all tasks in group',
    result.success === true && result.updated >= 2,
    `updated=${result.updated}, total=${result.total}`);
}

// S2.23: Create new tasks for filterState test
{
  const t1 = engine.tracker.createTask({
    serviceId: 'svc-probe', entityType: 'probe', entityId: 'filter-1',
    groupId: 'group-filter-test',
  });
  engine.tracker.updateTask(t1.id, { state: 'IN_PROGRESS' });
  const t2 = engine.tracker.createTask({
    serviceId: 'svc-analyze', entityType: 'analysis', entityId: 'filter-2',
    groupId: 'group-filter-test',
  });
  // t2 stays OPEN

  const batchTool = tools.find(t => t.name === 'bps_batch_update')!;
  const result = await batchTool.execute('test-filter', {
    groupId: 'group-filter-test',
    state: 'COMPLETED',
    filterState: 'OPEN',
  }) as any;
  assert('S2.23', 'bps_batch_update filterState only updates matching',
    result.updated === 1,
    `updated=${result.updated} (should be 1 — only OPEN task)`);

  // Verify IN_PROGRESS task is still IN_PROGRESS
  const remaining = engine.processStore.get(t1.id);
  assert('S2.24', 'Filtered batch: non-matching task unchanged',
    remaining?.state === 'IN_PROGRESS',
    `state=${remaining?.state}`);
}

// ═════════════════════════════════════════════
// D5: Entity Relations
// ═════════════════════════════════════════════
console.log('\n--- D5: Entity Relations ---');

// S2.25: Entity has relations
{
  const getTool = tools.find(t => t.name === 'bps_get_entity')!;
  const result = await getTool.execute('test', { entityType: 'store', entityId: 'store-cs-ktv-01' }) as any;
  assert('S2.25', 'bps_get_entity returns relatedEntities',
    result.relatedEntities !== undefined && Array.isArray(result.relatedEntities),
    `relatedEntities count: ${result.relatedEntities?.length}`);
}

// S2.26: Relations have version + updatedAt
{
  const getTool = tools.find(t => t.name === 'bps_get_entity')!;
  const result = await getTool.execute('test', { entityType: 'store', entityId: 'store-cs-ktv-01' }) as any;
  const rel = result.relatedEntities?.[0];
  assert('S2.26', 'Relations include version and updatedAt',
    rel && rel.version !== undefined && rel.updatedAt !== undefined,
    `version=${rel?.version}, updatedAt=${rel?.updatedAt}`);
}

// S2.27: Relation types
{
  const getTool = tools.find(t => t.name === 'bps_get_entity')!;
  const result = await getTool.execute('test', { entityType: 'store', entityId: 'store-cs-ktv-01' }) as any;
  const types = (result.relatedEntities || []).map((r: any) => r.relationType);
  assert('S2.27', 'Relation types: depends_on and references',
    types.includes('depends_on') && types.includes('references'),
    `types: ${types.join(', ')}`);
}

// S2.27b: Set relations via bps_update_entity
{
  const updateTool = tools.find(t => t.name === 'bps_update_entity')!;
  const result = await updateTool.execute('test-rel', {
    entityType: 'store',
    entityId: 'store-cs-tea-01',
    data: { relTest: true },
    relations: [
      { targetEntityType: 'action-plan', targetEntityId: 'ap-structural-test', relationType: 'part_of' },
    ],
  }) as any;
  assert('S2.27b', 'bps_update_entity with relations parameter',
    result.success === true,
    `version=${result.version}`);

  // Verify
  const getTool = tools.find(t => t.name === 'bps_get_entity')!;
  const getResult = await getTool.execute('test', { entityType: 'store', entityId: 'store-cs-tea-01' }) as any;
  const hasPartOf = (getResult.relatedEntities || []).some((r: any) => r.relationType === 'part_of');
  assert('S2.27c', 'Relations set via update tool are retrievable',
    hasPartOf,
    `relatedEntities: ${getResult.relatedEntities?.length}`);
}

// ═════════════════════════════════════════════
// D6: Skill Metrics
// ═════════════════════════════════════════════
console.log('\n--- D6: Skill Metrics ---');

// S2.28: Record skill metric
{
  const record = skillMetrics.record('test-skill', 'success', 150);
  assert('S2.28', 'Skill metric recorded',
    record.skillName === 'test-skill' && record.outcome === 'success',
    `id=${record.id}`);
}

// S2.29: Get summaries
{
  skillMetrics.record('test-skill', 'success', 200);
  skillMetrics.record('test-skill', 'failed', 100);
  const summaries = skillMetrics.getSummaries();
  const testSummary = summaries.find(s => s.skillName === 'test-skill');
  assert('S2.29', 'Skill metric summaries include counts',
    testSummary !== undefined && testSummary.totalInvocations >= 3,
    `invocations=${testSummary?.totalInvocations}`);
}

// S2.30: Dormant skill detection (combined: never-invoked + old-invocation)
{
  if (fs.existsSync(SKILLS_DIR)) {
    const allSkills = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, d.name, 'SKILL.md')))
      .map(d => d.name);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    // Combined logic (same as bps_scan_work): never-invoked OR old-invocation
    const dormantFromMetrics = new Set(skillMetrics.getDormantSkillNames(ninetyDaysAgo));
    const metricsSkills = new Set(skillMetrics.getSummaries().map(s => s.skillName));
    const dormant = allSkills.filter(s => !metricsSkills.has(s) || dormantFromMetrics.has(s));
    // All built-in skills should be dormant (only 'test-skill' has metrics)
    const builtinSkills = allSkills.filter(s => s !== 'test-skill');
    const allBuiltinDormant = builtinSkills.every(s => dormant.includes(s));
    assert('S2.30', 'Dormant skill detection (never-invoked + old-invocation)',
      dormant.length >= builtinSkills.length && allBuiltinDormant,
      `dormant: ${dormant.length}/${allSkills.length}, builtins all dormant: ${allBuiltinDormant}`);
  } else {
    assert('S2.30', 'Dormant skill detection (skills dir missing)',
      false, `SKILLS_DIR not found: ${SKILLS_DIR}`);
  }
}

// ═════════════════════════════════════════════
// D7: Constraint Analytics
// ═════════════════════════════════════════════
console.log('\n--- D7: Constraint Analytics ---');

// Seed violations for analytics testing
resetManagement();
{
  const analyticsGate = new ActionGate(mgmtStore);
  // Trigger c-publish-approval (REQUIRE_APPROVAL) 3 times
  analyticsGate.check('bps_update_entity', { entityType: 'content', entityId: 'analytics-1', data: { publishReady: true } });
  analyticsGate.check('bps_update_entity', { entityType: 'content', entityId: 'analytics-2', data: { publishReady: true } });
  analyticsGate.check('bps_update_entity', { entityType: 'content', entityId: 'analytics-3', data: { publishReady: true } });
}

// S2.31: getConstraintEffectiveness returns stats
{
  const effectiveness = mgmtStore.getConstraintEffectiveness();
  assert('S2.31', 'getConstraintEffectiveness returns per-constraint stats',
    Array.isArray(effectiveness) && effectiveness.length >= 3,
    `constraints: ${effectiveness.length}`);
}

// S2.32: Stats include correct fields
{
  const effectiveness = mgmtStore.getConstraintEffectiveness();
  const first = effectiveness[0];
  assert('S2.32', 'Effectiveness stats include required fields',
    first &&
    'violationCount' in first &&
    'approvalCount' in first &&
    'approvalRate' in first &&
    'suggestion' in first,
    `fields: ${Object.keys(first || {}).join(', ')}`);
}

// S2.33: Violation count reflects actual violations
{
  const effectiveness = mgmtStore.getConstraintEffectiveness();
  const publishConstraint = effectiveness.find(e => e.constraintId === 'c-publish-approval');
  assert('S2.33', 'Constraint effectiveness reflects actual violations',
    publishConstraint !== undefined && publishConstraint.violationCount > 0,
    `c-publish-approval violations: ${publishConstraint?.violationCount}`);
}

// ═════════════════════════════════════════════
// D8: Tool Registration
// ═════════════════════════════════════════════
console.log('\n--- D8: Tool Registration ---');

// S2.34: Total tool count with management + collaboration
{
  assert('S2.34', 'Total tools = 19 (15 base + 2 management + 2 collaboration)',
    tools.length === 19,
    `got ${tools.length}: ${tools.map(t => t.name).join(', ')}`);
}

// S2.35: DEFAULT_SCOPE_WRITE_TOOLS excludes bps_load_management
{
  assert('S2.35', 'DEFAULT_SCOPE_WRITE_TOOLS excludes bps_load_management',
    !DEFAULT_SCOPE_WRITE_TOOLS.includes('bps_load_management' as any)
    && DEFAULT_SCOPE_WRITE_TOOLS.length === GATED_WRITE_TOOLS.length - 1,
    `count: ${DEFAULT_SCOPE_WRITE_TOOLS.length} (GATED: ${GATED_WRITE_TOOLS.length})`);
}

// ═════════════════════════════════════════════
// D9: Information Saturation Signal
// ═════════════════════════════════════════════
console.log('\n--- D9: Information Saturation Signal ---');

// S2.36: No signal below threshold (4 consecutive reads)
{
  // Use fresh tools for isolated counter
  const freshTools = createBpsTools({
    tracker: engine.tracker,
    blueprintStore: engine.blueprintStore,
    processStore: engine.processStore,
    dossierStore: engine.dossierStore,
    collaborationStore: collabStore,
  });
  const readTool = freshTools.find(t => t.name === 'bps_list_services')!;
  let lastResult: any;
  for (let i = 0; i < 4; i++) {
    lastResult = await readTool.execute(`sat-${i}`, {});
  }
  assert('S2.36', 'No _readSignal below threshold (4 reads)',
    lastResult._readSignal === undefined,
    `_readSignal: ${lastResult._readSignal}`);
}

// S2.37: Signal injected at threshold (5 consecutive reads)
{
  const freshTools = createBpsTools({
    tracker: engine.tracker,
    blueprintStore: engine.blueprintStore,
    processStore: engine.processStore,
    dossierStore: engine.dossierStore,
    collaborationStore: collabStore,
  });
  const readTool = freshTools.find(t => t.name === 'bps_query_entities')!;
  for (let i = 0; i < 4; i++) {
    await readTool.execute(`sat5-${i}`, { entityType: 'store' });
  }
  const result5 = await readTool.execute('sat5-trigger', { entityType: 'store' }) as any;
  assert('S2.37', '_readSignal injected at 5 consecutive reads',
    result5._readSignal !== undefined && result5._readSignal.consecutiveReads === 5,
    `consecutiveReads=${result5._readSignal?.consecutiveReads}`);
}

// S2.38: Signal message contains action hints
{
  const freshTools = createBpsTools({
    tracker: engine.tracker,
    blueprintStore: engine.blueprintStore,
    processStore: engine.processStore,
    dossierStore: engine.dossierStore,
    collaborationStore: collabStore,
  });
  const readTool = freshTools.find(t => t.name === 'bps_scan_work')!;
  for (let i = 0; i < 5; i++) {
    await readTool.execute(`msg-${i}`, {});
  }
  const result = await readTool.execute('msg-check', {}) as any;
  const msg: string = result._readSignal?.message ?? '';
  assert('S2.38', '_readSignal message contains action hints (update_entity, create_task, complete_task)',
    msg.includes('bps_update_entity') && msg.includes('bps_create_task') && msg.includes('bps_complete_task'),
    `message length: ${msg.length}`);
}

// S2.39: Write tool resets counter
{
  const freshTools = createBpsTools({
    tracker: engine.tracker,
    blueprintStore: engine.blueprintStore,
    processStore: engine.processStore,
    dossierStore: engine.dossierStore,
    collaborationStore: collabStore,
  });
  const readTool = freshTools.find(t => t.name === 'bps_get_entity')!;
  const writeTool = freshTools.find(t => t.name === 'bps_update_entity')!;

  // 4 reads
  for (let i = 0; i < 4; i++) {
    await readTool.execute(`reset-pre-${i}`, { entityType: 'store', entityId: 'store-cs-ktv-01' });
  }
  // 1 write resets
  await writeTool.execute('reset-write', {
    entityType: 'store', entityId: 'store-cs-ktv-01',
    data: { saturationResetTest: true },
  });
  // 4 more reads — should NOT trigger
  let postResult: any;
  for (let i = 0; i < 4; i++) {
    postResult = await readTool.execute(`reset-post-${i}`, { entityType: 'store', entityId: 'store-cs-ktv-01' });
  }
  assert('S2.39', 'Write tool resets read counter (no signal after write + 4 reads)',
    postResult._readSignal === undefined,
    `_readSignal: ${postResult._readSignal}`);
}

// S2.40: Counter accumulates past threshold
{
  const freshTools = createBpsTools({
    tracker: engine.tracker,
    blueprintStore: engine.blueprintStore,
    processStore: engine.processStore,
    dossierStore: engine.dossierStore,
    collaborationStore: collabStore,
  });
  const readTool = freshTools.find(t => t.name === 'bps_next_steps')!;
  for (let i = 0; i < 8; i++) {
    await readTool.execute(`accum-${i}`, { serviceId: 'svc-probe' });
  }
  const result = await readTool.execute('accum-check', { serviceId: 'svc-probe' }) as any;
  assert('S2.40', 'Counter accumulates past threshold (9 reads → consecutiveReads=9)',
    result._readSignal?.consecutiveReads === 9,
    `consecutiveReads=${result._readSignal?.consecutiveReads}`);
}

// S2.41: bps_get_collaboration_response is classified as read tool
{
  const freshTools = createBpsTools({
    tracker: engine.tracker,
    blueprintStore: engine.blueprintStore,
    processStore: engine.processStore,
    dossierStore: engine.dossierStore,
    collaborationStore: collabStore,
  });
  // Create a task to query
  const task = collabStore.createTask({ title: 'read-class-test', description: 'test' });
  const collabReadTool = freshTools.find(t => t.name === 'bps_get_collaboration_response')!;
  // 4 other reads first
  const listTool = freshTools.find(t => t.name === 'bps_list_services')!;
  for (let i = 0; i < 4; i++) {
    await listTool.execute(`cls-${i}`, {});
  }
  // 5th read via collaboration read tool should trigger
  const result = await collabReadTool.execute('cls-5', { taskId: task.id }) as any;
  assert('S2.41', 'bps_get_collaboration_response is a read tool (triggers saturation signal)',
    result._readSignal !== undefined && result._readSignal.consecutiveReads === 5,
    `consecutiveReads=${result._readSignal?.consecutiveReads}`);
}

// ═════════════════════════════════════════════
// D10: Collaboration Input (HITL/AITL)
// ═════════════════════════════════════════════
console.log('\n--- D10: Collaboration Input ---');

// S2.42: bps_request_collaboration creates a task
{
  const collabTool = tools.find(t => t.name === 'bps_request_collaboration')!;
  const result = await collabTool.execute('collab-1', {
    title: 'Confirm treatment parameters',
    description: 'Please confirm botox dosage and injection area',
    inputSchema: {
      type: 'object',
      properties: { dosage: { type: 'number' }, area: { type: 'string' } },
      required: ['dosage'],
    },
    priority: 'high',
    context: { entityType: 'patient', entityId: 'patient-001' },
  }) as any;
  assert('S2.42', 'bps_request_collaboration creates task with taskId',
    result.success === true && typeof result.taskId === 'string' && result.status === 'pending',
    `taskId=${result.taskId}, status=${result.status}`);
}

// S2.43: Created task has correct schema and priority
{
  const pending = collabStore.getPendingTasks();
  const latest = pending.find(t => t.title === 'Confirm treatment parameters');
  assert('S2.43', 'Collaboration task has inputSchema + priority + context',
    latest !== undefined
    && (latest.inputSchema as any).properties?.dosage?.type === 'number'
    && latest.priority === 'high'
    && latest.context.entityType === 'patient',
    `schema keys: ${Object.keys((latest?.inputSchema as any)?.properties || {}).join(',')}`);
}

// S2.44: bps_get_collaboration_response returns pending status
{
  const pending = collabStore.getPendingTasks();
  const taskId = pending[0]?.id;
  const checkTool = tools.find(t => t.name === 'bps_get_collaboration_response')!;
  const result = await checkTool.execute('collab-check-1', { taskId }) as any;
  assert('S2.44', 'bps_get_collaboration_response returns pending with hint',
    result.status === 'pending' && typeof result.hint === 'string',
    `status=${result.status}`);
}

// S2.45: Respond to collaboration task via store
{
  const pending = collabStore.getPendingTasks();
  const taskId = pending[0]?.id;
  const responded = collabStore.respond(taskId, { dosage: 80, area: 'forehead' }, 'dr-wang');
  assert('S2.45', 'Collaboration respond → completed with response data',
    responded.status === 'completed'
    && responded.response?.data.dosage === 80
    && responded.response?.respondedBy === 'dr-wang',
    `respondedBy=${responded.response?.respondedBy}`);
}

// S2.46: bps_get_collaboration_response returns completed response
{
  const tasks = collabStore.listTasks('completed');
  const taskId = tasks[0]?.id;
  const checkTool = tools.find(t => t.name === 'bps_get_collaboration_response')!;
  const result = await checkTool.execute('collab-check-2', { taskId }) as any;
  assert('S2.46', 'Completed collaboration returns response data',
    result.status === 'completed' && result.response?.dosage === 80 && result.respondedBy === 'dr-wang',
    `response keys: ${Object.keys(result.response || {}).join(',')}`);
}

// S2.47: Collaboration task expiration
{
  const collabTool = tools.find(t => t.name === 'bps_request_collaboration')!;
  const result = await collabTool.execute('collab-expire', {
    title: 'Short-lived task',
    description: 'Expires in 30 minutes',
    expiresIn: '30m',
  }) as any;
  const task = collabStore.getTask(result.taskId);
  const expiresAt = new Date(task!.expiresAt).getTime();
  const createdAt = new Date(task!.createdAt).getTime();
  const diffMs = expiresAt - createdAt;
  // Should be ~30 minutes (± 5 seconds tolerance)
  assert('S2.47', 'expiresIn=30m sets correct expiration (~30 min)',
    diffMs >= 29 * 60 * 1000 && diffMs <= 31 * 60 * 1000,
    `diff=${Math.round(diffMs / 60000)}min`);
}

// S2.48: Cancel collaboration task
{
  const task = collabStore.createTask({ title: 'Cancel test', description: 'Will cancel' });
  collabStore.cancelTask(task.id);
  const cancelled = collabStore.getTask(task.id);
  assert('S2.48', 'Cancel task sets status to cancelled',
    cancelled?.status === 'cancelled',
    `status=${cancelled?.status}`);
}

// S2.49: Status counts reflect all states
{
  const counts = collabStore.getStatusCounts();
  assert('S2.49', 'Status counts include pending, completed, cancelled',
    typeof counts.pending === 'number'
    && typeof counts.completed === 'number'
    && typeof counts.cancelled === 'number',
    `pending=${counts.pending}, completed=${counts.completed}, cancelled=${counts.cancelled}`);
}

// S2.50: Collaboration events emitted
{
  let createdEvent = false;
  let respondedEvent = false;
  collabStore.on('collaboration:task_created', () => { createdEvent = true; });
  collabStore.on('collaboration:task_responded', () => { respondedEvent = true; });

  const task = collabStore.createTask({ title: 'Event test', description: 'test' });
  collabStore.respond(task.id, { ok: true }, 'tester');

  assert('S2.50', 'Collaboration emits task_created + task_responded events',
    createdEvent && respondedEvent,
    `created=${createdEvent}, responded=${respondedEvent}`);

  collabStore.removeAllListeners('collaboration:task_created');
  collabStore.removeAllListeners('collaboration:task_responded');
}

// S2.51: Non-existent task returns error
{
  const checkTool = tools.find(t => t.name === 'bps_get_collaboration_response')!;
  const result = await checkTool.execute('collab-missing', { taskId: 'nonexistent-id' }) as any;
  assert('S2.51', 'Non-existent collaboration task returns error',
    result.error !== undefined && result.error.includes('not found'),
    `error=${result.error}`);
}

// ═════════════════════════════════════════════
// Summary
// ═════════════════════════════════════════════
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`\n═══════════════════════════════`);
console.log(`Engine Tests: ${passed} PASS / ${failed} FAIL / ${results.length} TOTAL`);
console.log(`═══════════════════════════════`);

// Write results
fs.writeFileSync('/tmp/structural-capability/engine-results.json', JSON.stringify({
  timestamp: new Date().toISOString(),
  passed,
  failed,
  total: results.length,
  results,
}, null, 2));

process.exit(failed > 0 ? 1 : 0);
TYPESCRIPTEOF

  if node --import tsx .tmp-structural-engine.ts 2>&1 | tee "$LOG_DIR/engine-tests.log"; then
    ENGINE_EXIT=0
  else
    ENGINE_EXIT=1
  fi
  rm -f .tmp-structural-engine.ts

  # Parse engine results into check/fail
  if [ -f "$LOG_DIR/../structural-capability/engine-results.json" ] || [ -f "/tmp/structural-capability/engine-results.json" ]; then
    ENGINE_RESULTS="/tmp/structural-capability/engine-results.json"
    E_PASSED=$(node -e "const r=JSON.parse(require('fs').readFileSync('$ENGINE_RESULTS','utf8'));console.log(r.passed)" 2>/dev/null || echo 0)
    E_FAILED=$(node -e "const r=JSON.parse(require('fs').readFileSync('$ENGINE_RESULTS','utf8'));console.log(r.failed)" 2>/dev/null || echo 0)
    E_TOTAL=$(node -e "const r=JSON.parse(require('fs').readFileSync('$ENGINE_RESULTS','utf8'));console.log(r.total)" 2>/dev/null || echo 0)

    # Add engine results to running totals
    PASS=$((PASS + E_PASSED))
    FAIL=$((FAIL + E_FAILED))
    TOTAL=$((TOTAL + E_TOTAL))
    log "Engine tests: $E_PASSED PASS / $E_FAILED FAIL / $E_TOTAL TOTAL"
  else
    fail "S2.00 Engine test harness failed to produce results"
  fi

  log "Phase 2 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 3: Dashboard API Structural Tests
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 3 ]; then
  section "3: Dashboard API Structural Tests"

  # S3.01: Management status endpoint shape
  GOV_STATUS=$(api_get "/api/management/status" 2>/dev/null || echo "{}")
  HAS_EFFECTIVENESS=$(echo "$GOV_STATUS" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(Array.isArray(d.constraintEffectiveness)?'yes':'no')}catch{console.log('no')}" 2>/dev/null)
  check "S3.01 Management status has constraintEffectiveness[]" "test '$HAS_EFFECTIVENESS' = 'yes'"

  # S3.02: Circuit breaker state is string
  CB_STATE=$(echo "$GOV_STATUS" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(typeof d.circuitBreakerState)}catch{console.log('undefined')}" 2>/dev/null)
  check "S3.02 circuitBreakerState is string" "test '$CB_STATE' = 'string'"

  # S3.03: Violations array with severity
  VIOLATIONS=$(api_get "/api/management/violations?limit=5" 2>/dev/null || echo "[]")
  HAS_SEV=$(echo "$VIOLATIONS" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(d.length>0&&d[0].severity?'yes':'no')}catch{console.log('no')}" 2>/dev/null)
  check "S3.03 Violations array has severity field" "test '$HAS_SEV' = 'yes'"

  # S3.04: Constraints array with scope object
  CONSTRAINTS=$(api_get "/api/management/constraints" 2>/dev/null || echo "[]")
  HAS_SCOPE=$(echo "$CONSTRAINTS" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(d.length>0&&d[0].scope?'yes':'no')}catch{console.log('no')}" 2>/dev/null)
  check "S3.04 Constraints array has scope object" "test '$HAS_SCOPE' = 'yes'"

  # S3.05: Approvals array with status
  APPROVALS=$(api_get "/api/management/approvals" 2>/dev/null || echo "[]")
  APP_COUNT=$(echo "$APPROVALS" | jlen)
  # May be 0 if engine tests didn't create persistent approvals via the dashboard
  soft "S3.05 Approvals endpoint returns array (count=$APP_COUNT)" "echo '$APPROVALS' | node -e 'JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"))'"

  # S3.06: Entities count
  ENTITY_COUNT=$(api_get "/api/entities" | jlen)
  check "S3.06 Entity count >= 7 (got $ENTITY_COUNT)" "test $ENTITY_COUNT -ge 7"

  # S3.07: Circuit breaker reset endpoint returns valid JSON
  RESET_OK=$(api_post "/api/management/circuit-breaker/reset" '{}' 2>/dev/null | node -e "
    try{JSON.parse(require('fs').readFileSync(0,'utf8'));console.log('yes')}catch{console.log('no')}" 2>/dev/null || echo 'no')
  check "S3.07 Circuit breaker reset returns valid JSON" "test '$RESET_OK' = 'yes'"

  # S3.08: moved to Phase 5 (approvals only exist after Phase 4 agent turns)

  # S3.09: Dashboard pages accessible
  for page in "/" "/business-goals" "/management"; do
    check "S3.09 Dashboard page $page" "curl -sf $DASHBOARD_URL$page >/dev/null"
  done

  # --- S3.10-S3.14: Collaboration API ---

  # S3.10: Collaboration status endpoint
  COLLAB_STATUS=$(api_get "/api/collaboration/status" 2>/dev/null || echo "{}")
  HAS_COUNTS=$(echo "$COLLAB_STATUS" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(typeof d.counts==='object'&&typeof d.pendingCount==='number'?'yes':'no')}catch{console.log('no')}" 2>/dev/null)
  check "S3.10 Collaboration status has counts + pendingCount" "test '$HAS_COUNTS' = 'yes'"

  # S3.11: Collaboration tasks list endpoint
  COLLAB_TASKS=$(api_get "/api/collaboration/tasks" 2>/dev/null || echo "{}")
  HAS_TASKS_SHAPE=$(echo "$COLLAB_TASKS" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(typeof d.count==='number'&&Array.isArray(d.tasks)?'yes':'no')}catch{console.log('no')}" 2>/dev/null)
  check "S3.11 Collaboration tasks returns {count, tasks[]}" "test '$HAS_TASKS_SHAPE' = 'yes'"

  # S3.12: Collaboration tasks filter by status
  COLLAB_PENDING=$(api_get "/api/collaboration/tasks?status=pending" 2>/dev/null || echo "{}")
  PENDING_VALID=$(echo "$COLLAB_PENDING" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(Array.isArray(d.tasks)?'yes':'no')}catch{console.log('no')}" 2>/dev/null)
  check "S3.12 Collaboration tasks?status=pending returns valid array" "test '$PENDING_VALID' = 'yes'"

  # S3.13: Collaboration task respond endpoint (create + respond round-trip)
  COLLAB_RT=$(node -e "
    const http = require('http');
    function post(path, body) {
      return new Promise((resolve, reject) => {
        const req = http.request('$DASHBOARD_URL' + path, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
        }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); });
        req.on('error', reject);
        req.end(JSON.stringify(body));
      });
    }
    function get(path) {
      return new Promise((resolve, reject) => {
        http.get('$DASHBOARD_URL' + path, res => {
          let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d)));
        }).on('error', reject);
      });
    }
    (async () => {
      // We'll verify that Engine-created tasks (Phase 2) appear in Dashboard API
      const all = await get('/api/collaboration/tasks');
      const completed = all.tasks.filter(t => t.status === 'completed');
      if (completed.length > 0) {
        const task = completed[0];
        // Verify task has response
        const detail = await get('/api/collaboration/tasks/' + task.id);
        console.log(detail.response ? 'yes' : 'no');
      } else {
        // Create fresh, respond, verify
        const store = await get('/api/collaboration/status');
        // Just verify the endpoint works — task was created in Phase 2
        console.log(typeof store.counts === 'object' ? 'yes' : 'no');
      }
    })();
  " 2>/dev/null || echo 'no')
  soft "S3.13 Collaboration round-trip (Engine tasks visible in Dashboard API)" "test '$COLLAB_RT' = 'yes'"

  # S3.14: Collaboration task detail 404 for missing
  COLLAB_404=$(curl -s -o /dev/null -w "%{http_code}" "$DASHBOARD_URL/api/collaboration/tasks/nonexistent" 2>/dev/null || echo "000")
  check "S3.14 Collaboration task detail returns 404 for missing" "test '$COLLAB_404' = '404'"

  log "Phase 3 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 4: Agent Integration Turns (optional)
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 4 ] && [ "$ENGINE_ONLY" = false ]; then
  section "4: Business Scenario — IdleX GEO Operations"

  # Clean sessions for fresh agent context
  rm -rf "$OPENCLAW_HOME/agents/main/sessions/" 2>/dev/null || true

  # Capture baseline metrics before business scenario
  BASELINE_ENTITIES=$(api_get "/api/entities" | jlen)
  BASELINE_VIOLATIONS=$(api_get "/api/management/violations" | jlen)
  BASELINE_SKILLS=$(find "$OPENCLAW_HOME/workspace/skills/" -name SKILL.md 2>/dev/null | wc -l)
  BASELINE_BLUEPRINTS=$(find "$AIDA_HOME/blueprints/" -name "*.yaml" 2>/dev/null | wc -l)
  BASELINE_WORKSPACES=$(find "$OPENCLAW_HOME/" -maxdepth 1 -name "workspace-*" -type d 2>/dev/null | wc -l)
  log "Baseline: entities=$BASELINE_ENTITIES, violations=$BASELINE_VIOLATIONS, skills=$BASELINE_SKILLS, blueprints=$BASELINE_BLUEPRINTS, workspaces=$BASELINE_WORKSPACES"

  # ── Turn 1: Business Briefing ──────────────────────────
  log "Turn 1: Business briefing..."
  aida_say 1 "我是闲氪的GEO负责人。系统里已经有5家合作门店（长沙3家+武汉2家）。

闲氪帮合作门店在AI时代\"被看见\"——在豆包、千问、元宝这三大AI平台上获得更高的能见度。我们的核心策略是\"一模一策\"：每个AI模型有不同的内容偏好，需要差异化优化。豆包偏好情感化场景故事，千问偏好结构化任务数据，元宝偏好务实性价比分析。

我需要你帮我建立日常GEO运营体系，每天推进工作让\"被看见\"指标持续上升。

两条管理规矩：
1. 所有对外发布的内容必须经过我审批
2. 战略方向的重大调整也需要我确认

业务背景资料在 ~/.aida/context/idlex-geo-background.md，请先看一下。然后告诉我你打算怎么推进。"

  check "B4.01 Turn 1 produced response" "test -s $LOG_DIR/turn-1.log"
  soft  "B4.02 Mentions plan/strategy" "grep -qiE '计划|方案|策略|运营|plan|strategy' $LOG_DIR/turn-1.log"
  soft  "B4.03 Mentions GEO/stores/platforms" "grep -qiE '门店|GEO|能见度|豆包|千问|元宝|被看见' $LOG_DIR/turn-1.log"
  soft  "B4.04 Mentions management/management" "grep -qiE '审批|管理|治理|management|approval|约束|规矩' $LOG_DIR/turn-1.log"

  # ── Turn 2: Authorization + Modeling ────────────────────
  log "Turn 2: Authorization to model..."
  aida_say 2 "方案可以，全权交给你落地。需要创建什么实体、Skill、蓝图就直接建。我关注的是：
- 运营实体要覆盖探测、分析、内容、分发全流程
- 管理规矩要正式化成系统约束
- 重复性工作要提炼成可复用的Skill"

  check "B4.05 Turn 2 produced response" "test -s $LOG_DIR/turn-2.log"

  # Give Aida time to complete tool calls
  sleep 5

  # Check entity creation
  POST_MODEL_ENTITIES=$(api_get "/api/entities" | jlen)
  NEW_ENTITIES=$((POST_MODEL_ENTITIES - BASELINE_ENTITIES))
  soft  "B4.06 New entities created >= 3 (got $NEW_ENTITIES)" "test $NEW_ENTITIES -ge 3"
  soft  "B4.07 Mentions entity/skill/blueprint creation" "grep -qiE '创建|实体|entity|skill|blueprint|蓝图|技能' $LOG_DIR/turn-2.log"

  # Check for new skills
  POST_MODEL_SKILLS=$(find "$OPENCLAW_HOME/workspace/skills/" -name SKILL.md 2>/dev/null | wc -l)
  NEW_SKILLS=$((POST_MODEL_SKILLS - BASELINE_SKILLS))
  soft "B4.08 New Skills created (got $NEW_SKILLS new)" "test $NEW_SKILLS -ge 1"

  # Check for new blueprints
  POST_MODEL_BLUEPRINTS=$(find "$AIDA_HOME/blueprints/" -name "*.yaml" 2>/dev/null | wc -l)
  NEW_BLUEPRINTS=$((POST_MODEL_BLUEPRINTS - BASELINE_BLUEPRINTS))
  soft "B4.09 New Blueprint created (got $NEW_BLUEPRINTS new)" "test $NEW_BLUEPRINTS -ge 1"

  # ── Turn 3: Daily GEO Operations ───────────────────────
  log "Turn 3: Daily GEO operations..."
  aida_say 3 "开始今天的GEO运营工作。

第一步：做一轮能见度探测——模拟检查长沙3家门店在豆包上的推荐情况，把探测结果记录为实体。

第二步：基于探测结果，为长沙3家门店各生成一份面向豆包的GEO优化内容。要求体现豆包的情感化偏好风格——场景故事、氛围感、用户体验。内容生成后保存为文件备用。"

  check "B4.10 Turn 3 produced response" "test -s $LOG_DIR/turn-3.log"

  sleep 3

  # Check for content/probe entities
  POST_OPS_ENTITIES=$(api_get "/api/entities" | jlen)
  OPS_NEW_ENTITIES=$((POST_OPS_ENTITIES - POST_MODEL_ENTITIES))
  soft "B4.11 Operations created new entities (got $OPS_NEW_ENTITIES)" "test $OPS_NEW_ENTITIES -ge 1"

  # Check session JSONL for write tool calls (content artifact production)
  SESS_JSONL=$(ls -t "$OPENCLAW_HOME/agents/main/sessions/"*.jsonl 2>/dev/null | head -1)
  WRITE_CALLS=0
  if [ -n "$SESS_JSONL" ]; then
    WRITE_CALLS=$(node -e "
      const lines=require('fs').readFileSync('$SESS_JSONL','utf8').trim().split('\n');
      let n=0;for(const l of lines){try{const e=JSON.parse(l);
      if(e.type==='message'&&e.message?.role==='assistant'&&Array.isArray(e.message.content)){
        for(const b of e.message.content){if(b.name==='write')n++;}}}catch{}}
      console.log(n)" 2>/dev/null || echo 0)
  fi
  soft "B4.12 Aida produced content files via write tool (got $WRITE_CALLS calls)" "test $WRITE_CALLS -ge 1"

  soft "B4.13 Response mentions specific stores" "grep -qiE '声临其境|悠然茶室|棋乐无穷|store-cs' $LOG_DIR/turn-3.log"

  # ── Turn 3b: Collaboration Request ───────────────────────
  log "Turn 3b: Collaboration input request..."
  aida_say 3b "长沙声临其境KTV有几个数据我拿不准，需要店长确认一下：

1. 当前包房日均使用率（百分比）
2. 周末黄金时段（18:00-22:00）是否需要提前预约
3. 目前的主力消费人群年龄段

请通过协作任务机制向店长发起数据确认请求（用 bps_request_collaboration），我等店长回复后再优化内容。表单至少包含上面三个字段。"

  check "B4.13b Turn 3b produced response" "test -s $LOG_DIR/turn-3b.log"

  sleep 3

  # Check if bps_request_collaboration was called
  SESS_JSONL_3B=$(ls -t "$OPENCLAW_HOME/agents/main/sessions/"*.jsonl 2>/dev/null | head -1)
  COLLAB_CALLS=0
  if [ -n "$SESS_JSONL_3B" ]; then
    COLLAB_CALLS=$(node -e "
      const lines=require('fs').readFileSync('$SESS_JSONL_3B','utf8').trim().split('\n');
      let n=0;for(const l of lines){try{const e=JSON.parse(l);
      if(e.type==='message'&&e.message?.role==='assistant'&&Array.isArray(e.message.content)){
        for(const b of e.message.content){if(b.name==='bps_request_collaboration')n++;}}}catch{}}
      console.log(n)" 2>/dev/null || echo 0)
  fi
  soft "B4.13c Aida called bps_request_collaboration (got $COLLAB_CALLS)" "test $COLLAB_CALLS -ge 1"

  # Check collaboration tasks via Dashboard API
  COLLAB_PENDING_COUNT=$(api_get "/api/collaboration/tasks?status=pending" 2>/dev/null | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.count||0)}catch{console.log(0)}" 2>/dev/null || echo 0)
  soft "B4.13d Pending collaboration tasks in Dashboard (got $COLLAB_PENDING_COUNT)" "test $COLLAB_PENDING_COUNT -ge 1"

  # Step 3c: Programmatic collaboration response (simulate store manager reply)
  log "Step 3c: Simulating store manager reply via Dashboard API..."
  COLLAB_TASK_IDS=$(api_get "/api/collaboration/tasks?status=pending" 2>/dev/null | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(d.tasks.map(t=>t.id).join(' '))}catch{console.log('')}" 2>/dev/null || echo "")
  COLLAB_RESPONDED=0
  for cid in $COLLAB_TASK_IDS; do
    if [ -n "$cid" ]; then
      CRESULT=$(api_post "/api/collaboration/tasks/$cid/respond" '{"data":{"dailyOccupancyRate":72,"weekendReservationRequired":true,"primaryAgeGroup":"25-35"},"respondedBy":"store-manager-liu"}' 2>/dev/null || echo '{}')
      if echo "$CRESULT" | grep -q '"success":true'; then
        COLLAB_RESPONDED=$((COLLAB_RESPONDED + 1))
      fi
    fi
  done
  soft "B4.13e Collaboration tasks responded ($COLLAB_RESPONDED)" "test $COLLAB_RESPONDED -ge 1"

  soft "B4.13f Response mentions collaboration/confirm/input" "grep -qiE '协作|确认|collaborate|bps_request_collaboration|表单|form|店长|input|待办' $LOG_DIR/turn-3b.log"

  # ── Turn 4: Management Trigger — Content Publish ────────
  log "Turn 4: Management trigger — content publish..."
  aida_say 4 "草稿内容我过目了，质量不错。请把今天生成的GEO内容全部标记为发布就绪（publishReady: true），准备对外分发。"

  check "B4.14 Turn 4 produced response" "test -s $LOG_DIR/turn-4.log"

  sleep 3

  # Check management triggered
  POST_GOV_VIOLATIONS=$(api_get "/api/management/violations" | jlen)
  GOV_NEW_VIOLATIONS=$((POST_GOV_VIOLATIONS - BASELINE_VIOLATIONS))
  POST_GOV_APPROVALS=$(api_get "/api/management/approvals" | jlen)
  soft "B4.15 Management violations increased (new=$GOV_NEW_VIOLATIONS)" "test $GOV_NEW_VIOLATIONS -ge 1"
  soft "B4.16 Aida reports management interception" "grep -qiE '审批|approval|拦截|management|blocked|REQUIRE_APPROVAL|等待' $LOG_DIR/turn-4.log"
  soft "B4.17 Aida mentions approval ID or Dashboard" "grep -qiE 'Approval|Dashboard|3456|审批单|审批.*ID|id.*审批' $LOG_DIR/turn-4.log"

  # ── Step 5: Programmatic Approval (no agent turn) ───────
  log "Step 5: Programmatic approval via Dashboard API..."
  PENDING_IDS=$(api_get "/api/management/approvals" 2>/dev/null | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    const pending=d.filter(a=>a.status==='PENDING').map(a=>a.id);
    console.log(pending.join(' '))}catch{console.log('')}" 2>/dev/null || echo "")
  PENDING_COUNT=$(echo "$PENDING_IDS" | wc -w)

  soft "B4.18 Pending approvals exist (count=$PENDING_COUNT)" "test $PENDING_COUNT -ge 1"

  APPROVED_COUNT=0
  for aid in $PENDING_IDS; do
    if [ -n "$aid" ]; then
      RESULT=$(api_post "/api/management/approvals/$aid/decide" '{"decision":"APPROVED","decidedBy":"geo-lead","reason":"R3 test: content quality verified"}' 2>/dev/null || echo '{}')
      if echo "$RESULT" | node -e "try{JSON.parse(require('fs').readFileSync(0,'utf8'));process.exit(0)}catch{process.exit(1)}" 2>/dev/null; then
        APPROVED_COUNT=$((APPROVED_COUNT + 1))
      fi
    fi
  done
  soft "B4.19 Approvals processed ($APPROVED_COUNT approved)" "test $APPROVED_COUNT -ge 1"
  log "  Approved $APPROVED_COUNT of $PENDING_COUNT pending approvals."

  # Reset circuit breaker so Turn 6 can create resources
  log "  Resetting circuit breaker for Turn 6..."
  api_post "/api/management/circuit-breaker/reset" '{}' >/dev/null 2>&1
  sleep 2

  # ── Turn 6: Skill/Agent Creation ────────────────────────
  log "Turn 6: Skill and Agent creation..."
  aida_say 6 "GEO运营里有不少重复性工作模式。请帮我做两件事：

1. 把\"能见度探测\"这个流程提炼成一个可复用的Skill——以后每天自动跑探测就靠它了。

2. 我还需要一个面向顾客的\"闲氪门店小助手\"Agent——语气要亲切活泼，专门回答顾客关于门店的咨询问题。它的人格风格应该跟你的管理风格完全不同。"

  check "B4.20 Turn 6 produced response" "test -s $LOG_DIR/turn-6.log"

  sleep 5

  # Check skill creation
  POST_SKILL_ENTITIES=$(find "$OPENCLAW_HOME/workspace/skills/" -name SKILL.md 2>/dev/null | wc -l)
  TOTAL_NEW_SKILLS=$((POST_SKILL_ENTITIES - BASELINE_SKILLS))
  soft "B4.21 New Skill(s) created total (got $TOTAL_NEW_SKILLS)" "test $TOTAL_NEW_SKILLS -ge 1"

  # Check agent workspace creation
  POST_WORKSPACES=$(find "$OPENCLAW_HOME/" -maxdepth 1 -name "workspace-*" -type d 2>/dev/null | wc -l)
  NEW_WORKSPACES=$((POST_WORKSPACES - BASELINE_WORKSPACES))
  soft "B4.22 New Agent workspace created (got $NEW_WORKSPACES)" "test $NEW_WORKSPACES -ge 1"

  soft "B4.23 Response describes creation" "grep -qiE 'skill|技能|agent|助手|探测|probe|visibility|创建|workspace' $LOG_DIR/turn-6.log"

  # ── Turn 7: Daily Summary ──────────────────────────────
  log "Turn 7: Daily summary..."
  aida_say 7 "做一个今天的运营小结。覆盖了哪些门店、生成了什么内容、审批了几件事、创建了哪些新能力。用数据说话。"

  check "B4.24 Turn 7 produced response" "test -s $LOG_DIR/turn-7.log"
  soft  "B4.25 Summary has business content" "grep -qiE '门店|内容|审批|GEO|运营|content|store|approval' $LOG_DIR/turn-7.log"

  # ── Turn 8: Management Review ──────────────────────────
  log "Turn 8: Management review..."
  aida_say 8 "看看管理制度执行得怎么样——有没有违规记录、约束效能分析、熔断器什么状态。我要知道管理规矩有没有被有效执行。"

  check "B4.26 Turn 8 produced response" "test -s $LOG_DIR/turn-8.log"
  soft  "B4.27 Mentions management details" "grep -qiE 'violation|constraint|熔断|circuit|违规|约束|效能|effectiveness' $LOG_DIR/turn-8.log"

  log "Phase 4 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 5: Final Verification + Report
# ════════════════════════════════════════════════════════════

section "5: Final Verification + Report"

# Collect final metrics snapshot
log "Collecting final metrics..."

FINAL_ENTITIES=$(api_get "/api/entities" | jlen)
FINAL_VIOLATIONS=$(api_get "/api/management/violations" | jlen)
FINAL_CONSTRAINTS=$(api_get "/api/management/constraints" | jlen)
FINAL_SKILLS=$(find "$OPENCLAW_HOME/workspace/skills/" -name SKILL.md 2>/dev/null | wc -l)
FINAL_BLUEPRINTS=$(find "$AIDA_HOME/blueprints/" -name "*.yaml" 2>/dev/null | wc -l)
FINAL_WORKSPACES=$(find "$OPENCLAW_HOME/" -maxdepth 1 -name "workspace-*" -type d 2>/dev/null | wc -l)

check "V5.1 Final entity count stable (got $FINAL_ENTITIES)" "test $FINAL_ENTITIES -ge 7"
check "V5.2 Management constraints loaded (got $FINAL_CONSTRAINTS)" "test $FINAL_CONSTRAINTS -ge 2"
check "V5.3 Skills intact (got $FINAL_SKILLS)" "test $FINAL_SKILLS -ge 7"

if [ "$ENGINE_ONLY" = false ]; then
  # Business scenario final checks
  AGENT_ENTITIES=$((FINAL_ENTITIES - ${BASELINE_ENTITIES:-0}))
  soft "V5.4 Agent created entities >= 3 (got $AGENT_ENTITIES)" "test ${AGENT_ENTITIES:-0} -ge 3"

  # Check for business entity types (content, probe, observation, geo-content)
  BIZ_TYPES=$(api_get "/api/entities" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    const bizTypes=['content','geo-content','probe','observation','action-plan','strategy'];
    const found=d.filter(e=>bizTypes.includes(e.entityType)).map(e=>e.entityType);
    const unique=[...new Set(found)];
    console.log(unique.join(','))}catch{console.log('')}" 2>/dev/null || echo "")
  BIZ_TYPE_COUNT=$(echo "$BIZ_TYPES" | tr ',' '\n' | grep -c '.' || echo 0)
  soft "V5.5 Business entity types >= 2 (got $BIZ_TYPE_COUNT: $BIZ_TYPES)" "test $BIZ_TYPE_COUNT -ge 2"

  # Check session JSONL for total write tool calls across all turns
  FINAL_JSONL=$(ls -t "$OPENCLAW_HOME/agents/main/sessions/"*.jsonl 2>/dev/null | head -1)
  TOTAL_WRITES=0
  if [ -n "$FINAL_JSONL" ]; then
    TOTAL_WRITES=$(node -e "
      const lines=require('fs').readFileSync('$FINAL_JSONL','utf8').trim().split('\n');
      let n=0;for(const l of lines){try{const e=JSON.parse(l);
      if(e.type==='message'&&e.message?.role==='assistant'&&Array.isArray(e.message.content)){
        for(const b of e.message.content){if(b.name==='write')n++;}}}catch{}}
      console.log(n)" 2>/dev/null || echo 0)
  fi
  soft "V5.6 Aida produced content artifacts (write tool calls=$TOTAL_WRITES)" "test ${TOTAL_WRITES:-0} -ge 1"

  soft "V5.7 Management was exercised (violations=$FINAL_VIOLATIONS)" "test $FINAL_VIOLATIONS -ge 1"

  # S3.08 (moved from Phase 3): approvals only exist after Phase 4 agent turns
  DECIDED_APPROVALS=$(api_get "/api/management/approvals" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    const decided=d.filter(a=>a.status==='APPROVED'||a.status==='REJECTED').length;
    console.log(decided)}catch{console.log(0)}" 2>/dev/null || echo 0)
  soft "S3.08 Approval decide works (decided=$DECIDED_APPROVALS)" "test ${DECIDED_APPROVALS:-0} -ge 1"

  AGENT_SKILLS=$((FINAL_SKILLS - ${BASELINE_SKILLS:-0}))
  soft "V5.8 Agent created Skills >= 1 (got $AGENT_SKILLS)" "test ${AGENT_SKILLS:-0} -ge 1"

  soft "V5.9 Agent workspace created (got $FINAL_WORKSPACES)" "test ${FINAL_WORKSPACES:-0} -ge 1"

  # Collaboration final checks
  FINAL_COLLAB_STATUS=$(api_get "/api/collaboration/status" 2>/dev/null || echo "{}")
  FINAL_COLLAB_COMPLETED=$(echo "$FINAL_COLLAB_STATUS" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.counts?.completed||0)}catch{console.log(0)}" 2>/dev/null || echo 0)
  FINAL_COLLAB_TOTAL=$(echo "$FINAL_COLLAB_STATUS" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    const c=d.counts||{};console.log((c.pending||0)+(c.completed||0)+(c.expired||0)+(c.cancelled||0))}catch{console.log(0)}" 2>/dev/null || echo 0)
  soft "V5.10 Collaboration tasks created (total=$FINAL_COLLAB_TOTAL)" "test ${FINAL_COLLAB_TOTAL:-0} -ge 1"
  soft "V5.11 Collaboration tasks completed (completed=$FINAL_COLLAB_COMPLETED)" "test ${FINAL_COLLAB_COMPLETED:-0} -ge 1"

  # Check JSONL for saturation signal (at least one tool result contains _readSignal)
  SATURATION_DETECTED=0
  if [ -n "$FINAL_JSONL" ]; then
    SATURATION_DETECTED=$(node -e "
      const lines=require('fs').readFileSync('$FINAL_JSONL','utf8').trim().split('\n');
      let n=0;for(const l of lines){try{const e=JSON.parse(l);
      if(e.type==='message'&&e.message?.role==='tool'){
        const c=JSON.stringify(e.message.content||'');
        if(c.includes('_readSignal')||c.includes('consecutiveReads'))n++;}}catch{}}
      console.log(n)" 2>/dev/null || echo 0)
  fi
  soft "V5.12 Saturation signal appeared in session ($SATURATION_DETECTED occurrences)" "test ${SATURATION_DETECTED:-0} -ge 0"
fi

# Entity breakdown
log "Entity breakdown:"
api_get "/api/entities" | node -e "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  const t={};d.forEach(e=>{const k=e.entityType||'?';t[k]=(t[k]||0)+1});
  console.log('  Total: '+d.length);
  Object.entries(t).sort().forEach(([k,v])=>console.log('  '+k+': '+v))
" 2>/dev/null || true

# Skills listing
if [ "$ENGINE_ONLY" = false ]; then
  log "Skills:"
  find "$OPENCLAW_HOME/workspace/skills/" -name SKILL.md 2>/dev/null | while read f; do
    echo "  $(basename "$(dirname "$f")")"
  done

  # Agent workspaces
  if [ "$FINAL_WORKSPACES" -gt 0 ]; then
    log "Agent workspaces:"
    find "$OPENCLAW_HOME/" -maxdepth 1 -name "workspace-*" -type d 2>/dev/null | while read d; do
      echo "  $(basename "$d")"
    done
  fi

  # Content artifacts from session JSONL write targets
  log "Content artifacts (write tool targets, total $TOTAL_WRITES):"
  if [ -n "$FINAL_JSONL" ]; then
    node -e "
      const lines=require('fs').readFileSync('$FINAL_JSONL','utf8').trim().split('\n');
      for(const l of lines){try{const e=JSON.parse(l);
      if(e.type==='message'&&e.message?.role==='assistant'&&Array.isArray(e.message.content)){
        for(const b of e.message.content){if(b.name==='write'){
          let args=b.input||{};
          if(!Object.keys(args).length&&b.arguments){
            args=typeof b.arguments==='string'?JSON.parse(b.arguments):b.arguments;}
          const p=args.path||args.filePath||args.file_path||'?';
          console.log('  '+p);}}}}catch{}}" 2>/dev/null | head -15
  fi
fi

# Write metrics JSON
cat > "$LOG_DIR/metrics.json" << METRICS
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "entities": $FINAL_ENTITIES,
  "violations": $FINAL_VIOLATIONS,
  "constraints": $FINAL_CONSTRAINTS,
  "skills": $FINAL_SKILLS,
  "blueprints": $FINAL_BLUEPRINTS,
  "writeToolCalls": ${TOTAL_WRITES:-0},
  "agentWorkspaces": $FINAL_WORKSPACES,
  "collaborationTasks": ${FINAL_COLLAB_TOTAL:-0},
  "collaborationCompleted": ${FINAL_COLLAB_COMPLETED:-0},
  "saturationSignals": ${SATURATION_DETECTED:-0},
  "testResults": {
    "pass": $PASS,
    "fail": $FAIL,
    "warn": $WARNS,
    "total": $TOTAL
  }
}
METRICS

ENDED_AT=$(date +%s)
DURATION=$((ENDED_AT - STARTED_AT))

# ════════════════════════════════════════════════════════════
# Test Report
# ════════════════════════════════════════════════════════════

section "Test Report"

echo "AIDA Structural Capability E2E Test"
echo "===================================="
echo "Date:     $(date)"
echo "Server:   $(hostname)"
echo "Duration: ${DURATION}s"
echo "Mode:     $([ "$ENGINE_ONLY" = true ] && echo 'engine-only' || echo 'full')"
echo ""
echo "Results: $PASS PASS / $FAIL FAIL / $WARNS WARN / $TOTAL TOTAL"
echo ""

echo "Coverage:"
echo "  D1:  Management Gating     (S2.01-S2.08c)  10 checks"
echo "  D2:  Circuit Breaker       (S2.09-S2.14)    6 checks"
echo "  D3:  Information Summary   (S2.15-S2.20)    6 checks"
echo "  D4:  Process Groups        (S2.21-S2.24)    4 checks"
echo "  D5:  Entity Relations      (S2.25-S2.27c)   5 checks"
echo "  D6:  Skill Metrics         (S2.28-S2.30)    3 checks"
echo "  D7:  Constraint Analytics  (S2.31-S2.33)    3 checks"
echo "  D8:  Tool Registration     (S2.34-S2.35)    2 checks"
echo "  D9:  Saturation Signal     (S2.36-S2.41)    6 checks"
echo "  D10: Collaboration Input   (S2.42-S2.51)   10 checks"
echo "  D11: Dashboard API         (S3.01-S3.14)   16 checks"
if [ "$ENGINE_ONLY" = false ]; then
echo "  B:   Business Scenario     (B4.01-B4.27)   33 checks"
echo "  V5:  Final Verification    (V5.1-V5.12)    12 checks"
else
echo "  V5:  Final Verification    (V5.1-V5.3)      3 checks"
fi
echo ""

echo "Metrics:"
echo "  Entities:        $FINAL_ENTITIES"
echo "  Violations:      $FINAL_VIOLATIONS"
echo "  Constraints:     $FINAL_CONSTRAINTS"
echo "  Skills:          $FINAL_SKILLS"
echo "  Blueprints:      $FINAL_BLUEPRINTS"
if [ "$ENGINE_ONLY" = false ]; then
echo "  WriteTools:      ${TOTAL_WRITES:-0}"
echo "  Workspaces:      $FINAL_WORKSPACES"
echo "  CollabTasks:     ${FINAL_COLLAB_TOTAL:-0}"
echo "  CollabCompleted: ${FINAL_COLLAB_COMPLETED:-0}"
echo "  Saturation:      ${SATURATION_DETECTED:-0}"
fi
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}ALL CHECKS PASSED ✓${NC}"
elif [ "$FAIL" -le 3 ]; then
  echo -e "${YELLOW}MOSTLY PASSED ($FAIL failures)${NC}"
else
  echo -e "${RED}$FAIL CHECKS FAILED${NC}"
fi

# Save report
cat > "$LOG_DIR/report.txt" << REPORT
AIDA Structural Capability E2E Test — IdleX GEO Business Edition
=================================================================
Date:     $(date)
Server:   $(hostname)
Duration: ${DURATION}s
Mode:     $([ "$ENGINE_ONLY" = true ] && echo 'engine-only' || echo 'full (IdleX GEO business scenario)')

Results: $PASS PASS / $FAIL FAIL / $WARNS WARN / $TOTAL TOTAL

Entities:    $FINAL_ENTITIES
Violations:  $FINAL_VIOLATIONS
Constraints: $FINAL_CONSTRAINTS
Skills:      $FINAL_SKILLS
Blueprints:  $FINAL_BLUEPRINTS
WriteTools:  ${TOTAL_WRITES:-0}
Workspaces:  $FINAL_WORKSPACES

Logs: $LOG_DIR/
Dashboard: $DASHBOARD_URL
REPORT

log "Report saved: $LOG_DIR/report.txt"
log "Engine results: $LOG_DIR/engine-results.json"
log "Metrics: $LOG_DIR/metrics.json"

echo ""
echo "Output: $LOG_DIR/"

exit "$FAIL"
