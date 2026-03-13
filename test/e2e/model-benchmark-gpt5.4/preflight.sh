#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

require_cmd ssh
require_cmd python3
require_cmd curl
require_cmd node

ensure_results_dir

REPORT="$SCRIPT_DIR/preflight-report.md"
TMP_JSON="$SCRIPT_DIR/preflight-status.json"
REMOTE_JSON_FILE="$SCRIPT_DIR/preflight-remote.json"
API_JSON_FILE="$SCRIPT_DIR/preflight-api.json"

log "Running preflight checks"

python3 - <<'PY' > "$TMP_JSON"
import json
from pathlib import Path

root = Path('/Users/miles/Documents/JiangNing/aida')
config = json.loads((root / 'test/e2e/model-benchmark-config.json').read_text(encoding='utf-8'))
target = {
    'claude-opus-4.6': 'anthropic/claude-opus-4.6',
    'gpt-5.4': 'openai/gpt-5.4',
    'gemini-3.1-pro': 'gemini-3.1-pro-preview',
    'kimi-k2.5': 'kimi-k2.5',
    'qwen3.5-plus': 'qwen3.5-plus',
    'glm-5': 'glm-5',
}
provider = {
    'claude-opus-4.6': 'openrouter',
    'gpt-5.4': 'openrouter',
    'gemini-3.1-pro': 'google',
    'kimi-k2.5': 'moonshot',
    'qwen3.5-plus': 'dashscope',
    'glm-5': 'zhipu',
}
status = []
for item in config['models']:
    mid = item['id']
    if mid not in target:
        continue
    status.append({
        'id': mid,
        'configuredProvider': item['provider'],
        'expectedProvider': provider[mid],
        'providerOk': item['provider'] == provider[mid],
        'configuredModelId': item['modelId'],
        'expectedModelId': target[mid],
        'modelOk': item['modelId'] == target[mid],
        'configuredApi': item.get('apiConfig', {}).get('api', ''),
        'expectedApi': 'google-generative-ai' if mid == 'gemini-3.1-pro' else item.get('apiConfig', {}).get('api', ''),
        'apiOk': (item.get('apiConfig', {}).get('api', '') == 'google-generative-ai') if mid == 'gemini-3.1-pro' else True,
    })
print(json.dumps(status, ensure_ascii=False, indent=2))
PY

SSH_OK=no
if ssh_base "echo connected" >/tmp/model-benchmark-preflight-ssh.txt 2>/tmp/model-benchmark-preflight-ssh.err; then
  SSH_OK=yes
fi

ssh_base "python3 - <<'PY'
import json, os
paths = {
  'repo': os.path.isdir('/root/aida'),
  'openclaw_config': os.path.isfile('/root/.openclaw/openclaw.json'),
  'install_script': os.path.isfile('/root/aida/deploy/install-aida.sh'),
  'e2e_script': os.path.isfile('/root/aida/test/e2e/idlex-geo-v3.sh'),
}
print(json.dumps(paths))
PY" > "$REMOTE_JSON_FILE" 2>/dev/null || printf '{}' > "$REMOTE_JSON_FILE"

python3 - <<'PY' > "$API_JSON_FILE"
import json, os
from pathlib import Path

root = Path('/Users/miles/Documents/JiangNing/aida')
models = [
    ('claude-opus-4.6', 'openrouter', root / '.dev/openrouter-api.env', 'OPENROUTER_API_KEY'),
    ('gpt-5.4', 'openrouter', root / '.dev/openrouter-api.env', 'OPENROUTER_API_KEY'),
    ('gemini-3.1-pro', 'google', root / '.dev/google-gemini-api.env', 'GOOGLE_API_KEY'),
    ('kimi-k2.5', 'moonshot', root / '.dev/model-api-keys.env', 'MOONSHOT_API_KEY'),
    ('qwen3.5-plus', 'dashscope', root / '.dev/model-api-keys.env', 'DASHSCOPE_API_KEY'),
    ('glm-5', 'zhipu', root / '.dev/model-api-keys.env', 'ZHIPU_API_KEY'),
]

def parse_env(path: Path):
    values = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        values[k.strip()] = v.strip().strip('"').strip("'")
    return values

cache = {}
results = []
for mid, provider, path, env_var in models:
    envs = cache.setdefault(str(path), parse_env(path))
    token = envs.get(env_var, '')
    results.append({
        'id': mid,
        'provider': provider,
        'envFile': str(path.relative_to(root)),
        'envVar': env_var,
        'present': bool(token),
        'masked': (token[:6] + '...' + token[-4:]) if len(token) >= 12 else ('set' if token else ''),
    })
