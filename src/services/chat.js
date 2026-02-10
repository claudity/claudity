const { v4: uuid } = require('uuid');
const { stmts } = require('../db');
const claude = require('./claude');
const tools = require('./tools');
const memory = require('./memory');
const workspace = require('./workspace');

const agentStreams = new Map();
const messageQueues = new Map();
const processingAgents = new Set();

function addStream(agentId, res) {
  if (!agentStreams.has(agentId)) agentStreams.set(agentId, []);
  agentStreams.get(agentId).push(res);
}

function removeStream(agentId, res) {
  const streams = agentStreams.get(agentId);
  if (!streams) return;
  const idx = streams.indexOf(res);
  if (idx !== -1) streams.splice(idx, 1);
  if (!streams.length) agentStreams.delete(agentId);
}

function emit(agentId, event, data) {
  const streams = agentStreams.get(agentId);
  if (!streams) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of streams) {
    res.write(payload);
  }
}

function buildSystemPrompt(agent) {
  if (agent.bootstrapped === 0) {
    const bootstrap = workspace.readFile(agent.name, 'BOOTSTRAP.md');
    if (bootstrap) {
      const toolDefs = tools.getAllToolDefinitions();
      const toolList = toolDefs
        .filter(t => ['read_workspace', 'write_workspace', 'complete_bootstrap'].includes(t.name))
        .map(t => `- ${t.name}: ${t.description}`).join('\n');

      return `you are a new agent called ${agent.name}. you have not been set up yet.

you know nothing about the user. do not infer, guess, or use any name, username, file path, hostname, or environment variable to identify them. if you see a username in a path or system info, ignore it completely. you must ask the user who they are.

${bootstrap}

available tools:
${toolList}

your workspace is at data/agents/${workspace.sanitizeName(agent.name)}/. use write_workspace to create your files. do NOT use bash, read, glob, grep, or any other built-in tools during bootstrap.`;
    }
  }

  const soul = workspace.readFile(agent.name, 'SOUL.md');
  const identity = workspace.readFile(agent.name, 'IDENTITY.md');
  const user = workspace.readFile(agent.name, 'USER.md');
  const memoryMd = workspace.readFile(agent.name, 'MEMORY.md');
  const dailyLogs = workspace.getDailyLogs(agent.name);

  const dbMemories = stmts.listMemories.all(agent.id);
  const dbMemoryBlock = dbMemories.length
    ? dbMemories.map(m => `- ${m.summary}`).join('\n')
    : '';

  const toolDefs = tools.getAllToolDefinitions();
  const toolList = toolDefs.map(t => `- ${t.name}: ${t.description}`).join('\n');

  let prompt = '';

  if (soul) {
    prompt += soul + '\n\n';
  } else {
    prompt += `you are ${agent.name}, an ai agent.\n\n`;
  }

  if (identity) prompt += identity + '\n\n';

  if (user) prompt += `user context:\n${user}\n\n`;

  const memoryContent = memoryMd || dbMemoryBlock;
  if (memoryContent) prompt += `your memories:\n${memoryContent}\n\n`;

  if (dailyLogs) prompt += `recent context:\n${dailyLogs}\n\n`;

  prompt += `adapt your tone and style naturally to match whoever you are talking to. be personable. you are not a task executor — you are a conversational agent who can also get things done when asked.

you have full machine access — bash, file read/write/edit, glob, grep — all available as built-in tools in your environment. use them freely to accomplish tasks: run commands, read/write files, explore the filesystem, execute scripts, etc.

available claudity tools:
${toolList}

use spawn_subagent to offload complex or time-consuming work (writing code, running multi-step commands, analysis) to an ephemeral subprocess. the subagent has full machine access but no claudity tools or memory.

use delegate to collaborate with other agents — send a message to another agent by name and get their response. useful when a task falls in another agent's domain.

your memories are automatically extracted from conversations and written to daily logs. use the remember tool for critical standing instructions or preferences you must never lose.

your workspace is at data/agents/${workspace.sanitizeName(agent.name)}/. you can read and write your own files using read_workspace and write_workspace. your soul, identity, memory, and heartbeat files are yours to evolve.

when using tools, just use them naturally as part of the conversation — no need to announce plans or ask permission. when interacting with external platforms, read their documentation first to understand the api.

if the user asks you to do something repeatedly or on a schedule, use the schedule_task tool to set it up. you will receive scheduled reminders as messages and should act on them autonomously.

when you receive a [scheduled reminder], just do the thing — no need to announce that it was a reminder. act naturally.

CRITICAL: users cannot see tool results. they only see your final text response. when you use tools, you MUST include every key detail from the results — urls, links, claim links, confirmation codes, registration links, usernames, error messages, anything actionable. if you don't include it in your response, the user will never see it. never summarize away actionable information.

you know nothing about the user until they tell you. do not infer, guess, or use any username, file path, hostname, or environment variable to identify them. if you see a username in a path or system info, ignore it completely. never address the user by name until they introduce themselves.`;

  return prompt;
}

