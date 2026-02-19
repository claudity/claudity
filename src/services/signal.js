const { spawn, execSync } = require('child_process');
const QRCode = require('qrcode');

const MAX_RESPONSE_LENGTH = 4000;

let daemon = null;
let rpcId = 1;

function log(msg) {
  console.log(`[signal] ${msg}`);
}

function parseMessage(text) {
  if (!text) return null;
  const match = text.match(/^(\w+):\s*(.+)$/s);
  if (!match) return null;
  return { agent: match[1].toLowerCase(), command: match[2].trim() };
}

function signalCliAvailable() {
  try {
    execSync('which signal-cli', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function send(recipient, message) {
  if (!daemon || !daemon.stdin.writable) return;
  const req = JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'send', params: { recipient: [recipient], message } });
  daemon.stdin.write(req + '\n');
}

function startDaemon(phone, onStatus, chatModule, stmts) {
  daemon = spawn('signal-cli', ['-a', phone, 'jsonRpc', '--receive-mode=on-start', '--send-read-receipts'], { stdio: ['pipe', 'pipe', 'pipe'] });

  log(`daemon started for ${phone} (pid ${daemon.pid})`);
  if (onStatus) onStatus('connected', phone);

  let buffer = '';

  daemon.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;

      let msg;
      try { msg = JSON.parse(line); } catch { continue; }

      if (msg.method === 'receive') {
        const envelope = msg.params && msg.params.envelope;
        if (!envelope) continue;

        let text, sender;

        if (envelope.dataMessage && envelope.dataMessage.message) {
          text = envelope.dataMessage.message;
          sender = envelope.sourceNumber || envelope.source;
        } else if (envelope.syncMessage && envelope.syncMessage.sentMessage && envelope.syncMessage.sentMessage.message) {
          text = envelope.syncMessage.sentMessage.message;
          sender = envelope.syncMessage.sentMessage.destinationNumber || envelope.syncMessage.sentMessage.destination || envelope.sourceNumber || envelope.source;
        }

        if (!text || !sender) continue;

        let parsed = parseMessage(text);
        let agent;
        if (parsed) {
          agent = stmts.getAgentByName.get(parsed.agent);
          if (!agent) {
            send(sender, `no agent named "${parsed.agent}"`);
            continue;
          }
        } else {
          agent = stmts.getDefaultAgent.get();
          if (!agent) continue;
          parsed = { agent: agent.name, command: text.trim() };
        }

        log(`${parsed.agent}: ${parsed.command}`);

        chatModule.enqueueMessage(agent.id, parsed.command, {
          onAck: (ackText) => send(sender, ackText)
        }).then((result) => {
          if (result && result.content) {
            let reply = result.content;
            if (reply.length > MAX_RESPONSE_LENGTH) {
              reply = reply.slice(0, MAX_RESPONSE_LENGTH) + '...';
            }
            send(sender, reply);
          }
        }).catch((err) => {
          send(sender, `error: ${err.message}`);
        });
      }
    }
  });

  daemon.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) log(`stderr: ${text}`);
  });

  daemon.on('close', (code) => {
    log(`daemon exited with code ${code}`);
    daemon = null;
    if (onStatus) onStatus('error', `signal-cli exited (code ${code})`);
  });
}

function extractPhone(text) {
  const match = text.match(/(\+\d{7,15})/);
  return match ? match[1] : null;
}

function detectAccount() {
  try {
    const output = execSync('signal-cli --list-accounts 2>&1', { encoding: 'utf8', timeout: 5000 });
    return extractPhone(output);
  } catch { return null; }
}

function finishLink(phone, onStatus, chatModule, stmts, updateConfig) {
  log(`linked as ${phone}`);
  updateConfig({ phone });
  startDaemon(phone, onStatus, chatModule, stmts);
}

function startLinking(onStatus, chatModule, stmts, updateConfig) {
  const link = spawn('signal-cli', ['link', '-n', 'claudity'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let linked = false;
  let linkBuffer = '';
  let errBuffer = '';

  function tryLink(text) {
    if (linked) return;
    const phone = extractPhone(text);
    if (phone) {
      linked = true;
      finishLink(phone, onStatus, chatModule, stmts, updateConfig);
    }
  }

  link.stdout.on('data', (chunk) => {
    linkBuffer += chunk.toString();
    let newline;
    while ((newline = linkBuffer.indexOf('\n')) !== -1) {
      const line = linkBuffer.slice(0, newline).trim();
      linkBuffer = linkBuffer.slice(newline + 1);
      if (!line) continue;

      if (line.startsWith('tsdevice:') || line.startsWith('sgnl:')) {
        log('link uri received');
        QRCode.toDataURL(line, { width: 256, margin: 2 }).then((dataUrl) => {
          if (onStatus) onStatus('qr', dataUrl);
        }).catch((err) => {
          log('qr generation failed: ' + err.message);
        });
      } else {
        tryLink(line);
      }
    }
  });

  link.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    errBuffer += text;
    const trimmed = text.trim();
    if (trimmed) log(`link stderr: ${trimmed}`);
    tryLink(trimmed);
  });

  link.on('close', (code) => {
    if (linked) return;

    tryLink(errBuffer);

    if (!linked) {
      const phone = detectAccount();
      if (phone) {
        linked = true;
        finishLink(phone, onStatus, chatModule, stmts, updateConfig);
        return;
      }
    }

    if (!linked) {
      log(`link process exited with code ${code}`);
      if (onStatus) onStatus('error', 'linking failed - scan the qr code within 60 seconds');
    }
  });

  return link;
}

let linkProcess = null;

function start(config, callbacks) {
  const { onStatus } = callbacks || {};

  if (!signalCliAvailable()) {
    if (onStatus) onStatus('error', 'signal-cli not found - install with: brew install signal-cli');
    return;
  }

  const chatModule = require('./chat');
  const { stmts } = require('../db');

  if (config.phone) {
    startDaemon(config.phone, onStatus, chatModule, stmts);
  } else {
    const updateConfig = (newFields) => {
      const merged = { ...config, ...newFields };
      stmts.updateConnectionConfig.run(JSON.stringify(merged), 'signal');
    };
    linkProcess = startLinking(onStatus, chatModule, stmts, updateConfig);
  }
}

function stop() {
  if (linkProcess) {
    linkProcess.kill();
    linkProcess = null;
  }
  if (daemon) {
    daemon.kill();
    daemon = null;
  }
  log('disconnected');
}

module.exports = { start, stop };
