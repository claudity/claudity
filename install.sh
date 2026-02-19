#!/bin/bash
set -e

trap 'rm -f /tmp/claudity-install.log' EXIT

if [ "$(uname)" != "Darwin" ]; then
  echo "this installer is for macos only" >&2
  exit 1
fi

if ! tty -s </dev/tty 2>/dev/null; then
  echo "interactive terminal required (no tty available)" >&2
  exit 1
fi

green="\033[92m"
dim="\033[2m"
red="\033[91m"
yellow="\033[93m"
bold="\033[1m"
reset="\033[0m"

step() { echo -e "\n${green}→${reset} $1"; }
ok() { echo -e "  ${green}✓${reset} $1"; }
warn() { echo -e "  ${yellow}!${reset} $1"; }
fail() { echo -e "  ${red}✗${reset} $1"; exit 1; }
info() { echo -e "  ${dim}$1${reset}"; }

spin() {
  local msg="$1"
  shift
  local chars="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
  "$@" >/tmp/claudity-install.log 2>&1 &
  local pid=$!
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    local c="${chars:i%10:1}"
    printf "\r  \033[92m%s\033[0m %s" "$c" "$msg"
    i=$((i + 1))
    sleep 0.1
  done
  wait "$pid" 2>/dev/null
  local status=$?
  printf "\r"
  if [ "$status" -eq 0 ]; then
    ok "$msg"
  else
    echo -e "  ${red}✗${reset} $msg"
    echo ""
    echo -e "  ${dim}log:${reset}"
    tail -5 /tmp/claudity-install.log | while read -r line; do
      echo -e "    ${dim}$line${reset}"
    done
    exit 1
  fi
}

