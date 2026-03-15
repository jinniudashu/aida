#!/usr/bin/env bash
# ============================================================
# Mock test script for framework validation
# Simulates a structural-capability run with synthetic metrics.
# Used by: aida-eval.sh --scheme test-mock
# ============================================================

set -euo pipefail

LOG_DIR="/tmp/aida-eval-mock"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# -- Helpers (same interface as real scripts) --
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()   { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
pass()  { echo -e "  ${GREEN}PASS${NC} $*"; PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); }
fail()  { echo -e "  ${RED}FAIL${NC} $*"; FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); }
warn_() { echo -e "  ${YELLOW}WARN${NC} $*"; WARNS=$((WARNS+1)); TOTAL=$((TOTAL+1)); }

PASS=0; FAIL=0; WARNS=0; TOTAL=0

# ── Phase 0: Mock install checks ──
log "Phase 0: Mock install verification"
pass "V0.1 Mock data directory exists"
pass "V0.2 Mock SOUL.md exists"
pass "V0.3 Mock AGENTS.md exists"
pass "V0.4 Mock Dashboard API"
pass "V0.5 Mock Skills >= 7"

# ── Phase 1: Mock seed ──
log "Phase 1: Mock data seeding"
pass "V1.1 5 store entities seeded"
pass "V1.2 3 management constraints loaded"
pass "V1.3 project.yaml created"

# ── Phase 2: Mock engine tests ──
log "Phase 2: Mock engine structural tests"
for i in $(seq 1 30); do
  pass "S2.$i Mock engine check $i"
done
# Simulate 2 warnings (LLM variance)
warn_ "S2.31 Mock turn too short (non-critical)"
warn_ "S2.32 Mock keyword not found (non-critical)"

# ── Phase 3: Mock Dashboard API ──
log "Phase 3: Mock Dashboard API checks"
for i in $(seq 1 8); do
  pass "S3.$i Mock Dashboard endpoint $i"
done

# ── Phase 4: Mock business scenario ──
log "Phase 4: Mock IdleX GEO business scenario"
pass "B4.01 Turn 1 business understanding"
pass "B4.02 Turn 2 entity creation"
pass "B4.03 Turn 3 content generation"
pass "B4.04 Turn 4 management interception"
warn_ "B4.05 Turn 5 cron creation (non-critical)"
pass "B4.06 Turn 6 self-evolution"

# ── Phase 5: Mock final verification ──
log "Phase 5: Mock final verification"
pass "V5.1 Final entity count"
pass "V5.2 Management constraints"
pass "V5.3 Skills intact"

# ── Metrics ──
FINAL_ENTITIES=14
FINAL_VIOLATIONS=3
FINAL_CONSTRAINTS=3
FINAL_SKILLS=9
FINAL_BLUEPRINTS=1
TOTAL_WRITES=4
FINAL_WORKSPACES=1
FINAL_CRON=0
FINAL_APPROVAL_DECIDED=1
FINAL_COLLAB_TOTAL=1
FINAL_COLLAB_COMPLETED=0

cat > "$LOG_DIR/metrics.json" << METRICS
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "entities": $FINAL_ENTITIES,
  "violations": $FINAL_VIOLATIONS,
  "constraints": $FINAL_CONSTRAINTS,
  "skills": $FINAL_SKILLS,
  "blueprints": $FINAL_BLUEPRINTS,
  "writeToolCalls": $TOTAL_WRITES,
  "agentWorkspaces": $FINAL_WORKSPACES,
  "cronJobs": $FINAL_CRON,
  "approvalDecided": $FINAL_APPROVAL_DECIDED,
  "collaborationTasks": $FINAL_COLLAB_TOTAL,
  "collaborationCompleted": $FINAL_COLLAB_COMPLETED,
  "testResults": {
    "pass": $PASS,
    "fail": $FAIL,
    "warn": $WARNS,
    "total": $TOTAL
  }
}
METRICS

# ── Report ──
echo ""
echo "Mock Structural Capability E2E Test"
echo "===================================="
echo "Results: $PASS PASS / $FAIL FAIL / $WARNS WARN / $TOTAL TOTAL"
echo ""
echo "Metrics:"
echo "  Entities:    $FINAL_ENTITIES"
echo "  Violations:  $FINAL_VIOLATIONS"
echo "  Constraints: $FINAL_CONSTRAINTS"
echo "  Skills:      $FINAL_SKILLS"
echo "  Blueprints:  $FINAL_BLUEPRINTS"
echo "  WriteTools:  $TOTAL_WRITES"
echo "  Workspaces:  $FINAL_WORKSPACES"
echo "  CronJobs:    $FINAL_CRON"
echo ""

cat > "$LOG_DIR/report.txt" << REPORT
Mock Test Results: $PASS PASS / $FAIL FAIL / $WARNS WARN / $TOTAL TOTAL
REPORT

exit "$FAIL"
