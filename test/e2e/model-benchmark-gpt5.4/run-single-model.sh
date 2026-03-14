#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

require_cmd ssh
require_cmd scp
require_cmd python3
require_cmd git

[ $# -eq 1 ] || die "Usage: $0 <model-id>"
MODEL_ID="$1"
ensure_model_id "$MODEL_ID"
ensure_results_dir

RESULT_DIR="$(result_dir "$MODEL_ID")"
mkdir -p "$RESULT_DIR"

PRIMARY="$(model_primary "$MODEL_ID")"
MODEL_NAME="$(model_name "$MODEL_ID")"

log "Starting benchmark for $MODEL_NAME ($MODEL_ID)"

ssh_base "bash -s" <<'REMOTE_CLEAN'
set -e
systemctl stop bps-dashboard 2>/dev/null || true
systemctl stop openclaw-gateway 2>/dev/null || true
pkill -f "openclaw gateway" 2>/dev/null || true
sleep 3
[ -d /root/.aida ] && mv /root/.aida "/root/.aida.bak.$(date +%Y%m%d%H%M%S)"
rm -rf /root/.openclaw/workspace/ 2>/dev/null || true
rm -rf /root/.openclaw/workspace-* 2>/dev/null || true
rm -rf /root/.openclaw/agents/main/sessions/ 2>/dev/null || true
find /root/.openclaw \( -name 'cron*.json' -o -name 'cron*.jsonl' -o -name 'sessions.json' \) -delete 2>/dev/null || true
rm -rf /tmp/idlex-geo-e2e-v3 /tmp/benchmark-output /tmp/model-benchmark-gpt5.4
mkdir -p /tmp/model-benchmark-gpt5.4
echo clean-ok
REMOTE_CLEAN

ssh_base "mkdir -p /root/aida/.dev" 
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$ROOT_DIR/.dev/model-api-keys.env" "$SSH_HOST:/root/aida/.dev/model-api-keys.env" >/dev/null 2>&1 || true
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$ROOT_DIR/.dev/google-gemini-api.env" "$SSH_HOST:/root/aida/.dev/google-gemini-api.env" >/dev/null 2>&1 || true
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$ROOT_DIR/.dev/openrouter-api.env" "$SSH_HOST:/root/aida/.dev/openrouter-api.env" >/dev/null 2>&1 || true
ssh_base "python3 - <<'PY'
from pathlib import Path
for file in [Path('/root/aida/.dev/model-api-keys.env'), Path('/root/aida/.dev/google-gemini-api.env'), Path('/root/aida/.dev/openrouter-api.env')]:
    if file.exists():
        text = file.read_text(encoding='utf-8', errors='ignore').replace('\r\n', '\n')
        file.write_text(text, encoding='utf-8')
PY"


PRIMARY="$PRIMARY" python3 - <<'PY' > /tmp/model-benchmark-gpt5.4-config.json
import json
print(json.dumps({
  'agents': {
    'defaults': {
      'model': {
        'primary': __import__('os').environ['PRIMARY'],
        'fallbacks': ['dashscope/qwen3.5-plus', 'kimi/kimi-for-coding']
      }
    }
  }
}))
PY
CONFIG_JSON="$(python3 -c 'from pathlib import Path; print(Path("/tmp/model-benchmark-gpt5.4-config.json").read_text(encoding="utf-8"))')"
printf '%s\n' "$PRIMARY" > /tmp/model-benchmark-primary.txt
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no /tmp/model-benchmark-primary.txt "$SSH_HOST:/tmp/model-benchmark-primary.txt" >/dev/null

ssh_base "bash -s" <<REMOTE_CONFIG
set -e
cp /root/.openclaw/openclaw.json /root/.openclaw/openclaw.json.bak 2>/dev/null || true
cat > /tmp/model-merge.js <<'NODE'
const fs = require('fs');
const existing = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json.bak', 'utf8'));
const update = $CONFIG_JSON;
existing.agents = existing.agents || {};
existing.agents.defaults = existing.agents.defaults || {};
existing.agents.defaults.model = update.agents.defaults.model;
fs.writeFileSync('/root/.openclaw/openclaw.json', JSON.stringify(existing, null, 2));
console.log(existing.agents.defaults.model.primary);
NODE
node /tmp/model-merge.js
REMOTE_CONFIG

ssh_base "bash -s" <<'REMOTE_PATCH'
set -e
python3 - <<'PY'
import json
from pathlib import Path

config_path = Path('/root/.openclaw/openclaw.json')
config = json.loads(config_path.read_text(encoding='utf-8'))
primary = Path('/tmp/model-benchmark-primary.txt').read_text(encoding='utf-8').strip() if Path('/tmp/model-benchmark-primary.txt').exists() else config['agents']['defaults']['model'].get('primary')
config.setdefault('agents', {}).setdefault('defaults', {}).setdefault('model', {})['primary'] = primary
model_map = config['agents']['defaults'].setdefault('models', {})
model_map[primary] = {'alias': f'Benchmark target: {primary}'}
config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PY
REMOTE_PATCH

ssh_base "bash -s" <<'REMOTE_PROVIDER_PATCH'
set -e
python3 - <<'PY'
import json
from pathlib import Path

models_path = Path('/root/.openclaw/agents/main/agent/models.json')
models_path.parent.mkdir(parents=True, exist_ok=True)
data = {}
if models_path.exists():
    try:
        data = json.loads(models_path.read_text(encoding='utf-8'))
    except Exception:
        data = {}
providers = data.setdefault('providers', {})

providers['google'] = {
    'baseUrl': 'https://generativelanguage.googleapis.com/v1beta',
    'api': 'google-generative-ai',
    'models': [{
        'id': 'gemini-3.1-pro-preview',
        'name': 'Gemini 3.1 Pro Preview',
        'reasoning': False,
        'input': ['text', 'image'],
        'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0},
        'contextWindow': 1000000,
        'maxTokens': 8192,
    }],
    'apiKey': 'GOOGLE_API_KEY'
}
providers['zhipu'] = {
    'baseUrl': 'https://api.z.ai/api/paas/v4',
    'api': 'openai-completions',
    'models': [{
        'id': 'glm-5',
        'name': 'GLM-5',
        'reasoning': True,
        'input': ['text'],
        'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0},
        'contextWindow': 128000,
        'maxTokens': 8192,
    }],
    'apiKey': 'ZHIPU_API_KEY'
}
providers.setdefault('moonshot', {
    'baseUrl': 'https://api.moonshot.ai/v1',
    'api': 'openai-completions',
    'models': [{
        'id': 'kimi-k2.5',
        'name': 'Kimi K2.5',
        'reasoning': False,
        'input': ['text', 'image'],
        'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0},
        'contextWindow': 256000,
        'maxTokens': 8192,
    }],
    'apiKey': 'MOONSHOT_API_KEY'
})
providers.setdefault('dashscope', {
    'baseUrl': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    'api': 'openai-completions',
    'models': [{
        'id': 'qwen3.5-plus',
        'name': 'Qwen3.5 Plus',
        'reasoning': True,
        'input': ['text'],
        'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0},
        'contextWindow': 131072,
        'maxTokens': 8192,
    }],
    'apiKey': 'DASHSCOPE_API_KEY'
})

models_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PY
REMOTE_PROVIDER_PATCH

ssh_base "bash -s" <<'REMOTE_INSTALL_PATCH'
set -e
python3 - <<'PY'
from pathlib import Path

path = Path('/root/aida/deploy/install-aida.sh')
text = path.read_text(encoding='utf-8')
old = 'config.agents.defaults.model = { primary: "dashscope/qwen3.5-plus" };\nconfig.agents.defaults.models = { "dashscope/qwen3.5-plus": { alias: "Qwen3.5-Plus via DashScope" } };\n'
new = 'const benchmarkPrimary = process.env.AIDA_BENCHMARK_PRIMARY || "dashscope/qwen3.5-plus";\nconfig.agents.defaults.model = { primary: benchmarkPrimary };\nconfig.agents.defaults.models = { [benchmarkPrimary]: { alias: `Benchmark primary via ${benchmarkPrimary}` } };\n'
if old in text and 'AIDA_BENCHMARK_PRIMARY' not in text:
    text = text.replace(old, new)
    path.write_text(text, encoding='utf-8')
PY
REMOTE_INSTALL_PATCH

scp -i "$SSH_KEY" -o StrictHostKeyChecking=no /tmp/model-benchmark-primary.txt "$SSH_HOST:/tmp/model-benchmark-primary.txt" >/dev/null
printf '%s\n' "$MODEL_ID" > /tmp/model-benchmark-model-id.txt
printf '%s\n' "$MODEL_NAME" > /tmp/model-benchmark-model-name.txt
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no /tmp/model-benchmark-model-id.txt "$SSH_HOST:/tmp/model-benchmark-model-id.txt" >/dev/null
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no /tmp/model-benchmark-model-name.txt "$SSH_HOST:/tmp/model-benchmark-model-name.txt" >/dev/null

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=30 "$SSH_HOST" "bash -s" <<'REMOTE_RUN'
set -e
cd /root/aida
git pull --recurse-submodules 2>&1 >/tmp/model-benchmark-gpt5.4/git-pull.log || true
set +a
[ -f /root/aida/.dev/openrouter-api.env ] && source /root/aida/.dev/openrouter-api.env || true
[ -f /root/aida/.dev/google-gemini-api.env ] && source /root/aida/.dev/google-gemini-api.env || true
[ -f /root/aida/.dev/model-api-keys.env ] && source /root/aida/.dev/model-api-keys.env || true
if [ -n "${GOOGLE_API_KEY:-}" ]; then export GOOGLE_API_KEY; fi
if [ -n "${OPENROUTER_API_KEY:-}" ]; then export OPENROUTER_API_KEY; fi
if [ -n "${MOONSHOT_API_KEY:-}" ]; then export MOONSHOT_API_KEY; fi
if [ -n "${DASHSCOPE_API_KEY:-}" ]; then export DASHSCOPE_API_KEY; fi
if [ -n "${ZHIPU_API_KEY:-}" ]; then export ZHIPU_API_KEY; fi
set -a

MODEL_ID="$(cat /tmp/model-benchmark-model-id.txt)"
MODEL_NAME="$(cat /tmp/model-benchmark-model-name.txt)"
PRIMARY="$(cat /tmp/model-benchmark-primary.txt)"
export AIDA_BENCHMARK_PRIMARY="$PRIMARY"

mkdir -p /tmp/model-benchmark-gpt5.4/$MODEL_ID

echo '=== MODEL ===' | tee /tmp/model-benchmark-gpt5.4/$MODEL_ID/run.log
echo "$PRIMARY" | tee -a /tmp/model-benchmark-gpt5.4/$MODEL_ID/run.log

bash deploy/install-aida.sh >> /tmp/model-benchmark-gpt5.4/$MODEL_ID/run.log 2>&1
openclaw gateway start >> /tmp/model-benchmark-gpt5.4/$MODEL_ID/run.log 2>&1 || true

for i in \
  1 2 3 4 5 6 7 8 9 10 11 12; do
  if openclaw gateway status 2>/dev/null | grep -qiE 'running|healthy|active'; then
    echo "gateway-ready:$i" >> /tmp/model-benchmark-gpt5.4/$MODEL_ID/run.log
    break
  fi
  sleep 5
done

set +e
bash test/e2e/idlex-geo-v3.sh > /tmp/model-benchmark-gpt5.4/$MODEL_ID/e2e-test.log 2>&1
TEST_EXIT=$?
set -e

mkdir -p /tmp/model-benchmark-gpt5.4/$MODEL_ID/raw
cp /tmp/idlex-geo-e2e-v3/* /tmp/model-benchmark-gpt5.4/$MODEL_ID/raw/ 2>/dev/null || true

PASS_N=$(python3 -c "import re, pathlib; text=pathlib.Path('/tmp/model-benchmark-gpt5.4/${MODEL_ID}/e2e-test.log').read_text(encoding='utf-8', errors='ignore'); nums=re.findall(r'(\\d+) PASS', text); print(nums[-1] if nums else '0')")
FAIL_N=$(python3 -c "import re, pathlib; text=pathlib.Path('/tmp/model-benchmark-gpt5.4/${MODEL_ID}/e2e-test.log').read_text(encoding='utf-8', errors='ignore'); nums=re.findall(r'(\\d+) FAIL', text); print(nums[-1] if nums else '0')")
WARN_N=$(python3 -c "import re, pathlib; text=pathlib.Path('/tmp/model-benchmark-gpt5.4/${MODEL_ID}/e2e-test.log').read_text(encoding='utf-8', errors='ignore'); nums=re.findall(r'(\\d+) WARN', text); print(nums[-1] if nums else '0')")
ENTITIES=$(curl -sf http://localhost:3456/api/entities 2>/dev/null | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
SERVICES=$(curl -sf http://localhost:3456/api/services 2>/dev/null | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
RULES=$(curl -sf http://localhost:3456/api/rules 2>/dev/null | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
VIOLATIONS=$(curl -sf http://localhost:3456/api/governance/violations 2>/dev/null | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
APPROVALS=$(curl -sf http://localhost:3456/api/governance/approvals 2>/dev/null | python3 -c "import sys, json; print(len([x for x in json.load(sys.stdin) if x.get('status') == 'APPROVED']))" 2>/dev/null || echo 0)
SKILLS=$(find /root/.openclaw/workspace/skills -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')
AGENTS=$(find /root/.openclaw/workspace -maxdepth 1 -type d -name 'workspace-*' 2>/dev/null | wc -l | tr -d ' ')
BLUEPRINTS=$(find /root/.aida/blueprints -type f \( -name '*.yaml' -o -name '*.yml' \) 2>/dev/null | wc -l | tr -d ' ')

cat > /tmp/model-benchmark-gpt5.4/$MODEL_ID/metrics.json <<JSON
{
  "modelId": "$MODEL_ID",
  "modelName": "$MODEL_NAME",
  "primary": "$PRIMARY",
  "timestamp": "$(date -Iseconds)",
  "pass": ${PASS_N:-0},
  "fail": ${FAIL_N:-0},
  "warn": ${WARN_N:-0},
  "entities": ${ENTITIES:-0},
  "skills": ${SKILLS:-0},
  "agentWorkspaces": ${AGENTS:-0},
  "blueprints": ${BLUEPRINTS:-0},
  "services": ${SERVICES:-0},
  "rules": ${RULES:-0},
  "violations": ${VIOLATIONS:-0},
  "approvals": ${APPROVALS:-0},
  "testExit": ${TEST_EXIT:-0}
}
JSON

rm -f /tmp/model-benchmark-gpt5.4/$MODEL_ID/results.tar.gz
tar --exclude=results.tar.gz -czf /tmp/model-benchmark-gpt5.4/$MODEL_ID/results.tar.gz -C /tmp/model-benchmark-gpt5.4/$MODEL_ID .
echo benchmark-complete
REMOTE_RUN

scp_from_remote "/tmp/model-benchmark-gpt5.4/$MODEL_ID/results.tar.gz" "$RESULT_DIR/results.tar.gz"
tar -xzf "$RESULT_DIR/results.tar.gz" -C "$RESULT_DIR"

RESULT_DIR_ENV="$RESULT_DIR" python3 - <<'PY'
import json
import os
from pathlib import Path

metrics = json.loads(Path(os.environ['RESULT_DIR_ENV'], 'metrics.json').read_text(encoding='utf-8'))
pass_n = metrics['pass']
fail_n = metrics['fail']
warn_n = metrics['warn']
entities = metrics['entities']
skills = metrics['skills']
agents = metrics['agentWorkspaces']
blueprints = metrics['blueprints']
violations = metrics['violations']
approvals = metrics['approvals']

business = 9 if pass_n >= 40 else 7 if pass_n >= 32 else 5
tool = 9 if entities >= 14 and skills >= 7 else 7 if entities >= 8 and skills >= 5 else 5
layer = 10 if blueprints >= 1 and violations >= 1 else 8 if blueprints >= 1 else 6
governance = 10 if violations >= 1 else 6 if blueprints >= 1 else 4
self_evo = 10 if agents >= 1 else 5 if skills >= 7 else 3
response = 9 if fail_n == 0 and warn_n <= 2 else 8 if fail_n == 0 else 6
weighted = round(
    business * 0.25 + tool * 0.30 + layer * 0.15 + governance * 0.15 + self_evo * 0.10 + response * 0.05,
    2,
)

report = f'''# {metrics["modelName"]} 业务场景效能评测报告

**测试日期**: {metrics["timestamp"][:10]}
**测试方案**: IdleX GEO E2E v3
**模型**: `{metrics["primary"]}`

## 测试结果概览

| 指标 | 数值 |
|------|------|
| Pass | {pass_n} |
| Fail | {fail_n} |
| Warn | {warn_n} |
| Entities | {entities} |
| Skills | {skills} |
| Agent Workspaces | {agents} |
| Blueprints | {blueprints} |
| Governance Violations | {violations} |
| Approved Requests | {approvals} |

## 分维度评估

### 1. 业务理解 (25%)

评分: {business}/10

- 以 `Pass/Warn/Fail` 结果衡量对 6-turn 业务场景的覆盖程度。
- Pass 越高，代表模型越能正确理解 IdleX GEO 运营链路与业务语境。

### 2. 工具调用 (30%)

评分: {tool}/10

- 以实体、技能、蓝图、服务拓扑等产物数量估算落地深度。
- `Entities={entities}`, `Skills={skills}`, `Services={metrics['services']}`, `Rules={metrics['rules']}`。

### 3. Two-Layer 路由 (15%)

评分: {layer}/10

- 使用 Blueprint 与管理触发情况评估是否区分 Governance 与 Operations。
- `Blueprints={blueprints}`, `Violations={violations}`。

### 4. 管理合规 (15%)

评分: {governance}/10

- 重点看是否真正触发管理拦截而非口头描述审批。
- `Violations={violations}`, `Approvals={approvals}`。

### 5. 自我进化 (10%)

评分: {self_evo}/10

- 通过 Skill 与独立 Agent workspace 产物判断是否完成重复模式结晶与人格隔离。

### 6. 响应质量 (5%)

评分: {response}/10

- 以整体测试稳定性近似衡量输出质量与执行清晰度。

## 综合评分

**加权总分: {weighted}/10**

## 结论

- 该模型在 IdleX GEO 业务场景中的总体表现基于自动化指标计算得出。
- 原始日志见 `test/e2e/model-benchmark-gpt5.4/results/{metrics['modelId']}/`。
'''

Path(os.environ['RESULT_DIR_ENV'], 'EVALUATION.md').write_text(report, encoding='utf-8')
PY

cat > "$RESULT_DIR/model-info.json" <<JSON
{
  "id": "$MODEL_ID",
  "name": "$MODEL_NAME",
  "provider": "$(model_provider "$MODEL_ID")",
  "primary": "$PRIMARY",
  "timestamp": "$(date -Iseconds)"
}
JSON

log "Benchmark result ready at $RESULT_DIR"
