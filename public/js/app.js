let agents = [];
let activeAgent = null;
let eventSource = null;
let connectionsPoller = null;

async function api(method, path, body) {
  const opts = { method, headers: { 'content-type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

const setupSection = $('section[aria-label="setup"]');
const emptySection = $('section[aria-label="empty"]');
const chatSection = $('section[aria-label="chat"]');
const connectionsSection = $('section[aria-label="connections"]');
const agentList = $('nav[aria-label="agents"] ul');
const createDialog = $('dialog[aria-label="create agent"]');
const editDialog = $('dialog[aria-label="edit agent"]');
const filesDialog = $('dialog[aria-label="agent records"]');
const fileList = $('[data-file-list]');
const fileEditor = $('[data-file-editor]');
const fileListFooter = $('[data-list-footer]');
const messagesDiv = $('div[aria-label="messages"]');
const chatForm = $('form[aria-label="input"]');
const chatInput = $('form[aria-label="input"] textarea');
const chatSubmit = $('form[aria-label="input"] button[type="submit"]');
const connectionsBtn = $('button[data-action="connections"]');
const platformsDiv = $('[data-platforms]');

const iconRobot = '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512"><path fill="currentColor" d="M352 0c0-17.7-14.3-32-32-32S288-17.7 288 0l0 64-96 0c-53 0-96 43-96 96l0 224c0 53 43 96 96 96l256 0c53 0 96-43 96-96l0-224c0-53-43-96-96-96l-96 0 0-64zM160 368c0-13.3 10.7-24 24-24l32 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-32 0c-13.3 0-24-10.7-24-24zm120 0c0-13.3 10.7-24 24-24l32 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-32 0c-13.3 0-24-10.7-24-24zm120 0c0-13.3 10.7-24 24-24l32 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-32 0c-13.3 0-24-10.7-24-24zM224 176a48 48 0 1 1 0 96 48 48 0 1 1 0-96zm144 48a48 48 0 1 1 96 0 48 48 0 1 1 -96 0zM64 224c0-17.7-14.3-32-32-32S0 206.3 0 224l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96zm544-32c-17.7 0-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32z"/></svg>';

const platforms = [
  {
    id: 'discord',
    name: 'discord',
    description: 'talk to agents via dm or @mention',
    icon: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="currentColor" d="M492.5 69.8c-.2-.3-.4-.6-.8-.7-38.1-17.5-78.4-30-119.7-37.1-.4-.1-.8 0-1.1 .1s-.6 .4-.8 .8c-5.5 9.9-10.5 20.2-14.9 30.6-44.6-6.8-89.9-6.8-134.4 0-4.5-10.5-9.5-20.7-15.1-30.6-.2-.3-.5-.6-.8-.8s-.7-.2-1.1-.2c-41.3 7.1-81.6 19.6-119.7 37.1-.3 .1-.6 .4-.8 .7-76.2 113.8-97.1 224.9-86.9 334.5 0 .3 .1 .5 .2 .8s.3 .4 .5 .6c44.4 32.9 94 58 146.8 74.2 .4 .1 .8 .1 1.1 0s.7-.4 .9-.7c11.3-15.4 21.4-31.8 30-48.8 .1-.2 .2-.5 .2-.8s0-.5-.1-.8-.2-.5-.4-.6-.4-.3-.7-.4c-15.8-6.1-31.2-13.4-45.9-21.9-.3-.2-.5-.4-.7-.6s-.3-.6-.3-.9 0-.6 .2-.9 .3-.5 .6-.7c3.1-2.3 6.2-4.7 9.1-7.1 .3-.2 .6-.4 .9-.4s.7 0 1 .1c96.2 43.9 200.4 43.9 295.5 0 .3-.1 .7-.2 1-.2s.7 .2 .9 .4c2.9 2.4 6 4.9 9.1 7.2 .2 .2 .4 .4 .6 .7s.2 .6 .2 .9-.1 .6-.3 .9-.4 .5-.6 .6c-14.7 8.6-30 15.9-45.9 21.8-.2 .1-.5 .2-.7 .4s-.3 .4-.4 .7-.1 .5-.1 .8 .1 .5 .2 .8c8.8 17 18.8 33.3 30 48.8 .2 .3 .6 .6 .9 .7s.8 .1 1.1 0c52.9-16.2 102.6-41.3 147.1-74.2 .2-.2 .4-.4 .5-.6s.2-.5 .2-.8c12.3-126.8-20.5-236.9-86.9-334.5zm-302 267.7c-29 0-52.8-26.6-52.8-59.2s23.4-59.2 52.8-59.2c29.7 0 53.3 26.8 52.8 59.2 0 32.7-23.4 59.2-52.8 59.2zm195.4 0c-29 0-52.8-26.6-52.8-59.2s23.4-59.2 52.8-59.2c29.7 0 53.3 26.8 52.8 59.2 0 32.7-23.2 59.2-52.8 59.2z"/></svg>',
    fields: [
      { key: 'token', label: 'bot token', placeholder: 'from developer portal → bot → reset token' },
      { key: 'app_id', label: 'application id', placeholder: 'from developer portal → general information' }
    ],
    setup: [
      'go to <a href="https://discord.com/developers/applications" target="_blank" rel="noopener">discord developer portal</a> and create a new application',
      'go to bot → reset token, copy it and paste below',
      'enable message content intent under bot → privileged gateway intents',
      'copy the application id from general information',
      'after connecting, use the invite link to add the bot to your server'
    ],
    usage: 'dm the bot or @mention it: <code>agent_name: your message</code>'
  },
  {
    id: 'imessage',
    name: 'imessage',
    description: 'talk to agents by texting yourself',
    icon: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 134"><path fill="currentColor" d="M75 0C33.579 0 0 27.903 0 62.322C0.037 84.19 13.865 104.442 36.436 115.687C33.481 122.288 29.048 128.477 23.322 134C34.426 132.055 44.85 127.97 53.782 122.062C60.67 123.762 67.815 124.632 75 124.643C116.421 124.643 150 96.741 150 62.322C150 27.903 116.421 0 75 0Z"/></svg>',
    fields: [
      { key: 'phone', label: 'your phone number', placeholder: '+1234567890' }
    ],
    setup: [
      'enter your phone number (the one registered with imessage)',
      'claudity polls your self-chat for new messages',
      'text yourself: <code>agent_name: your message</code>'
    ],
    usage: 'text yourself: <code>agent_name: your message</code>'
  },
  {
    id: 'signal',
    name: 'signal',
    description: 'encrypted messaging via signal',
    icon: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M256 0c-13.3 0-26.3 1-39.1 3l3.7 23.7C232.1 24.9 244 24 256 24s23.9 .9 35.4 2.7L295.1 3C282.3 1 269.3 0 256 0zm60.8 7.3l-5.7 23.3c23.4 5.7 45.4 14.9 65.4 27.1l12.5-20.5c-22.1-13.4-46.4-23.6-72.2-29.9zm76.4 61.6c19.1 14 36 30.9 50.1 50.1l19.4-14.2C447 83.6 428.4 65 407.3 49.5L393.1 68.8zm81.7 54.2l-20.5 12.5c12.2 20 21.4 42 27.1 65.4l23.3-5.7c-6.3-25.8-16.5-50.1-29.9-72.2zm10.5 97.5c1.8 11.5 2.7 23.4 2.7 35.4s-.9 23.9-2.7 35.4l23.7 3.7c1.9-12.7 3-25.8 3-39.1s-1-26.3-3-39.1l-23.7 3.7zm-31 155.9l20.5 12.5c13.4-22.1 23.6-46.4 29.9-72.2l-23.3-5.7c-5.7 23.4-14.9 45.4-27.1 65.4zm8.2 30.8l-19.4-14.2c-14 19.1-30.9 36-50.1 50.1l14.2 19.4c21.1-15.5 39.8-34.1 55.2-55.2zm-86.1 47c-20 12.2-42 21.4-65.4 27.1l5.7 23.3c25.8-6.3 50.1-16.5 72.2-29.9l-12.5-20.5zM295.1 509l-3.7-23.7C279.9 487.1 268 488 256 488s-23.9-.9-35.4-2.7L216.9 509c12.7 1.9 25.8 3 39.1 3s26.3-1 39.1-3zm-94.1-27.6c-17.6-4.3-34.4-10.6-50.1-18.6l-7.8-4-32.8 7.7 5.5 23.4 24.3-5.7c17.4 8.9 35.9 15.8 55.3 20.5l5.7-23.3zM95.4 494.6L90 471.3 48.3 481c-10.4 2.4-19.7-6.9-17.3-17.3l9.7-41.6-23.4-5.5-9.7 41.6C1.2 486 26 510.8 53.8 504.4l41.6-9.7zm-50-92.9l7.7-32.8-4-7.8c-8-15.7-14.3-32.5-18.6-50.1L7.3 316.7C12 336.1 18.9 354.7 27.7 372l-5.7 24.3 23.4 5.5zM3 295.1l23.7-3.7C24.9 279.9 24 268 24 256s.9-23.9 2.7-35.4L3 216.9C1 229.7 0 242.7 0 256s1 26.3 3 39.1zm27.6-94.1c5.7-23.4 14.9-45.4 27.1-65.4L37.2 123.1c-13.4 22.1-23.6 46.4-29.9 72.2l23.3 5.7zm18.9-96.2l19.4 14.2c14-19.1 30.9-36 50.1-50.1L104.7 49.5C83.6 65 65 83.6 49.5 104.7zm86.1-47c20-12.2 42-21.4 65.4-27.1L195.2 7.3c-25.8 6.3-50.1 16.5-72.2 29.9l12.5 20.5zM256 464c114.9 0 208-93.1 208-208S370.9 48 256 48 48 141.1 48 256c0 36.4 9.4 70.7 25.8 100.5 1.6 2.9 2.1 6.2 1.4 9.4l-21.6 92.5 92.5-21.6c3.2-.7 6.5-.2 9.4 1.4 29.8 16.5 64 25.8 100.5 25.8z"/></svg>',
    qrAuth: true,
    fields: [],
    setup: [
      'requires <code>signal-cli</code> — install with <code>brew install signal-cli</code>',
      'click connect below — a qr code will appear',
      'open signal on your phone → settings → linked devices → link new device',
      'scan the qr code with your phone camera',
      'after linking, reconnects automatically on restart'
    ],
    usage: 'message your linked number: <code>agent_name: your message</code>'
  },
  {
    id: 'slack',
    name: 'slack',
    description: 'workspace bot via socket mode',
    icon: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="currentColor" d="M94.1 315.1c0 25.9-21.2 47.1-47.1 47.1S0 341 0 315.1 21.2 268 47.1 268l47.1 0 0 47.1zm23.7 0c0-25.9 21.2-47.1 47.1-47.1S212 289.2 212 315.1l0 117.8c0 25.9-21.2 47.1-47.1 47.1s-47.1-21.2-47.1-47.1l0-117.8zm47.1-189c-25.9 0-47.1-21.2-47.1-47.1S139 32 164.9 32 212 53.2 212 79.1l0 47.1-47.1 0zm0 23.7c25.9 0 47.1 21.2 47.1 47.1S190.8 244 164.9 244L47.1 244C21.2 244 0 222.8 0 196.9s21.2-47.1 47.1-47.1l117.8 0zm189 47.1c0-25.9 21.2-47.1 47.1-47.1S448 171 448 196.9 426.8 244 400.9 244l-47.1 0 0-47.1zm-23.7 0c0 25.9-21.2 47.1-47.1 47.1S236 222.8 236 196.9l0-117.8C236 53.2 257.2 32 283.1 32s47.1 21.2 47.1 47.1l0 117.8zm-47.1 189c25.9 0 47.1 21.2 47.1 47.1S309 480 283.1 480 236 458.8 236 432.9l0-47.1 47.1 0zm0-23.7c-25.9 0-47.1-21.2-47.1-47.1S257.2 268 283.1 268l117.8 0c25.9 0 47.1 21.2 47.1 47.1s-21.2 47.1-47.1 47.1l-117.8 0z"/></svg>',
    fields: [
      { key: 'bot_token', label: 'bot token', placeholder: 'xoxb-...', type: 'password' },
      { key: 'app_token', label: 'app-level token', placeholder: 'xapp-...', type: 'password' }
    ],
    setup: [
      'go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener">api.slack.com/apps</a> and create a new app from scratch',
      'under oauth & permissions, add bot scopes: <code>chat:write</code> <code>app_mentions:read</code> <code>im:history</code> <code>im:read</code> <code>im:write</code>',
      'under socket mode, enable it and generate an app-level token with <code>connections:write</code> scope',
      'under event subscriptions, subscribe to <code>message.im</code> and <code>app_mention</code>',
      'under app home, enable the <b>messages tab</b> and check "allow users to send slash commands and messages from the messages tab"',
      'install the app to your workspace and copy the bot token (xoxb-)'
    ],
    usage: 'dm the bot or @mention it: <code>agent_name: your message</code>'
  },
  {
    id: 'telegram',
    name: 'telegram',
    description: 'bot via long polling',
    icon: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M256 8a248 248 0 1 0 0 496 248 248 0 1 0 0-496zM371 176.7c-3.7 39.2-19.9 134.4-28.1 178.3-3.5 18.6-10.3 24.8-16.9 25.4-14.4 1.3-25.3-9.5-39.3-18.7-21.8-14.3-34.2-23.2-55.3-37.2-24.5-16.1-8.6-25 5.3-39.5 3.7-3.8 67.1-61.5 68.3-66.7 .2-.7 .3-3.1-1.2-4.4s-3.6-.8-5.1-.5c-2.2 .5-37.1 23.5-104.6 69.1-9.9 6.8-18.9 10.1-26.9 9.9-8.9-.2-25.9-5-38.6-9.1-15.5-5-27.9-7.7-26.8-16.3 .6-4.5 6.7-9 18.4-13.7 72.3-31.5 120.5-52.3 144.6-62.3 68.9-28.6 83.2-33.6 92.5-33.8 2.1 0 6.6 .5 9.6 2.9 2 1.7 3.2 4.1 3.5 6.7 .5 3.2 .6 6.5 .4 9.8z"/></svg>',
    fields: [
      { key: 'token', label: 'bot token', placeholder: 'from @botfather', type: 'password' }
    ],
    setup: [
      'message <a href="https://t.me/BotFather" target="_blank" rel="noopener">@botfather</a> on telegram',
      'send /newbot and follow the prompts to create a bot',
      'copy the token botfather gives you and paste below'
    ],
    usage: 'message the bot: <code>agent_name: your message</code>'
  },
  {
    id: 'whatsapp',
    name: 'whatsapp',
    description: 'talk to agents via whatsapp messages',
    icon: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="currentColor" d="M380.9 97.1c-41.9-42-97.7-65.1-157-65.1-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480 117.7 449.1c32.4 17.7 68.9 27 106.1 27l.1 0c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3 18.6-68.1-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1s56.2 81.2 56.1 130.5c0 101.8-84.9 184.6-186.6 184.6zM325.1 300.5c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8s-14.3 18-17.6 21.8c-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7 .9-6.9-.5-9.7s-12.5-30.1-17.1-41.2c-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2s-9.7 1.4-14.8 6.9c-5.1 5.6-19.4 19-19.4 46.3s19.9 53.7 22.6 57.4c2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4s4.6-24.1 3.2-26.4c-1.3-2.5-5-3.9-10.5-6.6z"/></svg>',
    fields: [],
    qrAuth: true,
    setup: [
      'click connect below — a qr code will appear',
      'open whatsapp on your phone → linked devices → link a device',
      'scan the qr code with your phone camera',
      'after first scan, reconnects automatically on restart'
    ],
    usage: 'message the linked number: <code>agent_name: your message</code>'
  }
];

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function renderMarkdown(text) {
  let html = esc(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/(<a[^>]*>[\s\S]*?<\/a>)|(https?:\/\/[^\s<)]+)/g, (m, anchor, url) => {
    if (anchor) return anchor;
    return '<a href="' + url + '" target="_blank" rel="noopener">' + url + '</a>';
  });
  html = html.replace(/(^|\n)([-*]) (.+)/g, '$1<li>$3</li>');
  html = html.replace(/(^|\n)(\d+)\. (.+)/g, '$1<li>$3</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\s*<ul>/g, '');
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  return `<p>${html}</p>`;
}

function showSection(name) {
  setupSection.hidden = name !== 'setup';
  emptySection.hidden = name !== 'empty';
  chatSection.hidden = name !== 'chat';
  connectionsSection.hidden = name !== 'connections';

  connectionsBtn.setAttribute('aria-selected', name === 'connections');
  document.body.dataset.screen = name;

  if (name === 'connections') {
    startConnectionsPolling();
  } else {
    stopConnectionsPolling();
  }
}

function bubbleAgent(id) {
  const idx = agents.findIndex(a => a.id === id);
  if (idx > 0) {
    agents.unshift(agents.splice(idx, 1)[0]);
    renderAgents();
  }
}

async function refreshAgentOrder() {
  try {
    const fresh = await api('GET', '/api/agents');
    const order = fresh.map(a => a.id);
    const current = agents.map(a => a.id);
    if (order.join() !== current.join()) {
      for (const f of fresh) {
        const existing = agents.find(a => a.id === f.id);
        if (existing) Object.assign(existing, f);
      }
      agents.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      renderAgents();
    }
  } catch {}
}

setInterval(refreshAgentOrder, 10000);

function renderAgents() {
  agentList.innerHTML = agents.map(a => `
    <li data-id="${a.id}" ${activeAgent && activeAgent.id === a.id ? 'aria-selected="true"' : 'aria-selected="false"'} title="${esc(a.name)}${a.is_default ? ' (default)' : ''}">
      ${iconRobot}
      <span>${esc(a.name)}</span>
      ${a.is_default ? '<i data-default aria-label="default agent"></i>' : ''}
    </li>
  `).join('');

  agentList.querySelectorAll('li').forEach(li => {
    li.setAttribute('role', 'option');
    li.setAttribute('tabindex', '0');
    li.addEventListener('click', () => { selectAgent(li.dataset.id); closeNav(); });
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectAgent(li.dataset.id);
        closeNav();
      }
    });
  });
}

