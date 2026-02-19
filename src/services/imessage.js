const Database = require('better-sqlite3');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const chatDbPath = path.join(process.env.HOME, 'Library', 'Messages', 'chat.db');
const POLL_INTERVAL = 3000;
const MAX_RESPONSE_LENGTH = 1500;

let db = null;
let lastRowId = 0;
let timer = null;
let chatModule = null;
let selfChatId = null;
const recentSent = new Set();

function log(msg) {
  console.log(`[imessage] ${msg}`);
}

function open() {
  if (!fs.existsSync(chatDbPath)) {
    log('chat.db not found');
    return false;
  }

  try {
    db = new Database(chatDbPath, { fileMustExist: true });
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 2000');
    db.function('after_delete_message_plugin', { varargs: true }, () => {});
    db.function('before_delete_attachment_path', { varargs: true }, () => {});
    db.function('delete_attachment_path', { varargs: true }, () => {});
    db.function('delete_chat_background_before_deleting_chat', { varargs: true }, () => {});
    db.function('guid_for_chat', { varargs: true }, () => '');
    db.function('is_mic_enabled', { varargs: true }, () => 0);
    db.function('verify_chat', { varargs: true }, () => {});
    return true;
  } catch (err) {
    log('cannot open chat.db: ' + err.message);
    return false;
  }
}

function initSelfChat(phone) {
  if (!phone) {
    log('no phone number configured');
    return false;
  }

  const row = db.prepare("select ROWID, guid from chat where chat_identifier = ?").get(phone);
  if (!row) {
    log(`no self-chat found for ${phone}`);
    return false;
  }

  selfChatId = row.ROWID;
  log(`self-chat: ${row.guid} (id ${selfChatId})`);
  return true;
}

function initLastRowId() {
  const row = db.prepare("select max(ROWID) as maxId from message").get();
  lastRowId = row && row.maxId ? row.maxId : 0;
  log(`starting from rowid ${lastRowId}`);
}

function parseMessage(text) {
  if (!text) return null;
  const match = text.match(/^(\w+):\s*(.+)$/s);
  if (!match) return null;
  return { agent: match[1].toLowerCase(), command: match[2].trim() };
}

function readNewMessages() {
  try {
    return db.prepare(
      "select m.ROWID, m.text, m.is_from_me, m.date, c.guid as chat_guid from message m join chat_message_join cmj on cmj.message_id = m.ROWID join chat c on c.ROWID = cmj.chat_id where m.ROWID > ? and m.is_from_me = 0 and m.text is not null and cmj.chat_id = ? order by m.ROWID asc limit 20"
    ).all(lastRowId, selfChatId);
  } catch (err) {
    log('read error: ' + err.message);
    return [];
  }
}

function sendMessage(chatGuid, text) {
  let truncated = text;
  if (text.length > MAX_RESPONSE_LENGTH) {
    truncated = text.slice(0, MAX_RESPONSE_LENGTH) + '...';
  }

  const escaped = truncated.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const script = `tell application "Messages"
  send "${escaped}" to chat id "${chatGuid}"
end tell`;

  recentSent.add(truncated);
  setTimeout(() => recentSent.delete(truncated), 15000);

  const beforeMax = db.prepare("select max(ROWID) as maxId from message").get();
  const beforeId = beforeMax ? beforeMax.maxId : 0;

  execFile('osascript', ['-e', script], (err) => {
    if (err) {
      log('send error: ' + err.message);
      return;
    }
    setTimeout(() => deleteResponseEcho(beforeId, truncated), 2000);
  });
}

function deleteResponseEcho(afterRowId, text) {
  try {
    const echo = db.prepare(
      "select m.ROWID from message m where m.is_from_me = 1 and m.ROWID > ? and m.text = ?"
    ).get(afterRowId, text);

    if (echo) {
      db.prepare("delete from chat_message_join where message_id = ?").run(echo.ROWID);
      log('deleted response echo');
    }
  } catch (err) {
    log('response echo delete error: ' + err.message);
  }
}

function poll() {
  const messages = readNewMessages();

  for (const msg of messages) {
    if (msg.ROWID > lastRowId) {
      lastRowId = msg.ROWID;
    }

    if (!msg.text) continue;
    const msgText = msg.text.length > MAX_RESPONSE_LENGTH ? msg.text.slice(0, MAX_RESPONSE_LENGTH) + '...' : msg.text;
    if (recentSent.has(msg.text) || recentSent.has(msgText)) continue;

    const { stmts } = require('../db');
    let parsed = parseMessage(msg.text);
    let agent;
    if (parsed) {
      agent = stmts.getAgentByName.get(parsed.agent);
      if (!agent) continue;
    } else {
      agent = stmts.getDefaultAgent.get();
      if (!agent) continue;
      parsed = { agent: agent.name, command: msg.text.trim() };
    }

    log(`${parsed.agent}: ${parsed.command}`);
    handleCommand(agent, parsed.command, msg.chat_guid);
  }
}

async function handleCommand(agent, command, chatGuid) {
  try {
    const result = await chatModule.enqueueMessage(agent.id, command, {
      onAck: (text) => sendMessage(chatGuid, text)
    });
    if (result && result.content) {
      sendMessage(chatGuid, result.content);
    }
  } catch (err) {
    sendMessage(chatGuid, `error: ${err.message}`);
  }
}

function start(config, callbacks) {
  chatModule = require('./chat');
  const { onStatus } = callbacks || {};

  if (!open()) {
    if (onStatus) onStatus('error', 'chat.db not found');
    return;
  }
  if (!initSelfChat(config && config.phone)) {
    if (onStatus) onStatus('error', 'self-chat not found for ' + (config && config.phone));
    return;
  }

  initLastRowId();
  timer = setInterval(poll, POLL_INTERVAL);
  log('relay started');
  if (onStatus) onStatus('connected', 'polling self-chat');
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (db) {
    db.close();
    db = null;
  }
  log('relay stopped');
}

module.exports = { start, stop };
