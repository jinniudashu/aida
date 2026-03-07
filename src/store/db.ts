import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS bps_entities (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  field_type TEXT,
  implement_type TEXT,
  business_type TEXT,
  affiliated_to TEXT,
  fields TEXT DEFAULT '[]',
  is_multivalued INTEGER DEFAULT 0,
  dependency_order INTEGER DEFAULT 0,
  computed_logic TEXT,
  init_content TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bps_services (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  service_type TEXT NOT NULL DEFAULT 'atomic',
  executor_type TEXT NOT NULL DEFAULT 'manual',
  entity_type TEXT,
  subject_entity TEXT,
  manual_start INTEGER DEFAULT 0,
  resources TEXT DEFAULT '[]',
  sub_services TEXT DEFAULT '[]',
  route_to TEXT,
  price REAL,
  agent_skills TEXT,
  agent_prompt TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bps_events (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  expression TEXT,
  evaluation_mode TEXT NOT NULL DEFAULT 'deterministic',
  is_timer INTEGER DEFAULT 0,
  timer_config TEXT,
  parameters TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bps_instructions (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  sys_call TEXT NOT NULL,
  parameters TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bps_service_rules (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  target_service_id TEXT NOT NULL,
  "order" INTEGER DEFAULT 0,
  service_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  instruction_id TEXT NOT NULL,
  operand_service_id TEXT,
  parameters TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bps_roles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  role_type TEXT NOT NULL DEFAULT 'user_defined',
  service_ids TEXT DEFAULT '[]',
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bps_operators (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  active INTEGER DEFAULT 1,
  role_ids TEXT DEFAULT '[]',
  organization_id TEXT,
  agent_session_key TEXT,
  agent_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bps_processes (
  id TEXT PRIMARY KEY,
  pid INTEGER NOT NULL,
  name TEXT,
  parent_id TEXT,
  previous_id TEXT,
  service_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'OPEN',
  priority INTEGER DEFAULT 0,
  entity_type TEXT,
  entity_id TEXT,
  operator_id TEXT,
  creator_id TEXT,
  program_entrypoint TEXT,
  scheduled_time TEXT,
  start_time TEXT,
  end_time TEXT,
  agent_session_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bps_context_snapshots (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  context_data TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(process_id, version)
);

CREATE TABLE IF NOT EXISTS bps_resources (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  resource_type TEXT NOT NULL,
  capacity INTEGER DEFAULT 1,
  content TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processes_state ON bps_processes(state);
CREATE INDEX IF NOT EXISTS idx_processes_service ON bps_processes(service_id);
CREATE INDEX IF NOT EXISTS idx_processes_operator ON bps_processes(operator_id);
CREATE INDEX IF NOT EXISTS idx_processes_entity ON bps_processes(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_process ON bps_context_snapshots(process_id, version);
CREATE INDEX IF NOT EXISTS idx_rules_target ON bps_service_rules(target_service_id, service_id);

CREATE TABLE IF NOT EXISTS bps_dossiers (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'ACTIVE',
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS bps_dossier_versions (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  patch TEXT,
  committed_by TEXT,
  commit_message TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(dossier_id, version)
);

CREATE INDEX IF NOT EXISTS idx_dossiers_type_id ON bps_dossiers(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_dossiers_entity_id ON bps_dossiers(entity_id);
CREATE INDEX IF NOT EXISTS idx_dossier_versions ON bps_dossier_versions(dossier_id, version);
CREATE INDEX IF NOT EXISTS idx_dossier_versions_committed ON bps_dossier_versions(committed_by);

-- 统计时间序列
CREATE TABLE IF NOT EXISTS bps_stats_timeseries (
  id TEXT PRIMARY KEY,
  metric TEXT NOT NULL,
  interval TEXT NOT NULL,
  bucket TEXT NOT NULL,
  dimensions TEXT,
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(metric, interval, bucket, dimensions)
);

-- 系统状态快照
CREATE TABLE IF NOT EXISTS bps_stats_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stats_ts ON bps_stats_timeseries(metric, interval, bucket);
CREATE INDEX IF NOT EXISTS idx_stats_snap ON bps_stats_snapshots(snapshot_type, created_at);
CREATE INDEX IF NOT EXISTS idx_processes_parent ON bps_processes(parent_id);
CREATE INDEX IF NOT EXISTS idx_dossiers_updated ON bps_dossiers(updated_at);

-- 审计日志
CREATE TABLE IF NOT EXISTS bps_task_log (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  details TEXT,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_log_task ON bps_task_log(task_id);
CREATE INDEX IF NOT EXISTS idx_task_log_time ON bps_task_log(timestamp);
`;

export function createDatabase(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

export function createMemoryDatabase(): DatabaseSync {
  return createDatabase(':memory:');
}

export function initBpsDatabase(homeDir: string): DatabaseSync {
  const dbPath = path.join(homeDir, 'bps-engine.db');
  return createDatabase(dbPath);
}
