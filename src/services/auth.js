const { execSync } = require('child_process');
const { stmts } = require('../db');

let cachedCredentials = null;

function readKeychain() {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    const parsed = JSON.parse(raw);
    const creds = parsed.claudeAiOauth || parsed;
    cachedCredentials = creds;
    return creds;
  } catch {
    cachedCredentials = null;
    return null;
  }
}

function getApiKey() {
  const row = stmts.getConfig.get('api_key');
  return row ? row.value : null;
}

function setApiKey(key) {
  stmts.setConfig.run('api_key', key);
}

function removeApiKey() {
  stmts.deleteConfig.run('api_key');
}

function getAccessToken() {
  const apiKey = getApiKey();
  if (apiKey) return apiKey;
  const creds = readKeychain();
  if (!creds) return null;
  return creds.accessToken || null;
}

function getAuthStatus() {
  const apiKey = getApiKey();
  if (apiKey) {
    return { authenticated: true, mode: 'api_key' };
  }

  const creds = readKeychain();
  if (!creds) {
    return { authenticated: false, reason: 'no credentials found' };
  }
  if (!creds.accessToken) {
    return { authenticated: false, reason: 'no access token in credentials' };
  }
  if (creds.expiresAt) {
    const expiry = new Date(creds.expiresAt).getTime();
    const now = Date.now();
    if (now >= expiry - 60000) {
      return { authenticated: false, reason: 'token expired' };
    }
  }
  return { authenticated: true, mode: 'oauth' };
}

function getHeaders() {
  const token = getAccessToken();
  if (!token) return null;
  return {
    'x-api-key': token,
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01'
  };
}

function writeSetupToken(token) {
  const payload = JSON.stringify({ claudeAiOauth: { accessToken: token } });
  try {
    execSync('security delete-generic-password -s "Claude Code-credentials"', { stdio: 'ignore' });
  } catch {}
  execSync(
    `security add-generic-password -s "Claude Code-credentials" -a "Claude Code" -w '${payload.replace(/'/g, "'\\''")}'`,
    { timeout: 5000 }
  );
  cachedCredentials = null;
}

module.exports = { getAccessToken, getAuthStatus, getHeaders, getApiKey, setApiKey, removeApiKey, readKeychain, writeSetupToken };
