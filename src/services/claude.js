const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const auth = require('./auth');
const { stmts } = require('../db');

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-6';
const activeProcesses = new Map();

function hashPrompt(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function isContextOverflow(err) {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('context') || msg.includes('overflow') || msg.includes('too long') || msg.includes('token limit');
}

async function sendMessage({ system, messages, tools, maxTokens = 4096, agentId, model = 'opus', effort = 'high', noBuiltinTools = false, onEvent = null }) {
  const status = auth.getAuthStatus();
  if (!status.authenticated) throw new Error('not authenticated - run claude setup-token');

  if (status.mode === 'api_key') {
    return sendViaApi({ system, messages, tools, maxTokens });
  }

  return sendViaCli({ system, messages, tools, maxTokens, agentId, model, effort, noBuiltinTools, onEvent });
}

async function sendViaApi({ system, messages, tools, maxTokens }) {
  const headers = auth.getHeaders();

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`claude api error ${res.status}: ${text}`);
  }

  return await res.json();
}

function buildFullSysPrompt(system, tools) {
  let sysPrompt = system || '';
  if (tools && tools.length > 0) {
    sysPrompt += '\n\nyou have these tools available. to use a tool, include a json block in your response:\n```json\n{"tool_use": {"name": "tool_name", "input": {...}}}\n```\n\navailable tools:\n' +
      tools.map(t => `- ${t.name}: ${t.description}\n  parameters: ${JSON.stringify(t.input_schema)}`).join('\n');
  }
  return sysPrompt;
}

function buildPromptText(lastUserMsg) {
  let promptText = '';
  if (typeof lastUserMsg.content === 'string') {
    promptText = lastUserMsg.content;
  } else if (Array.isArray(lastUserMsg.content)) {
    const textParts = lastUserMsg.content.filter(b => typeof b === 'string' || b.type === 'text');
    promptText = textParts.map(b => typeof b === 'string' ? b : b.text).join('\n');

    const toolResults = lastUserMsg.content.filter(b => b.type === 'tool_result');
    if (toolResults.length > 0) {
      promptText += '\n\ntool results:\n' + toolResults.map(r =>
        `[${r.tool_use_id}]: ${r.content}`
      ).join('\n');
    }
  }
  return promptText;
}

function buildContext(messages) {
  return messages.slice(0, -1).map(m => {
    if (m.role === 'user' && typeof m.content === 'string') return `user: ${m.content}`;
    if (m.role === 'assistant') {
      if (Array.isArray(m.content)) {
        const parts = m.content.map(b => {
          if (b.type === 'text') return b.text;
          if (b.type === 'tool_use') return `[tool call: ${b.name}(${JSON.stringify(b.input)})]`;
          return '';
        }).filter(Boolean);
        return `assistant: ${parts.join('\n')}`;
      }
      return `assistant: ${m.content}`;
    }
    return '';
  }).filter(Boolean).join('\n\n');
}

function runCli(args, input, extraEnv = {}, agentId = null, onEvent = null) {
  return new Promise((resolve, reject) => {
    let done = false;
    const env = { ...process.env, ...extraEnv };
    delete env.CLAUDECODE;
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'claudity-'));
    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env
    });

    if (agentId) activeProcesses.set(agentId, proc);

    let stdout = '';
    let stderr = '';
    let lastResult = null;
    let buffer = '';

    proc.stdout.on('data', d => {
      const chunk = d.toString();
      stdout += chunk;
      if (onEvent) {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'result') lastResult = line;
            onEvent(event);
          } catch {}
        }
      }
    });
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      if (done) return;
      done = true;
      if (agentId) activeProcesses.delete(agentId);
      if (onEvent && lastResult) {
        resolve(lastResult);
      } else if (onEvent && !lastResult) {
        if (code === null) {
          reject(new Error('aborted'));
        } else {
          reject(new Error(`claude cli exited with code ${code}${stderr.trim() ? ': ' + stderr.trim() : ''}`));
        }
      } else if (stdout.trim()) {
        resolve(stdout.trim());
      } else if (code !== 0 && code !== null) {
        reject(new Error(`claude cli exited with code ${code}${stderr.trim() ? ': ' + stderr.trim() : ''}`));
      } else if (code === null) {
        reject(new Error('claude cli process was terminated unexpectedly - try again'));
      } else {
        resolve('');
      }
    });

    proc.on('error', err => {
      if (done) return;
      done = true;
      reject(err);
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}

async function sendViaCli({ system, messages, tools, maxTokens, agentId, model = 'opus', effort = 'high', noBuiltinTools = false, onEvent = null }) {
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  const promptText = buildPromptText(lastUserMsg);
  const sysPrompt = buildFullSysPrompt(system, tools);
  const currentHash = hashPrompt(sysPrompt);

  const session = agentId ? stmts.getSession.get(agentId) : null;
  const canResume = session && session.prompt_hash === currentHash;

  let output;

  if (canResume) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--effort', effort, '--dangerously-skip-permissions', '--setting-sources', '', '--resume', session.session_id];
    try {
      output = await runCli(args, promptText, {}, agentId, onEvent);
      return processCliOutput(output, tools);
    } catch (err) {
      if (err.message === 'aborted') throw err;
      stmts.deleteSession.run(agentId);
      if (isContextOverflow(err)) {
        return sendCliFresh({ sysPrompt, messages: [messages[messages.length - 1]], promptText, tools, agentId, currentHash, model, effort, noBuiltinTools, onEvent });
      }
      return sendCliFresh({ sysPrompt, messages, promptText, tools, agentId, currentHash, model, effort, noBuiltinTools, onEvent });
    }
  }

  return sendCliFresh({ sysPrompt, messages, promptText, tools, agentId, currentHash, model, effort, noBuiltinTools, onEvent });
}

