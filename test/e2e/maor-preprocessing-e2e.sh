#!/usr/bin/env bash
# ============================================================
# MAOr Preprocessing E2E Test
# ============================================================
# Evaluates "raw materials → preprocessing → AIDA modeling" pipeline quality.
# 7 turns, 37 checkpoints (8 HARD + 29 SOFT), 6 scoring dimensions.
#
# Usage:
#   bash test/e2e/maor-preprocessing-e2e.sh [--skip-install] [--phase N]
#
# Test plan: test/e2e/maor-preprocessing-e2e.md
# Run on: root@47.236.109.62
# ============================================================

set -euo pipefail

# -- Configuration --
AIDA_HOME="${AIDA_HOME:-$HOME/.aida}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
AIDA_REPO="${AIDA_REPO:-$HOME/aida}"
DASHBOARD_URL="http://localhost:3456"
LOG_DIR="/tmp/maor-preprocessing-e2e"
AGENT_TIMEOUT=300

MAOR_CONTEXT="${AIDA_REPO}/.test-data/maor/processed"

SKIP_INSTALL=false
START_PHASE=0
PASS=0; FAIL=0; WARNS=0; TOTAL=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-install) SKIP_INSTALL=true; shift ;;
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
jlen()     { node -e "try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(Array.isArray(d)?d.length:0)}catch{console.log(0)}"; }

# Count entities of a given type via Dashboard API
entity_count() {
  local etype="$1"
  api_get "/api/entities?entityType=$etype" | jlen
}

aida_say() {
  local turn="$1"; shift; local msg="$1"
  local start_ts=$(date +%s)
  log "Turn $turn: sending to Aida..."
  local out="$LOG_DIR/turn-$turn.log"
  timeout "$AGENT_TIMEOUT" openclaw agent --agent main --message "$msg" > "$out" 2>&1 || true
  local end_ts=$(date +%s)
  local dur=$((end_ts - start_ts))
  echo -e "${CYAN}--- Aida response (turn $turn, ${dur}s, first 30 lines) ---${NC}"
  head -30 "$out"
  echo -e "${CYAN}--- (full log: $out, $(wc -l < "$out") lines total) ---${NC}\n"

  # Record timing for behavior.json
  echo "$turn $dur $(wc -l < "$out")" >> "$LOG_DIR/turn-timing.txt"
}

# ════════════════════════════════════════════════════════════
# Phase 0: Clean Environment + Install
# ════════════════════════════════════════════════════════════

if [[ "${BENCHMARK_MODE:-}" == "1" ]]; then
  section "0: Environment Setup (BENCHMARK_MODE — skipped, verifying)"

elif [ "$SKIP_INSTALL" = false ] && [ "$START_PHASE" -le 0 ]; then
  section "0: Clean Environment + Install"

  log "Stopping existing services..."
  systemctl stop bps-dashboard 2>/dev/null || true
  systemctl stop openclaw-gateway 2>/dev/null || true
  pkill -f "openclaw gateway" 2>/dev/null || true
  sleep 3

  log "Backing up ~/.aida/ ..."
  [ -d "$AIDA_HOME" ] && mv "$AIDA_HOME" "$AIDA_HOME.bak.$(date +%Y%m%d%H%M%S)"

  log "Wiping OpenClaw state..."
  rm -rf "$OPENCLAW_HOME/workspace/" 2>/dev/null || true
  rm -rf "$OPENCLAW_HOME"/workspace-* 2>/dev/null || true
  rm -rf "$OPENCLAW_HOME/agents/main/sessions/" 2>/dev/null || true
  rm -rf "$OPENCLAW_HOME/cron/" 2>/dev/null || true
  find "$OPENCLAW_HOME" -name "sessions.json" -o -name "*.session" 2>/dev/null | while read -r sf; do
    rm -f "$sf"
  done

  log "Loading API keys..."
  for envfile in \
    "$AIDA_REPO/.dev/model-api-keys.env" \
    "$AIDA_REPO/.dev/openrouter-api.env" \
    "$AIDA_REPO/.dev/google-gemini-api.env"; do
    [ -f "$envfile" ] && source "$envfile" 2>/dev/null || true
  done

  log "Updating repo..."
  cd "$AIDA_REPO"
  git pull --no-recurse-submodules 2>&1 | tail -3 || true

  log "Running install-aida.sh..."
  bash deploy/install-aida.sh

  log "Starting OpenClaw gateway..."
  openclaw gateway start 2>/dev/null || warn_ "Gateway start returned non-zero"

  log "Waiting for gateway health..."
  for i in $(seq 1 12); do
    if openclaw gateway status 2>/dev/null | grep -qi "running\|healthy\|active"; then
      log "  Gateway healthy after ${i}x5s"
      break
    fi
    sleep 5
  done
