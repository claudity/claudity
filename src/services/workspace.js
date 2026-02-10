const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..', '..', 'data', 'agents');

const BOOTSTRAP_TEMPLATE = `# bootstrap

you just came online for the first time. you don't know who you are yet.

conduct a short identity ritual with the user:

1. first message: introduce yourself and ask who you are and who the user is — combine questions
2. second message: if you have enough to work with, write your files and complete bootstrap. if not, ask one final clarifying question.
3. third message: you MUST write all files and call complete_bootstrap. no exceptions.

if the user gives you enough context upfront, skip questions entirely — write files and complete bootstrap immediately.

use write_workspace to create your identity files:
- SOUL.md — your personality, values, philosophy, how you think and behave
- IDENTITY.md — your name and signature traits
- USER.md — who the user is, their preferences
- HEARTBEAT.md — what to check on when you wake up periodically
- MEMORY.md — initial memories from this conversation

then call complete_bootstrap to finish setup.

CRITICAL: you MUST call complete_bootstrap or setup will not be saved. bootstrap MUST complete within 3 exchanges. after writing files, ALWAYS call complete_bootstrap in the same response. never end a response after writing files without also calling complete_bootstrap.
`;

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

function agentDir(agentName) {
  return path.join(BASE_DIR, sanitizeName(agentName));
}

function resolvePath(agentName, filePath) {
  const dir = agentDir(agentName);
  const resolved = path.resolve(dir, filePath);
  if (!resolved.startsWith(dir)) throw new Error('path escapes workspace');
  return resolved;
}

function initWorkspace(agentName) {
  const dir = agentDir(agentName);
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'BOOTSTRAP.md'), BOOTSTRAP_TEMPLATE);
}

function readFile(agentName, filename) {
  try {
    return fs.readFileSync(resolvePath(agentName, filename), 'utf-8');
  } catch {
    return null;
  }
}

function writeFile(agentName, filename, content) {
  const filePath = resolvePath(agentName, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function localDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function appendToDaily(agentName, entry) {
  const now = new Date();
  const today = localDate(now);
  const filename = `memory/${today}.md`;
  const filePath = resolvePath(agentName, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const timestamp = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  fs.appendFileSync(filePath, `- [${timestamp}] ${entry}\n`);
}

function getDailyLogs(agentName) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const todayStr = localDate(today);
  const yesterdayStr = localDate(yesterday);

  const todayLog = readFile(agentName, `memory/${todayStr}.md`);
  const yesterdayLog = readFile(agentName, `memory/${yesterdayStr}.md`);

  let result = '';
  if (yesterdayLog) result += `## ${yesterdayStr}\n${yesterdayLog}\n`;
  if (todayLog) result += `## ${todayStr}\n${todayLog}`;
  return result.trim() || null;
}

function deleteFile(agentName, filename) {
  try {
    fs.unlinkSync(resolvePath(agentName, filename));
  } catch {}
}

function renameWorkspace(oldName, newName) {
  const oldDir = agentDir(oldName);
  const newDir = agentDir(newName);
  if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
    fs.renameSync(oldDir, newDir);
  }
}

function deleteWorkspace(agentName) {
  const dir = agentDir(agentName);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function listFiles(agentName) {
  const dir = agentDir(agentName);
  if (!fs.existsSync(dir)) return [];

  const results = [];
  function walk(current, prefix) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), rel);
      } else {
        results.push(rel);
      }
    }
  }
  walk(dir, '');
  return results;
}

function listMemoryLogs(agentName) {
  const dir = path.join(agentDir(agentName), 'memory');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
    .map(f => f.replace('.md', ''));
}

module.exports = {
  initWorkspace,
  readFile,
  writeFile,
  appendToDaily,
  getDailyLogs,
  deleteFile,
  renameWorkspace,
  deleteWorkspace,
  listFiles,
  listMemoryLogs,
  sanitizeName
};