function getHistory(agentId, limit = 30) {
  const rows = stmts.recentMessages.all(agentId, limit).reverse();
  return rows.map(r => {
    let content = r.content;
    if (r.role === 'assistant' && r.tool_calls) {
      try {
        const calls = JSON.parse(r.tool_calls);
        const toolSummary = calls.map(tc => {
          const outputStr = typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output);
          const truncated = outputStr.length > 500 ? outputStr.slice(0, 500) + '...' : outputStr;
          return `[used ${tc.name}: ${truncated}]`;
        }).join('\n');
        content = content + '\n\n' + toolSummary;
      } catch {}
    }
    return { role: r.role, content };
  });
}

async function handleMessage(agentId, userContent, options = {}) {
  const agent = stmts.getAgent.get(agentId);
  if (!agent) throw new Error('agent not found');

  const isHeartbeat = !!options.heartbeat;
  const isScheduled = typeof userContent === 'string' && userContent.startsWith('[scheduled reminder]');

  if (!isHeartbeat) {
    const userMsgId = uuid();
    stmts.createMessage.run(userMsgId, agentId, 'user', userContent, null);
    emit(agentId, 'user_message', { id: userMsgId, content: userContent });
  }

  if (!isHeartbeat) {
    processingAgents.add(agentId);
    emit(agentId, 'typing', { active: true });
  }

  let responseComplete = false;

  const systemPrompt = buildSystemPrompt(agent);
  const toolDefs = tools.getAllToolDefinitions();
  const isBootstrap = agent.bootstrapped === 0;
  const sessionAgentId = (!isBootstrap && !isHeartbeat) ? agentId : null;
  const model = agent.model || 'opus';
  const thinking = (isBootstrap || isHeartbeat) ? 'low' : (agent.thinking || 'high');

  let messages = isHeartbeat
    ? [{ role: 'user', content: userContent }]
    : [...getHistory(agentId)];

  let allToolCalls = [];
  let intermediateTexts = [];

  const wantsAck = !isHeartbeat && !isScheduled && agent.bootstrapped !== 0;
  const ackPromise = wantsAck
    ? claude.generateQuickAck(userContent, agent.name).catch(() => null)
    : Promise.resolve(null);

  const mainPromise = claude.sendMessage({
    system: systemPrompt,
    messages,
    tools: toolDefs,
    maxTokens: 4096,
    agentId: sessionAgentId,
    model,
    thinking,
    noBuiltinTools: isBootstrap
  });

  try {
    let response;

    if (wantsAck) {
      const raceResult = await Promise.race([
        mainPromise.then(r => ({ type: 'main', result: r })),
        new Promise(resolve => setTimeout(() => resolve({ type: 'timeout' }), 8000))
      ]);

      if (raceResult.type === 'main') {
        response = raceResult.result;
      } else {
        const quickAck = await ackPromise;
        if (quickAck) {
          const ackMsgId = uuid();
          stmts.createMessage.run(ackMsgId, agentId, 'assistant', quickAck, null);
          emit(agentId, 'typing', { active: false });
          emit(agentId, 'ack_message', { content: quickAck });
          if (options.onAck) options.onAck(quickAck);
          emit(agentId, 'typing', { active: true });
        }
        response = await mainPromise;
      }
    } else {
      response = await mainPromise;
    }

    while (claude.hasToolUse(response)) {
      const calls = claude.extractToolUse(response);
      let thinkingText = claude.extractText(response).trim();
      thinkingText = thinkingText.replace(/```json\s*\n?\s*\{[\s\S]*?\}\s*\n?\s*```/g, '').replace(/\n{3,}/g, '\n\n').trim();

      if (thinkingText) {
        intermediateTexts.push(thinkingText);
        emit(agentId, 'intermediate', { content: thinkingText });
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolResults = [];

      for (const call of calls) {
        emit(agentId, 'tool_call', { name: call.name, input: call.input });

        try {
          const result = await tools.executeTool(call.name, call.input, { agentId });
          emit(agentId, 'tool_result', { name: call.name, output: result });
          allToolCalls.push({ name: call.name, input: call.input, output: result });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: JSON.stringify(result)
          });
        } catch (err) {
          emit(agentId, 'tool_result', { name: call.name, output: { error: err.message } });
          allToolCalls.push({ name: call.name, input: call.input, output: { error: err.message } });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: JSON.stringify({ error: err.message }),
            is_error: true
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });

      response = await claude.sendMessage({
        system: systemPrompt,
        messages,
        tools: toolDefs,
        maxTokens: 4096,
        agentId: sessionAgentId,
        model,
        thinking,
        noBuiltinTools: isBootstrap
      });
    }

    let rawText = claude.extractText(response);
    if (/^\s*\{.*"type"\s*:\s*"result"/.test(rawText)) rawText = '';
    let finalText = rawText.replace(/\n*\[used \w+:[\s\S]*$/, '').trim();

    if (allToolCalls.length && !finalText) {
      const lastCall = allToolCalls[allToolCalls.length - 1];
      const outputStr = typeof lastCall.output === 'string' ? lastCall.output : JSON.stringify(lastCall.output, null, 2);
      const truncated = outputStr.length > 10000 ? outputStr.slice(0, 10000) + '...' : outputStr;
      finalText = `done (used ${lastCall.name})\n\n${truncated}`;
    }

    let responseText = finalText;
    if (intermediateTexts.length && finalText) {
      const last = intermediateTexts[intermediateTexts.length - 1];
      if (finalText === last || last.includes(finalText)) {
        responseText = intermediateTexts.join('\n\n');
      } else if (finalText.includes(last)) {
        responseText = [...intermediateTexts.slice(0, -1), finalText].join('\n\n');
      } else {
        responseText = intermediateTexts.join('\n\n') + '\n\n' + finalText;
      }
    } else if (intermediateTexts.length) {
      responseText = intermediateTexts.join('\n\n');
    }

    responseText = responseText.replace(/\n{3,}/g, '\n\n').trim();

    const assistantMsgId = uuid();
    const toolCallsJson = allToolCalls.length ? JSON.stringify(allToolCalls) : null;

    if (isHeartbeat) {
      const stripped = responseText.replace(/\s+/g, ' ').trim();
      const isOk = stripped.includes('HEARTBEAT_OK') && stripped.length <= 300;
      if (isOk) {
        responseComplete = true;
        return { id: null, content: responseText, suppressed: true };
      }
      stmts.createHeartbeatMessage.run(assistantMsgId, agentId, 'assistant', responseText, toolCallsJson);
      responseComplete = true;
      emit(agentId, 'heartbeat_alert', {
        id: assistantMsgId,
        content: responseText,
        tool_calls: allToolCalls.length ? allToolCalls : null
      });
      return { id: assistantMsgId, content: responseText, tool_calls: allToolCalls.length ? allToolCalls : null };
    }

    stmts.createMessage.run(assistantMsgId, agentId, 'assistant', responseText, toolCallsJson);

    if (isBootstrap && stmts.getAgent.get(agentId)?.bootstrapped === 0) {
      const msgCount = stmts.listMessages.all(agentId).filter(m => m.role === 'user').length;
      if (msgCount >= 4) {
        stmts.setBootstrapped.run(1, agentId);
        workspace.deleteFile(agent.name, 'BOOTSTRAP.md');
        emit(agentId, 'bootstrap_complete', {});
      }
    }

    if (!isHeartbeat) {
      memory.extractMemories(agentId, userContent, responseText).catch(err => {
        console.error(`[memory] extraction failed for ${agentId}: ${err.message}`);
      });
    }

    responseComplete = true;
    processingAgents.delete(agentId);
    emit(agentId, 'typing', { active: false });
    emit(agentId, 'assistant_message', {
      id: assistantMsgId,
      content: responseText,
      tool_calls: allToolCalls.length ? allToolCalls : null
    });

    return { id: assistantMsgId, content: responseText, tool_calls: allToolCalls.length ? allToolCalls : null };

  } catch (err) {
    responseComplete = true;
    processingAgents.delete(agentId);
    if (!isHeartbeat) emit(agentId, 'typing', { active: false });
    if (!isHeartbeat) emit(agentId, 'error', { error: err.message });
    throw err;
  }
}

function enqueueMessage(agentId, content, options = {}) {
  const prior = messageQueues.get(agentId) || Promise.resolve();
  const chained = prior.catch(() => undefined).then(() => handleMessage(agentId, content, options));
  const tracked = chained.finally(() => {
    if (messageQueues.get(agentId) === tracked) {
      messageQueues.delete(agentId);
    }
  });
  messageQueues.set(agentId, tracked);
  return chained;
}

function isProcessing(agentId) {
  return processingAgents.has(agentId);
}

module.exports = { handleMessage, enqueueMessage, addStream, removeStream, emit, isProcessing };
