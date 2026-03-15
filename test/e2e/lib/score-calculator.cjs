#!/usr/bin/env node
// ============================================================
// AIDA Evaluation Score Calculator
// ============================================================
// Reads metrics.json + rubric → computes composite score + gap analysis.
// Pure Node.js, no dependencies.
//
// Usage:
//   node lib/score-calculator.js \
//     --metrics /tmp/structural-capability/metrics.json \
//     --rubric  rubrics/structural.json \
//     [--results results.tsv] \
//     [--scheme structural-v2] \
//     [--commit abc123] \
//     [--model dashscope/qwen3.5-plus] \
//     [--notes "R4 fix #2"]
//
// Output: formatted score report to stdout + optional TSV append
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

// -- Parse CLI args --
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  args[key] = process.argv[i + 1] || '';
}

if (!args.metrics || !args.rubric) {
  console.error('Usage: node score-calculator.js --metrics <path> --rubric <path> [--results <tsv>] [--scheme <name>] [--commit <hash>] [--model <id>] [--notes <text>]');
  process.exit(1);
}

// -- Load inputs --
let metrics, rubric;
try {
  metrics = JSON.parse(fs.readFileSync(args.metrics, 'utf-8'));
} catch (e) {
  console.error(`Error reading metrics: ${e.message}`);
  process.exit(1);
}
try {
  rubric = JSON.parse(fs.readFileSync(args.rubric, 'utf-8'));
} catch (e) {
  console.error(`Error reading rubric: ${e.message}`);
  process.exit(1);
}

// -- Flatten metrics for lookup --
// metrics.json has top-level fields + nested testResults
const flat = { ...metrics };
if (metrics.testResults) {
  flat.pass = metrics.testResults.pass;
  flat.fail = metrics.testResults.fail;
  flat.warn = metrics.testResults.warn;
  flat.total = metrics.testResults.total;
  flat.passRate = metrics.testResults.total > 0
    ? metrics.testResults.pass / metrics.testResults.total
    : 0;
}
// Computed metrics
flat.approvalDecided = (flat.approvalDecided || 0);
flat.cronJobs = (flat.cronJobs || 0);
flat.agentWorkspaces = (flat.agentWorkspaces || 0);

// -- Score each dimension --
const results = [];

for (const dim of rubric.dimensions) {
  const ruleScores = [];

  for (const rule of dim.rules) {
    const value = flat[rule.metric] ?? 0;
    let score = rule.floor ?? 0;

    // Walk thresholds: score is the highest threshold met
    for (let i = 0; i < rule.thresholds.length; i++) {
      if (value >= rule.thresholds[i]) {
        score = rule.scores[i];
      }
    }

    // Find next threshold to reach (for gap hint)
    let nextThreshold = null;
    let nextScore = null;
    for (let i = 0; i < rule.thresholds.length; i++) {
      if (value < rule.thresholds[i]) {
        nextThreshold = rule.thresholds[i];
        nextScore = rule.scores[i];
        break;
      }
    }

    ruleScores.push({
      metric: rule.metric,
      value,
      score,
      nextThreshold,
      nextScore,
    });
  }

  // Aggregate rule scores
  const agg = dim.aggregate || 'avg';
  let dimScore;
  const scores = ruleScores.map(r => r.score);
  if (agg === 'min') {
    dimScore = Math.min(...scores);
  } else if (agg === 'max') {
    dimScore = Math.max(...scores);
  } else {
    dimScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  // Collect gaps
  const gaps = ruleScores
    .filter(r => r.nextThreshold !== null && r.score < (dim.target || rubric.target || 9))
    .map(r => `${r.metric} ${r.value}→${r.nextThreshold}`);

  results.push({
    id: dim.id,
    name: dim.name,
    weight: dim.weight,
    score: Math.round(dimScore * 10) / 10,
    target: dim.target || rubric.target || 9,
    gaps,
    met: dimScore >= (dim.target || rubric.target || 9),
  });
}

// -- Composite score --
const compositeScore = results.reduce((sum, r) => sum + r.score * r.weight, 0);
const composite = Math.round(compositeScore * 100) / 100;
const targetComposite = rubric.target || 9.0;

// -- Find previous best from results.tsv --
let prevBest = null;
let prevBestLine = null;
const scheme = args.scheme || rubric.name || 'unknown';
if (args.results && fs.existsSync(args.results)) {
  const lines = fs.readFileSync(args.results, 'utf-8').trim().split('\n');
  for (const line of lines) {
    if (line.startsWith('#') || line.startsWith('timestamp')) continue;
    const cols = line.split('\t');
    if (cols[1] === scheme) {
      const score = parseFloat(cols[6]);
      if (!isNaN(score) && (prevBest === null || score > prevBest)) {
        prevBest = score;
        prevBestLine = line;
      }
    }
  }
}

// -- Format output --
const NC = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

const deltaStr = prevBest !== null
  ? ` (prev best: ${prevBest.toFixed(2)}, Δ: ${composite >= prevBest ? GREEN + '+' : RED}${(composite - prevBest).toFixed(2)}${NC})`
  : '';

console.log('');
console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}`);
console.log(`${BOLD}  COMPOSITE SCORE:  ${composite >= targetComposite ? GREEN : composite >= targetComposite * 0.8 ? YELLOW : RED}${composite.toFixed(2)}${NC} / ${targetComposite.toFixed(2)}${deltaStr}`);
console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}`);
console.log('');