async function selectAgent(id) {
  activeAgent = agents.find(a => a.id === id);
  if (eventSource) { eventSource.close(); eventSource = null; }

  renderAgents();

  if (!activeAgent) {
    showSection('empty');
    return;
  }

  showSection('chat');
  $('section[aria-label="chat"] > header h2').textContent = activeAgent.name;

  messagesDiv.innerHTML = '';
  chatInput.value = '';
  chatSubmit.disabled = false;


  try {
    const messages = await api('GET', `/api/agents/${id}/messages`);
    for (const msg of messages) {
      if (msg.type === 'heartbeat') {
        if (!activeAgent.show_heartbeat) continue;
        const div = document.createElement('div');
        div.dataset.role = 'heartbeat';
        const body = document.createElement('div');
        body.className = 'msg-body';
        body.innerHTML = renderMarkdown(cleanToolLeaks(msg.content));
        div.appendChild(body);
        messagesDiv.appendChild(div);
      } else {
        appendMessage(msg.role, msg.content, msg.tool_calls ? JSON.parse(msg.tool_calls) : null);
      }
    }
    scrollToBottom();
  } catch {}

  connectSSE(id);
}

function cleanToolLeaks(text) {
  return text.replace(/\n*\[used \w+:[\s\S]*$/, '').trim();
}

function appendMessage(role, content, toolCalls, intermediate) {
  const div = document.createElement('div');
  div.dataset.role = role;

  if (role === 'assistant') {
    const cleaned = cleanToolLeaks(content);
    if (cleaned) {
      const textEl = document.createElement('div');
      textEl.className = 'msg-body';
      textEl.innerHTML = renderMarkdown(cleaned);
      div.appendChild(textEl);
    }
  } else {
    const textEl = document.createElement('p');
    textEl.textContent = content;
    div.appendChild(textEl);
  }

  if (toolCalls && toolCalls.length) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `${toolCalls.length} tool ${toolCalls.length === 1 ? 'call' : 'calls'}`;
    details.appendChild(summary);
    for (const tc of toolCalls) {
      const pre = document.createElement('pre');
      const inputStr = JSON.stringify(tc.input, null, 2);
      let outputStr = typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output, null, 2);
      if (outputStr.length > 500) outputStr = outputStr.slice(0, 500) + '\n...';
      pre.textContent = `${tc.name}(${inputStr})\n→ ${outputStr}`;
      details.appendChild(pre);
    }
    div.appendChild(details);
  }

  messagesDiv.appendChild(div);
  return div;
}

