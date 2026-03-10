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
    mockPublishDraftFiles: parseInt(run(\"find \" + AH + \"/mock-publish-tmp/ -type f 2>/dev/null | wc -l\")) || 0,
    cronJobs: (() => {
      try {
        const f = OC + \"/cron/jobs.json\";
        const data = JSON.parse(require(\"fs\").readFileSync(f, \"utf8\"));
        return (data.jobs || []).filter(j => j.enabled).length;
      } catch { return 0; }
    })(),
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
# L3: Per-turn behavior from OpenClaw Session JSONL
# ============================================================
# Approach C: parse ~/.openclaw/agents/main/sessions/*.jsonl
# to extract actual tool calls, tool results, and timing per turn.
# This replaces the broken regex-on-turn-logs approach (which always
# returned 0 because openclaw agent --message stdout only has NL text).
# ============================================================
log "  Extracting per-turn behavior from session JSONL..."

BEHAVIOR=$(ssh_run 'node -e "
  const fs = require(\"fs\");
  const path = require(\"path\");

  const sessDir = (process.env.OPENCLAW_HOME || process.env.HOME + \"/.openclaw\")
    + \"/agents/main/sessions/\";

  // Find newest .jsonl file
  let jsonlFile = null;
  try {
    const files = fs.readdirSync(sessDir).filter(f => f.endsWith(\".jsonl\")).sort();
    if (files.length > 0) jsonlFile = path.join(sessDir, files[files.length - 1]);
  } catch {}

  if (!jsonlFile || !fs.existsSync(jsonlFile)) {
    console.log(JSON.stringify({ turns: [], error: \"no session JSONL found\", source: \"jsonl\" }));
    process.exit(0);
  }

  // Parse all JSONL entries
  const lines = fs.readFileSync(jsonlFile, \"utf8\").trim().split(\"\\n\");
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const msgs = entries.filter(e => e.type === \"message\" && e.message);

  // Group into turns: each turn starts with a user message
  const turnGroups = [];  // array of arrays
  let current = null;
  for (const e of msgs) {
    if (e.message.role === \"user\") {
      if (current) turnGroups.push(current);
      current = [e];
    } else if (current) {
      current.push(e);
    }
  }
  if (current) turnGroups.push(current);

  // Analyze each turn
  const turns = turnGroups.map((group, idx) => {
    const turnNum = idx + 1;
    const userMsg = group[0];
    const userContent = typeof userMsg.message.content === \"string\"
      ? userMsg.message.content
      : Array.isArray(userMsg.message.content)
        ? userMsg.message.content.map(b => b.text || \"\").join(\" \")
        : \"\";

    // Tool calls from assistant content blocks
    const toolCalls = [];
    const toolResults = [];
    let textBytes = 0;

    for (const e of group) {
      if (e.message.role === \"assistant\" && Array.isArray(e.message.content)) {
        for (const block of e.message.content) {
          if (block.name) {
            toolCalls.push({
              name: block.name,
              input: block.input || block.arguments || {},
            });
          }
          if (block.type === \"text\" && block.text) {
            textBytes += Buffer.byteLength(block.text);
          }
        }
      }
      if (e.message.role === \"toolResult\") {
        toolResults.push({
          name: e.message.toolName || \"?\",
          isError: Boolean(e.message.isError),
        });
      }
    }

    // Unique tool names
    const toolNames = [...new Set(toolCalls.map(t => t.name))];
    const bpsToolCalls = toolCalls.filter(t => t.name.startsWith(\"bps_\"));
    const bpsToolNames = [...new Set(bpsToolCalls.map(t => t.name))];
    const writeToolCalls = toolCalls.filter(t => t.name === \"write\");
    const errorCount = toolResults.filter(r => r.isError).length;

    // Timing
    const timestamps = group.map(e => e.timestamp).filter(Boolean);
    const startTs = timestamps.length ? Math.min(...timestamps) : null;
    const endTs = timestamps.length ? Math.max(...timestamps) : null;
    const durationMs = startTs && endTs ? endTs - startTs : null;

    return {
      turn: turnNum,
      userPrompt: userContent.slice(0, 200),
      startTime: startTs ? new Date(startTs).toISOString() : null,
      durationMs,
      messages: group.length,
      textBytes,
      toolCalls: {
        total: toolCalls.length,
        bps: bpsToolCalls.length,
        write: writeToolCalls.length,
        other: toolCalls.length - bpsToolCalls.length - writeToolCalls.length,
        errors: errorCount,
      },
      toolNames,
      bpsToolNames,
      bpsToolDetails: bpsToolCalls.map(t => ({
        name: t.name,
        inputKeys: Object.keys(t.input),
      })),
      writeTargets: writeToolCalls.map(t => {
        const inp = t.input || {};
        return inp.path || inp.filePath || inp.file_path || \"?\";
      }),
    };
  });

  // Summary across all turns
  const allToolCalls = turns.reduce((s, t) => s + t.toolCalls.total, 0);
  const allBpsCalls = turns.reduce((s, t) => s + t.toolCalls.bps, 0);
  const allWriteCalls = turns.reduce((s, t) => s + t.toolCalls.write, 0);
  const allErrors = turns.reduce((s, t) => s + t.toolCalls.errors, 0);
  const allBpsNames = [...new Set(turns.flatMap(t => t.bpsToolNames))];
  const allToolNames = [...new Set(turns.flatMap(t => t.toolNames))];

  console.log(JSON.stringify({
    source: \"session-jsonl\",
    sessionFile: path.basename(jsonlFile),
    totalEntries: entries.length,
    totalMessages: msgs.length,
    collectedAt: new Date().toISOString(),
    summary: {
      totalToolCalls: allToolCalls,
      bpsToolCalls: allBpsCalls,
      writeToolCalls: allWriteCalls,
      otherToolCalls: allToolCalls - allBpsCalls - allWriteCalls,
      toolErrors: allErrors,
      bpsToolNames: allBpsNames,
      allToolNames,
    },
    turns,
  }, null, 2));
"' 2>/dev/null || echo '{"turns":[],"error":"collection failed","source":"jsonl"}')

echo "$BEHAVIOR" > "$OUT_DIR/behavior.json"
log "  behavior.json written (source: session JSONL)"

log "Metric collection complete → $OUT_DIR/"
