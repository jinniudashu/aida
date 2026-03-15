# Benchmark Preflight Report

Generated: 2026-03-10T07:47:50

## Model Config Validation

| Model | Provider | Provider OK | Model ID | Model OK | API | API OK |
|-------|----------|-------------|----------|----------|-----|--------|
| claude-opus-4.6 | openrouter | YES | anthropic/claude-opus-4.6 | YES | openai-completions | YES |
| gpt-5.4 | openrouter | YES | openai/gpt-5.4 | YES | openai-completions | YES |
| gemini-3.1-pro | google | YES | gemini-3.1-pro-preview | YES | google-generative-ai | YES |
| kimi-k2.5 | moonshot | YES | kimi-k2.5 | YES | openai-completions | YES |
| glm-5 | zhipu | YES | glm-5 | YES | openai-completions | YES |
| qwen3.5-plus | dashscope | YES | qwen3.5-plus | YES | openai-completions | YES |

## API Key Presence

| Model | Provider | Env File | Env Var | Present | Token |
|-------|----------|----------|---------|---------|-------|
| claude-opus-4.6 | openrouter | `.dev/openrouter-api.env` | `OPENROUTER_API_KEY` | YES | sk-or-...aef6 |
| gpt-5.4 | openrouter | `.dev/openrouter-api.env` | `OPENROUTER_API_KEY` | YES | sk-or-...aef6 |
| gemini-3.1-pro | google | `.dev/google-gemini-api.env` | `GOOGLE_API_KEY` | YES | AIzaSy...baCw |
| kimi-k2.5 | moonshot | `.dev/model-api-keys.env` | `MOONSHOT_API_KEY` | YES | sk-Fx6...R6zF |
| qwen3.5-plus | dashscope | `.dev/model-api-keys.env` | `DASHSCOPE_API_KEY` | YES | sk-aea...94ec |
| glm-5 | zhipu | `.dev/model-api-keys.env` | `ZHIPU_API_KEY` | YES | f514bd...pS8g |

## Remote Connectivity

- SSH connectivity: yes
- repo: YES
- openclaw_config: YES
- install_script: YES
- e2e_script: YES

## Provider Readiness

- Gemini provider registration: yes