function scrollToBottom() {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function showActivity() {
  let el = messagesDiv.querySelector('[data-activity]');
  if (el) return el;
  el = document.createElement('div');
  el.dataset.activity = '';
  el.dataset.role = 'assistant';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'agent is thinking');
  el.innerHTML = '<p data-dots><span></span><span></span><span></span></p>';
  messagesDiv.appendChild(el);
  scrollToBottom();
  return el;
}

function clearActivity() {
  const el = messagesDiv.querySelector('[data-activity]');
  if (el) el.remove();
}

function updateThinking(content) {
  const activity = showActivity();
  let thinking = activity.querySelector('[data-thinking]');
  if (!thinking) {
    thinking = document.createElement('p');
    thinking.dataset.thinking = '';
    activity.prepend(thinking);
  }
  thinking.textContent = content;
  const dots = activity.querySelector('[data-dots]');
  if (dots) dots.remove();
  scrollToBottom();
}

function updateToolStatus(toolName) {
  const activity = showActivity();
  let status = activity.querySelector('[data-status]');
  if (!status) {
    status = document.createElement('p');
    status.dataset.status = '';
    activity.appendChild(status);
  }
  status.textContent = `using ${toolName}...`;
  const dots = activity.querySelector('[data-dots]');
  if (dots) dots.remove();
  scrollToBottom();
}

