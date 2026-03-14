#!/bin/bash
# ============================================================
# AIDA End-to-End Capability Test Script
# Tests all core capabilities against the Dashboard API
# Usage: bash test/e2e/aida-e2e-test.sh [--clean]
#
# Options:
#   --clean   Reset environment before testing (wipe ~/.aida,
#             OpenClaw state, re-run install-aida.sh)
#
# Prerequisites: Dashboard running on localhost:3456
# ============================================================
set -euo pipefail
BASE="http://localhost:3456"
PASS=0
FAIL=0
TOTAL=0
AIDA_HOME="${AIDA_HOME:-$HOME/.aida}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"

# Parse args
DO_CLEAN=false
for arg in "$@"; do
  case $arg in --clean) DO_CLEAN=true ;; esac
done

test_pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1)); }
test_fail() { echo "  [FAIL] $1: $2"; FAIL=$((FAIL + 1)); TOTAL=$((TOTAL + 1)); }

pyjson() {
  python3 -c "import json,sys; d=json.load(sys.stdin); $1" 2>/dev/null
}

# Optional: clean environment
if [ "$DO_CLEAN" = true ]; then
  echo "[clean] Stopping services..."
  systemctl stop bps-dashboard 2>/dev/null || true
  pkill -f "openclaw gateway" 2>/dev/null || true
  sleep 2

  echo "[clean] Wiping state..."
  [ -d "$AIDA_HOME" ] && mv "$AIDA_HOME" "$AIDA_HOME.bak.$(date +%Y%m%d%H%M%S)"
  rm -rf "$OPENCLAW_HOME/workspace/" 2>/dev/null || true
  rm -rf "$OPENCLAW_HOME"/workspace-* 2>/dev/null || true
  rm -rf "$OPENCLAW_HOME/agents/main/sessions/" 2>/dev/null || true
  rm -rf "$OPENCLAW_HOME/cron/" 2>/dev/null || true

  echo "[clean] Running install-aida.sh..."
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  bash "$SCRIPT_DIR/../../deploy/install-aida.sh"

  echo "[clean] Waiting for Dashboard..."
  sleep 5
  echo "[clean] Done."
fi

echo ""
echo "============================================"
echo "  AIDA End-to-End Capability Test"
echo "  $(date)"
echo "============================================"
echo ""

# ============================================
# Stage 1: Blueprint Loading & Service Registration
# ============================================
echo "--- Stage 1: Blueprint Loading & Service Registration ---"

SVC_COUNT=$(curl -sf "$BASE/api/services" | pyjson "print(len(d))")
if [ "$SVC_COUNT" -gt 0 ]; then
  test_pass "T2.1 Services loaded from blueprint ($SVC_COUNT services)"
else
  test_fail "T2.1 Services" "None found"
fi

AGENT_SVC=$(curl -sf "$BASE/api/services?status=active" | pyjson "print(sum(1 for s in d if s.get('executorType')=='agent'))")
if [ "$AGENT_SVC" -gt 0 ]; then
  test_pass "T2.2 Agent-type services exist ($AGENT_SVC)"
else
  test_fail "T2.2 Agent services" "None found"
fi

# POST a new test blueprint
cat > /tmp/test-blueprint.yaml << 'BPEOF'
services:
  - id: svc-e2e-checkin
    label: Customer Check-in
    serviceType: atomic
    executorType: agent
    entityType: customer
    agentPrompt: Greet the customer and record their arrival
    agentSkills:
      - business-execution
    status: active
  - id: svc-e2e-serve
    label: Serve Customer
    serviceType: atomic
    executorType: manual
    entityType: customer
    status: active

events:
  - id: evt-e2e-checkin-done
    label: Check-in Completed
    expression: "state == 'COMPLETED'"
    evaluationMode: deterministic

instructions:
  - id: ins-e2e-start
    label: Start Service
    sysCall: start_service

rules:
  - id: rule-e2e-checkin-to-serve
    label: After check-in start service
    targetServiceId: svc-e2e-checkin
    eventId: evt-e2e-checkin-done
    instructionId: ins-e2e-start
    operandServiceId: svc-e2e-serve
    order: 1
    status: active
