/**
 * 项目初始化步骤定义
 *
 * 替代原 system-blueprint.ts 中的 8 services + 8 rules 顺序链。
 * Aida 作为检查清单执行这些步骤，不再通过规则引擎驱动。
 */

export interface ProjectInitStep {
  id: string;
  name: string;
  description: string;
}

export const PROJECT_INIT_STEPS: ProjectInitStep[] = [
  { id: 'preflight',  name: '环境预检', description: '检查 ~/.aida/ 目录结构 + 引擎连接' },
  { id: 'identity',   name: '项目身份', description: '确认项目名称/ID/类型' },
  { id: 'interview',  name: '业务访谈', description: '了解业务需求和上下文' },
  { id: 'seed-data',  name: '数据策略', description: '确认初始数据方案' },
  { id: 'verify',     name: '验证完成', description: '检查 project.yaml + 基础配置' },
];

/**
 * Get the project init steps as a simple list.
 */
export function getProjectInitSteps(): ProjectInitStep[] {
  return [...PROJECT_INIT_STEPS];
}