function connectSSE(agentId) {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/api/agents/${agentId}/stream`);

  let suppressNextUserMsg = false;

  eventSource.addEventListener('connected', () => {
    if (activeAgent && activeAgent.bootstrapped === 0 && !activeAgent._kickedOff) {
      activeAgent._kickedOff = true;
      suppressNextUserMsg = true;
      api('POST', `/api/agents/${agentId}/chat`, { content: 'hello' }).catch(() => {});
    }
  });

  eventSource.addEventListener('typing', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.active) showActivity();
      else clearActivity();
    } catch {}
  });

  eventSource.addEventListener('ack_message', (e) => {
    try {
      clearActivity();
      const data = JSON.parse(e.data);
      appendMessage('assistant', data.content);
      scrollToBottom();
    } catch {}
  });

  eventSource.addEventListener('intermediate', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateThinking(data.content);
    } catch {}
  });

  eventSource.addEventListener('tool_call', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateToolStatus(data.name);
    } catch {}
  });

  eventSource.addEventListener('assistant_message', (e) => {
    try {
      clearActivity();
      const data = JSON.parse(e.data);
      appendMessage('assistant', data.content, data.tool_calls);
      scrollToBottom();
      chatInput.focus();
    } catch {}
  });

  eventSource.addEventListener('user_message', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (suppressNextUserMsg) {
        suppressNextUserMsg = false;
        return;
      }
      const existing = messagesDiv.querySelector(`[data-msg-id="${data.id}"]`);
      if (existing) return;
      const pending = messagesDiv.querySelector('[data-msg-id="pending"]');
      if (pending) {
        pending.dataset.msgId = data.id;
        return;
      }
      appendMessage('user', data.content).dataset.msgId = data.id;
      scrollToBottom();
      bubbleAgent(agentId);
    } catch {}
  });

  eventSource.addEventListener('heartbeat_alert', (e) => {
    try {
      if (!activeAgent || !activeAgent.show_heartbeat) return;
      const data = JSON.parse(e.data);
      const div = document.createElement('div');
      div.dataset.role = 'heartbeat';
      const body = document.createElement('div');
      body.className = 'msg-body';
      body.innerHTML = renderMarkdown(cleanToolLeaks(data.content));
      div.appendChild(body);
      messagesDiv.appendChild(div);
      scrollToBottom();
    } catch {}
  });

  eventSource.addEventListener('bootstrap_complete', async () => {
    if (activeAgent) {
      try {
        const updated = await api('GET', `/api/agents/${activeAgent.id}`);
        const idx = agents.findIndex(a => a.id === activeAgent.id);
        if (idx !== -1) agents[idx] = updated;
        activeAgent = updated;
      } catch {}
    }
  });

  eventSource.addEventListener('error', (e) => {
    clearActivity();
    try {
      const data = JSON.parse(e.data);
      const div = document.createElement('div');
      div.dataset.role = 'error';
      div.setAttribute('role', 'alert');
      div.innerHTML = `<p>${esc(data.error)}</p>`;
      messagesDiv.appendChild(div);
      scrollToBottom();
    } catch {}
  });

  eventSource.onerror = () => {};
}

const connectionDialog = $('dialog[aria-label="connection"]');
const connectionBody = $('dialog[aria-label="connection"] [data-body]');
const connectionHeader = $('dialog[aria-label="connection"] > header');
const connectionFooter = $('dialog[aria-label="connection"] > footer');

let connectionsData = {};

async function renderConnections() {
  let conns = [];
  try {
    conns = await api('GET', '/api/connections');
  } catch {}

  connectionsData = {};
  for (const c of conns) connectionsData[c.platform] = c;

  platformsDiv.innerHTML = platforms.map(p => {
    const conn = connectionsData[p.id];
    const status = conn ? conn.status : 'disconnected';

    let statusLabel = status;
    if (status === 'connected' && conn.status_detail) statusLabel = conn.status_detail;

    return `<article data-platform="${p.id}" data-status="${status}"${p.comingSoon ? ' data-coming-soon' : ''} title="${p.comingSoon ? p.name + ' — coming soon' : p.name + ' — ' + statusLabel}" role="${p.comingSoon ? 'presentation' : 'button'}" ${p.comingSoon ? '' : 'tabindex="0"'}>
      ${p.icon}
      <div><h3>${p.name}</h3><p>${p.comingSoon ? 'coming soon' : statusLabel}</p></div>
      <span data-indicator="${status}" aria-label="${status}"></span>
    </article>`;
  }).join('');

  platformsDiv.querySelectorAll('article:not([data-coming-soon])').forEach(card => {
    card.addEventListener('click', () => openConnectionDialog(card.dataset.platform));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openConnectionDialog(card.dataset.platform);
      }
    });
  });
}

function cleanConnectionError(msg) {
  if (!msg) return 'unknown error';
  return msg.replace(/\/[\w\/.-]+\//g, '').replace(/\s+/g, ' ').trim();
}

function openConnectionDialog(platformId) {
  const p = platforms.find(x => x.id === platformId);
  if (!p) return;
  const conn = connectionsData[p.id];
  const status = conn ? conn.status : 'disconnected';
  const config = conn ? conn.config : {};
  const isConnected = status === 'connected';

  connectionHeader.innerHTML = `${p.icon}<div><h2>${p.name}</h2><p>${p.description}</p></div><span data-indicator="${status}"></span>`;

  let body = '';

  if (isConnected) {
    if (conn.status_detail) {
      body += `<p data-detail>${esc(conn.status_detail)}</p>`;
    }
    if (p.usage) {
      body += `<p data-usage>${p.usage}</p>`;
    }
    if (p.id === 'discord' && config.app_id) {
      body += `<p data-invite-label>invite link</p>`;
      body += `<pre data-invite>https://discord.com/oauth2/authorize?client_id=${esc(config.app_id)}&scope=bot&permissions=274877975552</pre>`;
    }
  } else {
    if (status === 'error' && conn && conn.status_detail) {
      body += `<p data-detail="error">${esc(cleanConnectionError(conn.status_detail))}</p>`;
    }
    if (p.setup && p.setup.length) {
      body += '<ol data-setup>';
      for (const step of p.setup) body += `<li>${step}</li>`;
      body += '</ol>';
    }
    if (p.fields.length) {
      body += '<form>';
      for (const f of p.fields) {
        const val = config[f.key] || '';
        body += `<label><span>${f.label}</span><input type="${f.type || 'text'}" data-field="${f.key}" placeholder="${f.placeholder}" value="${esc(val)}"></label>`;
      }
      body += '</form>';
    }
  }

  connectionBody.innerHTML = body;

  let footerHtml = '';
  if (isConnected) {
    footerHtml = `<button type="button" data-disconnect data-platform="${p.id}" title="disconnect ${p.name}">disconnect</button>`;
  } else {
    const connectLabel = status === 'error' ? 'retry' : 'connect';
    footerHtml = `<button type="button" data-connect data-platform="${p.id}" title="connect to ${p.name}">${connectLabel}</button>`;
  }
  footerHtml += '<button type="button" data-action="cancel-dialog" title="close">close</button>';
  connectionFooter.innerHTML = footerHtml;

  connectionFooter.querySelector('button[data-action="cancel-dialog"]').addEventListener('click', () => connectionDialog.close());

  const connectBtn = connectionFooter.querySelector('[data-connect]');
  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      const cfg = {};
      connectionBody.querySelectorAll('input[data-field]').forEach(input => {
        if (input.value.trim()) cfg[input.dataset.field] = input.value.trim();
      });
      connectBtn.disabled = true;
      connectBtn.textContent = 'connecting...';
      try {
        await api('POST', `/api/connections/${p.id}/enable`, cfg);
        if (p.qrAuth) {
          let qrPoller = setInterval(async () => {
            try {
              const conns = await api('GET', '/api/connections');
              const conn = conns.find(c => c.platform === p.id);
              if (!conn) return;
              if (conn.status === 'qr' && conn.status_detail) {
                connectionBody.innerHTML = `<img data-qr src="${conn.status_detail}" alt="scan this qr code">`;
                connectionHeader.querySelector('[data-indicator]').setAttribute('data-indicator', 'qr');
              } else if (conn.status === 'connected') {
                clearInterval(qrPoller);
                connectionHeader.querySelector('[data-indicator]').setAttribute('data-indicator', 'connected');
                connectionBody.innerHTML = `<p data-detail>${esc(conn.status_detail || 'connected')}</p>` +
                  (p.usage ? `<p data-usage>${p.usage}</p>` : '');
                connectionFooter.innerHTML = `<button type="button" data-disconnect data-platform="${p.id}">disconnect</button>` +
                  '<button type="button" data-action="cancel-dialog">close</button>';
                connectionFooter.querySelector('[data-disconnect]').addEventListener('click', async () => {
                  try {
                    await api('POST', `/api/connections/${p.id}/disable`);
                    connectionDialog.close();
                    await renderConnections();
                  } catch (err) { connectionBody.insertAdjacentHTML('afterbegin', `<p data-detail="error">${esc(cleanConnectionError(err.message))}</p>`); }
                });
                connectionFooter.querySelector('[data-action="cancel-dialog"]').addEventListener('click', () => connectionDialog.close());
                await renderConnections();
              } else if (conn.status === 'error') {
                clearInterval(qrPoller);
                connectionBody.innerHTML = `<p data-detail="error">${esc(cleanConnectionError(conn.status_detail))}</p>`;
                connectBtn.disabled = false;
                connectBtn.textContent = 'connect';
                connectionFooter.innerHTML = `<button type="button" data-connect data-platform="${p.id}">retry</button>` +
                  '<button type="button" data-action="cancel-dialog">close</button>';
                connectionFooter.querySelector('[data-action="cancel-dialog"]').addEventListener('click', () => connectionDialog.close());
              }
            } catch {}
          }, 2000);
          connectionDialog.addEventListener('close', () => clearInterval(qrPoller), { once: true });
        } else {
          connectionDialog.close();
          await renderConnections();
        }
      } catch (err) {
        const existing = connectionBody.querySelector('[data-detail="error"]');
        if (existing) existing.remove();
        connectionBody.insertAdjacentHTML('afterbegin', `<p data-detail="error">${esc(cleanConnectionError(err.message))}</p>`);
        connectBtn.disabled = false;
        connectBtn.textContent = 'retry';
      }
    });
  }

  const disconnectBtn = connectionFooter.querySelector('[data-disconnect]');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', async () => {
      disconnectBtn.disabled = true;
      try {
        await api('POST', `/api/connections/${p.id}/disable`);
        connectionDialog.close();
        await renderConnections();
      } catch (err) {
        const existing = connectionBody.querySelector('[data-detail="error"]');
        if (existing) existing.remove();
        connectionBody.insertAdjacentHTML('afterbegin', `<p data-detail="error">${esc(cleanConnectionError(err.message))}</p>`);
        disconnectBtn.disabled = false;
      }
    });
  }

  connectionDialog.showModal();
}

