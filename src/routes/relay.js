const express = require('express');
const { stmts } = require('../db');
const chat = require('../services/chat');

const router = express.Router();

router.use((req, res, next) => {
  const secret = process.env.RELAY_SECRET;
  if (!secret) return res.status(500).json({ error: 'relay not configured' });
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

router.post('/chat', (req, res) => {
  const { agent_name, content } = req.body;
  if (!agent_name || !content) return res.status(400).json({ error: 'agent_name and content required' });

  const agent = stmts.getAgentByName.get(agent_name);
  if (!agent) return res.status(404).json({ error: `agent not found: ${agent_name}` });

  chat.enqueueMessage(agent.id, content).catch(err => {
    chat.emit(agent.id, 'error', { error: err.message });
  });

  res.json({ status: 'queued' });
});

router.get('/messages/:agent_name', (req, res) => {
  const agent = stmts.getAgentByName.get(req.params.agent_name);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  res.json(stmts.listMessages.all(agent.id));
});

module.exports = router;
