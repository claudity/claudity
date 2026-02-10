const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

const MAX_RESPONSE_LENGTH = 4000;

let client = null;

function log(msg) {
  console.log(`[whatsapp] ${msg}`);
}

function parseMessage(text) {
  if (!text) return null;
  const match = text.match(/^(\w+):\s*(.+)$/s);
  if (!match) return null;
  return { agent: match[1].toLowerCase(), command: match[2].trim() };
}

function start(config, callbacks) {
  const { onStatus } = callbacks || {};

  const chatModule = require('./chat');
  const { stmts } = require('../db');

  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
  });

  client.on('qr', async (qr) => {
    log('qr code received');
    try {
      const dataUrl = await QRCode.toDataURL(qr, { width: 256, margin: 2 });
      if (onStatus) onStatus('qr', dataUrl);
    } catch (err) {
      log('qr generation failed: ' + err.message);
    }
  });

  client.on('ready', () => {
    const name = client.info.pushname || client.info.wid.user;
    log(`logged in as ${name}`);
    if (onStatus) onStatus('connected', name);
  });

  client.on('auth_failure', (msg) => {
    log('auth failed: ' + msg);
    if (onStatus) onStatus('error', msg);
  });

  client.on('disconnected', (reason) => {
    log('disconnected: ' + reason);
    if (onStatus) onStatus('disconnected', reason);
  });

  let busy = false;

  client.on('message_create', async (message) => {

    let parsed = parseMessage(message.body);
    let agent;
    if (parsed) {
      agent = stmts.getAgentByName.get(parsed.agent);
      if (!agent) {
        message.reply(`no agent named "${parsed.agent}"`).catch(() => {});
        return;
      }
    } else {
      if (busy) return;
      agent = stmts.getDefaultAgent.get();
      if (!agent) return;
      if (!message.body || !message.body.trim()) return;
      parsed = { agent: agent.name, command: message.body.trim() };
    }

    log(`${parsed.agent}: ${parsed.command}`);
    busy = true;

    try {
      const result = await chatModule.enqueueMessage(agent.id, parsed.command, {
        onAck: (text) => message.reply(text).catch(() => {})
      });
      if (result && result.content) {
        let text = result.content;
        if (text.length > MAX_RESPONSE_LENGTH) {
          text = text.slice(0, MAX_RESPONSE_LENGTH) + '...';
        }
        await message.reply(text);
      }
    } catch (err) {
      message.reply(`error: ${err.message}`).catch(() => {});
    }

    setTimeout(() => { busy = false; }, 2000);
  });

  client.initialize().catch((err) => {
    log('init failed: ' + err.message);
    if (onStatus) onStatus('error', err.message);
  });
}

function stop() {
  if (client) {
    client.destroy().catch(() => {});
    client = null;
  }
  log('disconnected');
}

module.exports = { start, stop };