function startConnectionsPolling() {
  stopConnectionsPolling();
  renderConnections();
  connectionsPoller = setInterval(renderConnections, 3000);
}

function stopConnectionsPolling() {
  if (connectionsPoller) {
    clearInterval(connectionsPoller);
    connectionsPoller = null;
  }
}

connectionsBtn.addEventListener('click', () => {
  activeAgent = null;
  if (eventSource) { eventSource.close(); eventSource = null; }
  renderAgents();
  showSection('connections');
  closeNav();
});

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeAgent) return;
  const content = chatInput.value.trim();
  if (!content) return;

  chatSubmit.disabled = true;
  chatInput.value = '';
  autoResize();

  appendMessage('user', content).dataset.msgId = 'pending';
  scrollToBottom();

  bubbleAgent(activeAgent.id);

  try {
    await api('POST', `/api/agents/${activeAgent.id}/chat`, { content });
  } catch (err) {
    const div = document.createElement('div');
    div.dataset.role = 'error';
    div.setAttribute('role', 'alert');
    div.innerHTML = `<p>${esc(err.message)}</p>`;
    messagesDiv.appendChild(div);
    scrollToBottom();
  } finally {
    chatSubmit.disabled = false;
    chatInput.focus();
  }
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event('submit'));
  }
});

function autoResize() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
}

chatInput.addEventListener('input', autoResize);

$('nav[aria-label="agents"] header button').addEventListener('click', () => {
  $('dialog[aria-label="create agent"] form').reset();
  createDialog.showModal();
});

$('dialog[aria-label="create agent"] form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = {
    name: form.name.value.trim(),
    is_default: form.is_default.checked,
    model: form.model.value,
    thinking: form.thinking.value
  };
  try {
    const agent = await api('POST', '/api/agents', data);
    if (agent.is_default) agents.forEach(a => a.is_default = 0);
    agents.unshift(agent);
    renderAgents();
    selectAgent(agent.id);
    createDialog.close();
  } catch (err) {
    showDialogError(createDialog, err.message);
  }
});

$$('button[data-action="cancel-dialog"]').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.closest('dialog').close();
  });
});

$$('dialog').forEach(d => {
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
});

$('button[data-action="edit-agent"]').addEventListener('click', () => {
  if (!activeAgent) return;
  const form = $('dialog[aria-label="edit agent"] form');
  form.querySelector('[name="id"]').value = activeAgent.id;
  form.querySelector('[name="name"]').value = activeAgent.name;
  form.querySelector('[name="is_default"]').checked = !!activeAgent.is_default;
  form.querySelector('[name="heartbeat_enabled"]').checked = activeAgent.heartbeat_interval !== null;
  const intervalSelect = form.querySelector('[name="heartbeat_interval"]');
  if (activeAgent.heartbeat_interval) {
    intervalSelect.value = String(activeAgent.heartbeat_interval);
  }
  form.querySelector('[name="show_heartbeat"]').checked = !!activeAgent.show_heartbeat;
  form.querySelector('[name="model"]').value = activeAgent.model || 'opus';
  form.querySelector('[name="thinking"]').value = activeAgent.thinking || 'high';
  editDialog.showModal();
});

