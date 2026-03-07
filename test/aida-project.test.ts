import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { homedir } from 'os';
import {
  getDefaultAidaDir,
  initAidaProject,
  loadAidaProject,
  AIDA_DIR_NAME,
} from '../src/loader/aida-project.js';

const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

// Track temp dirs for cleanup
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aida-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs.length = 0;
});

describe('Aida Project', () => {
  describe('getDefaultAidaDir', () => {
    it('应返回 {homedir}/.aida', () => {
      const result = getDefaultAidaDir();
      expect(result).toBe(join(homedir(), AIDA_DIR_NAME));
    });
  });

  describe('initAidaProject', () => {
    it('应创建 blueprints/ data/ context/ 目录结构', () => {
      const dir = makeTempDir();
      const aidaDir = join(dir, '.aida');

      const result = initAidaProject(aidaDir);

      expect(result).toBe(aidaDir);
      expect(existsSync(join(aidaDir, 'blueprints'))).toBe(true);
      expect(existsSync(join(aidaDir, 'data'))).toBe(true);
      expect(existsSync(join(aidaDir, 'context'))).toBe(true);
    });

    it('幂等：重复调用不报错', () => {
      const dir = makeTempDir();
      const aidaDir = join(dir, '.aida');

      initAidaProject(aidaDir);
      initAidaProject(aidaDir);

      expect(existsSync(join(aidaDir, 'blueprints'))).toBe(true);
      expect(existsSync(join(aidaDir, 'data'))).toBe(true);
      expect(existsSync(join(aidaDir, 'context'))).toBe(true);
    });
  });

  describe('loadAidaProject', () => {
    it('空项目（无 project.yaml）正常启动引擎', () => {
      const dir = makeTempDir();
      const aidaDir = join(dir, '.aida');

      const result = loadAidaProject({ aidaDir });

      expect(result.engine).toBeDefined();
      expect(result.project).toBeNull();
      expect(result.aidaDir).toBe(aidaDir);
      expect(result.systemKnowledge.loaded).toBe(2); // 2 system knowledge entries
    });

    it('完整项目加载蓝图 + 种子数据', () => {
      const dir = makeTempDir();
      const aidaDir = join(dir, '.aida');

      // Set up ~/.aida/ with fixture files
      initAidaProject(aidaDir);
      copyFileSync(
        join(FIXTURES, 'project.yaml'),
        join(aidaDir, 'project.yaml'),
      );
      copyFileSync(
        join(FIXTURES, 'geo-ktv-changsha.yaml'),
        join(aidaDir, 'blueprints', 'geo-ktv-changsha.yaml'),
      );
      copyFileSync(
        join(FIXTURES, 'mock-stores-changsha.yaml'),
        join(aidaDir, 'mock-stores-changsha.yaml'),
      );

      const result = loadAidaProject({ aidaDir });

      expect(result.project).not.toBeNull();
      expect(result.project!.projectId).toBe('idlex');
      expect(result.project!.name).toBe('IdleX GEO 长沙自助KTV');
      expect(result.project!.blueprints.loaded).toBe(1);
      expect(result.project!.seeds.loaded).toBe(5);
    });

    it('bps.db 在 data/ 下生成', () => {
      const dir = makeTempDir();
      const aidaDir = join(dir, '.aida');

      loadAidaProject({ aidaDir });

      expect(existsSync(join(aidaDir, 'data', 'bps.db'))).toBe(true);
    });

    it('系统知识自动加载', () => {
      const dir = makeTempDir();
      const aidaDir = join(dir, '.aida');

      const result = loadAidaProject({ aidaDir });

      expect(result.systemKnowledge.loaded).toBe(2);
      expect(result.systemKnowledge.skipped).toBe(0);

      // Second load should skip all
      const result2 = loadAidaProject({ aidaDir });
      expect(result2.systemKnowledge.loaded).toBe(0);
      expect(result2.systemKnowledge.skipped).toBe(2);
    });
  });
});
