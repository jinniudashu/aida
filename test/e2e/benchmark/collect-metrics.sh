#!/usr/bin/env bash
# ============================================================
# AIDA Benchmark — Post-Test Metric Collection
# ============================================================
# Queries Dashboard API on the test server and writes:
#   metrics.json  — L1+L2 structured metrics
#   behavior.json — L3 per-turn timing + tool call counts
#
# Usage (called by run-single-model.sh, not standalone):
#   bash collect-metrics.sh <model-id> <results-dir>
#
# Requires: Dashboard API reachable at $DASHBOARD_URL
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

MODEL_ID="${1:?Usage: collect-metrics.sh <model-id> <results-dir>}"
OUT_DIR="${2:?Usage: collect-metrics.sh <model-id> <results-dir>}"
mkdir -p "$OUT_DIR"

log "Collecting metrics for $MODEL_ID..."

# -- Helper: query Dashboard API via SSH --
dash_get() {
  ssh_run "curl -sf http://localhost:3456$1 2>/dev/null" || echo "[]"
}

# ============================================================
# L1 + L2: Structured metrics
# ============================================================
log "  Querying Dashboard API..."

ENTITIES=$(dash_get "/api/entities")
GOVERNANCE_STATUS=$(dash_get "/api/governance/status")
GOVERNANCE_VIOLATIONS=$(dash_get "/api/governance/violations?limit=100")
GOVERNANCE_APPROVALS=$(dash_get "/api/governance/approvals")
GOVERNANCE_CONSTRAINTS=$(dash_get "/api/governance/constraints")

# Count entities by type, skills, agent workspaces, blueprints
METRICS=$(node -e '
const entities = JSON.parse(process.argv[1] || "[]");
const govStatus = JSON.parse(process.argv[2] || "{}");
const violations = JSON.parse(process.argv[3] || "[]");
const approvals = JSON.parse(process.argv[4] || "[]");
const constraints = JSON.parse(process.argv[5] || "[]");

// Entity breakdown
const byType = {};
for (const e of entities) {
  const t = e.entityType || "unknown";
  byType[t] = (byType[t] || 0) + 1;
}

// Approval stats
const approvalStats = {
  total: approvals.length,
  pending: approvals.filter(a => a.status === "PENDING").length,
  approved: approvals.filter(a => a.status === "APPROVED").length,
  rejected: approvals.filter(a => a.status === "REJECTED").length,
};

console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  entities: {
    total: entities.length,
    byType,
  },
  governance: {
    constraints: constraints.length,
    violations: violations.length,
    approvals: approvalStats,
    circuitBreaker: govStatus.circuitBreaker || null,
  },
}, null, 2));
' "$ENTITIES" "$GOVERNANCE_STATUS" "$GOVERNANCE_VIOLATIONS" "$GOVERNANCE_APPROVALS" "$GOVERNANCE_CONSTRAINTS")

# Enrich with remote filesystem data (skills, agent workspaces, blueprints, mock-publish)
REMOTE_COUNTS=$(ssh_run 'node -e "
  const {execSync} = require(\"child_process\");
  const run = cmd => { try { return execSync(cmd,{encoding:\"utf8\"}).trim(); } catch { return \"\"; } };
  const OC = process.env.OPENCLAW_HOME || process.env.HOME + \"/.openclaw\";
  const AH = process.env.AIDA_HOME || process.env.HOME + \"/.aida\";
  const skillDirs = run(\"find \" + OC + \"/workspace/skills/ -maxdepth 1 -mindepth 1 -type d 2>/dev/null\")
    .split(\"\\n\").filter(Boolean).map(d => require(\"path\").basename(d));
  console.log(JSON.stringify({
    skills: skillDirs.length,
    skillNames: skillDirs,
    agentWorkspaces: parseInt(run(\"find \" + OC + \" -maxdepth 1 -name workspace-* -type d 2>/dev/null | wc -l\")) || 0,
    blueprintFiles: parseInt(run(\"find \" + AH + \"/blueprints/ -name *.yaml 2>/dev/null | wc -l\")) || 0,
    mockPublishFiles: parseInt(run(\"find \" + AH + \"/mock-publish/ -type f 2>/dev/null | wc -l\")) || 0,
    cronJobs: parseInt(run(\"find \" + OC + \" -name cron*.json -o -name cron*.jsonl 2>/dev/null | wc -l\")) || 0,
  }, null, 2));
"' 2>/dev/null || echo '{}')

# Merge into final metrics
node -e '
const m = JSON.parse(process.argv[1]);
try { Object.assign(m, JSON.parse(process.argv[2])); } catch {}
console.log(JSON.stringify(m, null, 2));
' "$METRICS" "$REMOTE_COUNTS" > "$OUT_DIR/metrics.json"

log "  metrics.json written"

# ============================================================
# L3: Per-turn behavior (timing, tool calls, timeouts)
# ============================================================
log "  Extracting per-turn behavior..."

BEHAVIOR=$(ssh_run "
  LOG_DIR=/tmp/idlex-geo-e2e-v3
  node -e '
    const fs = require(\"fs\");
    const path = require(\"path\");
    const logDir = process.argv[1];
    const turns = [];

    for (let i = 1; i <= 6; i++) {
      const f = path.join(logDir, \"turn-\" + i + \".log\");
      if (!fs.existsSync(f)) { turns.push({ turn: i, status: \"missing\" }); continue; }
      const content = fs.readFileSync(f, \"utf-8\");
      const lines = content.split(\"\\n\");

      // Count tool calls (lines matching bps_* patterns)
      const toolCalls = lines.filter(l => /bps_[a-z_]+/.test(l)).length;
      const toolNames = [...new Set(lines.filter(l => /bps_[a-z_]+/.test(l))
        .map(l => l.match(/bps_[a-z_]+/)?.[0]).filter(Boolean))];

      // Detect timeout
      const timedOut = content.includes(\"timeout\") || content.includes(\"Timed out\");

      // Line count as proxy for response length
      turns.push({
        turn: i,
        status: lines.length > 2 ? \"ok\" : \"empty\",
        lines: lines.length,
        bytes: Buffer.byteLength(content),
        toolCallMentions: toolCalls,
        toolNames,
        timedOut,
      });
    }

    console.log(JSON.stringify({ turns, collectedAt: new Date().toISOString() }, null, 2));
  ' \"\$LOG_DIR\"
" 2>/dev/null || echo '{"turns":[],"error":"collection failed"}')

echo "$BEHAVIOR" > "$OUT_DIR/behavior.json"
log "  behavior.json written"

log "Metric collection complete → $OUT_DIR/"