$('dialog[aria-label="edit agent"] form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const id = form.querySelector('[name="id"]').value;
  const heartbeatEnabled = form.querySelector('[name="heartbeat_enabled"]').checked;
  const data = {
    name: form.name.value.trim(),
    is_default: form.is_default.checked,
    heartbeat_interval: heartbeatEnabled ? parseInt(form.querySelector('[name="heartbeat_interval"]').value) : null,
    show_heartbeat: form.querySelector('[name="show_heartbeat"]').checked,
    model: form.querySelector('[name="model"]').value,
    thinking: form.querySelector('[name="thinking"]').value
  };
  try {
    const updated = await api('PATCH', `/api/agents/${id}`, data);
    if (updated.is_default) agents.forEach(a => a.is_default = 0);
    const idx = agents.findIndex(a => a.id === id);
    if (idx !== -1) agents[idx] = updated;
    activeAgent = updated;
    renderAgents();
    $('section[aria-label="chat"] > header h2').textContent = updated.name;
    editDialog.close();
  } catch (err) {
    showDialogError(editDialog, err.message);
  }
});

const deleteDialog = $('dialog[aria-label="confirm delete"]');

$('button[data-action="delete-agent"]').addEventListener('click', () => {
  if (!activeAgent) return;
  deleteDialog.querySelector('[data-confirm-msg]').textContent = `are you sure you want to delete "${activeAgent.name}"? this cannot be undone.`;
  deleteDialog.showModal();
});

$('button[data-action="confirm-delete"]').addEventListener('click', async () => {
  if (!activeAgent) return;
  try {
    await api('DELETE', `/api/agents/${activeAgent.id}`);
    agents = agents.filter(a => a.id !== activeAgent.id);
    activeAgent = null;
    if (eventSource) { eventSource.close(); eventSource = null; }
    renderAgents();
    showSection('empty');
    deleteDialog.close();
  } catch (err) {
    showDialogError(deleteDialog, err.message);
  }
});


$('button[data-action="view-files"]').addEventListener('click', async () => {
  if (!activeAgent) return;
  await openFilesDialog();
});

const recordIcons = {
  'SOUL.md': '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="currentColor" d="M288 32c-80.8 0-145.5 36.8-192.6 80.6-46.8 43.5-78.1 95.4-93 131.1-3.3 7.9-3.3 16.7 0 24.6 14.9 35.7 46.2 87.7 93 131.1 47.1 43.7 111.8 80.6 192.6 80.6s145.5-36.8 192.6-80.6c46.8-43.5 78.1-95.4 93-131.1 3.3-7.9 3.3-16.7 0-24.6-14.9-35.7-46.2-87.7-93-131.1-47.1-43.7-111.8-80.6-192.6-80.6zM144 256a144 144 0 1 1 288 0 144 144 0 1 1 -288 0zm144-64c0 35.3-28.7 64-64 64-11.5 0-22.3-3-31.7-8.4-1 10.9-.1 22.1 2.9 33.2 13.7 51.2 66.4 81.6 117.6 67.9s81.6-66.4 67.9-117.6c-12.2-45.7-55.5-74.8-101.1-70.8 5.3 9.3 8.4 20.1 8.4 31.7z"/></svg>',
  'IDENTITY.md': '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M48 256c0-114.9 93.1-208 208-208 63.1 0 119.6 28.1 157.8 72.5 8.6 10.1 23.8 11.2 33.8 2.6s11.2-23.8 2.6-33.8C403.3 34.6 333.7 0 256 0 114.6 0 0 114.6 0 256l0 40c0 13.3 10.7 24 24 24s24-10.7 24-24l0-40zm458.5-52.9c-2.7-13-15.5-21.3-28.4-18.5s-21.3 15.5-18.5 28.4c2.9 13.9 4.5 28.3 4.5 43.1l0 40c0 13.3 10.7 24 24 24s24-10.7 24-24l0-40c0-18.1-1.9-35.8-5.5-52.9zM256 80c-19 0-37.4 3-54.5 8.6-15.2 5-18.7 23.7-8.3 35.9 7.1 8.3 18.8 10.8 29.4 7.9 10.6-2.9 21.8-4.4 33.4-4.4 70.7 0 128 57.3 128 128l0 24.9c0 25.2-1.5 50.3-4.4 75.3-1.7 14.6 9.4 27.8 24.2 27.8 11.8 0 21.9-8.6 23.3-20.3 3.3-27.4 5-55 5-82.7l0-24.9c0-97.2-78.8-176-176-176zM150.7 148.7c-9.1-10.6-25.3-11.4-33.9-.4-23.1 29.8-36.8 67.1-36.8 107.7l0 24.9c0 24.2-2.6 48.4-7.8 71.9-3.4 15.6 7.9 31.1 23.9 31.1 10.5 0 19.9-7 22.2-17.3 6.4-28.1 9.7-56.8 9.7-85.8l0-24.9c0-27.2 8.5-52.4 22.9-73.1 7.2-10.4 8-24.6-.2-34.2zM256 160c-53 0-96 43-96 96l0 24.9c0 35.9-4.6 71.5-13.8 106.1-3.8 14.3 6.7 29 21.5 29 9.5 0 17.9-6.2 20.4-15.4 10.5-39 15.9-79.2 15.9-119.7l0-24.9c0-28.7 23.3-52 52-52s52 23.3 52 52l0 24.9c0 36.3-3.5 72.4-10.4 107.9-2.7 13.9 7.7 27.2 21.8 27.2 10.2 0 19-7 21-17 7.7-38.8 11.6-78.3 11.6-118.1l0-24.9c0-53-43-96-96-96zm24 96c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 24.9c0 59.9-11 119.3-32.5 175.2l-5.9 15.3c-4.8 12.4 1.4 26.3 13.8 31s26.3-1.4 31-13.8l5.9-15.3C267.9 411.9 280 346.7 280 280.9l0-24.9z"/></svg>',
  'USER.md': '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="currentColor" d="M224 248a120 120 0 1 0 0-240 120 120 0 1 0 0 240zm-29.7 56C95.8 304 16 383.8 16 482.3 16 498.7 29.3 512 45.7 512l356.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-59.4 0z"/></svg>',
  'MEMORY.md': '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M120 56c0-30.9 25.1-56 56-56l24 0c17.7 0 32 14.3 32 32l0 448c0 17.7-14.3 32-32 32l-32 0c-29.8 0-54.9-20.4-62-48-.7 0-1.3 0-2 0-44.2 0-80-35.8-80-80 0-18 6-34.6 16-48-19.4-14.6-32-37.8-32-64 0-30.9 17.6-57.8 43.2-71.1-7.1-12-11.2-26-11.2-40.9 0-44.2 35.8-80 80-80l0-24zm272 0l0 24c44.2 0 80 35.8 80 80 0 15-4.1 29-11.2 40.9 25.7 13.3 43.2 40.1 43.2 71.1 0 26.2-12.6 49.4-32 64 10 13.4 16 30 16 48 0 44.2-35.8 80-80 80-.7 0-1.3 0-2 0-7.1 27.6-32.2 48-62 48l-32 0c-17.7 0-32-14.3-32-32l0-448c0-17.7 14.3-32 32-32l24 0c30.9 0 56 25.1 56 56z"/></svg>',
  'HEARTBEAT.md': '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M241 87.1l15 20.7 15-20.7C296 52.5 336.2 32 378.9 32 452.4 32 512 91.6 512 165.1l0 2.6c0 112.2-139.9 242.5-212.9 298.2-12.4 9.4-27.6 14.1-43.1 14.1s-30.8-4.6-43.1-14.1C139.9 410.2 0 279.9 0 167.7l0-2.6C0 91.6 59.6 32 133.1 32 175.8 32 216 52.5 241 87.1z"/></svg>'
};
const iconLogs = '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="currentColor" d="M56 225.6L32.4 296.2 32.4 96c0-35.3 28.7-64 64-64l138.7 0c13.8 0 27.3 4.5 38.4 12.8l38.4 28.8c5.5 4.2 12.3 6.4 19.2 6.4l117.3 0c35.3 0 64 28.7 64 64l0 16-365.4 0c-41.3 0-78 26.4-91.1 65.6zM477.8 448L99 448c-32.8 0-55.9-32.1-45.5-63.2l48-144C108 221.2 126.4 208 147 208l378.8 0c32.8 0 55.9 32.1 45.5 63.2l-48 144c-6.5 19.6-24.9 32.8-45.5 32.8z"/></svg>';
const recordLabels = {
  'SOUL.md': 'soul',
  'IDENTITY.md': 'identity',
  'USER.md': 'user',
  'MEMORY.md': 'memory',
  'HEARTBEAT.md': 'heartbeat'
};
const recordOrder = ['HEARTBEAT.md', 'IDENTITY.md', 'MEMORY.md', 'SOUL.md', 'USER.md'];

