# 六模型综合评测报告

**测试方案**: IdleX GEO E2E v3
**结果目录**: `test/e2e/model-benchmark-gpt5.4/results/`

| 排名 | 模型 | Pass | Fail | Warn | Entities | Skills | Agents | Blueprints | Violations | 备注 |
|------|------|------|------|------|----------|--------|--------|------------|------------|------|
| 1 | Kimi K2.5 | 40 | 0 | 5 | 10 | 10 | 0 | 2 | 0 | stable high pass |
| 2 | Qwen3.5-Plus | 40 | 1 | 4 | 8 | 13 | 0 | 1 | 0 | strong structure |
| 3 | GPT-5.4 | 38 | 0 | 7 | 9 | 8 | 0 | 1 | 0 | balanced but shallow governance |
| 4 | Claude Opus 4.6 | 38 | 1 | 6 | 33 | 12 | 1 | 1 | 5 | best governance |
| 5 | Gemini 3.1 Pro Preview | 35 | 1 | 9 | 7 | 7 | 0 | 0 | 0 | provider failure |
| 6 | GLM-5 | 34 | 1 | 10 | 7 | 7 | 0 | 0 | 0 | session drift |

## 关键结论

- Claude Opus 4.6 与 Kimi K2.5 是当前业务场景完成度最高的两档；前者治理触发最强，后者稳定性最好。
- Qwen3.5-Plus 在结构化规划与流程设计上表现稳定，但治理闭环仍弱。
- GPT-5.4 具备较强规划能力，但实体化与审批闭环深度不足。
- Gemini 3.1 Pro 当前样本受限于 provider 装配失败，不能直接视为模型能力下限。
- GLM-5 主要问题是会话语义漂移，导致中后程明显偏离任务。

## 建议

1. 生产主力优先考虑 `openrouter/anthropic/claude-opus-4.6` 与 `moonshot/kimi-k2.5`。
2. 若强调中文结构化表达，可将 `dashscope/qwen3.5-plus` 作为备选。
3. 在 OpenClaw 修复 Google provider 装配前，不建议把 Gemini 样本纳入公平横比。
4. 后续 benchmark 应继续保留安装阶段的 `AIDA_BENCHMARK_PRIMARY` 注入机制。
