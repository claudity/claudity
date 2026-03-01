const { App, LogLevel } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');

const MAX_RESPONSE_LENGTH = 3000;
const EDIT_THROTTLE = 5000;

let app = null;

function log(msg) {
  console.log(`[slack] ${msg}`);
}

function parseMessage(text) {
  if (!text) return null;
  let cleaned = text.replace(/<@[A-Z0-9]+>/g, '').trim();
  const match = cleaned.match(/^(\w+):\s*(.+)$/s);
  if (!match) return null;
  return { agent: match[1].toLowerCase(), command: match[2].trim() };
}

function clamp(text) {
  return text.length > MAX_RESPONSE_LENGTH ? text.slice(0, MAX_RESPONSE_LENGTH) + '...' : text;
}

function start(config, callbacks) {
  const { onStatus } = callbacks || {};
  const { bot_token, app_token } = config || {};

  if (!bot_token || !app_token) {
    if (onStatus) onStatus('error', 'bot token and app token required');
    return;
  }

  (async () => {
    try {
      const client = new WebClient(bot_token);
      const auth = await client.auth.test();
      const team = auth.team || 'unknown workspace';

      const chatModule = require('./chat');
      const { stmts } = require('../db');

      app = new App({
        token: bot_token,
        appToken: app_token,
        socketMode: true,
        logLevel: LogLevel.ERROR,
      });

      async function handleMessage({ message, say }) {
        if (message.subtype) return;
        if (message.bot_id) return;

        let parsed = parseMessage(message.text);
        let agent;
        if (parsed) {
          agent = stmts.getAgentByName.get(parsed.agent);
          if (!agent) {
            await say(`no agent named "${parsed.agent}"`);
            return;
          }
        } else {
          agent = stmts.getDefaultAgent.get();
          if (!agent) return;
          let cleaned = (message.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
          parsed = { agent: agent.name, command: cleaned };
        }

        log(`${parsed.agent}: ${parsed.command}`);

        let statusTs = null;
        let statusChannel = null;
        let statusPromise = null;
        let lastEditTime = 0;

        try {
          const result = await chatModule.enqueueMessage(agent.id, parsed.command, {
            onAck: (text) => {
              text = clamp(text);
              if (!statusPromise) {
                statusPromise = say(text)
                  .then(res => { statusTs = res.ts; statusChannel = res.channel; })
                  .catch(() => {});
              } else if (Date.now() - lastEditTime >= EDIT_THROTTLE) {
                lastEditTime = Date.now();
                statusPromise = statusPromise.then(() => {
                  if (statusTs) return client.chat.update({ channel: statusChannel, ts: statusTs, text }).catch(() => {});
                });
              }
            }
          });
          if (result && result.content) {
            const text = clamp(result.content);
            if (statusPromise) {
              await statusPromise;
              if (statusTs) {
                await client.chat.update({ channel: statusChannel, ts: statusTs, text }).catch(() => {});
              } else {
                await say(text);
              }
            } else {
              await say(text);
            }
          }
        } catch (err) {
          await say(`error: ${err.message}`);
        }
      }

      app.error(async (err) => {
        log('runtime error: ' + err.message);
      });

      app.message(handleMessage);

      app.event('app_mention', async ({ event, say }) => {
        handleMessage({ message: event, say });
      });

      await app.start();
      log(`connected to ${team}`);
      if (onStatus) onStatus('connected', auth.user + ' in ' + team);
    } catch (err) {
      log('start failed: ' + err.message);
      if (onStatus) onStatus('error', err.message);
    }
  })().catch((err) => {
    log('unhandled error: ' + err.message);
    if (onStatus) onStatus('error', err.message);
  });
}

function stop() {
  if (app) {
    app.stop().catch(() => {});
    app = null;
  }
  log('disconnected');
}

module.exports = { start, stop };