async function openFilesDialog() {
  fileEditor.hidden = true;
  fileListFooter.hidden = false;
  fileList.hidden = false;
  $('dialog[aria-label="agent records"] > h2').hidden = false;
  fileList.innerHTML = '';

  try {
    const files = await api('GET', `/api/agents/${activeAgent.id}/workspace`);
    const known = recordOrder.filter(f => files.includes(f));
    const other = files.filter(f => !recordOrder.includes(f) && !f.startsWith('memory/'));

    for (const f of known) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = `edit ${recordLabels[f]}`;
      btn.innerHTML = `${recordIcons[f]}<span>${recordLabels[f]}</span>`;
      btn.addEventListener('click', () => openFileEditor(f));
      fileList.appendChild(btn);
    }

    const logsBtn = document.createElement('button');
    logsBtn.type = 'button';
    logsBtn.title = 'view memory logs';
    logsBtn.innerHTML = `${iconLogs}<span>logs</span>`;
    logsBtn.addEventListener('click', () => openLogsView());
    fileList.appendChild(logsBtn);

    const fileIcon = '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path fill="currentColor" d="M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-277.5c0-17-6.7-33.3-18.7-45.3L258.7 18.7C246.7 6.7 230.5 0 213.5 0L64 0zM325.5 176L232 176c-13.3 0-24-10.7-24-24L208 58.5 325.5 176z"/></svg>';
    for (const f of other) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = `edit ${f}`;
      btn.innerHTML = `${fileIcon}<span>${esc(f)}</span>`;
      btn.addEventListener('click', () => openFileEditor(f));
      fileList.appendChild(btn);
    }
  } catch (err) {
    fileList.innerHTML = `<p style="color:var(--muted);font-size:12px">${err.message}</p>`;
  }

  filesDialog.showModal();
}

async function openLogsView() {
  fileList.hidden = true;
  fileListFooter.hidden = true;
  $('dialog[aria-label="agent records"] > h2').hidden = true;
  fileEditor.hidden = false;

  const textarea = fileEditor.querySelector('[data-file-content]');
  const nameEl = fileEditor.querySelector('[data-file-name]');
  nameEl.textContent = 'logs';
  textarea.value = 'loading...';
  textarea.disabled = true;

  try {
    const dates = await api('GET', `/api/agents/${activeAgent.id}/logs`);
    if (!dates.length) {
      textarea.value = 'no logs yet';
      textarea.disabled = true;

      const saveBtn = fileEditor.querySelector('[data-action="save-file"]');
      saveBtn.hidden = true;
    } else {
      const logList = fileEditor.querySelector('[data-file-content]');
      fileEditor.querySelector('[data-action="save-file"]').hidden = true;
      logList.hidden = true;

      const listDiv = document.createElement('div');
      listDiv.dataset.logList = '';
      for (const date of dates) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = `view log for ${date}`;
        btn.innerHTML = `${iconLogs}<span>${date}</span>`;
        btn.addEventListener('click', () => openFileEditor(`memory/${date}.md`));
        listDiv.appendChild(btn);
      }
      fileEditor.insertBefore(listDiv, fileEditor.querySelector('footer'));
    }
  } catch (err) {
    textarea.value = err.message;
    textarea.disabled = true;
  }

  const backBtn = fileEditor.querySelector('[data-action="file-back"]');
  const newBack = backBtn.cloneNode(true);
  backBtn.parentNode.replaceChild(newBack, backBtn);
  newBack.addEventListener('click', () => {
    const logListEl = fileEditor.querySelector('[data-log-list]');
    if (logListEl) logListEl.remove();
    fileEditor.querySelector('[data-file-content]').hidden = false;
    fileEditor.querySelector('[data-action="save-file"]').hidden = false;
    fileEditor.hidden = true;
    fileListFooter.hidden = false;
    fileList.hidden = false;
    $('dialog[aria-label="agent records"] > h2').hidden = false;
  });
}

async function openFileEditor(filePath) {
  const logListEl = fileEditor.querySelector('[data-log-list]');
  if (logListEl) logListEl.remove();
  const isLog = filePath.startsWith('memory/');
  const label = recordLabels[filePath] || filePath.replace('memory/', '').replace('.md', '');

  fileEditor.querySelector('[data-file-name]').textContent = label;
  fileEditor.hidden = false;
  fileListFooter.hidden = true;
  fileList.hidden = true;
  $('dialog[aria-label="agent records"] > h2').hidden = true;

  const textarea = fileEditor.querySelector('[data-file-content]');
  textarea.hidden = false;
  textarea.value = 'loading...';
  textarea.disabled = true;

  const saveBtn = fileEditor.querySelector('[data-action="save-file"]');
  saveBtn.hidden = false;

  try {
    const data = await api('GET', `/api/agents/${activeAgent.id}/workspace/${filePath}`);
    textarea.value = data.content;
    textarea.disabled = false;
  } catch {
    textarea.value = '';
    textarea.disabled = false;
  }

  const newSave = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSave, saveBtn);
  newSave.addEventListener('click', async () => {
    try {
      await api('PUT', `/api/agents/${activeAgent.id}/workspace/${filePath}`, { content: textarea.value });
      newSave.textContent = 'saved';
      setTimeout(() => { newSave.textContent = 'save'; }, 1500);
    } catch (err) {
      showDialogError(filesDialog, err.message);
    }
  });

  const backBtn = fileEditor.querySelector('[data-action="file-back"]');
  const newBack = backBtn.cloneNode(true);
  backBtn.parentNode.replaceChild(newBack, backBtn);
  newBack.addEventListener('click', () => {
    if (isLog) {
      openLogsView();
    } else {
      fileEditor.hidden = true;
      fileListFooter.hidden = false;
      fileList.hidden = false;
      $('dialog[aria-label="agent records"] > h2').hidden = false;
    }
  });
}

