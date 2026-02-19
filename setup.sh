#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

green="\033[0;32m"
yellow="\033[0;33m"
red="\033[0;31m"
dim="\033[2m"
bold="\033[1m"
reset="\033[0m"

step() { echo -e "\n${green}→${reset} $1"; }
info() { echo -e "  ${dim}$1${reset}"; }
warn() { echo -e "  ${yellow}!${reset} $1"; }
fail() { echo -e "  ${red}✗${reset} $1"; exit 1; }
ok() { echo -e "  ${dim}done${reset}"; }

ask() {
  echo -en "  $1 ${dim}[y/n]${reset} "
  read -r answer
  [[ "$answer" =~ ^[yY] ]]
}

echo -e "\n${bold}${green}claudity${reset} setup"
echo -e "${dim}personal ai agent platform${reset}"

# node check
step "checking node.js"
if ! command -v node &>/dev/null; then
  fail "node.js is required. install from https://nodejs.org"
fi
NODE_VER=$(node -v | cut -d. -f1 | tr -d 'v')
if [ "$NODE_VER" -lt 18 ]; then
  fail "node 18+ required (found $(node -v))"
fi
info "$(node -v)"

# dependencies
step "installing dependencies"
cd "$DIR"
npm install --silent 2>&1 | tail -1
ok

# env file
step "configuring environment"
if [ ! -f "$DIR/.env" ]; then
  echo "PORT=6767" > "$DIR/.env"
  echo "RELAY_SECRET=$(openssl rand -hex 24)" >> "$DIR/.env"
  info "created .env"
else
  if ! grep -q '^RELAY_SECRET=' "$DIR/.env" || grep -q 'change-me' "$DIR/.env"; then
    SECRET=$(openssl rand -hex 24)
    if grep -q '^RELAY_SECRET=' "$DIR/.env"; then
      sed -i '' "s|^RELAY_SECRET=.*|RELAY_SECRET=$SECRET|" "$DIR/.env"
    else
      echo "RELAY_SECRET=$SECRET" >> "$DIR/.env"
    fi
    info "generated relay secret"
  fi
  info ".env already exists"
fi
ok

# auth
step "checking authentication"
KEYCHAIN_CREDS=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)
if [ -n "$KEYCHAIN_CREDS" ]; then
  info "found oauth credentials in keychain"
else
  HAS_API_KEY=$(grep '^API_KEY=' "$DIR/.env" 2>/dev/null | cut -d= -f2-)
  if [ -n "$HAS_API_KEY" ] && [ "$HAS_API_KEY" != "" ]; then
    info "using api key from .env"
  else
    warn "no authentication found"
    echo ""
    echo -e "  option 1: run ${green}claude setup-token${reset} to connect your claude subscription"
    echo -e "  option 2: add ${green}API_KEY=sk-ant-api03-...${reset} to .env"
    echo ""
    echo -e "  ${dim}you can finish this later - claudity will show a setup screen${reset}"
  fi
fi

# imessage relay
step "imessage relay"
echo -e "  chat with your agents over imessage by texting yourself"
echo -e "  ${dim}send \"agent_name: your message\" in your self-chat${reset}"
echo ""

if ask "enable imessage relay?"; then
  CHAT_DB="$HOME/Library/Messages/chat.db"

  if ! sqlite3 "$CHAT_DB" "select 1 limit 1" &>/dev/null; then
    echo ""
    warn "terminal needs full disk access to read imessages"
    warn "system settings → privacy & security → full disk access → enable your terminal app"
    echo ""
    info "after granting access, run ${green}npm run setup${reset} again"
  else
    info "full disk access: ok"
  fi

  echo -en "  your phone number ${dim}(e.g. +15551234567)${reset}: "
  read -r PHONE
  if [ -z "$PHONE" ]; then
    warn "no phone number provided, skipping imessage relay"
  else
    if grep -q '^IMESSAGE_PHONE=' "$DIR/.env"; then
      sed -i '' "s|^IMESSAGE_PHONE=.*|IMESSAGE_PHONE=$PHONE|" "$DIR/.env"
    else
      echo "IMESSAGE_PHONE=$PHONE" >> "$DIR/.env"
    fi

    if grep -q '^IMESSAGE_RELAY=' "$DIR/.env"; then
      sed -i '' "s|^IMESSAGE_RELAY=.*|IMESSAGE_RELAY=true|" "$DIR/.env"
    else
      echo "IMESSAGE_RELAY=true" >> "$DIR/.env"
    fi
    info "enabled in .env"
    ok
  fi
else
  if grep -q '^IMESSAGE_RELAY=' "$DIR/.env"; then
    sed -i '' "s|^IMESSAGE_RELAY=.*|IMESSAGE_RELAY=false|" "$DIR/.env"
  fi
  info "skipped"
fi

# done
echo -e "\n${bold}${green}ready${reset}\n"
echo -e "  start claudity:  ${green}npm start${reset}"
echo -e "  dev mode:        ${green}npm run dev${reset}"
echo -e "  then visit:      ${green}http://localhost:6767${reset}"
echo ""
