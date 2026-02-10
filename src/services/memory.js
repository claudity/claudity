const { spawn } = require('child_process');
const { v4: uuid } = require('uuid');
const { db, stmts } = require('../db');
const auth = require('./auth');
const workspace = require('./workspace');

const API_URL = 'https://api.anthropic.com/v1/messages';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const EXTRACTION_COOLDOWN = 30000;

const lastExtractionTime = new Map();

async function callLightweight(prompt, systemPrompt) {
  const status = auth.getAuthStatus();
  if (!status.authenticated) return null;

  if (status.mode === 'api_key') {
    const headers = auth.getHeaders();
    const body = {
      model: HAIKU_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    };

    const res = await fetch(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) return null;
    const data = await res.json();
    const textBlock = data.content?.find(b => b.type === 'text');
    return textBlock?.text || null;
  }

  return cliCall(['--model', 'haiku'], prompt, systemPrompt);
}

function cliCall(extraArgs, prompt, systemPrompt) {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--dangerously-skip-permissions', '--setting-sources', '', ...extraArgs];
    if (systemPrompt) args.push('--system-prompt', systemPrompt);
    let done = false;
    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000,
      cwd: '/tmp'
    });

    const fallback = setTimeout(() => {
      if (!done) {
        done = true;
        proc.kill();
        resolve(null);
      }
    }, 65000);

    let stdout = '';
    proc.stdout.on('data', d => stdout += d);
    proc.on('close', () => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(typeof parsed.result === 'string' ? parsed.result : null);
      } catch {
        resolve(stdout.trim() || null);
      }
    });
    proc.on('error', () => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      resolve(null);
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

async function extractMemories(agentId, userContent, assistantContent) {
  if (typeof userContent === 'string' && userContent.startsWith('[scheduled reminder]')) return;

  const now = Date.now();
  const last = lastExtractionTime.get(agentId) || 0;
  if (now - last < EXTRACTION_COOLDOWN) return;
  lastExtractionTime.set(agentId, now);

  const existing = stmts.listMemories.all(agentId);
  const existingBlock = existing.length
    ? 'existing memories:\n' + existing.map(m => `- ${m.summary}`).join('\n')
    : 'no existing memories.';

  const systemPrompt = `extract only concrete facts THE USER explicitly stated. ignore everything the assistant said. max 3 memories per exchange. only extract: user's name, stated preferences, explicit instructions, key decisions. do NOT extract: greetings, small talk, questions, the assistant's personality, setup details, or anything implied. output a bullet list starting with "- ". if nothing worth remembering, respond with exactly "none".`;

  const prompt = `${existingBlock}\n\nlatest exchange:\nuser: ${userContent}\nassistant: ${assistantContent}`;

  try {
    const result = await callLightweight(prompt, systemPrompt);
    if (!result || result.trim().toLowerCase() === 'none') return;

    const lines = result.split('\n')
      .map(l => l.replace(/^-\s*/, '').trim())
      .filter(l => l.length > 0 && l.length < 500)
      .filter(l => !/^(done|here|your|i've|i have|consolidated|saved|memory is|sure|no new)/i.test(l));

    const agent = stmts.getAgent.get(agentId);

    for (const line of lines) {
      stmts.createMemory.run(uuid(), agentId, line);
      if (agent) {
        try { workspace.appendToDaily(agent.name, line); } catch (err) {
          console.error(`[memory] daily log error: ${err.message}`);
        }
      }
    }

    if (lines.length > 0) {
      console.log(`[memory] extracted ${lines.length} memories for agent ${agentId}`);
    }
  } catch (err) {
    console.error(`[memory] extraction error: ${err.message}`);
  }
}

function startConsolidation() {
  console.log('[memory] consolidation service started (every 15 min)');

  setInterval(async () => {
    try {
      const agents = stmts.listAgents.all();

      for (const agent of agents) {
        const memories = stmts.listMemories.all(agent.id);
        if (memories.length < 5) continue;

        const memoryList = memories.map(m => `- ${m.summary}`).join('\n');
        const systemPrompt = `you are a memory consolidation tool. your ONLY job is to deduplicate and clean up a list of factual memories. output ONLY a bullet list — one fact per line, each starting with "- ". do NOT add commentary, explanations, confirmations, or any text that is not a memory. do NOT say "done" or "here is your list" or anything like that. just output the cleaned list.`;

        const result = await callLightweight(memoryList, systemPrompt);
        if (!result || result.trim().toLowerCase() === 'none') continue;

        const lines = result.split('\n')
          .map(l => l.replace(/^-\s*/, '').trim())
          .filter(l => l.length > 0 && l.length < 500)
          .filter(l => /^[A-Z]/.test(l) || /^[a-z]/.test(l))
          .filter(l => !/^(done|here|your|i've|i have|consolidated|saved|memory is|sure|i appreciate|i'm claude|i'm an|i need to|based on|please provide|what memories|i'm ready)/i.test(l))
          .filter(l => !/(clarify my|actual role|anthropic|memory consolidation tool|deduplicate)/i.test(l));

        if (lines.length === 0) continue;
        if (lines.length < memories.length * 0.3) {
          console.log(`[memory] skipping consolidation for ${agent.name} — output too small (${lines.length} vs ${memories.length})`);
          continue;
        }

        const consolidate = db.transaction(() => {
          stmts.deleteMemories.run(agent.id);
          for (const line of lines) {
            stmts.createMemory.run(uuid(), agent.id, line);
          }
        });
        consolidate();

        try {
          const memoryMd = lines.map(l => `- ${l}`).join('\n');
          workspace.writeFile(agent.name, 'MEMORY.md', memoryMd + '\n');
        } catch (err) {
          console.error(`[memory] failed to write MEMORY.md for ${agent.name}: ${err.message}`);
        }

        console.log(`[memory] consolidated ${memories.length} → ${lines.length} memories for ${agent.name}`);
      }
    } catch (err) {
      console.error(`[memory] consolidation error: ${err.message}`);
    }
  }, 15 * 60 * 1000);
}

module.exports = { extractMemories, startConsolidation, callLightweight };
