const { spawn } = require('child_process');
const { v4: uuid } = require('uuid');
const { stmts } = require('../db');
const workspace = require('./workspace');

const registry = {
  http_request: {
    definition: {
      name: 'http_request',
      description: 'make an http request to any url. use this to interact with APIs, submit data, register accounts, etc. supports all http methods.',
      input_schema: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'http method' },
          url: { type: 'string', description: 'full url including https://' },
          headers: { type: 'object', description: 'request headers as key-value pairs' },
          body: { description: 'request body — object will be sent as json, string sent as-is' }
        },
        required: ['method', 'url']
      }
    },
    handler: httpRequest
  },
  read_url: {
    definition: {
      name: 'read_url',
      description: 'fetch a url and return its content as readable text. use this to read web pages, documentation, api specs, skill files, etc.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'url to fetch and read' }
        },
        required: ['url']
      }
    },
    handler: readUrl
  },
  store_credential: {
    definition: {
      name: 'store_credential',
      description: 'securely store a credential or secret for later use. credentials are scoped to this agent and persist across tasks.',
      input_schema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'credential name (e.g. moltbook_api_key, github_token)' },
          value: { type: 'string', description: 'the secret value to store' }
        },
        required: ['key', 'value']
      }
    },
    handler: storeCredential
  },
  get_credential: {
    definition: {
      name: 'get_credential',
      description: 'retrieve a previously stored credential by key. returns null if not found.',
      input_schema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'credential name to look up' }
        },
        required: ['key']
      }
    },
    handler: getCredential
  },
  remember: {
    definition: {
      name: 'remember',
      description: 'store a memory or standing instruction that persists across conversations. use this for user preferences, recurring instructions, important context, etc.',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'what to remember' }
        },
        required: ['summary']
      }
    },
    handler: remember
  },
  schedule_task: {
    definition: {
      name: 'schedule_task',
      description: 'schedule a recurring task. a reminder with your description will be sent to you at the specified interval, triggering you to act. use this for periodic actions like posting, checking feeds, monitoring, etc.',
      input_schema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'what to do each time this fires (be specific — this is the prompt you will receive)' },
          interval_minutes: { type: 'number', description: 'how often to run in minutes (minimum 1)' }
        },
        required: ['description', 'interval_minutes']
      }
    },
    handler: scheduleTask
  },
  cancel_schedule: {
    definition: {
      name: 'cancel_schedule',
      description: 'cancel a scheduled recurring task by its id.',
      input_schema: {
        type: 'object',
        properties: {
          schedule_id: { type: 'string', description: 'id of the schedule to cancel' }
        },
        required: ['schedule_id']
      }
    },
    handler: cancelSchedule
  },
  list_schedules: {
    definition: {
      name: 'list_schedules',
      description: 'list all active scheduled tasks.',
      input_schema: {
        type: 'object',
        properties: {}
      }
    },
    handler: listSchedules
  },
  spawn_subagent: {
    definition: {
      name: 'spawn_subagent',
      description: 'spawn an ephemeral claude subprocess to handle a complex task. the subagent has full machine access (bash, file read/write, etc) but no claudity tools or memory. use this to offload heavy work like writing code, analyzing files, running commands, etc.',
      input_schema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'detailed description of what the subagent should do' },
          context: { type: 'string', description: 'optional additional context to include' }
        },
        required: ['task']
      }
    },
    handler: spawnSubagent
  },
  delegate: {
    definition: {
      name: 'delegate',
      description: 'send a message to another claudity agent by name and get their response. use this for cross-agent collaboration — asking another agent to handle something in their domain.',
      input_schema: {
        type: 'object',
        properties: {
          agent_name: { type: 'string', description: 'name of the agent to delegate to' },
          message: { type: 'string', description: 'message to send to the other agent' }
        },
        required: ['agent_name', 'message']
      }
    },
    handler: delegateToAgent
  },
  read_workspace: {
    definition: {
      name: 'read_workspace',
      description: 'read a file from your workspace. use relative paths like "SOUL.md" or "memory/2026-02-07.md".',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'relative path within your workspace' }
        },
        required: ['path']
      }
    },
    handler: readWorkspace
  },
  write_workspace: {
    definition: {
      name: 'write_workspace',
      description: 'write or overwrite a file in your workspace. use this to update your soul, identity, memory, heartbeat, or any other workspace files.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'relative path within your workspace' },
          content: { type: 'string', description: 'file content to write' }
        },
        required: ['path', 'content']
      }
    },
    handler: writeWorkspace
  },
  complete_bootstrap: {
    definition: {
      name: 'complete_bootstrap',
      description: 'signal that your identity ritual is complete. call this after writing your workspace files during bootstrap.',
      input_schema: {
        type: 'object',
        properties: {}
      }
    },
    handler: completeBootstrap
  }
};

async function httpRequest(input) {
  const { method, url, headers = {}, body } = input;

  const opts = { method, headers: { ...headers } };

  if (body !== undefined && body !== null) {
    if (typeof body === 'object') {
      opts.headers['content-type'] = opts.headers['content-type'] || 'application/json';
      opts.body = JSON.stringify(body);
    } else {
      opts.body = String(body);
    }
  }

  const res = await fetch(url, opts);

  const contentType = res.headers.get('content-type') || '';
  let responseBody;

  if (contentType.includes('application/json')) {
    responseBody = await res.json();
  } else {
    responseBody = await res.text();
    if (responseBody.length > 50000) {
      responseBody = responseBody.slice(0, 50000) + '\n\n[truncated — response exceeded 50000 chars]';
    }
  }

  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: responseBody
  };
}

