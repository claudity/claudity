const express = require('express');
const { v4: uuid } = require('uuid');
const { stmts } = require('../db');
const auth = require('../services/auth');
const chat = require('../services/chat');
const workspace = require('../services/workspace');
const heartbeat = require('../services/heartbeat');

const router = express.Router();

router.get('/auth/status', (req, res) => {
  res.json(auth.getAuthStatus());
});

router.post('/auth/api-key', (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  if (!key.startsWith('sk-ant-api')) return res.status(400).json({ error: 'invalid api key — must start with sk-ant-api. setup tokens and oauth tokens are not supported here. run claude setup-token instead.' });
  auth.setApiKey(key);
  res.json({ saved: true });
});

router.post('/auth/setup-token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  if (!token.startsWith('sk-ant-oat')) return res.status(400).json({ error: 'invalid setup token — must start with sk-ant-oat. if you have an api key, use the api key option instead.' });
  try {
    auth.writeSetupToken(token);
    const status = auth.getAuthStatus();
    if (status.authenticated) return res.json({ saved: true });
    return res.status(400).json({ error: 'token saved to keychain but authentication failed — token may be invalid or expired' });
  } catch (err) {
    return res.status(500).json({ error: 'failed to write to keychain: ' + err.message });
  }
});

router.delete('/auth/api-key', (req, res) => {
  auth.removeApiKey();
  res.json({ removed: true });
});

router.get('/agents', (req, res) => {
  res.json(stmts.listAgents.all());
});

router.post('/agents', (req, res) => {
  const { name, is_default, model, thinking } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuid();
  try {
    stmts.createAgent.run(id, name);
    stmts.setBootstrapped.run(0, id);
    if (model) stmts.setModel.run(model, id);
    if (thinking) stmts.setThinking.run(thinking, id);
    if (is_default) {
      stmts.clearDefaultAgent.run();
      stmts.setDefaultAgent.run(id);
    }
    workspace.initWorkspace(name);
    const agent = stmts.getAgent.get(id);
    res.status(201).json(agent);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'agent name already exists' });
    throw err;
  }
});

router.get('/agents/:id', (req, res) => {
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  res.json(agent);
});

router.patch('/agents/:id', (req, res) => {
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const name = req.body.name || agent.name;
  if (name !== agent.name) {
    workspace.renameWorkspace(agent.name, name);
  }
  stmts.updateAgent.run(name, req.params.id);
  if (req.body.is_default) {
    stmts.clearDefaultAgent.run();
    stmts.setDefaultAgent.run(req.params.id);
  } else if (req.body.is_default === false) {
    stmts.unsetDefaultAgent.run(req.params.id);
  }
  if ('heartbeat_interval' in req.body) {
    heartbeat.updateInterval(req.params.id, req.body.heartbeat_interval);
  }
  if (req.body.model) stmts.setModel.run(req.body.model, req.params.id);
  if (req.body.thinking) stmts.setThinking.run(req.body.thinking, req.params.id);
  if ('show_heartbeat' in req.body) stmts.setShowHeartbeat.run(req.body.show_heartbeat ? 1 : 0, req.params.id);
  res.json(stmts.getAgent.get(req.params.id));
});

router.delete('/agents/:id', (req, res) => {
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  heartbeat.removeAgent(req.params.id);
  workspace.deleteWorkspace(agent.name);
  stmts.deleteAgent.run(req.params.id);
  res.json({ deleted: true });
});

router.get('/agents/:id/memories', (req, res) => {
  res.json(stmts.listMemories.all(req.params.id));
});

router.delete('/agents/:id/memories', (req, res) => {
  stmts.deleteMemories.run(req.params.id);
  res.json({ cleared: true });
});

router.get('/agents/:id/messages', (req, res) => {
  res.json(stmts.listMessages.all(req.params.id));
});

router.delete('/agents/:id/messages', (req, res) => {
  stmts.deleteMessages.run(req.params.id);
  res.json({ cleared: true });
});

router.post('/agents/:id/chat', (req, res) => {
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });

  res.json({ status: 'queued' });

  chat.enqueueMessage(req.params.id, content).catch(err => {
    chat.emit(req.params.id, 'error', { error: err.message });
  });
});

router.get('/agents/:id/stream', (req, res) => {
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive'
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ agent_id: req.params.id })}\n\n`);

  if (chat.isProcessing(req.params.id)) {
    res.write(`event: typing\ndata: ${JSON.stringify({ active: true })}\n\n`);
  }

  chat.addStream(req.params.id, res);

  req.on('close', () => {
    chat.removeStream(req.params.id, res);
  });
});

router.get('/agents/:id/workspace', (req, res) => {
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const files = workspace.listFiles(agent.name);
  res.json(agent.bootstrapped === 0 ? files.filter(f => f !== 'BOOTSTRAP.md') : files);
});

router.get('/agents/:id/logs', (req, res) => {
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  res.json(workspace.listMemoryLogs(agent.name));
});

router.get('/agents/:id/workspace/*', (req, res) => {
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const filePath = req.params[0];
  if (filePath.includes('..')) return res.status(400).json({ error: 'invalid path' });
  const content = workspace.readFile(agent.name, filePath);
  if (content === null) return res.status(404).json({ error: 'file not found' });
  res.json({ path: filePath, content });
});

router.put('/agents/:id/workspace/*', (req, res) => {
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const filePath = req.params[0];
  if (filePath.includes('..')) return res.status(400).json({ error: 'invalid path' });
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  workspace.writeFile(agent.name, filePath, content);
  res.json({ written: true, path: filePath });
});

module.exports = router;
