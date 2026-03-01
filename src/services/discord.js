const { Client, GatewayIntentBits, Partials } = require('discord.js');

const MAX_RESPONSE_LENGTH = 1900;
const EDIT_THROTTLE = 5000;

let client = null;
let typingTimer = null;

function log(msg) {
  console.log(`[discord] ${msg}`);
}

function parseMessage(text, botId) {
  if (!text) return null;
  let cleaned = text.replace(new RegExp(`<@!?${botId}>\\s*`, 'g'), '').trim();
  const match = cleaned.match(/^(\w+):\s*(.+)$/s);
  if (!match) return null;
  return { agent: match[1].toLowerCase(), command: match[2].trim() };
}

function clamp(text) {
  return text.length > MAX_RESPONSE_LENGTH ? text.slice(0, MAX_RESPONSE_LENGTH) + '...' : text;
}

function startTyping(channel) {
  channel.sendTyping().catch(() => {});
  typingTimer = setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, 5000);
}

function stopTyping() {
  if (typingTimer) {
    clearInterval(typingTimer);
    typingTimer = null;
  }
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

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once('ready', () => {
    const tag = client.user.tag;
    const servers = client.guilds.cache.size;
    log(`logged in as ${tag} on ${servers} server(s)`);
    if (onStatus) onStatus('connected', `${tag} on ${servers} server(s)`);
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const isDM = !message.guild;
    const isMention = message.mentions.has(client.user);

    if (!isDM && !isMention) return;

    let parsed = parseMessage(message.content, client.user.id);
    let agent;
    if (parsed) {
      agent = stmts.getAgentByName.get(parsed.agent);
      if (!agent) {
        await message.reply(`no agent named "${parsed.agent}"`).catch(() => {});
        return;
      }
    } else {
      agent = stmts.getDefaultAgent.get();
      if (!agent) return;
      let cleaned = message.content.replace(new RegExp(`<@!?${client.user.id}>\\s*`, 'g'), '').trim();
      parsed = { agent: agent.name, command: cleaned };
    }

    log(`${parsed.agent}: ${parsed.command}`);
    startTyping(message.channel);

    let statusReply = null;
    let statusPromise = null;
    let lastEditTime = 0;

    try {
      const result = await chatModule.enqueueMessage(agent.id, parsed.command, {
        onAck: (text) => {
          text = clamp(text);
          if (!statusPromise) {
            statusPromise = message.reply(text)
              .then(sent => { statusReply = sent; })
              .catch(() => {});
          } else if (Date.now() - lastEditTime >= EDIT_THROTTLE) {
            lastEditTime = Date.now();
            statusPromise = statusPromise.then(() => {
              if (statusReply) return statusReply.edit(text).catch(() => {});
            });
          }
        }
      });
      stopTyping();
      if (result && result.content) {
        const text = clamp(result.content);
        if (statusPromise) {
          await statusPromise;
          if (statusReply) {
            await statusReply.edit(text).catch(() => {});
          } else {
            await message.reply(text);
          }
        } else {
          await message.reply(text);
        }
      }
    } catch (err) {
      stopTyping();
      await message.reply(`error: ${err.message}`).catch(() => {});
    }
  });

  client.login(token).catch((err) => {
    log('login failed: ' + err.message);
    if (onStatus) onStatus('error', err.message);
  });
}

function stop() {
  stopTyping();
  if (client) {
    client.destroy();
    client = null;
  }
  log('disconnected');
}

module.exports = { start, stop };
