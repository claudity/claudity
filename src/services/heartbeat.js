const { stmts } = require('../db');
const workspace = require('./workspace');

const MIN_INTERVAL = 5 * 60 * 1000;
const timers = new Map();
const delays = new Map();
const processing = new Set();
const queues = new Map();

function start() {
  const agents = stmts.agentsWithHeartbeat.all();
  let offset = 0;
  for (const agent of agents) {
    addAgent(agent, offset);
    offset += 30000;
  }
  if (agents.length > 0) {
    console.log(`[heartbeat] started timers for ${agents.length} agent${agents.length === 1 ? '' : 's'}`);
  }
}

function stop() {
  for (const [id, timeout] of delays) clearTimeout(timeout);
  delays.clear();
  for (const [id, timer] of timers) clearInterval(timer);
  timers.clear();
}

function addAgent(agent, initialDelay) {
  if (!agent.heartbeat_interval) return;
  removeAgent(agent.id);
  const interval = Math.max(agent.heartbeat_interval, MIN_INTERVAL);
  const delay = initialDelay !== undefined ? initialDelay : Math.floor(Math.random() * 30000);
  const timeout = setTimeout(() => {
    delays.delete(agent.id);
    const timer = setInterval(() => scheduleHeartbeat(agent.id), interval);
    timers.set(agent.id, timer);
    scheduleHeartbeat(agent.id);
  }, delay);
  delays.set(agent.id, timeout);
}

function removeAgent(agentId) {
  const delay = delays.get(agentId);
  if (delay) {
    clearTimeout(delay);
    delays.delete(agentId);
  }
  const timer = timers.get(agentId);
  if (timer) {
    clearInterval(timer);
    timers.delete(agentId);
  }
}

function updateInterval(agentId, intervalMs) {
  stmts.setHeartbeatInterval.run(intervalMs, agentId);
  const agent = stmts.getAgent.get(agentId);
  if (!agent) return;
  if (intervalMs === null) {
    removeAgent(agentId);
  } else {
    addAgent(agent);
  }
}

function scheduleHeartbeat(agentId) {
  if (processing.has(agentId)) return;
  const prior = queues.get(agentId) || Promise.resolve();
  const next = prior.catch(() => {}).then(() => handleHeartbeat(agentId));
  queues.set(agentId, next);
}

async function handleHeartbeat(agentId) {
  if (processing.has(agentId)) return;
  processing.add(agentId);

  const agent = stmts.getAgent.get(agentId);
  if (!agent || !agent.heartbeat_interval) {
    processing.delete(agentId);
    removeAgent(agentId);
    return;
  }

  if (agent.bootstrapped === 0) {
    processing.delete(agentId);
    return;
  }

  const heartbeatMd = workspace.readFile(agent.name, 'HEARTBEAT.md') || 'check if anything needs follow-up from recent conversations.';

  const prompt = `[heartbeat] review your heartbeat checklist and act on anything that needs attention. if nothing needs action, respond with exactly HEARTBEAT_OK.\n\n${heartbeatMd}`;

  try {
    console.log(`[heartbeat] running for ${agent.name}`);
    const chat = require('./chat');
    await chat.enqueueMessage(agentId, prompt, { heartbeat: true });
    console.log(`[heartbeat] completed for ${agent.name}`);
  } catch (err) {
    console.error(`[heartbeat] error for ${agent.name}: ${err.message}`);
  } finally {
    processing.delete(agentId);
  }
}

module.exports = { start, stop, addAgent, removeAgent, updateInterval };
