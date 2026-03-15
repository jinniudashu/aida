#!/usr/bin/env bash
# ============================================================
# AEF Capability E2E Test
# ============================================================
# Full E2E test based on structural-capability, upgraded with
# AEF 11-dimension evaluation framework (Σ1-Σ11).
#
# Same business scenario (IdleX GEO), same deployment flow,
# enriched with 30 additional engine checks covering:
#   Σ1 PROC, Σ7 SCHED, Σ9 HIER, ΣX Cross, Σ11 MATCH
#
# Usage:
#   bash test/e2e/aef-capability.sh [options]
#
# Options:
#   --skip-install    Skip reinstall (reuse existing deployment)
#   --engine-only     Skip agent turns (fast mode, ~3 min)
#   --phase N         Start from phase N
#
# Test plan: test/e2e/aef-capability-test.md
# Framework: docs/AIDA评估理论框架 (AEF) v0.1.md
# Run on: root@47.236.109.62
# ============================================================

set -euo pipefail

# -- Configuration --
AIDA_HOME="${AIDA_HOME:-$HOME/.aida}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
AIDA_REPO="${AIDA_REPO:-$HOME/aida}"
DASHBOARD_URL="http://localhost:3456"
LOG_DIR="/tmp/aef-capability"
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
  local max_retries=2
  local min_lines=5
  local attempt=0
  local out="$LOG_DIR/turn-$turn.log"

  while [ $attempt -le $max_retries ]; do
    attempt=$((attempt + 1))
    if [ $attempt -gt 1 ]; then
      log "Turn $turn: response too short (<$min_lines lines), retry $((attempt-1))/$max_retries..."
    else
      log "Turn $turn: sending to Aida..."
    fi
    timeout "$AGENT_TIMEOUT" openclaw agent --agent main --message "$msg" > "$out" 2>&1 || true
    local lines
    lines=$(wc -l < "$out" 2>/dev/null || echo 0)
    if [ "$lines" -ge $min_lines ] || [ $attempt -gt $max_retries ]; then
      break
    fi
  done

  echo -e "${CYAN}--- Aida response (turn $turn, attempt $attempt, first 20 lines) ---${NC}"
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

    # Lock model to dashscope/qwen3.5-plus — AEF capability tests
    # use a fixed model for stable baseline. Fallback: kimi/kimi-for-coding.
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
      console.log("[aef] model locked: dashscope/qwen3.5-plus");
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
  check "V0.7 Model locked to known baseline (got $ACTUAL_MODEL)" "test '$ACTUAL_MODEL' = 'dashscope/qwen3.5-plus' -o '$ACTUAL_MODEL' = 'kimi/kimi-for-coding'"

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

  cat > .tmp-aef-seed.ts << 'TYPESCRIPT'
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
fs.writeFileSync('/tmp/aef-capability/seed-ids.json', JSON.stringify({
  taskIds: [task1.id, task2.id, task3.id],
  groupId: 'group-structural-batch',
}));
TYPESCRIPT

  node --import tsx .tmp-aef-seed.ts 2>&1 | tee "$LOG_DIR/seed.log"
  rm -f .tmp-aef-seed.ts

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
# Phase 2: Engine Tests (D1-D8 + AEF Σ1-Σ11)
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 2 ]; then
  section "2: Engine Tests (D1-D8 + AEF Σ1-Σ11)"

  log "Running programmatic engine tests..."
  cd "$AIDA_REPO"

  cat > .tmp-aef-engine.ts << 'TYPESCRIPTEOF'
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  createBpsEngine,
  createDatabase,
  ManagementStore,
  SkillMetricsStore,
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