boxlines() {
  local maxlen=0
  for arg in "$@"; do
    local stripped
    stripped=$(echo -e "$arg" | sed $'s/\033\[[0-9;]*m//g')
    local slen=${#stripped}
    if [ "$slen" -gt "$maxlen" ]; then maxlen=$slen; fi
  done
  local w=$((maxlen + 8))
  if [ "$w" -lt 50 ]; then w=50; fi
  local bar=""
  for ((i = 0; i < w - 2; i++)); do bar="${bar}─"; done
  echo ""
  echo -e "  ${dim}╭${bar}╮${reset}"
  echo -e "  ${dim}│${reset}$(printf '%*s' $((w - 2)) '')${dim}│${reset}"
  while [ "$#" -gt 0 ]; do
    local line="$1"
    shift
    local stripped
    stripped=$(echo -e "$line" | sed $'s/\033\[[0-9;]*m//g')
    local slen=${#stripped}
    local pad=$((w - 2 - slen - 3))
    if [ "$pad" -lt 0 ]; then pad=0; fi
    echo -e "  ${dim}│${reset}   ${line}$(printf '%*s' "$pad" '')${dim}│${reset}"
  done
  echo -e "  ${dim}│${reset}$(printf '%*s' $((w - 2)) '')${dim}│${reset}"
  echo -e "  ${dim}╰${bar}╯${reset}"
}

boxlines \
  "${bold}${green}claudity installer${reset}" \
  "" \
  "this installer will:" \
  "" \
  "${dim}•${reset} install xcode command line tools, homebrew, node.js" \
  "  and npm packages if not already present" \
  "${dim}•${reset} download ~200mb of dependencies" \
  "${dim}•${reset} read macos keychain for claude authentication" \
  "${dim}•${reset} optionally access ~/library/messages for imessage relay" \
  "${dim}•${reset} run a local web server on port 6767" \
  "" \
  "claudity is experimental software that can read," \
  "create, edit and delete files. please use with" \
  "extreme caution."

echo ""
while true; do
  echo -en "  type ${green}i understand${reset} to continue ${dim}(esc to exit)${reset}: "
  confirm=""
  while IFS= read -rsn1 char </dev/tty; do
    if [ "$char" = $'\x1b' ]; then
      read -rsn2 -t 0.1 _ </dev/tty 2>/dev/null
      echo ""
      echo ""
      info "installation cancelled"
      echo ""
      exit 0
    elif [ "$char" = "" ]; then
      echo ""
      break
    elif [ "$char" = $'\x7f' ] || [ "$char" = $'\b' ]; then
      if [ -n "$confirm" ]; then
        confirm="${confirm%?}"
        printf '\b \b'
      fi
    else
      confirm="${confirm}${char}"
      printf '%s' "$char"
    fi
  done
  normalized=$(echo "$confirm" | tr '[:upper:]' '[:lower:]')
  if [ "$normalized" = "i understand" ]; then
    break
  fi
done

step "xcode command line tools"
if xcode-select -p &>/dev/null; then
  ok "already installed"
else
  xcode-select --install 2>/dev/null || true
  warn "a dialog may appear - click install and wait"
  elapsed=0
  timeout=1800
  chars="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
  i=0
  while ! xcode-select -p &>/dev/null; do
    c="${chars:i%10:1}"
    printf "\r  \033[92m%s\033[0m waiting for xcode cli tools..." "$c"
    i=$((i + 1))
    sleep 5
    elapsed=$((elapsed + 5))
    if [ "$elapsed" -ge "$timeout" ]; then
      printf "\r"
      fail "timed out waiting for xcode cli tools"
    fi
  done
  printf "\r"
  ok "xcode cli tools installed"
fi

step "homebrew"
if command -v brew &>/dev/null; then
  ok "already installed"
else
  info "installing homebrew..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" >/tmp/claudity-install.log 2>&1
  if [ -f /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -f /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  ok "homebrew installed"
fi

BREW_PREFIX="$(brew --prefix 2>/dev/null || echo "/opt/homebrew")"
SHELLENV_LINE="eval \"\$(${BREW_PREFIX}/bin/brew shellenv)\""
ZPROFILE="$HOME/.zprofile"
if [ -f "$ZPROFILE" ]; then
  if ! grep -qF "brew shellenv" "$ZPROFILE"; then
    echo "$SHELLENV_LINE" >> "$ZPROFILE"
    info "added brew to ~/.zprofile"
  fi
else
  echo "$SHELLENV_LINE" > "$ZPROFILE"
  info "created ~/.zprofile with brew path"
fi

step "node.js"
need_node=false
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | cut -d. -f1 | tr -d 'v')
  if [ "$NODE_VER" -ge 18 ]; then
    ok "$(node -v)"
  else
    warn "found node $(node -v), need 18+"
    need_node=true
  fi
else
  need_node=true
fi
if [ "$need_node" = true ]; then
  spin "installing node.js" brew install node
  ok "$(node -v)"
fi

step "claude code cli"
if command -v claude &>/dev/null; then
  ok "already installed"
else
  spin "installing claude code cli" npm install -g @anthropic-ai/claude-code
fi

step "downloading claudity"
INSTALL_DIR="$HOME/claudity"
REPO_URL="https://github.com/claudity/claudity.git"
if [ -d "$INSTALL_DIR/.git" ]; then
  spin "updating claudity" git -C "$INSTALL_DIR" pull --ff-only
elif [ -d "$INSTALL_DIR" ]; then
  ok "already installed"
else
  spin "cloning claudity" git clone "$REPO_URL" "$INSTALL_DIR"
fi

step "installing dependencies"
spin "npm install" bash -c "cd '$INSTALL_DIR' && npm install"

step "configuring environment"
ENV_FILE="$INSTALL_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "PORT=6767" > "$ENV_FILE"
  echo "RELAY_SECRET=$(openssl rand -hex 24)" >> "$ENV_FILE"
  ok "created .env"
else
  if ! grep -q '^RELAY_SECRET=' "$ENV_FILE" || grep -q 'change-me' "$ENV_FILE"; then
    SECRET=$(openssl rand -hex 24)
    if grep -q '^RELAY_SECRET=' "$ENV_FILE"; then
      sed -i '' "s|^RELAY_SECRET=.*|RELAY_SECRET=$SECRET|" "$ENV_FILE"
    else
      echo "RELAY_SECRET=$SECRET" >> "$ENV_FILE"
    fi
    info "generated relay secret"
  fi
  ok ".env already exists"
fi

step "authentication"
KEYCHAIN_CREDS=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)
if [ -n "$KEYCHAIN_CREDS" ]; then
  ok "found oauth credentials in keychain"
else
  HAS_API_KEY=""
  if [ -f "$ENV_FILE" ]; then
    HAS_API_KEY=$(grep '^API_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
  fi
  if [ -n "$HAS_API_KEY" ]; then
    ok "using api key from .env"
  else
    warn "no authentication found"
    echo ""
    echo -e "  ${green}1${reset}) run ${green}claude login${reset} now ${dim}(recommended)${reset}"
    echo -e "  ${green}2${reset}) skip - configure later via web ui"
    echo ""
    echo -en "  choice ${dim}[1/2]${reset}: "
    read -r auth_choice </dev/tty
    if [ "$auth_choice" != "2" ]; then
      echo ""
      info "launching claude login..."
      echo ""
      claude login </dev/tty
      echo ""
      KEYCHAIN_CREDS=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)
      if [ -n "$KEYCHAIN_CREDS" ]; then
        ok "authenticated successfully"
      else
        warn "credentials not detected - you can authenticate later"
      fi
    else
      info "skipped - authenticate at http://localhost:6767"
    fi
  fi
fi

step "imessage relay"
echo -e "  ${dim}chat with your agents over imessage by texting yourself${reset}"
echo ""
echo -en "  enable imessage relay? ${dim}[y/n]${reset} "
read -r imsg_choice </dev/tty
if [[ "$imsg_choice" =~ ^[yY] ]]; then
  CHAT_DB="$HOME/Library/Messages/chat.db"
  if ! sqlite3 "$CHAT_DB" "select 1 limit 1" &>/dev/null; then
    echo ""
    warn "terminal needs full disk access to read imessages"
    warn "system settings → privacy & security → full disk access → enable your terminal app"
    echo ""
    info "after granting access, run setup again"
  else
    info "full disk access: ok"
  fi

  echo -en "  your phone number ${dim}(e.g. +15551234567)${reset}: "
  read -r PHONE </dev/tty
  if [ -z "$PHONE" ]; then
    warn "no phone number provided, skipping imessage relay"
  else
    if grep -q '^IMESSAGE_PHONE=' "$ENV_FILE"; then
      sed -i '' "s|^IMESSAGE_PHONE=.*|IMESSAGE_PHONE=$PHONE|" "$ENV_FILE"
    else
      echo "IMESSAGE_PHONE=$PHONE" >> "$ENV_FILE"
    fi
    if grep -q '^IMESSAGE_RELAY=' "$ENV_FILE"; then
      sed -i '' "s|^IMESSAGE_RELAY=.*|IMESSAGE_RELAY=true|" "$ENV_FILE"
    else
      echo "IMESSAGE_RELAY=true" >> "$ENV_FILE"
    fi
    ok "imessage relay enabled"
  fi
else
  if [ -f "$ENV_FILE" ] && grep -q '^IMESSAGE_RELAY=' "$ENV_FILE"; then
    sed -i '' "s|^IMESSAGE_RELAY=.*|IMESSAGE_RELAY=false|" "$ENV_FILE"
  fi
  info "skipped"
fi

echo ""
info "for signal support: ${green}brew install signal-cli${reset}"

step "setting up auto-start"
PLIST_NAME="ai.claudity.server"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
NODE_PATH="$(which node)"
CLAUDE_PATH="$(which claude 2>/dev/null || echo "")"
mkdir -p "$INSTALL_DIR/data"

PLIST_PATH_DIRS="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
[ -n "$NODE_PATH" ] && PLIST_PATH_DIRS="$(dirname "$NODE_PATH"):${PLIST_PATH_DIRS}"
[ -n "$CLAUDE_PATH" ] && PLIST_PATH_DIRS="$(dirname "$CLAUDE_PATH"):${PLIST_PATH_DIRS}"

launchctl bootout "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null || true

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${INSTALL_DIR}/src/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${INSTALL_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${INSTALL_DIR}/data/claudity.log</string>
  <key>StandardErrorPath</key>
  <string>${INSTALL_DIR}/data/claudity.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${PLIST_PATH_DIRS}</string>
  </dict>
</dict>
</plist>
PLIST

launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || launchctl load "$PLIST_PATH" 2>/dev/null
sleep 2

if curl -sf http://localhost:6767/api/auth/status >/dev/null 2>&1; then
  ok "claudity is running and will restart automatically"
else
  warn "service loaded but server not responding yet - check ~/claudity/data/claudity.log"
fi

boxlines \
  "${bold}${green}claudity is ready${reset}" \
  "" \
  "${green}http://localhost:6767${reset}" \
  "" \
  "${dim}claudity starts automatically on login${reset}" \
  "${dim}logs: ~/claudity/data/claudity.log${reset}"

echo ""