// Dimension table
const nameW = 24;
const header = `  ${'Dimension (weight)'.padEnd(nameW)}  Score  Target  Gap`;
console.log(`${DIM}${header}${NC}`);
console.log(`${DIM}  ${'─'.repeat(nameW)}  ─────  ──────  ${'─'.repeat(40)}${NC}`);

for (const r of results) {
  const label = `${r.name} (${r.weight.toFixed(2)})`.padEnd(nameW);
  const scoreColor = r.met ? GREEN : r.score >= r.target * 0.7 ? YELLOW : RED;
  const gapStr = r.met ? `${GREEN}✓ met${NC}` : r.gaps.join(', ') || `${YELLOW}below target${NC}`;
  console.log(`  ${label}  ${scoreColor}${r.score.toFixed(1).padStart(5)}${NC}  ${String(r.target).padStart(6)}  ${gapStr}`);
}

console.log('');

// Top actions
const unmet = results
  .filter(r => !r.met)
  .sort((a, b) => b.weight - a.weight); // highest-weight gaps first

if (unmet.length > 0) {
  console.log(`${BOLD}  Top actions for next iteration:${NC}`);
  for (let i = 0; i < Math.min(3, unmet.length); i++) {
    const r = unmet[i];
    const potentialGain = (r.target - r.score) * r.weight;
    console.log(`  ${i + 1}. [${r.name}] ${r.gaps.join(', ') || 'improve score'}  ${DIM}(+${potentialGain.toFixed(2)} potential)${NC}`);
  }
  console.log('');
}

// Metrics summary
console.log(`${DIM}  Metrics: entities=${flat.entities||0} violations=${flat.violations||0} skills=${flat.skills||0} blueprints=${flat.blueprints||0} writes=${flat.writeToolCalls||0} workspaces=${flat.agentWorkspaces||0} cron=${flat.cronJobs||0}${NC}`);
console.log(`${DIM}  Test: ${flat.pass||0}P/${flat.fail||0}F/${flat.warn||0}W/${flat.total||0}T${NC}`);
console.log('');

// -- Append to results.tsv --
if (args.results) {
  const tsvDir = path.dirname(args.results);
  if (!fs.existsSync(tsvDir)) fs.mkdirSync(tsvDir, { recursive: true });

  if (!fs.existsSync(args.results)) {
    fs.writeFileSync(args.results, '# AIDA Evaluation Results\n# Auto-generated by aida-eval.sh — do not edit manually\ntimestamp\tscheme\tcommit\tmodel\tpass\tfail\tscore\tentities\tviolations\tskills\tnotes\n');
  }

  const timestamp = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
  const commit = args.commit || '?';
  const model = args.model || '?';
  const notes = args.notes || '';

  const tsv = [
    timestamp,
    scheme,
    commit.slice(0, 7),
    model,
    flat.pass || 0,
    flat.fail || 0,
    composite.toFixed(2),
    flat.entities || 0,
    flat.violations || 0,
    flat.skills || 0,
    notes,
  ].join('\t');

  fs.appendFileSync(args.results, tsv + '\n');
  console.log(`${DIM}  Appended to: ${args.results}${NC}`);
}

// -- Write score.json for programmatic consumption --
const scoreJson = {
  composite,
  target: targetComposite,
  delta: prevBest !== null ? composite - prevBest : null,
  prevBest,
  dimensions: results,
  metrics: flat,
  scheme,
  timestamp: new Date().toISOString(),
};

const scoreOutPath = path.join(path.dirname(args.metrics), 'score.json');
fs.writeFileSync(scoreOutPath, JSON.stringify(scoreJson, null, 2) + '\n');
console.log(`${DIM}  Score details: ${scoreOutPath}${NC}`);
console.log('');