const setupTokenDialog = $('dialog[aria-label="setup token"]');
const apiKeyDialog = $('dialog[aria-label="api key"]');

$('button[data-action="open-setup-token"]').addEventListener('click', () => { clearDialogError(setupTokenDialog); setupTokenDialog.showModal(); });
$('button[data-action="open-api-key"]').addEventListener('click', () => { clearDialogError(apiKeyDialog); apiKeyDialog.showModal(); });

function showDialogError(dialog, msg) {
  const el = $('[data-error]', dialog);
  el.textContent = msg;
  el.hidden = false;
}

function clearDialogError(dialog) {
  const el = $('[data-error]', dialog);
  el.textContent = '';
  el.hidden = true;
}

$('form[aria-label="setup-token"]').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearDialogError(setupTokenDialog);
  const input = $('form[aria-label="setup-token"] input');
  const token = input.value.trim();
  if (!token) return;
  if (!token.startsWith('sk-ant-oat')) return showDialogError(setupTokenDialog, 'invalid setup token — must start with sk-ant-oat. if you have an api key, use the api key option instead.');
  try {
    await api('POST', '/api/auth/setup-token', { token });
    setupTokenDialog.close();
    init();
  } catch (err) {
    showDialogError(setupTokenDialog, err.message);
  }
});

$('form[aria-label="api-key"]').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearDialogError(apiKeyDialog);
  const input = $('form[aria-label="api-key"] input');
  const key = input.value.trim();
  if (!key) return;
  if (!key.startsWith('sk-ant-api')) return showDialogError(apiKeyDialog, 'invalid api key — must start with sk-ant-api. if you have a setup token, use the setup token option instead.');
  try {
    await api('POST', '/api/auth/api-key', { key });
    apiKeyDialog.close();
    init();
  } catch (err) {
    showDialogError(apiKeyDialog, err.message);
  }
});

$('button[data-action="check-auth"]').addEventListener('click', () => init());

const navEl = $('nav[aria-label="agents"]');
const navOverlay = $('[data-overlay]');
const navToggle = $('button[data-action="toggle-nav"]');

function openNav() {
  navEl.setAttribute('data-open', '');
  navOverlay.hidden = false;
  navToggle.setAttribute('aria-expanded', 'true');
}

function closeNav() {
  navEl.removeAttribute('data-open');
  navOverlay.hidden = true;
  navToggle.setAttribute('aria-expanded', 'false');
}

navToggle.addEventListener('click', () => {
  if (navEl.hasAttribute('data-open')) closeNav();
  else openNav();
});

navOverlay.addEventListener('click', closeNav);

const themeToggle = $('button[data-action="toggle-theme"]');
const themeColorMeta = $('meta[name="theme-color"]');
const colorSchemeMeta = $('meta[name="color-scheme"]');

function setTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('claudity-theme', theme);
  themeColorMeta.content = theme === 'light' ? '#f5f5f5' : '#000000';
  colorSchemeMeta.content = theme;
}

themeToggle.addEventListener('click', () => {
  const current = document.body.getAttribute('data-theme') || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
});

setTheme(localStorage.getItem('claudity-theme') || 'dark');

const sfx = (() => {
  let ctx = null;
  let enabled = localStorage.getItem('claudity-sound') !== 'off';

  function getCtx() {
    if (!ctx) ctx = new AudioContext();
    return ctx;
  }

  function play(fn) {
    if (!enabled) return;
    try { fn(getCtx()); } catch {}
  }

  return {
    get enabled() { return enabled; },
    set enabled(v) {
      enabled = v;
      localStorage.setItem('claudity-sound', v ? 'on' : 'off');
      document.body.setAttribute('data-sound', v ? 'on' : 'off');
    },

    hover() {
      play(c => {
        const t = c.currentTime;
        const osc = c.createOscillator();
        const gain = c.createGain();
        const filter = c.createBiquadFilter();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1800 + Math.random() * 200, t);
        osc.frequency.exponentialRampToValueAtTime(1200, t + 0.07);
        filter.type = 'lowpass';
        filter.frequency.value = 3000;
        filter.Q.value = 2;
        gain.gain.setValueAtTime(0.04, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        osc.connect(filter).connect(gain).connect(c.destination);
        osc.start(t);
        osc.stop(t + 0.07);
      });
    },

    click() {
      play(c => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'square';
        osc.frequency.value = 800 + Math.random() * 200;
        osc.frequency.exponentialRampToValueAtTime(400, c.currentTime + 0.08);
        gain.gain.value = 0.06;
        gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.08);
        osc.connect(gain).connect(c.destination);
        osc.start();
        osc.stop(c.currentTime + 0.08);
      });
    },

    type() {
      play(c => {
        const buf = c.createBuffer(1, c.sampleRate * 0.04, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.15));
        }
        const src = c.createBufferSource();
        const gain = c.createGain();
        const filter = c.createBiquadFilter();
        src.buffer = buf;
        filter.type = 'bandpass';
        filter.frequency.value = 2000 + Math.random() * 3000;
        filter.Q.value = 1.5;
        gain.gain.value = 0.08 + Math.random() * 0.04;
        src.connect(filter).connect(gain).connect(c.destination);
        src.start();
      });
    }
  };
})();

document.body.setAttribute('data-sound', sfx.enabled ? 'on' : 'off');

const soundToggle = $('button[data-action="toggle-sound"]');
soundToggle.setAttribute('aria-pressed', String(sfx.enabled));
soundToggle.addEventListener('click', () => {
  sfx.enabled = !sfx.enabled;
  soundToggle.setAttribute('aria-pressed', String(sfx.enabled));
  if (sfx.enabled) sfx.click();
});

let lastHovered = null;
document.addEventListener('pointerover', (e) => {
  if (!e.target.closest) return;
  const btn = e.target.closest('button, nav li');
  if (btn && btn !== lastHovered) {
    lastHovered = btn;
    sfx.hover();
  } else if (!btn) {
    lastHovered = null;
  }
});

document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest) return;
  const btn = e.target.closest('button, nav li');
  if (btn) sfx.click();
}, true);

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Tab') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.length === 1) sfx.type();
});

async function init() {
  try {
    const status = await api('GET', '/api/auth/status');

    if (!status.authenticated) {
      showSection('setup');
      return;
    }

    agents = await api('GET', '/api/agents');
    renderAgents();
    showSection('empty');
  } catch {
    showSection('setup');
  }
}

init();