print(json.dumps(results, ensure_ascii=False))
PY

export TMP_JSON REMOTE_JSON_FILE API_JSON_FILE SSH_OK

python3 - <<'PY' > "$REPORT"
import json
import os
from datetime import datetime
from pathlib import Path

config_status = json.loads(Path(os.environ['TMP_JSON']).read_text(encoding='utf-8'))
remote_status = json.loads(Path(os.environ['REMOTE_JSON_FILE']).read_text(encoding='utf-8') or '{}')
api_status = json.loads(Path(os.environ['API_JSON_FILE']).read_text(encoding='utf-8'))
ssh_ok = os.environ['SSH_OK']

lines = []
lines.append('# Benchmark Preflight Report')
lines.append('')
lines.append(f'Generated: {datetime.now().isoformat(timespec="seconds")}')
lines.append('')
lines.append('## Model Config Validation')
lines.append('')
lines.append('| Model | Provider | Provider OK | Model ID | Model OK | API | API OK |')
lines.append('|-------|----------|-------------|----------|----------|-----|--------|')
for item in config_status:
    lines.append(
        f"| {item['id']} | {item['configuredProvider']} | {'YES' if item['providerOk'] else 'NO'} | {item['configuredModelId']} | {'YES' if item['modelOk'] else 'NO'} | {item['configuredApi']} | {'YES' if item['apiOk'] else 'NO'} |"
    )
lines.append('')
lines.append('## API Key Presence')
lines.append('')
lines.append('| Model | Provider | Env File | Env Var | Present | Token |')
lines.append('|-------|----------|----------|---------|---------|-------|')
for item in api_status:
    lines.append(
        f"| {item['id']} | {item['provider']} | `{item['envFile']}` | `{item['envVar']}` | {'YES' if item['present'] else 'NO'} | {item['masked'] or '-'} |"
    )
lines.append('')
lines.append('## Remote Connectivity')
lines.append('')
lines.append(f'- SSH connectivity: {ssh_ok}')
for key, value in remote_status.items():
    lines.append(f'- {key}: {"YES" if value else "NO"}')
lines.append('')
lines.append('## Provider Readiness')
lines.append('')
lines.append('- Gemini provider registration: pending runtime check')
print('\n'.join(lines) + '\n', end='')
PY

cat "$REPORT"

if [ "$SSH_OK" != "yes" ]; then
  die "SSH preflight failed"
fi

GEMINI_PROVIDER_OK="not-run"
if ssh_base "bash -lc 'set -a; [ -f /root/aida/.dev/google-gemini-api.env ] && source /root/aida/.dev/google-gemini-api.env || true; set +a; python3 - <<\"PY\"
from pathlib import Path
text = Path(\"/root/.local/share/pnpm/global/5/.pnpm/@mariozechner+pi-ai@0.55.3_ws@8.19.0_zod@4.3.6/node_modules/@mariozechner/pi-ai/dist/providers/register-builtins.js\").read_text(encoding=\"utf-8\", errors=\"ignore\")
print(\"google-generative-ai\" in text)
PY'" | grep -q '^True$'; then
  GEMINI_PROVIDER_OK="yes"
else
  GEMINI_PROVIDER_OK="no"
fi

REPORT_PATH="$REPORT" GEMINI_PROVIDER_OK="$GEMINI_PROVIDER_OK" python3 - <<'PY'
from pathlib import Path
import os
path = Path(os.environ['REPORT_PATH'])
text = path.read_text(encoding='utf-8')
text = text.replace('Gemini provider registration: pending runtime check', f"Gemini provider registration: {os.environ['GEMINI_PROVIDER_OK']}")
path.write_text(text, encoding='utf-8')
PY

cat "$REPORT"

python3 - <<'PY'
import json
from pathlib import Path
status = json.loads(Path('/Users/miles/Documents/JiangNing/aida/test/e2e/model-benchmark-gpt5.4/preflight-status.json').read_text(encoding='utf-8'))
if not all(item['providerOk'] and item['modelOk'] and item['apiOk'] for item in status):
    raise SystemExit('Config validation failed')
PY

python3 - <<'PY'
import json
from pathlib import Path
api = json.loads(Path('/Users/miles/Documents/JiangNing/aida/test/e2e/model-benchmark-gpt5.4/preflight-api.json').read_text(encoding='utf-8'))
missing = [item['id'] for item in api if not item['present']]
if missing:
    raise SystemExit('Missing API keys for: ' + ', '.join(missing))
PY

if [ "$GEMINI_PROVIDER_OK" != "yes" ]; then
  die "Gemini provider registration check failed"
fi

log "Preflight checks passed"