fi

# V0: Post-install checks
log "V0: Verifying installation..."
check "V0.1 ~/.aida/blueprints/"  "test -d $AIDA_HOME/blueprints"
check "V0.2 ~/.aida/data/"        "test -d $AIDA_HOME/data"
check "V0.3 ~/.aida/context/"     "test -d $AIDA_HOME/context"
check "V0.4 SOUL.md"              "test -f $OPENCLAW_HOME/workspace/SOUL.md"
check "V0.5 AGENTS.md"            "test -f $OPENCLAW_HOME/workspace/AGENTS.md"
check "V0.6 TOOLS.md"             "test -f $OPENCLAW_HOME/workspace/TOOLS.md"
check "V0.7 Dashboard /api/overview" "curl -sf $DASHBOARD_URL/api/overview >/dev/null"

log "Phase 0 complete."

# ════════════════════════════════════════════════════════════
# Phase 1: Deploy MAOr Context + Seed
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 1 ]; then
  section "1: Deploy MAOr Context"

  # 1a. project.yaml
  log "Creating project.yaml..."
  cat > "$AIDA_HOME/project.yaml" << 'YAML'
version: "1.1"
name: "MAOr Medical Aesthetics"
projectId: "maor"
description: "广州颜青医疗美容诊所运营管理"
language: "zh"
blueprints: []
knowledge: []
YAML

  # 1b. Deploy preprocessed context files
  log "Deploying preprocessed context docs..."
  if [ -d "$MAOR_CONTEXT" ]; then
    cp "$MAOR_CONTEXT"/*.md "$AIDA_HOME/context/" 2>/dev/null || true
    DOC_COUNT=$(ls "$AIDA_HOME/context/"*.md 2>/dev/null | wc -l)
    log "  Deployed $DOC_COUNT context files from $MAOR_CONTEXT"
  else
    fail "CRITICAL: MAOr preprocessed docs not found at $MAOR_CONTEXT"
    exit 1
  fi

  # 1c. No seed data — MAOr test relies entirely on Aida modeling from context/
  # No management seed either — Aida should create management.yaml from compliance.md

  # Restart dashboard to pick up new project.yaml
  log "Restarting Dashboard..."
  systemctl restart bps-dashboard 2>/dev/null || true
  sleep 3

  # V1: Post-deploy checks
  log "V1: Post-deploy checks"
  CC=$(find "$AIDA_HOME/context/" -name "*.md" 2>/dev/null | wc -l)
  check "V1.1 Context docs >= 4 (got $CC)" "test $CC -ge 4"
  check "V1.2 business-overview.md" "test -f $AIDA_HOME/context/business-overview.md"
  check "V1.3 service-catalog.md"   "test -f $AIDA_HOME/context/service-catalog.md"
  check "V1.4 clinical-workflow.md"  "test -f $AIDA_HOME/context/clinical-workflow.md"
  check "V1.5 compliance.md"        "test -f $AIDA_HOME/context/compliance.md"
  check "V1.6 project.yaml"         "test -f $AIDA_HOME/project.yaml"

  log "Phase 1 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 2: Turn 1 — Business Understanding + Core Entities
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 2 ]; then
  section "2: Turn 1 — Business Understanding + Core Entities"

  ENTITY_BEFORE=$(api_get "/api/entities" | jlen)

  aida_say 1 '你是广州颜青医疗美容诊所的运营管理助理。
请阅读 context/ 目录下的全部业务文档，然后：
1. 总结这家诊所的业务概况（服务类型、收入模式、组织角色）
2. 列出你识别到的核心业务实体类型
3. 开始创建业务实体：先从治疗项目（至少15个主力项目）和服务套餐（全部5个）开始'

  check "V2.1 Aida produced response" "test -s $LOG_DIR/turn-1.log"
  soft  "V2.2 Mentions business overview" "grep -qiE '诊所|医美|医疗美容|MAOr|颜青' $LOG_DIR/turn-1.log"

  sleep 3
  ENTITY_AFTER=$(api_get "/api/entities" | jlen)
  NEW_E=$((ENTITY_AFTER - ENTITY_BEFORE))
  log "  Entities created: +$NEW_E"

  log "Phase 2 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 3: Turn 2 — Membership + Products + Roles
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 3 ]; then
  section "3: Turn 2 — Membership + Products + Roles"

  aida_say 2 '继续创建：
1. 会员等级体系（5个等级：VIP/银/金/白金/钻石，每个含3星级的充值额和折扣率）
2. 产品目录（至少10个，覆盖注射类、护肤品和耗材）
3. 组织角色（4个：医生/护士/客服/设备工程师）'

  check "V3.1 Aida produced response" "test -s $LOG_DIR/turn-2.log"

  log "Phase 3 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 4: Turn 3 — Blueprint (Patient Journey)
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 4 ]; then
  section "4: Turn 3 — Blueprint"

  aida_say 3 '基于文档中的"7步患者旅程"（预约→接待→面诊→收费→治疗→随访→新预约），创建一个 Blueprint。
使用 bps_load_blueprint 工具，YAML 格式包含 services 和 flow。
flow 可以用箭头 DSL（如 svc-a -> svc-b -> svc-c）或 rules 格式（{when: svc-a, then: svc-b}）。'

  check "V4.1 Aida produced response" "test -s $LOG_DIR/turn-3.log"

  # Check if blueprint was created
  BP=$(find "$AIDA_HOME/blueprints/" -name "*.yaml" 2>/dev/null | wc -l)
  soft  "V4.2 Blueprint file created (got $BP)" "test $BP -ge 1"

  log "Phase 4 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 5: Turn 4a — Consent Forms + Management
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 5 ]; then
  section "5: Turn 4a — Consent Forms + Management"

  aida_say 4a '现在建立合规体系：
1. 创建全部 8 个知情同意书模板实体（IC-01 至 IC-08，见 compliance.md 同意书覆盖范围表），每个包含编号、项目类型、适应症、禁忌、风险
2. 建立治理约束（management.yaml），至少包含：知情同意必签、肉毒素剂量上限（2月200U）、光子间隔（≥3周）、折扣不叠加、禁忌症阻断、三星钻石限额、麻药面积上限
3. 写完 management.yaml 后，请立即使用 bps_load_management 工具将其加载到运行时'

  check "V5.1 Aida produced response" "test -s $LOG_DIR/turn-4a.log"

  log "Phase 5 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 6: Turn 4b — Post-Care Protocols
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 6 ]; then
  section "6: Turn 4b — Post-Care Protocols"

  aida_say 4b '创建术后护理方案实体。compliance.md 中列出了 17 个方案（见"术后护理方案索引"表），请至少创建前 14 个 P0 优先级的方案：
光子嫩肤、调Q激光、CO2点阵、黄金微针、超声炮、水光注射、玻尿酸、肉毒素、果酸换肤、体表手术通用、双眼皮、眼袋、植发、脂肪填充。
每个方案包含：项目类型、时间线、禁忌行为、正常反应、异常信号。'

  check "V6.1 Aida produced response" "test -s $LOG_DIR/turn-4b.log"

  log "Phase 6 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 7: Turn 5 — Follow-up + Cron
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 7 ]; then
  section "7: Turn 5 — Follow-up + Cron"

  aida_say 5 '创建随访计划实体，包含 8 种治疗的完整随访时间表（水光/黄金微针/肉毒-除皱/肉毒-咬肌/果酸/玻尿酸/光子/双眼皮）。
然后设置一个日常运营提醒（Cron），用于检查当天需要随访的患者。'

  check "V7.1 Aida produced response" "test -s $LOG_DIR/turn-5.log"

  log "Phase 7 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 8: Turn 6 — Verification Queries
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 8 ]; then
  section "8: Turn 6 — Verification Queries"

  aida_say 6 '基于你已建好的业务模型，回答以下问题：
1. 光子嫩肤多少钱一次？
2. 3万年卡包含哪些项目？
3. 肉毒素注射后要注意什么？
4. 一个新患者到店的完整流程是什么？'

  check "V8.1 Aida produced response" "test -s $LOG_DIR/turn-6.log"

  # D5: Usability — check query answers
  soft  "V8.2 [U1] 光子嫩肤价格 (1500)" "grep -qE '1[,.]?500' $LOG_DIR/turn-6.log"
  soft  "V8.3 [U2] 3万年卡 (六选三)" "grep -qiE '六选三|6选3|三个.*选|选.*三' $LOG_DIR/turn-6.log"
  soft  "V8.4 [U3] 肉毒素术后 (注意)" "grep -qiE '按摩|饮酒|运动|头痛|眼睑' $LOG_DIR/turn-6.log"
  soft  "V8.5 [U4] 患者流程 (多步)" "grep -qiE '预约.*面诊\|接待.*收费\|治疗.*随访\|7.*步\|七.*步' $LOG_DIR/turn-6.log"

  log "Phase 8 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 9: Ground Truth Verification (37 Checkpoints)
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 9 ]; then
  section "9: Ground Truth Verification"

  log "Collecting entity counts from Dashboard API..."

  # -- D1: Business Element Coverage --
  log "D1: Business Element Coverage"

  TI=$(entity_count "treatment-item")
  check "E1 [HARD] treatment-item >= 15 (got $TI)" "test $TI -ge 15"

  SP=$(entity_count "service-package")
  check "E2 [HARD] service-package >= 3 (got $SP)" "test $SP -ge 3"

  MB=$(entity_count "membership")
  check "E3 [HARD] membership >= 5 (got $MB)" "test $MB -ge 5"

  CF=$(entity_count "consent-form")
  soft  "E4 [SOFT] consent-form >= 5 (got $CF)" "test $CF -ge 5"

  PC=$(entity_count "post-care-protocol")
  soft  "E5 [SOFT] post-care-protocol >= 8 (got $PC)" "test $PC -ge 8"

  FS=$(entity_count "follow-up-schedule")
  soft  "E6 [SOFT] follow-up-schedule >= 1 (got $FS)" "test $FS -ge 1"

  SR=$(entity_count "staff-role")
  soft  "E7 [SOFT] staff-role >= 3 (got $SR)" "test $SR -ge 3"

  PI=$(entity_count "product-inventory")
  soft  "E8 [SOFT] product-inventory >= 5 (got $PI)" "test $PI -ge 5"

  # -- D2: Business Logic Fidelity (sampled via entity data) --
  log "D2: Business Logic Fidelity (requires post-hoc Evaluator review)"
  # F1-F8 are checked by the Evaluator reading entity data — we just verify key entities exist
  soft  "F1-F3 [HARD] service-package + treatment-item exist for pricing verification" "test $SP -ge 3 -a $TI -ge 15"

  # -- D3: Process Modeling --
  log "D3: Process Modeling"

  BP=$(find "$AIDA_HOME/blueprints/" -name "*.yaml" 2>/dev/null | wc -l)
  check "P1 [HARD] Blueprint file exists (got $BP)" "test $BP -ge 1"

  # Check blueprint services count via API
  SVC=$(api_get "/api/services" | jlen)
  soft  "P2-P7 [SOFT] Blueprint services >= 5 (got $SVC)" "test ${SVC:-0} -ge 5"

  # -- D4: Compliance Constraint Capture --
  log "D4: Compliance Constraint Capture"

  # Check management.yaml on disk
  if [ -f "$AIDA_HOME/management.yaml" ]; then
    GOV_DISK=$(grep -c "id:" "$AIDA_HOME/management.yaml" 2>/dev/null || echo "0")
    check "G1 [HARD] management.yaml exists with constraints (got $GOV_DISK ids)" "test $GOV_DISK -ge 1"
  else
    fail "G1 [HARD] management.yaml not found on disk"
    GOV_DISK=0
  fi

  # Check management loaded at runtime (NEW: bps_load_management should have activated them)
  GOV_RUNTIME=$(api_get "/api/management/constraints" | jlen)
  soft  "G1b [SOFT] Management constraints loaded at runtime (got $GOV_RUNTIME)" "test ${GOV_RUNTIME:-0} -ge 1"

  GOV_VIO=$(api_get "/api/management/violations" | jlen)
  log "  Management: $GOV_DISK on disk, $GOV_RUNTIME loaded, $GOV_VIO violations"

  # -- D6: No Hallucination (automated entity name check) --
  log "D6: No Hallucination (automated spot check)"

  # Dump all treatment-item entity IDs for post-hoc review
  api_get "/api/entities?entityType=treatment-item" | node -e "
    const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    d.forEach(e => console.log(e.entityId + ' | ' + (e.data?.name || e.data?.nameCN || '?')))
  " 2>/dev/null > "$LOG_DIR/treatment-items.txt" || true
  log "  Treatment items dumped to $LOG_DIR/treatment-items.txt ($(wc -l < "$LOG_DIR/treatment-items.txt") items)"

  # -- Cron check --
  log "Cron check"
  CRON_JOBS=0
  if [ -f "$OPENCLAW_HOME/cron/jobs.json" ]; then
    CRON_JOBS=$(node -e "try{const d=JSON.parse(require('fs').readFileSync('$OPENCLAW_HOME/cron/jobs.json','utf8'));console.log((d.jobs||[]).filter(j=>j.enabled).length)}catch{console.log(0)}" 2>/dev/null)
  fi
  soft  "Cron jobs >= 1 (got $CRON_JOBS)" "test ${CRON_JOBS:-0} -ge 1"

  log "Phase 9 complete."
fi

# ════════════════════════════════════════════════════════════
# Phase 10: Metrics Collection
# ════════════════════════════════════════════════════════════

if [ "$START_PHASE" -le 10 ]; then
  section "10: Metrics Collection"

  log "Generating metrics.json..."
  ENTITIES_JSON=$(api_get "/api/entities" || echo "[]")
  GOV_CONSTRAINTS_JSON=$(api_get "/api/management/constraints" || echo "[]")
  GOV_VIOLATIONS_JSON=$(api_get "/api/management/violations?limit=100" || echo "[]")
  GOV_APPROVALS_JSON=$(api_get "/api/management/approvals" || echo "[]")

  node -e '
const entities = JSON.parse(process.argv[1] || "[]");
const constraints = JSON.parse(process.argv[2] || "[]");
const violations = JSON.parse(process.argv[3] || "[]");
const approvals = JSON.parse(process.argv[4] || "[]");

const byType = {};
for (const e of entities) {
  const t = e.entityType || "unknown";
  byType[t] = (byType[t] || 0) + 1;
}

const bpFiles = parseInt(process.argv[5]) || 0;
const svcCount = parseInt(process.argv[6]) || 0;
const cronJobs = parseInt(process.argv[7]) || 0;
const govOnDisk = parseInt(process.argv[8]) || 0;

console.log(JSON.stringify({
  runId: "maor-preprocessing",
  date: new Date().toISOString().slice(0, 10),
  model: process.env.BENCHMARK_PRIMARY || "default",
  preprocessVersion: "v0.2",
  scriptVersion: "v0.3 (7 turns, automated)",
  entities: {
    total: entities.length,
    byType,
  },
  blueprints: {
    total: bpFiles,
    services: svcCount,
    health: svcCount > 0 ? "loaded" : "none",
  },
  management: {
    constraintsOnDisk: govOnDisk,
    constraintsLoaded: constraints.length,
    violations: violations.length,
    approvals: approvals.length,
  },
  crons: cronJobs,
  turns: 7,
  checkpoints: {
    pass: parseInt(process.argv[9]) || 0,
    fail: parseInt(process.argv[10]) || 0,
    warn: parseInt(process.argv[11]) || 0,
    total: parseInt(process.argv[12]) || 0,
  },
}, null, 2));
' "$ENTITIES_JSON" "$GOV_CONSTRAINTS_JSON" "$GOV_VIOLATIONS_JSON" "$GOV_APPROVALS_JSON" \
  "${BP:-0}" "${SVC:-0}" "${CRON_JOBS:-0}" "${GOV_DISK:-0}" \
  "$PASS" "$FAIL" "$WARNS" "$TOTAL" > "$LOG_DIR/metrics.json"

  log "  metrics.json → $LOG_DIR/metrics.json"

  # Generate behavior.json from session JSONL
  log "Generating behavior.json from session JSONL..."
  SESS_DIR="$OPENCLAW_HOME/agents/main/sessions"
  JSONL_FILE=$(ls -t "$SESS_DIR"/*.jsonl 2>/dev/null | head -1 || true)

  if [ -n "$JSONL_FILE" ] && [ -f "$JSONL_FILE" ]; then
    node -e '
const fs = require("fs");
const path = require("path");

const jsonlFile = process.argv[1];
const lines = fs.readFileSync(jsonlFile, "utf8").trim().split("\n");
const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const msgs = entries.filter(e => e.type === "message" && e.message);

const turnGroups = [];
let current = null;
for (const e of msgs) {
  if (e.message.role === "user") {
    if (current) turnGroups.push(current);
    current = [e];
  } else if (current) {
    current.push(e);
  }
}
if (current) turnGroups.push(current);

const turns = turnGroups.map((group, idx) => {
  const toolCalls = [];
  for (const e of group) {
    if (e.message.role === "assistant" && Array.isArray(e.message.content)) {
      for (const block of e.message.content) {
        if (block.name) toolCalls.push({ name: block.name, input: block.input || {} });
      }
    }
  }
  const bps = toolCalls.filter(t => t.name.startsWith("bps_"));
  const timestamps = group.map(e => e.timestamp).filter(Boolean);
  const start = timestamps.length ? Math.min(...timestamps) : null;
  const end = timestamps.length ? Math.max(...timestamps) : null;

  return {
    turn: idx + 1,
    messages: group.length,
    durationMs: start && end ? end - start : null,
    toolCalls: { total: toolCalls.length, bps: bps.length },
    bpsToolNames: [...new Set(bps.map(t => t.name))],
    bpsToolDetails: bps.map(t => ({ name: t.name, inputKeys: Object.keys(t.input) })),
  };
});

const allBps = turns.reduce((s, t) => s + t.toolCalls.bps, 0);
const allTotal = turns.reduce((s, t) => s + t.toolCalls.total, 0);

console.log(JSON.stringify({
  source: "session-jsonl",
  sessionFile: path.basename(jsonlFile),
  totalEntries: entries.length,
  summary: { totalToolCalls: allTotal, bpsToolCalls: allBps },
  turns,
}, null, 2));
' "$JSONL_FILE" > "$LOG_DIR/behavior.json"
    log "  behavior.json → $LOG_DIR/behavior.json"
  else
    echo '{"turns":[],"error":"no session JSONL found"}' > "$LOG_DIR/behavior.json"
    warn_ "No session JSONL found for behavior analysis"
  fi

  # Entity breakdown
  log "Entity breakdown:"
  echo "$ENTITIES_JSON" | node -e "
    const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    const t={};d.forEach(e=>{const k=e.entityType||'?';t[k]=(t[k]||0)+1});
    console.log('  Total: '+d.length);
    Object.entries(t).sort().forEach(([k,v])=>console.log('  '+k+': '+v))
  " 2>/dev/null || true

  log "Phase 10 complete."
fi

# ════════════════════════════════════════════════════════════
# Test Report
# ════════════════════════════════════════════════════════════

section "Test Report"

echo "MAOr Preprocessing E2E Test v0.3"
echo "================================"
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
echo "Entities:     ${TI:-?} treatment, ${SP:-?} package, ${MB:-?} membership, ${CF:-?} consent, ${PC:-?} post-care"
echo "Blueprint:    ${BP:-?} files, ${SVC:-?} services"
echo "Management:   ${GOV_DISK:-?} on disk, ${GOV_RUNTIME:-?} loaded, ${GOV_VIO:-?} violations"
echo "Cron:         ${CRON_JOBS:-?}"
echo ""
echo "Logs:         $LOG_DIR/"
echo "Metrics:      $LOG_DIR/metrics.json"
echo "Behavior:     $LOG_DIR/behavior.json"
echo "Dashboard:    $DASHBOARD_URL"
echo ""

# Save report
cat > "$LOG_DIR/report.txt" << REPORT
MAOr Preprocessing E2E Test v0.3
================================
Date:    $(date)
Server:  $(hostname)
Results: $PASS PASS / $FAIL FAIL / $WARNS WARN / $TOTAL TOTAL

Entities:
  treatment-item:      ${TI:-?}
  service-package:     ${SP:-?}
  membership:          ${MB:-?}
  consent-form:        ${CF:-?}
  post-care-protocol:  ${PC:-?}
  follow-up-schedule:  ${FS:-?}
  staff-role:          ${SR:-?}
  product-inventory:   ${PI:-?}

Blueprint: ${BP:-?} files, ${SVC:-?} services
Management: ${GOV_DISK:-?} on disk, ${GOV_RUNTIME:-?} loaded, ${GOV_VIO:-?} violations
Cron: ${CRON_JOBS:-?}

Logs: $LOG_DIR/
Dashboard: $DASHBOARD_URL
REPORT

log "Report saved: $LOG_DIR/report.txt"

# Combined turn logs
echo "=== Combined Turn Logs ===" > "$LOG_DIR/all-turns.log"
for t in 1 2 3 4a 4b 5 6; do
  if [ -f "$LOG_DIR/turn-$t.log" ]; then
    echo -e "\n=== TURN $t ===" >> "$LOG_DIR/all-turns.log"
    cat "$LOG_DIR/turn-$t.log" >> "$LOG_DIR/all-turns.log"
  fi
done
log "Combined logs: $LOG_DIR/all-turns.log"

exit "$FAIL"
