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
name: "Structural Capability Test"
projectId: "structural-test"
description: "AIDA structural capability E2E test project"
language: "zh"
blueprints: []
knowledge: []
YAML

  # 1b. governance.yaml — 3 constraints covering different verdicts
  log "Creating governance.yaml..."
  cat > "$AIDA_HOME/governance.yaml" << 'YAML'
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

  # 1c. Seed entities, blueprint, tasks, governance via TypeScript
  log "Seeding test data via TypeScript..."
  cd "$AIDA_REPO"

  cat > .tmp-structural-seed.ts << 'TYPESCRIPT'
import path from 'node:path';
import fs from 'node:fs';
import { createBpsEngine, createDatabase, GovernanceStore, loadGovernanceFile } from './src/index.js';

const HOME = process.env.HOME || '/root';
const DB_PATH = path.resolve(HOME, '.aida', 'data', 'bps.db');
const GOV_PATH = path.resolve(HOME, '.aida', 'governance.yaml');

console.log(`[seed] DB: ${DB_PATH}`);
const db = createDatabase(DB_PATH);
const engine = createBpsEngine({ db });
const { dossierStore, blueprintStore, processStore } = engine;

// --- Seed 5 store entities ---
const stores = [
  { id: 'store-cs-ktv-01', nameCN: '声临其境KTV', city: '长沙', type: 'ktv' },
  { id: 'store-cs-tea-01', nameCN: '悠然茶室', city: '长沙', type: 'tearoom' },
  { id: 'store-cs-mj-01', nameCN: '棋乐无穷', city: '长沙', type: 'mahjong' },
  { id: 'store-wh-ktv-01', nameCN: '音乐盒KTV', city: '武汉', type: 'ktv' },
  { id: 'store-wh-tea-01', nameCN: '静享茶空间', city: '武汉', type: 'tearoom' },
];

for (const s of stores) {
  const d = dossierStore.getOrCreate('store', s.id);
  dossierStore.commit(d.id, { nameCN: s.nameCN, city: s.city, spaceType: s.type, status: 'active' }, {
    committedBy: 'structural-test:seed',
    message: `Seed store: ${s.nameCN}`,
  });
  console.log(`[seed] + store/${s.id}`);
}

// --- Seed 1 action-plan entity ---
const apDossier = dossierStore.getOrCreate('action-plan', 'ap-structural-test');
dossierStore.commit(apDossier.id, {
  title: 'Structural Test Action Plan',
  items: [
    { id: 'item-1', description: 'Test governance gating', status: 'pending' },
    { id: 'item-2', description: 'Test batch update', status: 'pending' },
    { id: 'item-3', description: 'Test entity relations', status: 'pending' },
  ],
}, { committedBy: 'structural-test:seed', message: 'Seed action plan' });
console.log('[seed] + action-plan/ap-structural-test');

// --- Seed 1 strategy entity ---
const stDossier = dossierStore.getOrCreate('strategy', 'st-geo-master');
dossierStore.commit(stDossier.id, {
  title: 'GEO Master Strategy',
  platforms: ['doubao', 'qianwen', 'yuanbao'],
  majorChange: false,
}, { committedBy: 'structural-test:seed', message: 'Seed strategy' });
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

// --- Load governance ---
if (fs.existsSync(GOV_PATH)) {
  const govStore = new GovernanceStore(db);
  const result = loadGovernanceFile(GOV_PATH);
  if (result.errors.length > 0) console.log(`[seed] WARN: ${result.errors.join(', ')}`);
  govStore.loadConstraints(result.constraints);
  console.log(`[seed] + ${result.constraints.length} governance constraints`);
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

  GC=$(api_get "/api/governance/constraints" | jlen)
  check "V1.2 >= 3 governance constraints (got $GC)" "test $GC -ge 3"

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
  GovernanceStore,
  SkillMetricsStore,
} from './src/index.js';
import { ActionGate } from './src/governance/action-gate.js';
import { loadGovernanceFile } from './src/governance/governance-loader.js';
import { GATED_WRITE_TOOLS, DEFAULT_SCOPE_WRITE_TOOLS } from './src/governance/constants.js';
import { createBpsTools } from './src/integration/tools.js';

const HOME = process.env.HOME || '/root';
const DB_PATH = path.resolve(HOME, '.aida', 'data', 'bps.db');
const GOV_PATH = path.resolve(HOME, '.aida', 'governance.yaml');
const SKILLS_DIR = path.resolve(HOME, '.openclaw', 'workspace', 'skills');