async function readUrl(input) {
  const { url } = input;

  const res = await fetch(url, {
    headers: { 'accept': 'text/html,text/plain,text/markdown,application/json,*/*' }
  });

  if (!res.ok) {
    return { error: `fetch failed: ${res.status} ${res.statusText}`, url };
  }

  const contentType = res.headers.get('content-type') || '';
  let text;

  if (contentType.includes('application/json')) {
    const json = await res.json();
    text = JSON.stringify(json, null, 2);
  } else {
    text = await res.text();
  }

  if (contentType.includes('text/html')) {
    text = htmlToText(text);
  }

  if (text.length > 80000) {
    text = text.slice(0, 80000) + '\n\n[truncated — content exceeded 80000 chars]';
  }

  return { url, content: text };
}

function htmlToText(html) {
  let text = html;
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  return text.trim();
}

async function storeCredential(input, context) {
  const { key, value } = input;
  const agent = stmts.getAgent.get(context.agentId);
  if (!agent) throw new Error('agent not found');
  const config = JSON.parse(agent.tools_config || '{}');
  config[key] = value;
  stmts.updateAgentToolsConfig.run(JSON.stringify(config), context.agentId);
  return { stored: true, key };
}

async function getCredential(input, context) {
  const { key } = input;
  const agent = stmts.getAgent.get(context.agentId);
  if (!agent) return { key, value: null };
  const config = JSON.parse(agent.tools_config || '{}');
  return { key, value: config[key] || null };
}

async function remember(input, context) {
  const { summary } = input;
  const id = uuid();
  stmts.createMemory.run(id, context.agentId, summary);
  return { remembered: true, summary };
}

async function scheduleTask(input, context) {
  const { description, interval_minutes } = input;
  const mins = Math.max(1, interval_minutes);
  const intervalMs = mins * 60 * 1000;
  const id = uuid();
  const now = Date.now();
  stmts.createSchedule.run(id, context.agentId, description, intervalMs, now + intervalMs);
  return {
    scheduled: true,
    id,
    description,
    interval_minutes: mins,
    next_run_at: new Date(now + intervalMs).toISOString()
  };
}

async function cancelSchedule(input, context) {
  const { schedule_id } = input;
  stmts.deactivateSchedule.run(schedule_id, context.agentId);
  return { cancelled: true, id: schedule_id };
}

async function listSchedules(input, context) {
  const schedules = stmts.agentSchedules.all(context.agentId);
  return schedules.map(s => ({
    id: s.id,
    description: s.description,
    interval_minutes: s.interval_ms / 60000,
    next_run_at: new Date(s.next_run_at).toISOString(),
    active: !!s.active
  }));
}

async function spawnSubagent(input, context) {
  const { task, context: taskContext } = input;
  let prompt = task;
  if (taskContext) prompt = `context: ${taskContext}\n\ntask: ${task}`;

  let model = 'opus';
  if (context && context.agentId) {
    const agent = stmts.getAgent.get(context.agentId);
    if (agent && agent.model) model = agent.model;
  }

  return new Promise((resolve) => {
    let done = false;
    const args = ['-p', '--output-format', 'json', '--model', model, '--dangerously-skip-permissions'];
    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300000
    });

    const fallback = setTimeout(() => {
      if (!done) {
        done = true;
        proc.kill();
        resolve({ error: 'subagent timed out after 5 minutes' });
      }
    }, 310000);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      if (!stdout.trim() && code !== 0) {
        resolve({ error: `subagent exited ${code}: ${stderr.trim()}` });
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        const text = typeof parsed.result === 'string' ? parsed.result : '';
        resolve({ result: text });
      } catch {
        resolve({ result: stdout.trim() });
      }
    });

    proc.on('error', err => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      resolve({ error: err.message });
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

async function delegateToAgent(input, context) {
  const { agent_name, message } = input;

  const target = stmts.getAgentByName.get(agent_name);
  if (!target) return { error: `agent "${agent_name}" not found` };

  if (target.id === context.agentId) {
    return { error: 'cannot delegate to yourself' };
  }

  const chat = require('./chat');
  const response = await chat.enqueueMessage(target.id, message);
  return { agent: target.name, response: response.content };
}

async function readWorkspace(input, context) {
  const agent = stmts.getAgent.get(context.agentId);
  if (!agent) throw new Error('agent not found');
  if (input.path.includes('..')) throw new Error('path cannot contain ..');
  const content = workspace.readFile(agent.name, input.path);
  return { path: input.path, content };
}

async function writeWorkspace(input, context) {
  const agent = stmts.getAgent.get(context.agentId);
  if (!agent) throw new Error('agent not found');
  if (input.path.includes('..')) throw new Error('path cannot contain ..');
  workspace.writeFile(agent.name, input.path, input.content);
  return { written: true, path: input.path };
}

async function completeBootstrap(input, context) {
  const agent = stmts.getAgent.get(context.agentId);
  if (!agent) throw new Error('agent not found');
  stmts.setBootstrapped.run(1, context.agentId);
  workspace.deleteFile(agent.name, 'BOOTSTRAP.md');
  const chat = require('./chat');
  chat.emit(context.agentId, 'bootstrap_complete', {});
  return { bootstrapped: true };
}

function getToolDefinitions(toolNames) {
  if (!toolNames || !toolNames.length) return [];
  return toolNames
    .filter(name => registry[name])
    .map(name => registry[name].definition);
}

function getAllToolNames() {
  return Object.keys(registry);
}

function getAllToolDefinitions() {
  return Object.values(registry).map(t => t.definition);
}

async function executeTool(name, input, context) {
  const tool = registry[name];
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return await tool.handler(input, context);
}

module.exports = { getToolDefinitions, getAllToolNames, getAllToolDefinitions, executeTool };
