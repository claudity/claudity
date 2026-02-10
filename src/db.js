const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'claudity.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  create table if not exists config (
    key text primary key,
    value text not null,
    updated_at datetime default current_timestamp
  );

  create table if not exists agents (
    id text primary key,
    name text not null unique,
    role text not null,
    tools_config text not null default '{}',
    created_at datetime default current_timestamp,
    updated_at datetime default current_timestamp
  );

  create table if not exists memories (
    id text primary key,
    agent_id text not null,
    summary text not null,
    created_at datetime default current_timestamp,
    foreign key (agent_id) references agents(id) on delete cascade
  );

  create table if not exists messages (
    id text primary key,
    agent_id text not null,
    role text not null,
    content text not null,
    tool_calls text,
    created_at datetime default current_timestamp,
    foreign key (agent_id) references agents(id) on delete cascade
  );

  create table if not exists schedules (
    id text primary key,
    agent_id text not null,
    description text not null,
    interval_ms integer not null,
    next_run_at integer not null,
    last_run_at integer,
    active integer not null default 1,
    created_at datetime default current_timestamp,
    foreign key (agent_id) references agents(id) on delete cascade
  );

  create table if not exists connections (
    id text primary key,
    platform text not null,
    config text not null default '{}',
    enabled integer not null default 0,
    status text not null default 'disconnected',
    status_detail text,
    created_at datetime default current_timestamp,
    updated_at datetime default current_timestamp
  );

  create unique index if not exists idx_connections_platform on connections(platform);
  create index if not exists idx_memories_agent on memories(agent_id);
  create index if not exists idx_messages_agent on messages(agent_id, created_at);
  create index if not exists idx_schedules_due on schedules(active, next_run_at);
`);

try {
  db.exec('alter table agents add column is_default integer not null default 0');
} catch {}

try {
  db.exec('alter table agents add column heartbeat_interval integer default null');
} catch {}

try {
  db.exec('alter table agents add column bootstrapped integer not null default 1');
} catch {}

try {
  db.exec("alter table agents add column model text not null default 'opus'");
} catch {}

try {
  db.exec("alter table agents add column thinking text not null default 'high'");
} catch {}

try {
  db.exec("alter table messages add column type text not null default 'chat'");
} catch {}

try {
  db.exec('alter table agents add column show_heartbeat integer not null default 0');
} catch {}

db.exec(`
  create table if not exists sessions (
    agent_id text primary key,
    session_id text not null,
    prompt_hash text not null,
    updated_at datetime default current_timestamp,
    foreign key (agent_id) references agents(id) on delete cascade
  )
`);

const stmts = {
  getConfig: db.prepare('select value from config where key = ?'),
  setConfig: db.prepare('insert into config (key, value, updated_at) values (?, ?, current_timestamp) on conflict(key) do update set value = excluded.value, updated_at = current_timestamp'),
  deleteConfig: db.prepare('delete from config where key = ?'),

  listAgents: db.prepare("select a.*, max(m.created_at) as last_message_at from agents a left join messages m on m.agent_id = a.id and m.type = 'chat' group by a.id order by coalesce(last_message_at, a.created_at) desc"),
  getAgent: db.prepare('select * from agents where id = ?'),
  getAgentByName: db.prepare('select * from agents where lower(name) = lower(?)'),
  createAgent: db.prepare("insert into agents (id, name, role) values (?, ?, '')"),
  updateAgent: db.prepare('update agents set name = ?, updated_at = current_timestamp where id = ?'),
  updateAgentToolsConfig: db.prepare('update agents set tools_config = ?, updated_at = current_timestamp where id = ?'),
  deleteAgent: db.prepare('delete from agents where id = ?'),
  getDefaultAgent: db.prepare('select * from agents where is_default = 1'),
  clearDefaultAgent: db.prepare('update agents set is_default = 0 where is_default = 1'),
  setDefaultAgent: db.prepare('update agents set is_default = 1, updated_at = current_timestamp where id = ?'),
  unsetDefaultAgent: db.prepare('update agents set is_default = 0, updated_at = current_timestamp where id = ?'),

  listMemories: db.prepare('select * from memories where agent_id = ? order by created_at desc'),
  createMemory: db.prepare('insert into memories (id, agent_id, summary) values (?, ?, ?)'),
  deleteMemories: db.prepare('delete from memories where agent_id = ?'),

  listMessages: db.prepare('select * from messages where agent_id = ? order by created_at asc'),
  recentMessages: db.prepare("select * from messages where agent_id = ? and type = 'chat' order by created_at desc limit ?"),
  createMessage: db.prepare("insert into messages (id, agent_id, role, content, tool_calls, type) values (?, ?, ?, ?, ?, 'chat')"),
  createHeartbeatMessage: db.prepare("insert into messages (id, agent_id, role, content, tool_calls, type) values (?, ?, ?, ?, ?, 'heartbeat')"),
  deleteMessages: db.prepare('delete from messages where agent_id = ?'),
  createSchedule: db.prepare('insert into schedules (id, agent_id, description, interval_ms, next_run_at) values (?, ?, ?, ?, ?)'),
  dueSchedules: db.prepare('select * from schedules where active = 1 and next_run_at <= ?'),
  updateScheduleRun: db.prepare('update schedules set last_run_at = ?, next_run_at = ? where id = ?'),
  deactivateSchedule: db.prepare('update schedules set active = 0 where id = ? and agent_id = ?'),
  agentSchedules: db.prepare('select * from schedules where agent_id = ? and active = 1'),
  listConnections: db.prepare('select * from connections order by created_at asc'),
  getConnectionByPlatform: db.prepare('select * from connections where platform = ?'),
  upsertConnection: db.prepare('insert into connections (id, platform, config, enabled, status, status_detail, updated_at) values (?, ?, ?, ?, ?, ?, current_timestamp) on conflict(platform) do update set config = excluded.config, enabled = excluded.enabled, status = excluded.status, status_detail = excluded.status_detail, updated_at = current_timestamp'),
  updateConnectionStatus: db.prepare('update connections set status = ?, status_detail = ?, updated_at = current_timestamp where platform = ?'),
  updateConnectionEnabled: db.prepare('update connections set enabled = ?, updated_at = current_timestamp where platform = ?'),
  updateConnectionConfig: db.prepare('update connections set config = ?, updated_at = current_timestamp where platform = ?'),
  deleteConnection: db.prepare('delete from connections where platform = ?'),
  enabledConnections: db.prepare('select * from connections where enabled = 1'),

  agentsWithHeartbeat: db.prepare('select * from agents where heartbeat_interval is not null'),
  setBootstrapped: db.prepare('update agents set bootstrapped = ?, updated_at = current_timestamp where id = ?'),
  setHeartbeatInterval: db.prepare('update agents set heartbeat_interval = ?, updated_at = current_timestamp where id = ?'),
  setModel: db.prepare('update agents set model = ?, updated_at = current_timestamp where id = ?'),
  setThinking: db.prepare('update agents set thinking = ?, updated_at = current_timestamp where id = ?'),
  setShowHeartbeat: db.prepare('update agents set show_heartbeat = ?, updated_at = current_timestamp where id = ?'),

  getSession: db.prepare('select * from sessions where agent_id = ?'),
  upsertSession: db.prepare('insert into sessions (agent_id, session_id, prompt_hash, updated_at) values (?, ?, ?, current_timestamp) on conflict(agent_id) do update set session_id = excluded.session_id, prompt_hash = excluded.prompt_hash, updated_at = current_timestamp'),
  deleteSession: db.prepare('delete from sessions where agent_id = ?'),
};

module.exports = { db, stmts };