const db = createDatabase(DB_PATH);
const engine = createBpsEngine({ db });
const govStore = new GovernanceStore(db);
const skillMetrics = new SkillMetricsStore(db);

// Load governance constraints
const govResult = loadGovernanceFile(GOV_PATH);
govStore.loadConstraints(govResult.constraints);

// Create ActionGate with test-friendly config
const gate = new ActionGate(govStore, {
  thresholds: [
    { severity: 'CRITICAL', maxViolations: 1, window: '1h', action: 'DISCONNECTED' },
    { severity: 'HIGH', maxViolations: 5, window: '1h', action: 'RESTRICTED' },
    { severity: 'HIGH', maxViolations: 2, window: '1h', action: 'WARNING' },
  ],
  cooldown: '1s', // Short cooldown for test
});

// Create tools with governance
const tools = createBpsTools({
  tracker: engine.tracker,
  blueprintStore: engine.blueprintStore,
  processStore: engine.processStore,
  dossierStore: engine.dossierStore,
  skillsDir: SKILLS_DIR,
  governanceGate: gate,
  governanceStore: govStore,
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

// Helper: fully reset governance state (CB + violations + approvals)
function resetGovernance() {
  db.exec('DELETE FROM bps_governance_violations');
  db.exec('DELETE FROM bps_governance_approvals');
  govStore.resetCircuitBreaker();
}

// ═════════════════════════════════════════════
// D1: Governance Gating
// ═════════════════════════════════════════════
console.log('\n--- D1: Governance Gating ---');

// S2.01: All 9 GATED_WRITE_TOOLS are defined
assert('S2.01', 'GATED_WRITE_TOOLS has 9 entries',
  GATED_WRITE_TOOLS.length === 9,
  `got ${GATED_WRITE_TOOLS.length}: ${GATED_WRITE_TOOLS.join(', ')}`);

// S2.02: Read-only tool bypasses governance
{
  const result = gate.check('bps_list_services', {});
  assert('S2.02', 'Read-only tool bypasses governance',
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
resetGovernance();

// S2.04: REQUIRE_APPROVAL verdict for HIGH constraint
{
  const gate2 = new ActionGate(govStore); // fresh gate, reset state
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
  resetGovernance();
  const gate3 = new ActionGate(govStore);
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
  resetGovernance();
  const gate4 = new ActionGate(govStore);
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
  resetGovernance();
  const gate5 = new ActionGate(govStore);
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
  const newTools = ['bps_batch_update', 'bps_load_blueprint', 'bps_register_agent', 'bps_load_governance'];
  const allPresent = newTools.every(t => GATED_WRITE_TOOLS.includes(t as any));
  assert('S2.08', 'New tools (batch_update, load_blueprint, register_agent, load_governance) are gated',
    allPresent,
    `missing: ${newTools.filter(t => !GATED_WRITE_TOOLS.includes(t as any)).join(', ') || 'none'}`);
}

// S2.08b: Governance wrapper throws Error (not returns {success:false})
{
  resetGovernance();
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
  assert('S2.08b', 'Governance BLOCK throws Error (not {success:false})',
    threwError && errorMsg.includes('GOVERNANCE BLOCKED'),
    `threw=${threwError}, msg contains GOVERNANCE BLOCKED: ${errorMsg.includes('GOVERNANCE BLOCKED')}`);
}

// S2.08c: REQUIRE_APPROVAL throws Error with approval ID
{
  resetGovernance();
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
    threwError && errorMsg.includes('GOVERNANCE APPROVAL REQUIRED') && errorMsg.includes('Approval ID:'),
    `threw=${threwError}`);
}

// ═════════════════════════════════════════════
// D2: Circuit Breaker
// ═════════════════════════════════════════════
console.log('\n--- D2: Circuit Breaker ---');

// S2.09: CRITICAL violation → DISCONNECTED
{
  resetGovernance();
  const gateC = new ActionGate(govStore);
  gateC.check('bps_update_entity', {
    entityType: 'content', entityId: 'cb-test-1',
    data: { lifecycle: 'ARCHIVED' },
  });
  const cb = govStore.getCircuitBreakerState();
  assert('S2.09', 'CRITICAL violation → DISCONNECTED',
    cb.state === 'DISCONNECTED',
    `state=${cb.state}`);
}

// S2.10: DISCONNECTED blocks all writes immediately
{
  const gateD = new ActionGate(govStore); // inherits DISCONNECTED state
  const result = gateD.check('bps_create_task', { serviceId: 'svc-probe' });
  assert('S2.10', 'DISCONNECTED blocks all writes immediately',
    result.verdict === 'BLOCK' && result.circuitBreakerState === 'DISCONNECTED',
    `verdict=${result.verdict}, cbState=${result.circuitBreakerState}`);
}

// S2.11: HIGH violations accumulate → WARNING
{
  resetGovernance();
  const gateH = new ActionGate(govStore);
  // Trigger 2 HIGH violations (threshold for WARNING)
  gateH.check('bps_update_entity', { entityType: 'content', entityId: 'high-1', data: { publishReady: true } });
  gateH.check('bps_update_entity', { entityType: 'content', entityId: 'high-2', data: { publishReady: true } });
  const cb = govStore.getCircuitBreakerState();
  assert('S2.11', 'HIGH violations → WARNING',
    cb.state === 'WARNING',
    `state=${cb.state}`);
}

// S2.12: Cooldown recovery auto-downgrades
{
  resetGovernance();
  // Set state to WARNING manually
  govStore.updateCircuitBreaker('WARNING', { critical: 0, high: 0, windowStart: new Date().toISOString() });

  // Backdate lastStateChange to trigger cooldown
  // Using a gate with 1s cooldown
  const gateR = new ActionGate(govStore, {
    thresholds: [
      { severity: 'CRITICAL', maxViolations: 1, window: '1h', action: 'DISCONNECTED' },
      { severity: 'HIGH', maxViolations: 5, window: '1h', action: 'RESTRICTED' },
    ],
    cooldown: '1s',
  });

  // Backdate: set lastStateChange to 2 seconds ago
  const twoSecsAgo = new Date(Date.now() - 2000).toISOString();
  govStore.updateCircuitBreaker('WARNING', { critical: 0, high: 0, windowStart: twoSecsAgo });
  // Manually update last_state_change in the DB
  db.exec(`UPDATE bps_governance_circuit_breaker SET last_state_change = '${twoSecsAgo}' WHERE id = 'singleton'`);

  // Next check should trigger cooldown: WARNING → NORMAL
  const result = gateR.check('bps_update_entity', {
    entityType: 'store', entityId: 'cooldown-test', data: { status: 'ok' },
  });
  const cb = govStore.getCircuitBreakerState();
  assert('S2.12', 'Cooldown recovery: WARNING → NORMAL',
    cb.state === 'NORMAL',
    `state=${cb.state}, verdict=${result.verdict}`);
}

// S2.13: No recovery if new violations in window
{
  resetGovernance();
  const gateNR = new ActionGate(govStore, {
    thresholds: [
      { severity: 'CRITICAL', maxViolations: 1, window: '1h', action: 'DISCONNECTED' },
      { severity: 'HIGH', maxViolations: 2, window: '1h', action: 'WARNING' },
    ],
    cooldown: '1s',
  });
  // Trigger WARNING via 2 HIGH violations
  gateNR.check('bps_update_entity', { entityType: 'content', entityId: 'nr-1', data: { publishReady: true } });
  gateNR.check('bps_update_entity', { entityType: 'content', entityId: 'nr-2', data: { publishReady: true } });
  const cbBefore = govStore.getCircuitBreakerState();

  // Backdate, but violations exist in window, so no recovery
  const twoSecsAgo = new Date(Date.now() - 2000).toISOString();
  db.exec(`UPDATE bps_governance_circuit_breaker SET last_state_change = '${twoSecsAgo}' WHERE id = 'singleton'`);

  gateNR.check('bps_update_entity', { entityType: 'store', entityId: 'nr-check', data: { status: 'ok' } });
  const cbAfter = govStore.getCircuitBreakerState();
  assert('S2.13', 'No recovery if violations exist in window',
    cbAfter.state === 'WARNING',
    `before=${cbBefore.state}, after=${cbAfter.state}`);
}

// S2.14: Oscillation detection
{
  resetGovernance();
  const gateOsc = new ActionGate(govStore, {
    thresholds: [
      { severity: 'CRITICAL', maxViolations: 1, window: '1h', action: 'DISCONNECTED' },
    ],
    cooldown: '1s',
  });

  // Simulate rapid oscillations by:
  // Repeatedly setting WARNING, backdating, and triggering recovery
  let detected = false;
  govStore.on('governance:oscillation_detected', () => { detected = true; });

  for (let i = 0; i < 5; i++) {
    govStore.updateCircuitBreaker('WARNING', { critical: 0, high: 0, windowStart: new Date().toISOString() });
    const ago = new Date(Date.now() - 2000).toISOString();
    db.exec(`UPDATE bps_governance_circuit_breaker SET last_state_change = '${ago}' WHERE id = 'singleton'`);
    gateOsc.check('bps_update_entity', { entityType: 'store', entityId: `osc-${i}`, data: { x: 1 } });
  }

  assert('S2.14', 'Oscillation detection (>3 transitions/1h → lock)',
    detected,
    `oscillation_detected event fired: ${detected}`);
  govStore.removeAllListeners('governance:oscillation_detected');
}

// ═════════════════════════════════════════════
// D3: Information Summary Layer
// ═════════════════════════════════════════════
console.log('\n--- D3: Information Summary ---');

resetGovernance();

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
resetGovernance();
{
  const analyticsGate = new ActionGate(govStore);
  // Trigger c-publish-approval (REQUIRE_APPROVAL) 3 times
  analyticsGate.check('bps_update_entity', { entityType: 'content', entityId: 'analytics-1', data: { publishReady: true } });
  analyticsGate.check('bps_update_entity', { entityType: 'content', entityId: 'analytics-2', data: { publishReady: true } });
  analyticsGate.check('bps_update_entity', { entityType: 'content', entityId: 'analytics-3', data: { publishReady: true } });
}

// S2.31: getConstraintEffectiveness returns stats
{
  const effectiveness = govStore.getConstraintEffectiveness();
  assert('S2.31', 'getConstraintEffectiveness returns per-constraint stats',
    Array.isArray(effectiveness) && effectiveness.length >= 3,
    `constraints: ${effectiveness.length}`);
}

// S2.32: Stats include correct fields
{
  const effectiveness = govStore.getConstraintEffectiveness();
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
  const effectiveness = govStore.getConstraintEffectiveness();
  const publishConstraint = effectiveness.find(e => e.constraintId === 'c-publish-approval');
  assert('S2.33', 'Constraint effectiveness reflects actual violations',
    publishConstraint !== undefined && publishConstraint.violationCount > 0,
    `c-publish-approval violations: ${publishConstraint?.violationCount}`);
}

// ═════════════════════════════════════════════
// D8: Tool Registration
// ═════════════════════════════════════════════
console.log('\n--- D8: Tool Registration ---');

// S2.34: Total tool count with governance
{
  assert('S2.34', 'Total tools = 17 (15 base + 2 governance)',
    tools.length === 17,
    `got ${tools.length}: ${tools.map(t => t.name).join(', ')}`);
}

// S2.35: DEFAULT_SCOPE_WRITE_TOOLS excludes bps_load_governance
{
  assert('S2.35', 'DEFAULT_SCOPE_WRITE_TOOLS excludes bps_load_governance',
    !DEFAULT_SCOPE_WRITE_TOOLS.includes('bps_load_governance' as any)
    && DEFAULT_SCOPE_WRITE_TOOLS.length === GATED_WRITE_TOOLS.length - 1,
    `count: ${DEFAULT_SCOPE_WRITE_TOOLS.length} (GATED: ${GATED_WRITE_TOOLS.length})`);
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

  # S3.01: Governance status endpoint shape
  GOV_STATUS=$(api_get "/api/governance/status" 2>/dev/null || echo "{}")
  HAS_EFFECTIVENESS=$(echo "$GOV_STATUS" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(Array.isArray(d.constraintEffectiveness)?'yes':'no')}catch{console.log('no')}" 2>/dev/null)
  check "S3.01 Governance status has constraintEffectiveness[]" "test '$HAS_EFFECTIVENESS' = 'yes'"

  # S3.02: Circuit breaker state is string
  CB_STATE=$(echo "$GOV_STATUS" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(typeof d.circuitBreakerState)}catch{console.log('undefined')}" 2>/dev/null)
  check "S3.02 circuitBreakerState is string" "test '$CB_STATE' = 'string'"

  # S3.03: Violations array with severity
  VIOLATIONS=$(api_get "/api/governance/violations?limit=5" 2>/dev/null || echo "[]")
  HAS_SEV=$(echo "$VIOLATIONS" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(d.length>0&&d[0].severity?'yes':'no')}catch{console.log('no')}" 2>/dev/null)
  check "S3.03 Violations array has severity field" "test '$HAS_SEV' = 'yes'"

  # S3.04: Constraints array with scope object
  CONSTRAINTS=$(api_get "/api/governance/constraints" 2>/dev/null || echo "[]")
  HAS_SCOPE=$(echo "$CONSTRAINTS" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(d.length>0&&d[0].scope?'yes':'no')}catch{console.log('no')}" 2>/dev/null)
  check "S3.04 Constraints array has scope object" "test '$HAS_SCOPE' = 'yes'"

  # S3.05: Approvals array with status
  APPROVALS=$(api_get "/api/governance/approvals" 2>/dev/null || echo "[]")
  APP_COUNT=$(echo "$APPROVALS" | jlen)
  # May be 0 if engine tests didn't create persistent approvals via the dashboard
  soft "S3.05 Approvals endpoint returns array (count=$APP_COUNT)" "echo '$APPROVALS' | node -e 'JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"))'"

  # S3.06: Entities count
  ENTITY_COUNT=$(api_get "/api/entities" | jlen)
  check "S3.06 Entity count >= 7 (got $ENTITY_COUNT)" "test $ENTITY_COUNT -ge 7"

  # S3.07: Circuit breaker reset endpoint returns valid JSON
  RESET_OK=$(api_post "/api/governance/circuit-breaker/reset" '{}' 2>/dev/null | node -e "
    try{JSON.parse(require('fs').readFileSync(0,'utf8'));console.log('yes')}catch{console.log('no')}" 2>/dev/null || echo 'no')
  check "S3.07 Circuit breaker reset returns valid JSON" "test '$RESET_OK' = 'yes'"

  # S3.08: Approvals decide endpoint
  FIRST_APPROVAL_ID=$(api_get "/api/governance/approvals" 2>/dev/null | node -e "
    try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    const p=d.find(a=>a.status==='PENDING');
    console.log(p?p.id:'')}catch{console.log('')}" 2>/dev/null)
  if [ -n "$FIRST_APPROVAL_ID" ]; then
    DECIDE_OK=$(api_post "/api/governance/approvals/$FIRST_APPROVAL_ID/decide" '{"decision":"REJECTED","reason":"structural test"}' 2>/dev/null | node -e "
      try{JSON.parse(require('fs').readFileSync(0,'utf8'));console.log('yes')}catch{console.log('no')}" 2>/dev/null || echo 'no')
    check "S3.08 Approvals decide endpoint works" "test '$DECIDE_OK' = 'yes'"
  else
    soft "S3.08 Approvals decide endpoint (no pending approvals to test)" "false"
  fi

  # S3.09: Dashboard pages accessible
  for page in "/" "/business-goals" "/governance"; do
    check "S3.09 Dashboard page $page" "curl -sf $DASHBOARD_URL$page >/dev/null"
  done

  log "Phase 3 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 4: Agent Integration Turns (optional)
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 4 ] && [ "$ENGINE_ONLY" = false ]; then
  section "4: Agent Integration Turns"

  # Clean sessions for fresh agent context
  rm -rf "$OPENCLAW_HOME/agents/main/sessions/" 2>/dev/null || true

  # Turn 1: Information summary (scan_work + brief mode)
  aida_say 1 'Use bps_scan_work to check the current work landscape. Then use bps_query_entities with brief=true to get a compact entity listing. Report what you find, including the total counts and showing counts.'

  check "V4.1 Turn 1 produced response" "test -s $LOG_DIR/turn-1.log"
  soft  "V4.2 Response mentions summary/total" "grep -qiE 'total|summary|showing|open|entities' $LOG_DIR/turn-1.log"

  # Turn 2: Entity relations + governance status
  aida_say 2 'Check the entity store-cs-ktv-01 — it should have relations to other entities. Also check governance status and report the constraint effectiveness analytics.'

  check "V4.3 Turn 2 produced response" "test -s $LOG_DIR/turn-2.log"
  soft  "V4.4 Response mentions relations" "grep -qiE 'relation|depends_on|references|related' $LOG_DIR/turn-2.log"
  soft  "V4.5 Response mentions effectiveness" "grep -qiE 'effectiveness|violation|constraint|analytics' $LOG_DIR/turn-2.log"

  # Turn 3: Governance trigger
  aida_say 3 'Update entity content/test-publish-check with data {publishReady: true, title: "Test Content"}. This should trigger governance.'

  check "V4.6 Turn 3 produced response" "test -s $LOG_DIR/turn-3.log"
  soft  "V4.7 Response mentions governance/approval" "grep -qiE 'governance|approval|blocked|REQUIRE_APPROVAL|审批' $LOG_DIR/turn-3.log"

  # Verify governance triggered via API
  VIO_COUNT=$(api_get "/api/governance/violations" | jlen)
  soft "V4.8 Governance violations exist after Turn 3 (got $VIO_COUNT)" "test $VIO_COUNT -ge 1"

  log "Phase 4 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 5: Final Verification + Report
# ════════════════════════════════════════════════════════════

section "5: Final Verification + Report"

# Collect final metrics snapshot
log "Collecting final metrics..."

FINAL_ENTITIES=$(api_get "/api/entities" | jlen)
FINAL_VIOLATIONS=$(api_get "/api/governance/violations" | jlen)
FINAL_CONSTRAINTS=$(api_get "/api/governance/constraints" | jlen)
FINAL_SKILLS=$(find "$OPENCLAW_HOME/workspace/skills/" -name SKILL.md 2>/dev/null | wc -l)
FINAL_BLUEPRINTS=$(find "$AIDA_HOME/blueprints/" -name "*.yaml" 2>/dev/null | wc -l)

check "V5.1 Final entity count stable (got $FINAL_ENTITIES)" "test $FINAL_ENTITIES -ge 7"
check "V5.2 Governance constraints loaded (got $FINAL_CONSTRAINTS)" "test $FINAL_CONSTRAINTS -ge 3"
check "V5.3 Skills intact (got $FINAL_SKILLS)" "test $FINAL_SKILLS -ge 7"

# Entity breakdown
log "Entity breakdown:"
api_get "/api/entities" | node -e "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  const t={};d.forEach(e=>{const k=e.entityType||'?';t[k]=(t[k]||0)+1});
  console.log('  Total: '+d.length);
  Object.entries(t).sort().forEach(([k,v])=>console.log('  '+k+': '+v))
" 2>/dev/null || true

# Write metrics JSON
cat > "$LOG_DIR/metrics.json" << METRICS
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "entities": $FINAL_ENTITIES,
  "violations": $FINAL_VIOLATIONS,
  "constraints": $FINAL_CONSTRAINTS,
  "skills": $FINAL_SKILLS,
  "blueprints": $FINAL_BLUEPRINTS,
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
echo "  D1: Governance Gating     (S2.01-S2.08c)  10 checks"
echo "  D2: Circuit Breaker       (S2.09-S2.14)    6 checks"
echo "  D3: Information Summary   (S2.15-S2.20)    6 checks"
echo "  D4: Process Groups        (S2.21-S2.24)    4 checks"
echo "  D5: Entity Relations      (S2.25-S2.27c)   5 checks"
echo "  D6: Skill Metrics         (S2.28-S2.30)    3 checks"
echo "  D7: Constraint Analytics  (S2.31-S2.33)    3 checks"
echo "  D8: Tool Registration     (S2.34-S2.35)    2 checks"
echo "  D9: Dashboard API         (S3.01-S3.09)   11 checks"
if [ "$ENGINE_ONLY" = false ]; then
echo "  Agent Integration         (V4.1-V4.8)"
fi
echo ""

echo "Metrics:"
echo "  Entities:    $FINAL_ENTITIES"
echo "  Violations:  $FINAL_VIOLATIONS"
echo "  Constraints: $FINAL_CONSTRAINTS"
echo "  Skills:      $FINAL_SKILLS"
echo "  Blueprints:  $FINAL_BLUEPRINTS"
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
AIDA Structural Capability E2E Test
====================================
Date:     $(date)
Server:   $(hostname)
Duration: ${DURATION}s
Mode:     $([ "$ENGINE_ONLY" = true ] && echo 'engine-only' || echo 'full')

Results: $PASS PASS / $FAIL FAIL / $WARNS WARN / $TOTAL TOTAL

Entities:    $FINAL_ENTITIES
Violations:  $FINAL_VIOLATIONS
Constraints: $FINAL_CONSTRAINTS
Skills:      $FINAL_SKILLS
Blueprints:  $FINAL_BLUEPRINTS

Logs: $LOG_DIR/
Dashboard: $DASHBOARD_URL
REPORT

log "Report saved: $LOG_DIR/report.txt"
log "Engine results: $LOG_DIR/engine-results.json"
log "Metrics: $LOG_DIR/metrics.json"

echo ""
echo "Output: $LOG_DIR/"

exit "$FAIL"
