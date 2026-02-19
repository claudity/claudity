const { v4: uuid } = require('uuid');
const { stmts } = require('../db');

const services = {
  imessage: () => require('./imessage'),
  discord: () => require('./discord'),
  telegram: () => require('./telegram'),
  slack: () => require('./slack'),
  whatsapp: () => require('./whatsapp'),
  signal: () => require('./signal'),
};

const running = new Map();

function log(msg) {
  console.log(`[connections] ${msg}`);
}

function onStatus(platform) {
  return (status, detail) => {
    stmts.updateConnectionStatus.run(status, detail || null, platform);
    log(`${platform}: ${status}${detail ? ' - ' + detail : ''}`);
  };
}

async function startService(platform, config) {
  if (running.has(platform)) {
    await stopService(platform);
  }

  const factory = services[platform];
  if (!factory) {
    log(`unknown platform: ${platform}`);
    return;
  }

  try {
    stmts.updateConnectionStatus.run('connecting', null, platform);
    const svc = factory();
    running.set(platform, svc);
    await svc.start(config, { onStatus: onStatus(platform) });
  } catch (err) {
    stmts.updateConnectionStatus.run('error', err.message, platform);
    log(`${platform} start failed: ${err.message}`);
  }
}

async function stopService(platform) {
  const svc = running.get(platform);
  if (svc) {
    svc.stop();
    running.delete(platform);
  }
  stmts.updateConnectionStatus.run('disconnected', null, platform);
}

async function start() {
  const rows = stmts.enabledConnections.all();
  for (const row of rows) {
    let config = {};
    try { config = JSON.parse(row.config); } catch {}
    await startService(row.platform, config);
  }
  log(`started ${rows.length} connection(s)`);
}

async function stop() {
  for (const platform of running.keys()) {
    await stopService(platform);
  }
}

async function enable(platform, config) {
  const existing = stmts.getConnectionByPlatform.get(platform);
  const id = existing ? existing.id : uuid();
  stmts.upsertConnection.run(id, platform, JSON.stringify(config), 1, 'disconnected', null);
  await startService(platform, config);
}

async function disable(platform) {
  stmts.updateConnectionEnabled.run(0, platform);
  await stopService(platform);
}

async function remove(platform) {
  await stopService(platform);
  stmts.deleteConnection.run(platform);
}

function list() {
  return stmts.listConnections.all().map(row => ({
    ...row,
    config: (() => { try { return JSON.parse(row.config); } catch { return {}; } })(),
  }));
}

module.exports = { start, stop, enable, disable, remove, list };
