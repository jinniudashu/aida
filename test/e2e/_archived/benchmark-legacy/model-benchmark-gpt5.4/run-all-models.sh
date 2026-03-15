#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

require_cmd python3
require_cmd git

"$SCRIPT_DIR/preflight.sh"

for model_id in "${MODELS[@]}"; do
  "$SCRIPT_DIR/run-single-model.sh" "$model_id"

  git add "test/e2e/model-benchmark-gpt5.4/results/$model_id/"
  git add "test/e2e/model-benchmark-gpt5.4/README.md" \
          "test/e2e/model-benchmark-gpt5.4/lib.sh" \
          "test/e2e/model-benchmark-gpt5.4/preflight.sh" \
          "test/e2e/model-benchmark-gpt5.4/run-single-model.sh" \
          "test/e2e/model-benchmark-gpt5.4/run-all-models.sh" \
          "test/e2e/model-benchmark-gpt5.4/preflight-report.md"

  if ! git diff --cached --quiet; then
    git commit -m "test: add $model_id IdleX GEO benchmark result"
    git push origin main
  fi
done

python3 - <<'PY'
import json
from pathlib import Path

root = Path('/Users/miles/Documents/JiangNing/aida/test/e2e/model-benchmark-gpt5.4')
results_dir = root / 'results'
rows = []
for metrics_file in sorted(results_dir.glob('*/metrics.json')):
    metrics = json.loads(metrics_file.read_text(encoding='utf-8'))
    rows.append(metrics)

rows.sort(key=lambda item: (-item['pass'], item['fail'], item['warn']))

lines = []
lines.append('# 六模型综合评测报告')
lines.append('')
lines.append('**测试方案**: IdleX GEO E2E v3')
lines.append('**结果目录**: `test/e2e/model-benchmark-gpt5.4/results/`')
lines.append('')
lines.append('| 排名 | 模型 | Pass | Fail | Warn | Entities | Skills | Agents | Blueprints | Violations | Approvals |')
lines.append('|------|------|------|------|------|----------|--------|--------|------------|------------|-----------|')
for idx, item in enumerate(rows, start=1):
    lines.append(
        f"| {idx} | {item['modelName']} | {item['pass']} | {item['fail']} | {item['warn']} | {item['entities']} | {item['skills']} | {item['agentWorkspaces']} | {item['blueprints']} | {item['violations']} | {item['approvals']} |"
    )

lines.append('')
lines.append('## 结论')
lines.append('')
if rows:
    best = rows[0]
    lines.append(f"- 综合表现最佳模型: `{best['primary']}`")
    lines.append('- 本报告按 Pass 优先、Fail/Warn 次级排序，作为业务场景效能的统一比较口径。')
    lines.append('- 单模型详细分析见各自 `EVALUATION.md`。')

(root / 'COMPARISON.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
PY

git add "test/e2e/model-benchmark-gpt5.4/COMPARISON.md"
if ! git diff --cached --quiet; then
  git commit -m "test: add six-model IdleX GEO benchmark comparison"
  git push origin main
fi

log "All model runs complete"
