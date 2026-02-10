const TelegramBot = require('node-telegram-bot-api');

const MAX_RESPONSE_LENGTH = 4000;

let bot = null;

function log(msg) {
  console.log(`[telegram] ${msg}`);
}

function parseMessage(text) {
  if (!text) return null;
  const match = text.match(/^(\w+):\s*(.+)$/s);
  if (!match) return null;
  return { agent: match[1].toLowerCase(), command: match[2].trim() };
}

function start(config, callbacks) {
  const { onStatus } = callbacks || {};
  const { token } = config || {};

  if (!token) {
    if (onStatus) onStatus('error', 'no bot token configured');
    return;
  }

  const chatModule = require('./chat');
  const { stmts } = require('../db');

  bot = new TelegramBot(token, { polling: true });

  bot.on('polling_error', (err) => {
    log('polling error: ' + err.message);
    if (onStatus) onStatus('error', err.message);
  });

  bot.getMe().then((me) => {
    log(`logged in as @${me.username}`);
    if (onStatus) onStatus('connected', `@${me.username}`);
  }).catch((err) => {
    log('auth failed: ' + err.message);
    if (onStatus) onStatus('error', err.message);
  });

  bot.on('message', async (msg) => {
    if (msg.from.is_bot) return;
    if (!msg.text) return;

    let parsed = parseMessage(msg.text);
    let agent;
    if (parsed) {
      agent = stmts.getAgentByName.get(parsed.agent);
      if (!agent) {
        bot.sendMessage(msg.chat.id, `no agent named "${parsed.agent}"`).catch(() => {});
        return;
      }
    } else {
      agent = stmts.getDefaultAgent.get();
      if (!agent) return;
      parsed = { agent: agent.name, command: msg.text.trim() };
    }

    log(`${parsed.agent}: ${parsed.command}`);
    bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});

    try {
      const result = await chatModule.enqueueMessage(agent.id, parsed.command, {
        onAck: (text) => {
          bot.sendMessage(msg.chat.id, text, { reply_to_message_id: msg.message_id }).catch(() => {});
          bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
        }
      });
      if (result && result.content) {
        let text = result.content;
        if (text.length > MAX_RESPONSE_LENGTH) {
          text = text.slice(0, MAX_RESPONSE_LENGTH) + '...';
        }
        await bot.sendMessage(msg.chat.id, text, { reply_to_message_id: msg.message_id });
      }
    } catch (err) {
      bot.sendMessage(msg.chat.id, `error: ${err.message}`, { reply_to_message_id: msg.message_id }).catch(() => {});
    }
  });
}

function stop() {
  if (bot) {
    bot.stopPolling();
    bot = null;
  }
  log('disconnected');
}

module.exports = { start, stop };