async function sendCliFresh({ sysPrompt, messages, promptText, tools, agentId, currentHash, model = 'opus', effort = 'high', noBuiltinTools = false, onEvent = null }) {
  const sessionId = randomUUID();
  const context = buildContext(messages);

  let fullPrompt = '';
  if (context) fullPrompt += `previous conversation:\n${context}\n\n`;
  fullPrompt += promptText;

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--effort', effort, '--dangerously-skip-permissions', '--setting-sources', '', '--session-id', sessionId];
  if (noBuiltinTools) args.push('--tools', '');
  if (sysPrompt) {
    args.push('--system-prompt', sysPrompt);
  }

  try {
    const output = await runCli(args, fullPrompt, {}, agentId, onEvent);

    if (agentId) {
      stmts.upsertSession.run(agentId, sessionId, currentHash);
    }

    return processCliOutput(output, tools);
  } catch (err) {
    if (err.message === 'aborted') throw err;
    if (isContextOverflow(err) && context) {
      const retryArgs = ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--effort', effort, '--dangerously-skip-permissions', '--setting-sources', '', '--session-id', randomUUID()];
      if (sysPrompt) retryArgs.push('--system-prompt', sysPrompt);
      const output = await runCli(retryArgs, promptText, {}, agentId);
      return processCliOutput(output, tools);
    }
    throw err;
  }
}

function processCliOutput(output, tools) {
  const parsed = parseCliOutput(output);
  if (!parsed) throw new Error('claude cli returned empty response');

  if (parsed.is_error && parsed.num_turns === 0) {
    throw new Error('cli session error');
  }

  if (parsed.is_error || parsed.subtype === 'error_max_turns') {
    const text = typeof parsed.result === 'string' && parsed.result.length > 0
      ? parsed.result
      : '';
    return buildResponse(text, tools);
  }

  if (parsed.result !== undefined && parsed.result !== null && parsed.result !== '') {
    const text = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
    return buildResponse(text, tools);
  }

  if (parsed.content) {
    return parsed;
  }

  if (parsed.type === 'result') {
    return buildResponse('', tools);
  }

  return buildResponse(output, tools);
}

function parseCliOutput(output) {
  if (!output) return null;
  try { return JSON.parse(output); } catch {}
  const lines = output.split('\n').filter(l => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch {}
  }
  return null;
}

function extractJsonObjects(str) {
  const results = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] === '{') {
      let depth = 0;
      let start = i;
      let inString = false;
      let escaped = false;
      for (let j = i; j < str.length; j++) {
        const ch = str[j];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\' && inString) { escaped = true; continue; }
        if (ch === '"' && !escaped) { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            const candidate = str.slice(start, j + 1);
            try {
              results.push(JSON.parse(candidate));
            } catch {}
            i = j + 1;
            break;
          }
        }
      }
      if (depth !== 0) i++;
    } else {
      i++;
    }
  }
  return results;
}

function buildResponse(text, tools) {
  const content = [{ type: 'text', text }];
  let stopReason = 'end_turn';

  if (tools && tools.length > 0) {
    const jsonBlockPattern = /```json\s*\n?\s*([\s\S]*?)\s*\n?\s*```/g;
    let match;
    while ((match = jsonBlockPattern.exec(text)) !== null) {
      const objects = extractJsonObjects(match[1]);
      for (const obj of objects) {
        if (obj.tool_use && obj.tool_use.name) {
          content.push({
            type: 'tool_use',
            id: `toolu_cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: obj.tool_use.name,
            input: obj.tool_use.input || {}
          });
          stopReason = 'tool_use';
        }
      }
    }
  }

  return { content, stop_reason: stopReason };
}

function extractText(response) {
  const textBlocks = response.content.filter(b => b.type === 'text');
  return textBlocks.map(b => b.text).join('\n');
}

function extractToolUse(response) {
  return response.content.filter(b => b.type === 'tool_use');
}

function hasToolUse(response) {
  return response.stop_reason === 'tool_use';
}

async function generateQuickAck(userContent, agentName) {
  const args = ['-p', '--output-format', 'json', '--model', 'haiku', '--dangerously-skip-permissions', '--setting-sources', ''];
  const prompt = `you are ${agentName}. the user just said: "${userContent}"\n\nacknowledge their message in one casual sentence - show you understood what they want and you're about to start. don't answer or attempt the task, just the acknowledgment. no quotes.`;
  try {
    const output = await runCli(args, prompt);
    const parsed = parseCliOutput(output);
    if (parsed && typeof parsed.result === 'string' && parsed.result.length > 0) {
      return parsed.result.trim();
    }
  } catch {}
  return null;
}

function abort(agentId) {
  const proc = activeProcesses.get(agentId);
  if (proc) {
    proc.kill();
    activeProcesses.delete(agentId);
    return true;
  }
  return false;
}

async function generateStatus(toolName, elapsedSeconds, agentName) {
  const mins = Math.floor(elapsedSeconds / 60);
  const args = ['-p', '--output-format', 'json', '--model', 'haiku', '--dangerously-skip-permissions', '--setting-sources', ''];
  const prompt = `you are ${agentName}. you've been working for ${mins} minute${mins === 1 ? '' : 's'} and you're currently using ${toolName}. give a one-sentence first-person casual status update for your user. no quotes.`;
  try {
    const output = await runCli(args, prompt);
    const parsed = parseCliOutput(output);
    if (parsed && typeof parsed.result === 'string' && parsed.result.length > 0) {
      return parsed.result.trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return null;
}

module.exports = { sendMessage, extractText, extractToolUse, hasToolUse, generateQuickAck, generateStatus, abort };
