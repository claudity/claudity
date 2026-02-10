#!/usr/bin/env node
require('dotenv').config();
const express = require('express');
const path = require('path');
const { v4: uuid } = require('uuid');
const { execSync } = require('child_process');
const { stmts } = require('./db');
const apiRoutes = require('./routes/api');
const relayRoutes = require('./routes/relay');
const connectionRoutes = require('./routes/connections');
const scheduler = require('./services/scheduler');
const connections = require('./services/connections');
const memory = require('./services/memory');
const heartbeat = require('./services/heartbeat');

const app = express();
const PORT = process.env.PORT || 6767;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', apiRoutes);
app.use('/relay', relayRoutes);
app.use('/api/connections', connectionRoutes);

function autoUpdate() {
  const root = path.join(__dirname, '..');
  try {
    execSync('git rev-parse --git-dir', { cwd: root, stdio: 'ignore' });
  } catch { return; }
  try {
    const result = execSync('git pull --ff-only 2>&1', { cwd: root, encoding: 'utf8', timeout: 15000 });
    if (result && !result.includes('Already up to date')) {
      console.log('[update] ' + result.trim());
    }
  } catch (err) {
    console.log('[update] skipped: ' + (err.stderr || err.message || 'unknown error').toString().trim());
  }
}

function migrateImessageFromEnv() {
  if (process.env.IMESSAGE_RELAY !== 'true') return;
  const existing = stmts.getConnectionByPlatform.get('imessage');
  if (existing) return;
  const phone = process.env.IMESSAGE_PHONE;
  if (!phone) return;
  const id = uuid();
  stmts.upsertConnection.run(id, 'imessage', JSON.stringify({ phone }), 1, 'disconnected', null);
  console.log('[connections] migrated imessage config from .env to database');
}

autoUpdate();

app.listen(PORT, () => {
  console.log(`claudity running on http://localhost:${PORT}`);
  scheduler.start();
  memory.startConsolidation();
  migrateImessageFromEnv();
  connections.start();
  heartbeat.start();
});
