# Structural Capability v2 — R2 Report

**Date**: 2026-03-14 14:00–14:09 CST
**Server**: iZt4n7qaa80fqgnql0diggZ (47.236.109.62)
**Model**: moonshot/kimi-k2.5（配置），实际降级为 dashscope/qwen3.5-plus（见 B4.00b）
**Duration**: 560s (9.3 min)
**Mode**: full (IdleX GEO business scenario, 含 model probe)

## Result

**108 PASS / 1 FAIL / 20 WARN / 129 TOTAL**

## R1→R2 对比

| 指标 | R1 (Qwen) | R2 (Kimi→Qwen降级) | 变化 |
|------|-----------|---------------------|------|
| 总检查 | 127 | 129 | +2（B4.00a/b 模型探针） |
| PASS | 121 | 108 | -13 |
| FAIL | 1 | 1 | 0（不同检查） |
| WARN | 5 | 20 | +15 |
| Skills | 18 (残留) | 7 (清理后) | **修复生效** |
| S3.14 | FAIL | PASS | **修复生效** |

## 关键发现

### 1. 模型降级：Kimi→Qwen 回退

- **B4.00b FAIL**: 配置 `moonshot/kimi-k2.5`，但 JSONL 实际模型为 `qwen3.5-plus`
- **原因**: Kimi K2.5 API 无响应或超时，OpenClaw Gateway 自动降级到 fallback 模型
- **影响**: 全部 8 个 Agent turn 实际由 Qwen3.5-Plus 执行（非目标模型）
- **后果**: R2 本质上是 R1 的**降级运行复现**，而非 Kimi 对比测试

### 2. R1 修复全部生效

| 修复项 | R1 | R2 | 状态 |
|--------|-----|-----|------|
| S3.14 curl -sf 404 检测 | FAIL | PASS | **已修复** |
| Skills 残留清理 | 18 | 7 | **已修复** |
| 模型可配置 (SC_MODEL) | N/A | PASS (V0.7) | **生效** |
| 模型验证探针 | N/A | PASS (B4.00a) | **生效** |

### 3. WARN 从 5 增至 20 — Qwen 方差

R2 的 Qwen 行为**显著弱于 R1 同一模型**：

| 维度 | R1 (Qwen) | R2 (Qwen降级) | 差异 |
|------|-----------|---------------|------|
| Turn 2 实体创建 | 7 | 12 | R2 更多 |
| Turn 3 内容生成 | 3 write calls | 0 | **R2 未生成文件** |
| Turn 3 新实体 | 4 | 0 | **R2 未创建运营实体** |
| Turn 3b 协作调用 | 1 call | 0 | **R2 未调用 bps_request_collaboration** |
| Turn 4 管理触发 | 1 violation | 0 | **R2 未触发管理** |
| Blueprint 创建 | 1 | 0 | **R2 未创建蓝图** |
| Skill 创建 | 0 | 0 | 两轮均为 0 |

R2 的 Qwen 创建了 12 个实体（比 R1 的 7 更多），但后续 Turn 3-6 几乎没有工具调用——典型的**高实体/低执行**模式。模型方差导致同一模型在不同运行中表现差异显著。

## Phase 维度汇总

| Phase | 结果 | 说明 |
|-------|------|------|
| Phase 0 (V0) | 7/7 PASS | install-aida.sh Skill 清理生效，模型锁定 moonshot/kimi-k2.5 |
| Phase 1 (V1) | 5/5 PASS | 种子数据正常 |
| Phase 2 (S2) | 55/55 PASS | 引擎 D1-D10 全部通过 |
| Phase 3 (S3) | 16/16 PASS | Dashboard API 全部通过（含 S3.14 修复） |
| Phase 4 (B4) | 15/35 PASS, 1 FAIL, 19 WARN | 模型降级 + Qwen 方差双重影响 |
| Phase 5 (V5) | 10/12 PASS, 2 WARN | 终验反映 Phase 4 产出不足 |

## 1 FAIL 分析

### B4.00b: JSONL model matches config

**根因**: Kimi K2.5 API 在 model probe 阶段无法响应，OpenClaw Gateway 自动降级到 fallback `dashscope/qwen3.5-plus`。JSONL 记录的实际模型为 `qwen3.5-plus`，与配置的 `moonshot/kimi-k2.5` 不匹配。

**验证价值**: 模型验证探针**正确检测到降级**——如果没有 B4.00b，我们会误以为整个测试运行在 Kimi 上。

## 20 WARN 分析

| 模式 | 数量 | 涉及检查 |
|------|------|----------|
| Turn 3 运营空转（0 write, 0 新实体） | 3 | B4.11, B4.12, B4.13 |
| Turn 3b 协作未调用 | 2 | B4.13c, B4.13f |
| Turn 4 管理未触发 | 4 | B4.15, B4.16, B4.17, B4.18 |
| Turn 2 蓝图/Skill 未创建 | 3 | B4.07, B4.08, B4.09 |
| Turn 6 Skill/Agent 未创建 | 2 | B4.21, B4.22 |
| Turn 8 管理详情未提及 | 1 | B4.27 |
| Step 5 审批未处理 | 1 | B4.19 |
| Phase 5 终验反映 | 4 | V5.6, S3.08, V5.8, V5.9 |

核心问题仍是**"说而不做"**，但 R2 比 R1 严重得多——连 Turn 3 的内容生成和 Turn 3b 的协作请求都未执行。

## 系统状态（测试后）

| 指标 | R1 | R2 |
|------|-----|-----|
| 实体 | 21 | 24 |
| 违规 | 4 | 3（仅种子） |
| 约束 | 4 | 3（仅种子） |
| Skills | 18 → **7（修复后）** | 7 |
| 蓝图 | 2 | 1（仅种子） |
| 写调用 | 3 | 0 |
| 协作任务 | 6 | 5 |
| 协作完成 | 5 | 4 |

## 结论

1. **基础设施层 100% 稳定**: D1-D10 + D11 共 71 检查全部 PASS，两轮零回归
2. **R1 修复全部验证**: S3.14 curl fix, Skill 清理, 模型可配置, 模型探针
3. **模型验证探针价值确认**: 成功检测到 Kimi→Qwen 降级，避免了错误归因
4. **Kimi K2.5 当前不可用**: 需排查 moonshot API 连通性或 OpenClaw 路由配置
5. **Qwen 方差显著**: 同一模型两次运行，WARN 从 5 增至 20（Turn 3-4 完全空转）
6. **建议**: 下次 Kimi 测试前先 `openclaw agent --agent main --message "ping"` 验证 API 连通性
