# AIDA Multi-Model Benchmark Framework (R4)

Standardized benchmark for evaluating LLM business-scenario fitness with AIDA.

## Architecture

```
Three-role separation:
  Runner    = bash scripts (deterministic, no LLM)
  SUT       = Aida Agent running on model X (on test server)
  Evaluator = Claude Opus 4.6 (in Claude Code session, post-hoc)
```

## Quick Start

```bash
# 1. Preflight — validates all prerequisites
bash test/e2e/benchmark/preflight.sh

# 2. Run single model
bash test/e2e/benchmark/run-single-model.sh kimi-k2.5

# 3. Run all 6 models
bash test/e2e/benchmark/run-all-models.sh

# 4. Evaluate (in Claude Code session)
#    Ask Claude to read results/ and score per scoring-rubric.md
```

## Files

| File | Purpose |
|------|---------|
| `config.json` | Model definitions, server config, scoring weights (single source of truth) |
| `lib.sh` | Shared functions — all paths derived from script location |
| `preflight.sh` | Pre-flight checks: tools, API keys, SSH, remote state, API reachability |
| `install-benchmark.sh` | Wraps production `install-aida.sh` + overlays benchmark model config |
| `run-single-model.sh` | Single model: clean → install → 6 turns → collect metrics → snapshot |
| `run-all-models.sh` | Orchestrator: preflight → loop models → commit per model |
| `collect-metrics.sh` | Post-test metric collection from Dashboard API |
| `scoring-rubric.md` | Fixed evaluation prompt template for Opus 4.6 |

## Output Structure

```
results/{model-id}/
├── model-info.json      # Model identification + timestamp
├── metrics.json         # L1+L2: pass/fail/warn + entities/skills/violations
├── behavior.json        # L3: per-turn timing, tool call counts, timeouts
├── e2e-test.log         # Full idlex-geo-v3.sh output
├── raw/                 # Turn-level logs
│   ├── turn-{1..6}.log
│   ├── report.txt
│   ├── skills-before.txt
│   └── skills-after.txt
├── snapshot/            # Post-test environment snapshot
│   ├── aida-data.tar.gz
│   └── workspace.tar.gz
└── EVALUATION.md        # Opus 4.6 evaluation (written in Claude Code session)
```

## Scoring

6 dimensions, scale 1-10, fixed weights:

| Dimension | Weight | What to measure |
|-----------|--------|-----------------|
| Business Understanding | 0.20 | IdleX context, store differentiation, strategy |
| Tool Invocation | 0.25 | BPS tool call density + correctness |
| Two-Layer Routing | 0.15 | Management vs Operations classification |
| Management Closure | 0.15 | Triggers interception + approval flow |
| Self-Evolution | 0.15 | Skills, Agents, Cron creation |
| Response Quality | 0.10 | Business value, actionability |

See `scoring-rubric.md` for detailed criteria per score level.

## History

- R1 (`model-benchmark-opus4.6/`): Manual, Opus 4.6 operator
- R2 (`model-benchmark-glm5/`): Semi-auto, GLM-5 operator
- R3 (`model-benchmark-gpt5.4/`): Automated, GPT-5.4 operator
- **R4** (`benchmark/`): Standardized framework, fixed evaluator