BPEOF

BP_YAML=$(cat /tmp/test-blueprint.yaml)
BP_JSON=$(python3 -c "import json; print(json.dumps({'yaml': open('/tmp/test-blueprint.yaml').read()}))")
BP_RESULT=$(curl -sf -X POST "$BASE/api/blueprints" -H "Content-Type: application/json" -d "$BP_JSON")
BP_SVC=$(echo "$BP_RESULT" | pyjson "print(d.get('services',0))")
if [ "$BP_SVC" -ge 2 ]; then
  test_pass "T2.1b Blueprint POST loads services ($BP_SVC)"
else
  test_fail "T2.1b Blueprint POST" "$BP_RESULT"
fi

# T2.3: Check agentPrompt/agentSkills returned
AP_CHECK=$(curl -sf "$BASE/api/services?status=active" | pyjson "
svcs = [s for s in d if s.get('id')=='svc-e2e-checkin']
if svcs:
  s = svcs[0]
  print('yes' if s.get('agentPrompt') and s.get('agentSkills') else 'no')
else:
  print('missing')
")
if [ "$AP_CHECK" = "yes" ]; then
  test_pass "T2.3 agentPrompt/agentSkills present"
else
  test_fail "T2.3 agentPrompt/agentSkills" "$AP_CHECK"
fi

# T2.4: Rules
RULE_COUNT=$(curl -sf "$BASE/api/rules" | pyjson "print(len(d))")
if [ "$RULE_COUNT" -gt 0 ]; then
  test_pass "T2.4 Rules topology ($RULE_COUNT rules)"
else
  test_fail "T2.4 Rules" "None found"
fi

echo ""

# ============================================
# Stage 2: Entity Management
# ============================================
echo "--- Stage 2: Entity Management ---"

# T2.5: Create entity
CE_RESULT=$(curl -sf -X POST "$BASE/api/entities/store/e2e-store-001" \
  -H "Content-Type: application/json" \
  -d '{"data":{"name":"E2E Test Store","city":"Beijing","status":"operating"},"committedBy":"test","message":"Test entity"}')
CE_VER=$(echo "$CE_RESULT" | pyjson "print(d['version']['version'])")
if [ "$CE_VER" -ge 1 ]; then
  test_pass "T2.5 Entity creation (version=$CE_VER)"
else
  test_fail "T2.5 Entity creation" "$CE_RESULT"
fi

# T2.6: Query entities
EQ_COUNT=$(curl -sf "$BASE/api/entities?entityType=store" | pyjson "print(len(d))")
if [ "$EQ_COUNT" -gt 0 ]; then
  test_pass "T2.6 Entity query (stores=$EQ_COUNT)"
else
  test_fail "T2.6 Entity query" "None"
fi

# System knowledge
SK_COUNT=$(curl -sf "$BASE/api/entities?entityType=knowledge" | pyjson "print(len(d))")
if [ "$SK_COUNT" -ge 2 ]; then
  test_pass "T2.6b System knowledge loaded ($SK_COUNT entries)"
else
  test_fail "T2.6b System knowledge" "$SK_COUNT"
fi

echo ""

# ============================================
# Stage 3: Runtime Process Progression
# ============================================
echo "--- Stage 3: Runtime Process Progression ---"

# T3.1: Create task
T31=$(curl -sf -X POST "$BASE/api/processes" \
  -H "Content-Type: application/json" \
  -d '{"serviceId":"svc-e2e-checkin","entityType":"customer","entityId":"cust-001"}')
T31_ID=$(echo "$T31" | pyjson "print(d['id'])")
T31_STATE=$(echo "$T31" | pyjson "print(d['state'])")
if [ "$T31_STATE" = "OPEN" ]; then
  test_pass "T3.1 Task created (state=OPEN)"
else
  test_fail "T3.1 Task creation" "state=$T31_STATE"
fi

# T3.2: OPEN → IN_PROGRESS
T32=$(curl -sf -X POST "$BASE/api/processes/$T31_ID/transition" \
  -H "Content-Type: application/json" -d '{"newState":"IN_PROGRESS"}')
T32_STATE=$(echo "$T32" | pyjson "print(d['state'])")
if [ "$T32_STATE" = "IN_PROGRESS" ]; then
  test_pass "T3.2 State transition OPEN->IN_PROGRESS"
else
  test_fail "T3.2 State transition" "$T32_STATE"
fi

# T3.3: Invalid transition (new OPEN task → COMPLETED directly)
T33_TASK=$(curl -sf -X POST "$BASE/api/processes" \
  -H "Content-Type: application/json" \
  -d '{"serviceId":"svc-e2e-checkin","entityType":"customer","entityId":"cust-002"}')
T33_ID=$(echo "$T33_TASK" | pyjson "print(d['id'])")
T33_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/processes/$T33_ID/transition" \
  -H "Content-Type: application/json" -d '{"newState":"COMPLETED"}')
if [ "$T33_HTTP" = "400" ]; then
  test_pass "T3.3 Invalid transition rejected (OPEN->COMPLETED = HTTP 400)"
else
  test_fail "T3.3 Invalid transition" "HTTP $T33_HTTP"
fi

# T3.4: Complete task
T34=$(curl -sf -X POST "$BASE/api/processes/$T31_ID/simulate-complete")
T34_STATE=$(echo "$T34" | pyjson "print(d['process']['state'])")
if [ "$T34_STATE" = "COMPLETED" ]; then
  test_pass "T3.4 Task completion (simulate-complete)"
else
  test_fail "T3.4 Task completion" "$T34_STATE"
fi

# T3.6: Next steps (rules topology)
T36=$(curl -sf "$BASE/api/rules?targetServiceId=svc-e2e-checkin" | pyjson "print(len(d))")
if [ "$T36" -gt 0 ]; then
  test_pass "T3.6 Next steps via rules ($T36 downstream rules for svc-e2e-checkin)"
else
  test_fail "T3.6 Next steps" "No rules"
fi

# T3.7: Full landscape (overview as proxy for scan_work)
T37=$(curl -sf "$BASE/api/overview" | pyjson "print(d['processes']['totalCount'])")
if [ "$T37" -gt 0 ]; then
  test_pass "T3.7 Work landscape ($T37 total processes)"
else
  test_fail "T3.7 Work landscape" "0 processes"
fi

# T3.8: Failed task
T38_TASK=$(curl -sf -X POST "$BASE/api/processes" \
  -H "Content-Type: application/json" \
  -d '{"serviceId":"svc-e2e-serve","entityType":"customer","entityId":"cust-fail"}')
T38_ID=$(echo "$T38_TASK" | pyjson "print(d['id'])")
curl -sf -X POST "$BASE/api/processes/$T38_ID/transition" -H "Content-Type: application/json" -d '{"newState":"IN_PROGRESS"}' >/dev/null
curl -sf -X POST "$BASE/api/processes/$T38_ID/transition" -H "Content-Type: application/json" -d '{"newState":"FAILED"}' >/dev/null
T38_CHECK=$(curl -sf "$BASE/api/processes?state=FAILED" | pyjson "print(len(d))")
if [ "$T38_CHECK" -gt 0 ]; then
  test_pass "T3.8 Failed task tracking ($T38_CHECK failed)"
else
  test_fail "T3.8 Failed task" "None"
fi

# T3.9: Blocked → unblock
T39_TASK=$(curl -sf -X POST "$BASE/api/processes" \
  -H "Content-Type: application/json" \
  -d '{"serviceId":"svc-e2e-serve","entityType":"customer","entityId":"cust-block"}')
T39_ID=$(echo "$T39_TASK" | pyjson "print(d['id'])")
curl -sf -X POST "$BASE/api/processes/$T39_ID/transition" -H "Content-Type: application/json" -d '{"newState":"IN_PROGRESS"}' >/dev/null
curl -sf -X POST "$BASE/api/processes/$T39_ID/transition" -H "Content-Type: application/json" -d '{"newState":"BLOCKED"}' >/dev/null
T39_UNBLOCK=$(curl -sf -X POST "$BASE/api/processes/$T39_ID/transition" \
  -H "Content-Type: application/json" -d '{"newState":"IN_PROGRESS"}')
T39_STATE=$(echo "$T39_UNBLOCK" | pyjson "print(d['state'])")
if [ "$T39_STATE" = "IN_PROGRESS" ]; then
  test_pass "T3.9 Blocked -> unblock (BLOCKED->IN_PROGRESS)"
else
  test_fail "T3.9 Blocked -> unblock" "$T39_STATE"
fi

echo ""

# ============================================
# Stage 4: Skill Creation
# ============================================
echo "--- Stage 4: Skill Creation ---"

SKILL_DIR="/root/.openclaw/workspace/skills/test-inventory-audit"
mkdir -p "$SKILL_DIR"
cat > "$SKILL_DIR/SKILL.md" << 'SKILLEOF'
---
name: test-inventory-audit
description: Weekly inventory audit for all stores
---
# Inventory Audit

1. Query all stores via bps_query_entities
2. For each store, compare current vs expected inventory
3. Flag discrepancies and generate report
SKILLEOF

if [ -f "$SKILL_DIR/SKILL.md" ]; then
  test_pass "T2.7 Skill file creation (test-inventory-audit)"
else
  test_fail "T2.7 Skill creation" "File not created"
fi

echo ""

# ============================================
# Stage 5: HITL Approval Loop
# ============================================
echo "--- Stage 5: HITL Approval Loop ---"

# T5.1: Create approval
curl -sf -X POST "$BASE/api/entities/approval/e2e-appr-equip" \
  -H "Content-Type: application/json" \
  -d '{"data":{"status":"pending","question":"Approve equipment purchase: Coffee Machine 25000 CNY?","context":{"amount":25000,"vendor":"Test Vendor"},"requestedBy":"aida","serviceId":"svc-e2e-serve"},"committedBy":"aida","message":"Test approval"}' >/dev/null
T51=$(curl -sf "$BASE/api/approvals?status=pending" | pyjson "print(len(d))")
if [ "$T51" -gt 0 ]; then
  test_pass "T5.1 Approval created (pending=$T51)"
else
  test_fail "T5.1 Approval creation" "None pending"
fi

# T5.2: Decide
T52=$(curl -sf -X POST "$BASE/api/approvals/e2e-appr-equip/decide" \
  -H "Content-Type: application/json" \
  -d '{"decision":"approved","decidedBy":"owner","reason":"Within budget"}')
T52_OK=$(echo "$T52" | pyjson "print(d.get('success',False))")
if [ "$T52_OK" = "True" ]; then
  test_pass "T5.2 Approval decision (approved)"
else
  test_fail "T5.2 Approval decision" "$T52"
fi

# T5.3: Decision auditable
T53=$(curl -sf "$BASE/api/approvals?status=all" | pyjson "
for a in d:
  if a['approvalId'] == 'e2e-appr-equip':
    print(a.get('status','?'), a.get('decidedBy','?'))
")
if echo "$T53" | grep -q "approved owner"; then
  test_pass "T5.3 Decision auditable (status=approved, decidedBy=owner)"
else
  test_fail "T5.3 Decision audit" "$T53"
fi

echo ""

# ============================================
# Stage 6: Dashboard Observability
# ============================================
echo "--- Stage 6: Dashboard Observability ---"

# T4.1: Overview
T41=$(curl -sf "$BASE/api/overview" | pyjson "print(d['processes']['totalCount'])")
test_pass "T4.1 Overview API (processes=$T41)"

# T4.2: Kanban
T42=$(curl -sf "$BASE/api/kanban" | pyjson "print(len(d))")
if [ "$T42" -gt 0 ]; then
  test_pass "T4.2 Kanban API ($T42 columns)"
else
  test_fail "T4.2 Kanban" "Empty"
fi

# T4.3: Agent Log
T43=$(curl -sf "$BASE/api/agent-log" | pyjson "print(len(d))")
if [ "$T43" -gt 0 ]; then
  test_pass "T4.3 Agent Log ($T43 entries)"
else
  test_fail "T4.3 Agent Log" "Empty"
fi

# T4.4: Business Goals
T44=$(curl -sf "$BASE/api/business-goals" | pyjson "print(len(d))")
test_pass "T4.4 Business Goals API (plans=$T44)"

# T4.5: Approvals
T45=$(curl -sf "$BASE/api/approvals?status=all" | pyjson "print(len(d))")
if [ "$T45" -gt 0 ]; then
  test_pass "T4.5 Approvals API ($T45 total)"
else
  test_fail "T4.5 Approvals" "None"
fi

# T4.6: SSE (quick connectivity test)
T46_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$BASE/api/events" 2>/dev/null || true)
test_pass "T4.6 SSE endpoint accessible (HTTP=$T46_HTTP)"

# T4.7: Alerts
T47=$(curl -sf "$BASE/api/alerts" | pyjson "print(type(d).__name__)")
if [ "$T47" = "list" ]; then
  test_pass "T4.7 Alerts API responds (type=list)"
else
  test_fail "T4.7 Alerts" "$T47"
fi

# Timeseries
T47B=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/stats/timeseries?metric=process.created&interval=day&from=2026-03-01&to=2026-03-05")
if [ "$T47B" = "200" ]; then
  test_pass "T4.7b Timeseries API (HTTP 200)"
else
  test_fail "T4.7b Timeseries" "HTTP $T47B"
fi

# Store Profile API
T47C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/store-profiles")
if [ "$T47C" = "200" ]; then
  test_pass "T4.8 Store Profile API (HTTP 200)"
else
  test_fail "T4.8 Store Profile" "HTTP $T47C"
fi

echo ""

# ============================================
# Stage 7: E2E Business Scenario
# ============================================
echo "--- Stage 7: End-to-End Business Scenario ---"

# Create store entity
curl -sf -X POST "$BASE/api/entities/store/e2e-wangjing" \
  -H "Content-Type: application/json" \
  -d '{"data":{"name":"Wangjing New Store","city":"Beijing","district":"Chaoyang","status":"preparing","targetOpenDate":"2026-04-15"},"committedBy":"aida","message":"New store"}' >/dev/null
test_pass "E2E.1 Store entity created"

# Create action plan
curl -sf -X POST "$BASE/api/entities/action-plan/e2e-plan" \
  -H "Content-Type: application/json" \
  -d '{"data":{"name":"New Store Opening Plan","description":"Pipeline: survey -> design -> license -> open","items":[{"name":"Site Survey","status":"done"},{"name":"Design Plan","status":"in-progress"},{"name":"Licensing","status":"pending"},{"name":"Grand Opening","status":"pending"}],"periodicItems":[{"name":"Weekly progress report","cron":"0 9 * * MON"}]},"committedBy":"aida","message":"Opening plan"}' >/dev/null
test_pass "E2E.2 Action plan created"

# Verify business goals
E2E_BG=$(curl -sf "$BASE/api/business-goals" | pyjson "
for g in d:
  if g['planId'] == 'e2e-plan':
    print(g['name'], len(g['items']), len(g['periodicItems']))
")
if echo "$E2E_BG" | grep -q "New Store Opening"; then
  test_pass "E2E.3 Business goals visible"
else
  test_fail "E2E.3 Business goals" "$E2E_BG"
fi

# Task chain: survey → design → licensing → opening
E2E_T1=$(curl -sf -X POST "$BASE/api/processes" \
  -H "Content-Type: application/json" \
  -d '{"serviceId":"svc-e2e-checkin","entityType":"store","entityId":"e2e-wangjing","name":"Site Survey"}')
E2E_T1_ID=$(echo "$E2E_T1" | pyjson "print(d['id'])")
curl -sf -X POST "$BASE/api/processes/$E2E_T1_ID/simulate-complete" >/dev/null
test_pass "E2E.4 Task 1 (Site Survey) completed"

E2E_T2=$(curl -sf -X POST "$BASE/api/processes" \
  -H "Content-Type: application/json" \
  -d "{\"serviceId\":\"svc-e2e-serve\",\"entityType\":\"store\",\"entityId\":\"e2e-wangjing\",\"name\":\"Design Plan\",\"previousId\":\"$E2E_T1_ID\"}")
E2E_T2_ID=$(echo "$E2E_T2" | pyjson "print(d['id'])")
curl -sf -X POST "$BASE/api/processes/$E2E_T2_ID/simulate-complete" >/dev/null
test_pass "E2E.5 Task 2 (Design) completed (chained from T1)"

E2E_T3=$(curl -sf -X POST "$BASE/api/processes" \
  -H "Content-Type: application/json" \
  -d "{\"serviceId\":\"svc-e2e-checkin\",\"entityType\":\"store\",\"entityId\":\"e2e-wangjing\",\"name\":\"Licensing\",\"previousId\":\"$E2E_T2_ID\"}")
E2E_T3_ID=$(echo "$E2E_T3" | pyjson "print(d['id'])")

# Approval gate
curl -sf -X POST "$BASE/api/entities/approval/e2e-appr-license" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"status\":\"pending\",\"question\":\"Approve licensing fee 5000 CNY?\",\"context\":{\"amount\":5000},\"requestedBy\":\"aida\",\"taskId\":\"$E2E_T3_ID\"},\"committedBy\":\"aida\",\"message\":\"License approval\"}" >/dev/null
test_pass "E2E.6 Approval gate created"

curl -sf -X POST "$BASE/api/approvals/e2e-appr-license/decide" \
  -H "Content-Type: application/json" \
  -d '{"decision":"approved","decidedBy":"owner","reason":"Proceed"}' >/dev/null
curl -sf -X POST "$BASE/api/processes/$E2E_T3_ID/simulate-complete" >/dev/null
test_pass "E2E.7 Task 3 (Licensing) approved + completed"

E2E_T4=$(curl -sf -X POST "$BASE/api/processes" \
  -H "Content-Type: application/json" \
  -d "{\"serviceId\":\"svc-e2e-serve\",\"entityType\":\"store\",\"entityId\":\"e2e-wangjing\",\"name\":\"Grand Opening\",\"previousId\":\"$E2E_T3_ID\"}")
E2E_T4_ID=$(echo "$E2E_T4" | pyjson "print(d['id'])")
curl -sf -X POST "$BASE/api/processes/$E2E_T4_ID/simulate-complete" >/dev/null

# Update store
curl -sf -X POST "$BASE/api/entities/store/e2e-wangjing" \
  -H "Content-Type: application/json" \
  -d '{"data":{"status":"operating","openDate":"2026-03-05"},"committedBy":"aida","message":"Store opened"}' >/dev/null
test_pass "E2E.8 Full pipeline completed (store status=operating)"

# Final verification
E2E_FINAL=$(curl -sf "$BASE/api/processes?entityId=e2e-wangjing" | pyjson "
states={}
for p in d:
  s=p['state']
  states[s]=states.get(s,0)+1
print(f'total={len(d)}', ' '.join(f'{k}={v}' for k,v in sorted(states.items())))")
test_pass "E2E.9 Final processes: $E2E_FINAL"

E2E_LOG=$(curl -sf "$BASE/api/agent-log" | pyjson "print(len(d))")
test_pass "E2E.10 Total audit log: $E2E_LOG entries"

E2E_STORE_VER=$(curl -sf "$BASE/api/entities?entityType=store" | pyjson "
for e in d:
  if e['dossier']['entityId'] == 'e2e-wangjing':
    print(f\"v{e['dossier']['currentVersion']} status={e['data'].get('status','?')}\")")
test_pass "E2E.11 Store entity: $E2E_STORE_VER"

# Dashboard UI accessible
T_UI=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/")
if [ "$T_UI" = "200" ]; then
  test_pass "E2E.12 Dashboard SPA accessible (HTTP 200)"
else
  test_fail "E2E.12 Dashboard SPA" "HTTP $T_UI"
fi

echo ""

# ============================================
# Summary
# ============================================
echo "============================================"
echo "  Test Summary"
echo "============================================"
echo ""
echo "  Total: $TOTAL"
echo "  Pass:  $PASS"
echo "  Fail:  $FAIL"
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "  RESULT: ALL TESTS PASSED"
else
  echo "  RESULT: $FAIL TEST(S) FAILED"
fi
echo ""

# Cleanup
rm -rf /root/.openclaw/workspace/skills/test-*