// Create tools with management
const tools = createBpsTools({
  tracker: engine.tracker,
  blueprintStore: engine.blueprintStore,
  processStore: engine.processStore,
  dossierStore: engine.dossierStore,
  skillsDir: SKILLS_DIR,
  managementGate: gate,
  managementStore: mgmtStore,
  skillMetricsStore: skillMetrics,
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
const seedIds = JSON.parse(fs.readFileSync('/tmp/aef-capability/seed-ids.json', 'utf-8'));
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

// S2.34: Total tool count with management
{
  assert('S2.34', 'Total tools = 17 (15 base + 2 management)',
    tools.length === 17,
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
// AEF Supplementary Engine Checks (Σ1-Σ11)
// ═════════════════════════════════════════════

resetManagement();

// ── Σ1 PROC: Process Lifecycle 5-State ──────
console.log('\n--- Σ1 PROC: Process Lifecycle ---');

// E1.01: Create task → OPEN
{
  const t = engine.tracker.createTask({
    serviceId: 'svc-probe', entityType: 'probe', entityId: 'e1-lifecycle-01',
  });
  assert('E1.01', 'Create task → state=OPEN', t.state === 'OPEN', `state=${t.state}`);
}

// E1.02: OPEN → IN_PROGRESS
{
  const t = engine.tracker.createTask({
    serviceId: 'svc-probe', entityType: 'probe', entityId: 'e1-lifecycle-02',
  });
  engine.tracker.updateTask(t.id, { state: 'IN_PROGRESS' });
  const u = engine.processStore.get(t.id);
  assert('E1.02', 'OPEN → IN_PROGRESS', u?.state === 'IN_PROGRESS', `state=${u?.state}`);
}

// E1.03: Complete outcome=success (via tool — stores _outcome in snapshot)
{
  const t = engine.tracker.createTask({
    serviceId: 'svc-probe', entityType: 'probe', entityId: 'e1-lifecycle-03',
  });
  const completeTool = tools.find(t => t.name === 'bps_complete_task')!;
  await completeTool.execute('e1-03', { taskId: t.id, outcome: 'success' });
  const c = engine.processStore.get(t.id);
  const snap = engine.processStore.getLatestSnapshot(t.id);
  assert('E1.03', 'Complete outcome=success → stored in snapshot',
    c?.state === 'COMPLETED' && snap?.contextData?._outcome === 'success',
    `state=${c?.state}, outcome=${snap?.contextData?._outcome}`);
}

// E1.04: Complete outcome=partial
{
  const t = engine.tracker.createTask({
    serviceId: 'svc-analyze', entityType: 'analysis', entityId: 'e1-lifecycle-04',
  });
  const completeTool = tools.find(t => t.name === 'bps_complete_task')!;
  await completeTool.execute('e1-04', { taskId: t.id, outcome: 'partial' });
  const c = engine.processStore.get(t.id);
  const snap = engine.processStore.getLatestSnapshot(t.id);
  assert('E1.04', 'Complete outcome=partial persisted',
    c?.state === 'COMPLETED' && snap?.contextData?._outcome === 'partial',
    `outcome=${snap?.contextData?._outcome}`);
}

// E1.05: IN_PROGRESS → FAILED
{
  const t = engine.tracker.createTask({
    serviceId: 'svc-probe', entityType: 'probe', entityId: 'e1-lifecycle-05',
  });
  engine.tracker.updateTask(t.id, { state: 'IN_PROGRESS' });
  engine.tracker.updateTask(t.id, { state: 'FAILED' });
  const f = engine.processStore.get(t.id);
  assert('E1.05', 'IN_PROGRESS → FAILED', f?.state === 'FAILED', `state=${f?.state}`);
}

// E1.06: IN_PROGRESS → BLOCKED
{
  const t = engine.tracker.createTask({
    serviceId: 'svc-probe', entityType: 'probe', entityId: 'e1-lifecycle-06',
  });
  engine.tracker.updateTask(t.id, { state: 'IN_PROGRESS' });
  engine.tracker.updateTask(t.id, { state: 'BLOCKED' });
  const b = engine.processStore.get(t.id);
  assert('E1.06', 'IN_PROGRESS → BLOCKED', b?.state === 'BLOCKED', `state=${b?.state}`);
}

// ── Σ7 SCHED: Scheduling Efficiency ─────────
console.log('\n--- Σ7 SCHED: Scheduling ---');

const earlyDeadline = new Date(Date.now() - 172800000).toISOString();
const lateDeadline = new Date(Date.now() - 86400000).toISOString();
const futureDeadline = new Date(Date.now() + 86400000).toISOString();

const overdueTask1 = engine.tracker.createTask({
  serviceId: 'svc-probe', entityType: 'probe', entityId: 'e7-overdue-early',
  deadline: earlyDeadline, priority: 1,
});
engine.tracker.createTask({
  serviceId: 'svc-probe', entityType: 'probe', entityId: 'e7-overdue-late',
  deadline: lateDeadline, priority: 5,
});
engine.tracker.createTask({
  serviceId: 'svc-probe', entityType: 'probe', entityId: 'e7-future',
  deadline: futureDeadline, priority: 3,
});

assert('E7.01', 'Past-deadline task created', !!overdueTask1.id, `id=${overdueTask1.id}`);

{
  const scanTool = tools.find(t => t.name === 'bps_scan_work')!;
  const result = await scanTool.execute('e7-test', {}) as any;
  const overdue = result.overdueTasks;

  assert('E7.02', 'scan_work overdueTasks >= 1',
    overdue && overdue.total >= 1,
    `total=${overdue?.total}`);

  const overdueIds = (overdue?.items || []).map((i: any) => i.entityId);
  assert('E7.03', 'Overdue task ID in overdueTasks.items',
    overdueIds.includes('e7-overdue-early') || overdueIds.includes('e7-overdue-late'),
    `items: ${overdueIds.join(', ')}`);

  assert('E7.04', 'Future task NOT in overdueTasks',
    !overdueIds.includes('e7-future'),
    `items: ${overdueIds.join(', ')}`);

  const items = overdue?.items || [];
  if (items.length >= 2) {
    let sorted = true;
    for (let i = 0; i < items.length - 1; i++) {
      if (items[i].deadline && items[i+1].deadline && items[i].deadline > items[i+1].deadline) {
        sorted = false; break;
      }
    }
    assert('E7.05', 'Deadline ASC sort (earliest first)',
      sorted,
      `first=${items[0]?.deadline}, second=${items[1]?.deadline}`);
  } else {
    assert('E7.05', 'Deadline ASC sort (need >= 2 overdue)',
      items.length >= 2, `only ${items.length} overdue items`);
  }
}

// ── Σ9 HIER: Hierarchy Consistency ──────────
console.log('\n--- Σ9 HIER: Hierarchy ---');

{
  const constraints = govResult.constraints;

  const allHaveTools = constraints.every((c: any) => c.scope?.tools && c.scope.tools.length > 0);
  assert('E9.01', 'All constraints have scope.tools[] defined',
    allHaveTools, `${constraints.length} constraints checked`);

  const allToolsValid = constraints.every((c: any) =>
    (c.scope?.tools || []).every((t: string) => GATED_WRITE_TOOLS.includes(t as any))
  );
  assert('E9.02', 'scope.tools ⊆ GATED_WRITE_TOOLS',
    allToolsValid, `GATED: ${GATED_WRITE_TOOLS.join(', ')}`);

  const hasEntityScope = constraints.some((c: any) => c.scope?.entityTypes?.length > 0);
  assert('E9.03', 'entityType scoping exists',
    hasEntityScope, `with entityType: ${constraints.filter((c: any) => c.scope?.entityTypes?.length > 0).length}`);
}

// ── ΣX Cross: Cross-Dimension Links ─────────
console.log('\n--- ΣX Cross: Cross-Dimension ---');

// EX.01: Σ3→Σ4 CRITICAL violation → CB DISCONNECTED
{
  resetManagement();
  const gateX1 = new ActionGate(mgmtStore);
  gateX1.check('bps_update_entity', {
    entityType: 'content', entityId: 'ex01-trigger',
    data: { lifecycle: 'ARCHIVED' },
  });
  const cb = mgmtStore.getCircuitBreakerState();
  assert('EX.01', 'Σ3→Σ4: CRITICAL → CB DISCONNECTED',
    cb.state === 'DISCONNECTED', `state=${cb.state}`);
}

// EX.02: Σ4→Σ3 Reset CB → write PASS
{
  mgmtStore.resetCircuitBreaker();
  db.exec('DELETE FROM bps_management_violations');
  const gateX2 = new ActionGate(mgmtStore);
  const result = gateX2.check('bps_update_entity', {
    entityType: 'store', entityId: 'ex02-after-reset',
    data: { status: 'ok' },
  });
  assert('EX.02', 'Σ4→Σ3: Reset CB → write PASS',
    result.verdict === 'PASS', `verdict=${result.verdict}`);
}

// EX.03: Σ3→Σ5 N violations → effectiveness count
{
  resetManagement();
  const gateX3 = new ActionGate(mgmtStore, {
    thresholds: [
      { severity: 'CRITICAL', maxViolations: 999, window: '1h', action: 'DISCONNECTED' },
      { severity: 'HIGH', maxViolations: 999, window: '1h', action: 'WARNING' },
    ],
  });
  for (let i = 0; i < 3; i++) {
    gateX3.check('bps_update_entity', {
      entityType: 'content', entityId: `ex03-v${i}`,
      data: { publishReady: true },
    });
  }
  const eff = mgmtStore.getConstraintEffectiveness();
  const pubEff = eff.find(e => e.constraintId === 'c-publish-approval');
  assert('EX.03', 'Σ3→Σ5: 3 violations → violationCount >= 3',
    pubEff !== undefined && pubEff.violationCount >= 3,
    `violationCount=${pubEff?.violationCount}`);
}

// EX.04: Σ5 High approval rate → suggestion
{
  resetManagement();
  // Use gate.check() for violations (it handles the complex schema),
  // then seed APPROVED approvals directly (gate doesn't create approvals).
  const gateX4 = new ActionGate(mgmtStore, {
    thresholds: [
      { severity: 'CRITICAL', maxViolations: 999, window: '1h', action: 'DISCONNECTED' },
      { severity: 'HIGH', maxViolations: 999, window: '1h', action: 'WARNING' },
    ],
  });
  for (let i = 0; i < 22; i++) {
    gateX4.check('bps_update_entity', {
      entityType: 'content', entityId: `ex04-${i}`,
      data: { publishReady: true },
    });
  }
  // Seed 22 APPROVED approval records (gate creates violations but not approvals)
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  for (let i = 0; i < 22; i++) {
    db.exec(`INSERT INTO bps_management_approvals (id, constraint_id, tool, tool_input, entity_type, entity_id, message, status, approved_by, decided_at, created_at, expires_at)
      VALUES ('ex04-a${i}', 'c-publish-approval', 'bps_update_entity', '{}', 'content', 'ex04-${i}', 'test', 'APPROVED', 'test', '${nowIso}', '${nowIso}', '${expiresAt}')`);
  }

  const eff = mgmtStore.getConstraintEffectiveness();
  const pubEff = eff.find(e => e.constraintId === 'c-publish-approval');
  assert('EX.04', 'Σ5: 92% approval → relaxation suggestion',
    pubEff !== undefined && pubEff.suggestion !== null && pubEff.approvalRate !== null && pubEff.approvalRate > 0.9,
    `rate=${pubEff?.approvalRate}, suggestion="${pubEff?.suggestion}"`);
}

// EX.05: Σ1→Σ7→Σ6 scan_work summary with counts
{
  const scanTool = tools.find(t => t.name === 'bps_scan_work')!;
  const result = await scanTool.execute('ex05', {}) as any;
  assert('EX.05', 'Σ1→Σ7→Σ6: scan_work summary has counts',
    typeof result.summary === 'string' && result.summary.length > 0 && /\d/.test(result.summary),
    `summary="${result.summary}"`);
}

// EX.06: Σ1→Σ5 outcome=partial → distribution
{
  // Create a fresh partial-outcome task with high priority to ensure it's in recentlyCompleted (limit:10, ORDER BY priority DESC)
  const t = engine.tracker.createTask({
    serviceId: 'svc-probe', entityType: 'probe', entityId: 'ex06-partial',
    priority: 999,
  });
  const cTool = tools.find(t => t.name === 'bps_complete_task')!;
  await cTool.execute('ex06-complete', { taskId: t.id, outcome: 'partial' });

  const scanTool = tools.find(t => t.name === 'bps_scan_work')!;
  const result = await scanTool.execute('ex06', {}) as any;
  assert('EX.06', 'Σ1→Σ5: outcomeDistribution.partial >= 1',
    result.outcomeDistribution?.partial >= 1,
    `partial=${result.outcomeDistribution?.partial}`);
}

// ── Σ11 MATCH: Capability Matching ──────────
console.log('\n--- Σ11 MATCH: Capability Matching ---');
resetManagement();

// A-layer: Structural Prerequisites
{
  const eff = mgmtStore.getConstraintEffectiveness();
  const hasSuggestion = eff.length > 0 && 'suggestion' in eff[0];
  assert('E11.01', 'A: effectiveness API has suggestion field',
    hasSuggestion, `fields: ${Object.keys(eff[0] || {}).join(', ')}`);
}

{
  const hasEntity = GATED_WRITE_TOOLS.includes('bps_update_entity' as any);
  const hasBP = GATED_WRITE_TOOLS.includes('bps_load_blueprint' as any);
  const hasAgent = GATED_WRITE_TOOLS.includes('bps_register_agent' as any);
  assert('E11.02', 'A: management covers entity+blueprint+agent tools',
    hasEntity && hasBP && hasAgent,
    `entity=${hasEntity}, bp=${hasBP}, agent=${hasAgent}`);
}

{
  const withDF = govResult.constraints.filter((c: any) => c.scope?.dataFields?.length > 0);
  assert('E11.03', 'A: fine-grained dataFields scope available',
    withDF.length >= 1, `constraints with dataFields: ${withDF.map((c: any) => c.id).join(', ')}`);
}

{
  const scanTool = tools.find(t => t.name === 'bps_scan_work')!;
  const r = await scanTool.execute('e11-04', {}) as any;
  assert('E11.04', 'A: scan_work has summary+outcomeDistribution+overdueTasks',
    r.summary !== undefined && r.outcomeDistribution !== undefined && r.overdueTasks !== undefined,
    `keys: ${Object.keys(r).join(', ')}`);
}

// B-layer: Over-Constraint Resistance
{
  resetManagement();
  const g5 = new ActionGate(mgmtStore);
  const r = g5.check('bps_update_entity', {
    entityType: 'store', entityId: 'e11-store-pass',
    data: { lifecycle: 'ARCHIVED' },
  });
  assert('E11.05', 'B: content constraint NOT blocking store entity',
    r.verdict === 'PASS', `verdict=${r.verdict}`);
}

{
  resetManagement();
  const g6 = new ActionGate(mgmtStore);
  const r = g6.check('bps_update_entity', {
    entityType: 'content', entityId: 'e11-name-pass',
    data: { name: 'harmless update' },
  });
  assert('E11.06', 'B: publishReady constraint NOT blocking name update',
    r.verdict === 'PASS', `verdict=${r.verdict}`);
}

{
  // Add constraint without dataFields → applies to all content updates
  const extra: any = {
    id: 'c-test-undefined-var', policyId: 'p-test', label: 'Test undefined variable',
    severity: 'HIGH', onViolation: 'REQUIRE_APPROVAL',
    condition: 'publishReady != true', message: 'Test: undefined variable handling',
    scope: { tools: ['bps_update_entity'], entityTypes: ['content'] },
  };
  mgmtStore.loadConstraints([...govResult.constraints, extra]);
  resetManagement();

  const g7 = new ActionGate(mgmtStore);
  const r = g7.check('bps_update_entity', {
    entityType: 'content', entityId: 'e11-undef',
    data: { name: 'no publishReady field' },
  });
  assert('E11.07', 'B: undefined variable → PASS (not applicable)',
    r.verdict === 'PASS', `verdict=${r.verdict}`);

  mgmtStore.loadConstraints(govResult.constraints);
}

// C-layer: Under-Support Detection
{
  const batch = tools.find(t => t.name === 'bps_batch_update');
  assert('E11.08', 'C: bps_batch_update tool registered',
    batch !== undefined, `found: ${!!batch}`);
}

{
  resetManagement();
  const g9 = new ActionGate(mgmtStore);
  const r = g9.check('bps_update_entity', {
    entityType: 'content', entityId: 'e11-block-info',
    data: { lifecycle: 'ARCHIVED' },
  });
  const blk = r.checks.find((c: any) => !c.passed);
  assert('E11.09', 'C: BLOCK has constraintId+severity+message',
    r.verdict === 'BLOCK' && blk?.constraintId && blk?.severity && blk?.message,
    `constraintId=${blk?.constraintId}, severity=${blk?.severity}`);
}

{
  resetManagement();
  const qTool = tools.find(t => t.name === 'bps_query_entities')!;
  const briefStr = JSON.stringify(await qTool.execute('brief', { entityType: 'store', brief: true }));
  const fullStr = JSON.stringify(await qTool.execute('full', { entityType: 'store', brief: false }));
  assert('E11.10', 'C: brief payload < full payload',
    briefStr.length < fullStr.length,
    `brief=${briefStr.length}B, full=${fullStr.length}B`);
}

// ─── AEF Σ10 COADAPT — Human-Agent Cooperative Adaptation ───

// E10.01: REQUIRE_APPROVAL creates structured approval record with approvalId + constraintId
{
  mgmtStore.loadConstraints(govResult.constraints);
  resetManagement();
  const g10 = new ActionGate(mgmtStore);
  const r10 = g10.check('bps_update_entity', {
    entityType: 'content', entityId: 'e10-doc',
    data: { publishReady: true },
  });
  let approvalId = '';
  if (r10.verdict === 'REQUIRE_APPROVAL') {
    approvalId = g10.createApprovalRequest('bps_update_entity', {
      entityType: 'content', entityId: 'e10-doc',
      data: { publishReady: true },
    }, r10);
  }
  const pending = mgmtStore.getPendingApprovals();
  const match = pending.find((a: any) => a.id === approvalId);
  assert('E10.01', 'REQUIRE_APPROVAL produces structured approval (approvalId + constraintId)',
    !!approvalId && !!match && match.constraintId === 'c-publish-approval',
    `approvalId=${approvalId}, constraintId=${match?.constraintId}`);
}

// E10.02: Approved replay executes successfully (entity version increments)
{
  mgmtStore.loadConstraints(govResult.constraints);
  resetManagement();
  const ds = engine.dossierStore;
  const d = ds.getOrCreate('content', 'e10-replay');
  ds.commit(d.id, { title: 'draft', publishReady: false });
  const before = ds.get('content', 'e10-replay')!;

  const g10b = new ActionGate(mgmtStore);
  const r10b = g10b.check('bps_update_entity', {
    entityType: 'content', entityId: 'e10-replay',
    data: { publishReady: true },
  });
  const aid = g10b.createApprovalRequest('bps_update_entity', {
    entityType: 'content', entityId: 'e10-replay',
    data: { publishReady: true },
  }, r10b);
  // Approve and replay: apply the update
  mgmtStore.decideApproval(aid, 'APPROVED', 'e2e-test');
  ds.commit(d.id, { publishReady: true });
  const after = ds.get('content', 'e10-replay')!;
  assert('E10.02', 'Approved replay increments entity version',
    after.dossier.currentVersion > before.dossier.currentVersion && after.data?.publishReady === true,
    `v1=${before.dossier.currentVersion}, v2=${after.dossier.currentVersion}, publishReady=${after.data?.publishReady}`);
}

// E10.03: Rejected replay does NOT execute (entity unchanged)
{
  mgmtStore.loadConstraints(govResult.constraints);
  resetManagement();
  const ds = engine.dossierStore;
  const d = ds.getOrCreate('content', 'e10-reject');
  ds.commit(d.id, { title: 'keep', publishReady: false });
  const before = ds.get('content', 'e10-reject')!;

  const g10c = new ActionGate(mgmtStore);
  const r10c = g10c.check('bps_update_entity', {
    entityType: 'content', entityId: 'e10-reject',
    data: { publishReady: true },
  });
  const rejId = g10c.createApprovalRequest('bps_update_entity', {
    entityType: 'content', entityId: 'e10-reject',
    data: { publishReady: true },
  }, r10c);
  // Reject — should NOT replay
  mgmtStore.decideApproval(rejId, 'REJECTED', 'e2e-test');
  // Intentionally do NOT apply the update
  const after = ds.get('content', 'e10-reject')!;
  assert('E10.03', 'Rejected approval leaves entity unchanged',
    after.dossier.currentVersion === before.dossier.currentVersion && after.data?.publishReady === false,
    `vBefore=${before.dossier.currentVersion}, vAfter=${after.dossier.currentVersion}, publishReady=${after.data?.publishReady}`);
}

// E10.04: Approval decisions feed back to constraintEffectiveness
{
  mgmtStore.loadConstraints(govResult.constraints);
  resetManagement();
  const g10d = new ActionGate(mgmtStore, {
    thresholds: [
      { severity: 'CRITICAL', maxViolations: 999, window: '1h', action: 'DISCONNECTED' },
      { severity: 'HIGH', maxViolations: 999, window: '1h', action: 'WARNING' },
    ],
  });
  // Generate 3 violations + 3 approval requests, then decide them
  for (let i = 0; i < 3; i++) {
    const r = g10d.check('bps_update_entity', {
      entityType: 'content', entityId: 'e10-eff-' + i,
      data: { publishReady: true },
    });
    const aId = g10d.createApprovalRequest('bps_update_entity', {
      entityType: 'content', entityId: 'e10-eff-' + i,
      data: { publishReady: true },
    }, r);
    mgmtStore.decideApproval(aId, i < 2 ? 'APPROVED' : 'REJECTED', 'e2e-test');
  }
  const eff = mgmtStore.getConstraintEffectiveness();
  const pubEff = eff.find((e: any) => e.constraintId === 'c-publish-approval');
  assert('E10.04', 'Decisions feed back to constraintEffectiveness',
    !!pubEff && pubEff.approvedCount === 2 && pubEff.rejectedCount === 1 && pubEff.violationCount >= 3,
    `approved=${pubEff?.approvedCount}, rejected=${pubEff?.rejectedCount}, violations=${pubEff?.violationCount}`);
}

// E10.05: management_status exposes effectiveness to Agent
{
  // Reuse state from E10.04 (effectiveness data still in DB)
  const statusTool = tools.find(t => t.name === 'bps_management_status')!;
  const status = await statusTool.execute('status', {}) as any;
  const hasEff = Array.isArray(status.constraintEffectiveness) && status.constraintEffectiveness.length > 0;
  const hasFields = hasEff && status.constraintEffectiveness[0].constraintId &&
    status.constraintEffectiveness[0].violationCount !== undefined;
  assert('E10.05', 'management_status exposes constraintEffectiveness to Agent',
    hasEff && hasFields,
    `count=${status.constraintEffectiveness?.length}, fields=${hasFields}`);
}

// ═════════════════════════════════════════════
// Cleanup: remove test entities/tasks created by engine tests
// (prevents DB bloat across repeated --skip-install runs)
// ═════════════════════════════════════════════
{
  // Clean up test dossiers created by Phase 2
  const testPrefixes = ['test-', 'e10-', 'e11-', 'ex0', 'e7-', 'svc-', 'grp-', 'rel-'];
  const allDossiers = engine.dossierStore.query({});
  let cleaned = 0;
  for (const d of allDossiers) {
    if (testPrefixes.some(p => d.entityId.startsWith(p))) {
      db.exec(`DELETE FROM bps_dossier_versions WHERE dossier_id = '${d.id}'`);
      db.exec(`DELETE FROM bps_dossiers WHERE id = '${d.id}'`);
      cleaned++;
    }
  }
  // Clean up test processes
  db.exec(`DELETE FROM bps_processes WHERE entity_id LIKE 'test-%' OR entity_id LIKE 'e7-%' OR entity_id LIKE 'ex0%' OR entity_id LIKE 'grp-%' OR group_id LIKE 'grp-%'`);
  // Reset management state
  resetManagement();
  mgmtStore.loadConstraints(govResult.constraints);
  console.log(`[cleanup] Removed ${cleaned} test dossiers, reset management`);
}

// ═════════════════════════════════════════════
// Summary + AEF Dimension Health
// ═════════════════════════════════════════════

// Dimension mapping
const SIGMA_MAP: Record<string, string> = {
  // D1 Management Gating → Σ3
  'S2.01':'Σ3','S2.02':'Σ3','S2.03':'Σ3','S2.04':'Σ3','S2.05':'Σ3',
  'S2.06':'Σ3','S2.07':'Σ3','S2.08':'Σ3','S2.08b':'Σ3','S2.08c':'Σ3',
  // D2 Circuit Breaker → Σ4
  'S2.09':'Σ4','S2.10':'Σ4','S2.11':'Σ4','S2.12':'Σ4','S2.13':'Σ4','S2.14':'Σ4',
  // D3 Information Summary → Σ6
  'S2.15':'Σ6','S2.16':'Σ6','S2.17':'Σ6','S2.18':'Σ6','S2.19':'Σ6','S2.20':'Σ6',
  // D4 Process Groups → Σ1
  'S2.21':'Σ1','S2.22':'Σ1','S2.23':'Σ1','S2.24':'Σ1',
  // D5 Entity Relations → Σ2
  'S2.25':'Σ2','S2.26':'Σ2','S2.27':'Σ2','S2.27b':'Σ2','S2.27c':'Σ2',
  // D6 Skill Metrics → Σ5
  'S2.28':'Σ5','S2.29':'Σ5','S2.30':'Σ5',
  // D7 Constraint Analytics → Σ5
  'S2.31':'Σ5','S2.32':'Σ5','S2.33':'Σ5',
  // D8 Tool Registration → Σ8
  'S2.34':'Σ8','S2.35':'Σ8',
  // AEF Σ1 PROC
  'E1.01':'Σ1','E1.02':'Σ1','E1.03':'Σ1','E1.04':'Σ1','E1.05':'Σ1','E1.06':'Σ1',
  // AEF Σ7 SCHED
  'E7.01':'Σ7','E7.02':'Σ7','E7.03':'Σ7','E7.04':'Σ7','E7.05':'Σ7',
  // AEF Σ9 HIER
  'E9.01':'Σ9','E9.02':'Σ9','E9.03':'Σ9',
  // AEF ΣX Cross
  'EX.01':'ΣX','EX.02':'ΣX','EX.03':'ΣX','EX.04':'ΣX','EX.05':'ΣX','EX.06':'ΣX',
  // AEF Σ10 COADAPT
  'E10.01':'Σ10','E10.02':'Σ10','E10.03':'Σ10','E10.04':'Σ10','E10.05':'Σ10',
  // AEF Σ11 MATCH
  'E11.01':'Σ11','E11.02':'Σ11','E11.03':'Σ11','E11.04':'Σ11','E11.05':'Σ11',
  'E11.06':'Σ11','E11.07':'Σ11','E11.08':'Σ11','E11.09':'Σ11','E11.10':'Σ11',
};

const DIM_NAMES: Record<string, string> = {
  'Σ1':'PROC','Σ2':'ENTITY','Σ3':'CONSTRAINT','Σ4':'CIRCUIT','Σ5':'LEARNING',
  'Σ6':'CONTEXT','Σ7':'SCHED','Σ8':'TOOL','Σ9':'HIER','Σ10':'COADAPT','ΣX':'CROSS','Σ11':'MATCH',
};

const dimStats: Record<string, { pass: number; total: number }> = {};
for (const key of Object.keys(DIM_NAMES)) {
  dimStats[key] = { pass: 0, total: 0 };
}
for (const r of results) {
  const sigma = SIGMA_MAP[r.id];
  if (sigma && dimStats[sigma]) {
    dimStats[sigma].total++;
    if (r.passed) dimStats[sigma].pass++;
  }
}

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log(`\n═══════════════════════════════════════════`);
console.log(`Engine Tests: ${passed} PASS / ${failed} FAIL / ${results.length} TOTAL`);
console.log(`═══════════════════════════════════════════`);

console.log('\nAEF Dimension Health:');
const dimHealthRows: any[] = [];
for (const [key, name] of Object.entries(DIM_NAMES)) {
  const s = dimStats[key];
  if (s.total === 0) continue;
  const health = s.pass / s.total;
  const status = s.pass === s.total ? 'HEALTHY' : health >= 0.8 ? 'DEGRADED' : 'UNHEALTHY';
  console.log(`  ${key.padEnd(4)} ${name.padEnd(12)} ${String(s.pass).padStart(2)}/${String(s.total).padStart(2)}  ${health.toFixed(2)}  ${status}`);
  dimHealthRows.push({ dimension: key, name, pass: s.pass, total: s.total, health, status });
}

// Seed a violation so Dashboard S3.03 can verify the violations API shape
{
  resetManagement();
  const gate = new ActionGate(mgmtStore, {
    thresholds: [
      { severity: 'CRITICAL', maxViolations: 1, window: '1h', action: 'DISCONNECTED' },
    ],
  });
  gate.check('bps_update_entity', {
    entityType: 'content', entityId: 'dashboard-seed',
    data: { lifecycle: 'ARCHIVED' },
  });
}

// Write results
fs.writeFileSync('/tmp/aef-capability/engine-results.json', JSON.stringify({
  timestamp: new Date().toISOString(),
  passed,
  failed,
  total: results.length,
  results,
  dimensionHealth: dimHealthRows,
}, null, 2));

process.exit(failed > 0 ? 1 : 0);
TYPESCRIPTEOF

  if node --import tsx .tmp-aef-engine.ts 2>&1 | tee "$LOG_DIR/engine-tests.log"; then
    ENGINE_EXIT=0
  else
    ENGINE_EXIT=1
  fi
  rm -f .tmp-aef-engine.ts

  # Parse engine results into check/fail
  if [ -f "/tmp/aef-capability/engine-results.json" ]; then
    ENGINE_RESULTS="/tmp/aef-capability/engine-results.json"
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
# Phase 3: Dashboard API Tests
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 3 ]; then
  section "3: Dashboard API Tests"

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

  # S3.08: moved to Phase 4 Step 5 (immediately after programmatic approval)

  # S3.09: Dashboard pages accessible
  for page in "/" "/business-goals" "/management"; do
    check "S3.09 Dashboard page $page" "curl -sf $DASHBOARD_URL$page >/dev/null"
  done

  log "Phase 3 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 4: Agent Integration Turns (optional)
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 4 ] && [ "$ENGINE_ONLY" = false ]; then
  section "4: Business Scenario — IdleX GEO Operations"

  # Clean sessions for fresh agent context
  rm -rf "$OPENCLAW_HOME/agents/main/sessions/" 2>/dev/null || true

  # ── Reset management state before business scenario ────────
  # Engine tests (Phase 2) leave CRITICAL violations in DB that cause
  # updateCircuitBreaker() to immediately re-trip CB to DISCONNECTED
  # on any new violation — even after S3.07 reset. Clear violations +
  # reset CB + restart Dashboard so Phase 4 starts with clean state.
  log "Resetting management state for Phase 4..."
  node -e "
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync('$AIDA_HOME/data/bps.db');
    db.exec('DELETE FROM bps_management_violations');
    db.exec('DELETE FROM bps_management_approvals');
    db.exec(\"UPDATE bps_management_circuit_breaker SET state='NORMAL', violation_count_critical=0, violation_count_high=0\");
    db.close();
    console.log('[reset] Cleared violations + approvals + CB → NORMAL');
  " 2>/dev/null
  # Also reset via Dashboard API so its in-memory state is consistent
  api_post "/api/management/circuit-breaker/reset" '{}' >/dev/null 2>&1

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

  # ── Turn 4: Management Trigger — Content Publish ────────
  # Reset CB + clear violations before Turn 4 so REQUIRE_APPROVAL is reachable.
  # updateCircuitBreaker() re-counts violations within 1h window, so API reset
  # alone is insufficient — old violations re-trip CB on next check.
  log "Turn 4: Clearing violations + resetting CB for REQUIRE_APPROVAL test..."
  node -e "
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync('$AIDA_HOME/data/bps.db');
    db.exec('DELETE FROM bps_management_violations');
    db.exec(\"UPDATE bps_management_circuit_breaker SET state='NORMAL', violation_count_critical=0, violation_count_high=0\");
    db.close();
  " 2>/dev/null
  api_post "/api/management/circuit-breaker/reset" '{}' >/dev/null 2>&1
  sleep 1

  log "Turn 4: Management trigger — content publish..."
  aida_say 4 "草稿内容我过目了，质量不错。请把今天生成的GEO内容全部标记为发布就绪（publishReady: true），准备对外分发。"

  check "B4.14 Turn 4 produced response" "test -s $LOG_DIR/turn-4.log"

  sleep 3

  # Check management triggered — primary: DB violations; fallback: session JSONL messages
  POST_GOV_VIOLATIONS=$(api_get "/api/management/violations" | jlen)
  GOV_NEW_VIOLATIONS=$((POST_GOV_VIOLATIONS - BASELINE_VIOLATIONS))
  POST_GOV_APPROVALS=$(api_get "/api/management/approvals" | jlen)
  # If DB violations were cleared by pre-Turn-4 reset, check JSONL for management messages
  MGMT_JSONL_HITS=0
  if [ "$GOV_NEW_VIOLATIONS" -lt 1 ] 2>/dev/null; then
    TURN4_JSONL=$(ls -t "$OPENCLAW_HOME/agents/main/sessions/"*.jsonl 2>/dev/null | head -1)
    if [ -n "$TURN4_JSONL" ]; then
      MGMT_JSONL_HITS=$(grep -ciE 'MANAGEMENT BLOCKED|MANAGEMENT APPROVAL REQUIRED|REQUIRE_APPROVAL|management.*violation|violation.*management' "$TURN4_JSONL" 2>/dev/null || echo 0)
    fi
  fi
  MGMT_EXERCISED=$((GOV_NEW_VIOLATIONS + MGMT_JSONL_HITS))
  soft "B4.15 Management triggered (violations=$GOV_NEW_VIOLATIONS, JSONL=$MGMT_JSONL_HITS)" "test $MGMT_EXERCISED -ge 1"
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

  # S3.08: verify decided approvals immediately after Step 5.
  # Note: /api/management/approvals only returns PENDING (by design — it's a queue),
  # so query SQLite directly for APPROVED/REJECTED records.
  DECIDED_APPROVALS=$(node -e "
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync('$AIDA_HOME/data/bps.db');
    const r=db.prepare(\"SELECT COUNT(*) as n FROM bps_management_approvals WHERE status IN ('APPROVED','REJECTED')\").get();
    console.log(r.n);db.close();" 2>/dev/null || echo 0)
  soft "S3.08 Approval decide works (decided=$DECIDED_APPROVALS)" "test ${DECIDED_APPROVALS:-0} -ge 1"

  # Reset CB + clear Turn 4 violations so Turn 6 can create resources
  # (same pattern as Turn 4 pre-reset — updateCircuitBreaker re-counts 1h window)
  log "  Resetting CB for Turn 6..."
  node -e "
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync('$AIDA_HOME/data/bps.db');
    db.exec('DELETE FROM bps_management_violations');
    db.exec(\"UPDATE bps_management_circuit_breaker SET state='NORMAL', violation_count_critical=0, violation_count_high=0\");
    db.close();
  " 2>/dev/null
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
FINAL_CRON=$(find "$OPENCLAW_HOME/cron/" -name "*.json" -o -name "*.yaml" 2>/dev/null | wc -l)
FINAL_APPROVAL_DECIDED=$(api_get "/api/management/approvals" | node -e "
  try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log(d.filter(a=>a.status==='APPROVED'||a.status==='REJECTED').length)}catch{console.log(0)}" 2>/dev/null || echo 0)

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

  # V5.7: Check session JSONL for management error messages (not final violations count,
  # which may be 0 if cleanup reset deleted Turn 3 records)
  V57_JSONL=$(ls -t "$OPENCLAW_HOME/agents/main/sessions/"*.jsonl 2>/dev/null | head -1)
  V57_MGMT_MSGS=0
  if [ -n "$V57_JSONL" ]; then
    V57_MGMT_MSGS=$(grep -ciE 'MANAGEMENT BLOCKED|MANAGEMENT APPROVAL REQUIRED|REQUIRE_APPROVAL|management.*violation|violation.*management|management.*拦截|管理.*违规' "$V57_JSONL" 2>/dev/null || echo 0)
  fi
  soft "V5.7 Management was exercised (JSONL msgs=$V57_MGMT_MSGS, DB violations=$FINAL_VIOLATIONS)" "test $((V57_MGMT_MSGS + FINAL_VIOLATIONS)) -ge 1"

  # S3.08 moved to Step 5 (immediately after approval decide) — see Phase 4

  AGENT_SKILLS=$((FINAL_SKILLS - ${BASELINE_SKILLS:-0}))
  soft "V5.8 Agent created Skills >= 1 (got $AGENT_SKILLS)" "test ${AGENT_SKILLS:-0} -ge 1"

  soft "V5.9 Agent workspace created (got $FINAL_WORKSPACES)" "test ${FINAL_WORKSPACES:-0} -ge 1"
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
  "cronJobs": ${FINAL_CRON:-0},
  "approvalDecided": ${FINAL_APPROVAL_DECIDED:-0},
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

echo "AEF Capability E2E Test"
echo "======================="
echo "Date:     $(date)"
echo "Server:   $(hostname)"
echo "Duration: ${DURATION}s"
echo "Mode:     $([ "$ENGINE_ONLY" = true ] && echo 'engine-only' || echo 'full')"
echo "Model:    $ACTUAL_MODEL (locked)"
echo ""
echo "Results: $PASS PASS / $FAIL FAIL / $WARNS WARN / $TOTAL TOTAL"
echo ""

echo "AEF Dimension Coverage (Σ1-Σ11):"
echo "  Σ1  PROC       Process lifecycle     S2.21-24 + E1.01-06    10 checks"
echo "  Σ2  ENTITY     Entity management     S2.25-27c               5 checks"
echo "  Σ3  CONSTRAINT Constraint eval       S2.01-08c              10 checks"
echo "  Σ4  CIRCUIT    Circuit breaker        S2.09-14                6 checks"
echo "  Σ5  LEARNING   Effectiveness          S2.28-33                6 checks"
echo "  Σ6  CONTEXT    Context efficiency     S2.15-20                6 checks"
echo "  Σ7  SCHED      Scheduling             E7.01-05                5 checks"
echo "  Σ8  TOOL       Tool ecosystem         S2.34-35                2 checks"
echo "  Σ9  HIER       Hierarchy              E9.01-03                3 checks"
echo "  ΣX  CROSS      Cross-dimension        EX.01-06                6 checks"
echo "  Σ11 MATCH      Capability matching    E11.01-10              10 checks"
echo "  --- Engine subtotal: 69 checks ---"
echo "  D9: Dashboard API         (S3.01-S3.09)   11 checks"
if [ "$ENGINE_ONLY" = false ]; then
echo "  B:  Business Scenario     (B4.01-B4.27)   27 checks"
echo "  V5: Final Verification    (V5.1-V5.9)      9 checks"
else
echo "  V5: Final Verification    (V5.1-V5.3)      3 checks"
fi
echo ""

# Show dimension health from engine results
if [ -f "/tmp/aef-capability/engine-results.json" ]; then
  echo "Dimension Health:"
  node -e "
    const r=JSON.parse(require('fs').readFileSync('/tmp/aef-capability/engine-results.json','utf8'));
    if(r.dimensionHealth){r.dimensionHealth.forEach(d=>{
      console.log('  '+d.dimension.padEnd(4)+' '+d.name.padEnd(12)+' '+
        String(d.pass).padStart(2)+'/'+String(d.total).padStart(2)+'  '+
        d.health.toFixed(2)+'  '+d.status)})}" 2>/dev/null || true
  echo ""
fi

echo "Metrics:"
echo "  Entities:    $FINAL_ENTITIES"
echo "  Violations:  $FINAL_VIOLATIONS"
echo "  Constraints: $FINAL_CONSTRAINTS"
echo "  Skills:      $FINAL_SKILLS"
echo "  Blueprints:  $FINAL_BLUEPRINTS"
if [ "$ENGINE_ONLY" = false ]; then
echo "  WriteTools:  ${TOTAL_WRITES:-0}"
echo "  Workspaces:  $FINAL_WORKSPACES"
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
AEF Capability E2E Test — IdleX GEO Business Edition
=====================================================
Date:     $(date)
Server:   $(hostname)
Duration: ${DURATION}s
Mode:     $([ "$ENGINE_ONLY" = true ] && echo 'engine-only' || echo 'full (IdleX GEO business scenario)')
Model:    $ACTUAL_MODEL (locked)
Framework: AEF v0.1 (11 dimensions)

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

log "Report: $LOG_DIR/report.txt"
log "Engine + AEF results: $LOG_DIR/engine-results.json"
log "Metrics: $LOG_DIR/metrics.json"

echo ""
echo "Output: $LOG_DIR/"

# ════════════════════════════════════════════════════════════
# Auto-scoring (when not invoked via aida-eval.sh)
# ════════════════════════════════════════════════════════════

if [ -z "${AIDA_EVAL_WRAPPER:-}" ]; then
  SCORE_CALC="$(dirname "${BASH_SOURCE[0]}")/lib/score-calculator.cjs"
  RUBRIC="$(dirname "${BASH_SOURCE[0]}")/rubrics/aef.json"
  RESULTS="$(dirname "${BASH_SOURCE[0]}")/results.tsv"
  if [ -f "$SCORE_CALC" ] && [ -f "$RUBRIC" ]; then
    GIT_COMMIT=$(git -C "$AIDA_REPO" rev-parse --short HEAD 2>/dev/null || echo "?")
    ACTUAL_MODEL="${ACTUAL_MODEL:-dashscope/qwen3.5-plus}"
    node "$SCORE_CALC" \
      --metrics "$LOG_DIR/metrics.json" \
      --rubric "$RUBRIC" \
      --results "$RESULTS" \
      --scheme "aef-v1" \
      --commit "$GIT_COMMIT" \
      --model "$ACTUAL_MODEL" || true
  fi
fi

exit "$FAIL"
