#!/usr/bin/env bash
# RSDWServerAPI installer: a RuneScape: Dragonwilds dedicated server with the
# RSDWServerAPI mod and its Discord bot, on a plain Linux VPS or dedicated box.
#
#   curl -fsSLO https://raw.githubusercontent.com/joaopmsilva/RSDWServerAPI/main/install.sh
#   sudo bash install.sh
#
# It asks a few questions, then installs everything: system packages, Node.js,
# steamcmd and the game server, the mod, the bot, the systemd services, hourly
# backups, a daily update and restart, and the firewall rule. Run it again any
# time to update or change your answers - the world, the bot's data and your
# settings are kept.
#
#   sudo bash install.sh            install, or update and keep the answers
#   sudo bash install.sh --reconfigure   ask every question again
#
# Supported: Ubuntu 22.04+ and Debian 12+ on 64-bit x86 (amd64).
set -euo pipefail

REPO="joaopmsilva/RSDWServerAPI"
APP_ID=4019830
GAME_USER="${RSDW_USER:-dragonwilds}"
HOME_DIR="/home/$GAME_USER"
SERVER_DIR="$HOME_DIR/rs_server"
BOT_DIR="$HOME_DIR/rsdw-bot"
SRC_DIR="$HOME_DIR/RSDWServerAPI"
STEAMCMD_DIR="$HOME_DIR/steamcmd"
SCRIPTS_DIR="$HOME_DIR/scripts"
BACKUP_DIR="$HOME_DIR/backups"
MOD_DIR="$SERVER_DIR/rsdwapi"
GAME_INI="$SERVER_DIR/RSDragonwilds/Saved/Config/LinuxServer/DedicatedServer.ini"
ANSWERS=/etc/rsdw/install.env
# The bot's invite: View/Send/Embed/Attach/History/Reactions, Manage Messages,
# Manage Channels and Manage Roles (it makes its own channels).
BOT_PERMISSIONS=275146468432

SELF="$0"
if [ -f "$SELF" ]; then SELF="$(readlink -f "$SELF")"; else SELF="install.sh"; fi
RECONFIGURE=false
for arg in "$@"; do
    case "$arg" in
        --reconfigure) RECONFIGURE=true ;;
        -h | --help)
            { if [ -f "$0" ]; then cat "$0"; else curl -fsSL "https://raw.githubusercontent.com/$REPO/main/install.sh"; fi; } 2>/dev/null |
                sed -n '2,17p' | sed 's/^# \{0,1\}//' || true
            exit 0 ;;
        *) echo "Unknown option: $arg (try --help)"; exit 1 ;;
    esac
done

# --- Output ------------------------------------------------------------------
if [ -t 1 ]; then
    B=$'\e[1m'; DIM=$'\e[2m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; C=$'\e[36m'; N=$'\e[0m'
else
    B=; DIM=; G=; Y=; R=; C=; N=
fi
step() { echo; echo "${C}${B}==> $*${N}"; }
ok() { echo "  ${G}✔${N} $*"; }
warn() { echo "  ${Y}!${N} $*"; }
die() { echo; echo "${R}${B}✘ $*${N}" >&2; exit 1; }
trap 'echo; echo "${R}The installer stopped at line $LINENO. Fix what it says above and run it again - finished steps are skipped.${N}" >&2' ERR

# Questions are read from the terminal even when the script itself is piped in.
# (-r isn't enough: /dev/tty is always there, but opening it fails without a terminal.)
TTY=/dev/tty
{ : <"$TTY"; } 2>/dev/null || TTY=/dev/stdin

ask() { # ask VAR "Question" "default" [secret]
    local var="$1" question="$2" default="${3:-}" secret="${4:-}" reply shown
    shown="$default"
    [ -n "$secret" ] && [ -n "$default" ] && shown="(keep current)"
    while true; do
        if [ -n "$secret" ]; then
            read -r -s -p "  ${B}$question${N}${shown:+ ${DIM}[$shown]${N}}: " reply <"$TTY"; echo
        else
            read -r -p "  ${B}$question${N}${shown:+ ${DIM}[$shown]${N}}: " reply <"$TTY"
        fi
        reply="${reply:-$default}"
        if [[ "$reply" == *'"'* ]]; then echo "    Please leave out double quotes (\")."; continue; fi
        printf -v "$var" '%s' "$reply"
        return 0
    done
}
ask_required() { # like ask, but won't take an empty answer
    while true; do
        ask "$@"
        [ -n "${!1}" ] && return 0
        echo "    This one is needed."
    done
}
yes_no() { # yes_no "Question" Y|N
    local reply
    read -r -p "  ${B}$1${N} ${DIM}[$([ "$2" = Y ] && echo Y/n || echo y/N)]${N}: " reply <"$TTY"
    reply="${reply:-$2}"
    [[ "$reply" =~ ^[Yy] ]]
}
random_secret() { tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c "${1:-16}" || true; }

# Writes KEY=value into a KEY=value file (the bot's .env, the game's ini),
# replacing the line if it's there and adding it under the first section (or
# at the end) if not.
set_key() { # set_key file key value
    local file="$1" key="$2" value="$3" tmp
    tmp=$(mktemp)
    # Two passes over the file: the first only looks for the key.
    K="$key" V="$value" awk '
        BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"]; done = 0 }
        NR == FNR { if (index($0, k "=") == 1) found = 1; next }
        index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next }
        { print }
        !found && !done && /^\[/ { print k "=" v; done = 1 }
        END { if (!done) print k "=" v }
    ' "$file" "$file" >"$tmp"
    cat "$tmp" >"$file"
    rm -f "$tmp"
}
get_key() { # get_key file key
    [ -f "$1" ] && grep -m1 "^$2=" "$1" | cut -d= -f2- || true
}
# dotenv reads an unquoted # as the start of a comment.
env_value() { if [[ "$1" == *"#"* || "$1" == " "* || "$1" == *" " ]]; then printf '"%s"' "$1"; else printf '%s' "$1"; fi; }
# From / - the folder the installer was started in (often /root) is off limits to
# that user, and git refuses to run there.
as_game() { (cd / && sudo -u "$GAME_USER" -H "$@"); }

cat <<EOF

${B}RuneScape: Dragonwilds server + RSDWServerAPI mod + Discord bot${N}
${DIM}https://github.com/$REPO${N}

EOF

# --- 1. This machine -----------------------------------------------------------
step "Checking this machine"
[ "$(id -u)" -eq 0 ] || die "Run it with sudo:  sudo bash $SELF"
[ "$(uname -m)" = "x86_64" ] || die "The Dragonwilds server only runs on 64-bit x86 (amd64). This machine is $(uname -m)."
[ -d /run/systemd/system ] || die "systemd is needed to keep the server running (containers like LXC without systemd aren't supported)."
[ -r /etc/os-release ] || die "Can't tell which Linux this is (no /etc/os-release)."
. /etc/os-release
OS_NAME="${PRETTY_NAME:-$ID}"
case "${ID:-}:${ID_LIKE:-}" in
    ubuntu:* | debian:* | *:*debian* | *:*ubuntu*) ok "$OS_NAME" ;;
    *) die "$OS_NAME isn't supported by this installer - it needs Ubuntu or Debian (apt). DEPLOY.md has the manual steps." ;;
esac
# Debian testing/sid have no VERSION_ID.
VERSION_ID="${VERSION_ID:-99}"
if [ "${ID}" = ubuntu ] && [ "${VERSION_ID%%.*}" -lt 22 ] 2>/dev/null; then warn "Ubuntu $VERSION_ID is old; 22.04 or newer is recommended."; fi
if [ "${ID}" = debian ] && [ "${VERSION_ID%%.*}" -lt 12 ] 2>/dev/null; then warn "Debian $VERSION_ID is old; 12 or newer is recommended."; fi
RAM_GB=$(awk '/MemTotal/ { printf "%d", $2 / 1024 / 1024 + 0.5 }' /proc/meminfo)
CPUS=$(nproc)
DISK_GB=$(df -BG --output=avail /home | tail -1 | tr -dc 0-9)
ok "$CPUS CPU core(s), ${RAM_GB} GB RAM, ${DISK_GB} GB free disk"
[ "$RAM_GB" -ge 4 ] || warn "The game wants 2 GB plus 1 GB per player (8 GB for a full server of 6). ${RAM_GB} GB will be tight."
[ "$DISK_GB" -ge 15 ] || warn "Under 15 GB free: the game is about 6 GB, plus backups and updates."

if ! command -v curl >/dev/null; then
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates >/dev/null
fi

FIRST_INSTALL=true
[ -f "$ANSWERS" ] && FIRST_INSTALL=false

# --- 2. Questions --------------------------------------------------------------
# Answers are kept (readable by root only) so a re-run just updates.
mkdir -p "$(dirname "$ANSWERS")"
chmod 700 "$(dirname "$ANSWERS")"
if [ -f "$ANSWERS" ]; then
    # shellcheck disable=SC1090
    . "$ANSWERS"
fi
if [ ! -f "$ANSWERS" ]; then
    A_DISCORD_TOKEN=$(get_key "$BOT_DIR/.env" DISCORD_TOKEN)
    A_ADMIN_IDS=$(get_key "$BOT_DIR/.env" ADMIN_USER_IDS)
    A_CONNECT=$(get_key "$BOT_DIR/.env" CONNECT_ADDRESS)
    A_RESTART_AT=$(get_key "$BOT_DIR/.env" DAILY_RESTART)
    A_OWNER_ID=$(get_key "$GAME_INI" OwnerId)
    A_SERVER_NAME=$(get_key "$GAME_INI" ServerName)
    A_WORLD_NAME=$(get_key "$GAME_INI" DefaultWorldName)
    A_WORLD_PASSWORD=$(get_key "$GAME_INI" WorldPassword)
    max=$(get_key "$BOT_DIR/.env" MAX_PLAYERS); [ "${max:-0}" != 0 ] && A_MAX_PLAYERS=$max
    [ -n "$(get_key "$BOT_DIR/.env" DISCORD_TOKEN)" ] && warn "Found an existing install - its settings are filled in below."
fi
PUBLIC_IP=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{ print $1 }')

check_token() { # the HTTP status Discord gives the token
    curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Authorization: Bot $1" https://discord.com/api/v10/users/@me || true
}

if [ "$FIRST_INSTALL" = true ] || [ "$RECONFIGURE" = true ]; then
    step "A few questions (press Enter to take the suggestion in [brackets])"
    cat <<EOF

  ${B}The game server${N}
  Your Player ID is in the game: Settings, at the very bottom (there's a copy button).
  The server won't start without it, and it makes you the owner.
EOF
    ask_required A_OWNER_ID "Your Dragonwilds Player ID" "${A_OWNER_ID:-}"
    ask_required A_SERVER_NAME "Server name (shown in the server list)" "${A_SERVER_NAME:-My Dragonwilds Server}"
    # The game cuts it to 16 characters, and players search for the cut one.
    suggestion="${A_SERVER_NAME// /}"
    while true; do
        ask_required A_WORLD_NAME "World name (what players search for, case sensitive, 16 characters at most)" "${A_WORLD_NAME:-${suggestion:0:16}}"
        [ "${#A_WORLD_NAME}" -le 16 ] && break
        echo "    That's ${#A_WORLD_NAME} characters; the game would cut it to \"${A_WORLD_NAME:0:16}\". Pick one of 16 or fewer."
        A_WORLD_NAME=
    done
    if [ -n "${A_WORLD_PASSWORD:-}" ]; then
        ask A_WORLD_PASSWORD "World password (Enter keeps it, - for none)" "$A_WORLD_PASSWORD"
        [ "$A_WORLD_PASSWORD" = - ] && A_WORLD_PASSWORD=
    else
        ask A_WORLD_PASSWORD "World password (Enter for none - anyone can join)" ""
    fi
    ask_required A_ADMIN_PASSWORD "Admin password (typed in game under Server Management)" "${A_ADMIN_PASSWORD:-$(random_secret 12)}"
    while true; do
        ask_required A_PORT "Game port (UDP)" "${A_PORT:-7777}"
        [[ "$A_PORT" =~ ^[0-9]{4,5}$ ]] && [ "$A_PORT" -ge 1024 ] && [ "$A_PORT" -le 65535 ] && break
        echo "    A number from 1024 to 65535 - 7777 unless you know you need another."
        A_PORT=
    done
    # The game's limit is 6 and not a setting; this is only what the bot shows.
    A_MAX_PLAYERS="${A_MAX_PLAYERS:-6}"

    cat <<EOF

  ${B}The Discord bot${N}
  1. https://discord.com/developers/applications -> New Application -> give it a name.
  2. Bot -> Reset Token -> copy it. On the same page turn on ${B}Message Content Intent${N}.
  3. In Discord: Settings -> Advanced -> Developer Mode on. Then right-click your name -> Copy User ID.
EOF
    while true; do
        ask_required A_DISCORD_TOKEN "Bot token" "${A_DISCORD_TOKEN:-}" secret
        code=$(check_token "$A_DISCORD_TOKEN")
        if [ "$code" = 200 ]; then ok "Discord accepted the token"; break; fi
        if [ "$code" = 401 ]; then echo "    Discord says that token is wrong - copy it again (Reset Token gives a new one)."; A_DISCORD_TOKEN=; continue; fi
        warn "Couldn't reach Discord to check the token (HTTP $code) - using it anyway."
        break
    done
    while true; do
        ask_required A_ADMIN_IDS "Your Discord user ID (several: separate with commas)" "${A_ADMIN_IDS:-}"
        A_ADMIN_IDS="${A_ADMIN_IDS//[[:space:]]/}"
        [[ "$A_ADMIN_IDS" =~ ^[0-9]{17,20}(,[0-9]{17,20})*$ ]] && break
        echo "    That's a long number like 169180385501118485, not your name: Developer Mode on, then right-click yourself -> Copy User ID."
        A_ADMIN_IDS=
    done
    ask_required A_RESTART_AT "Daily update and restart time, 24h (server time is $(date +%Z))" "${A_RESTART_AT:-05:00}"
    [[ "$A_RESTART_AT" =~ ^([01]?[0-9]|2[0-3]):[0-5][0-9]$ ]] || { warn "Not a time like 05:00 - using 05:00."; A_RESTART_AT=05:00; }
    ask_required A_CONNECT "Address players connect to" "${A_CONNECT:-$PUBLIC_IP:$A_PORT}"

    umask 077
    {
        echo '# Answers from install.sh - run "sudo bash install.sh --reconfigure" to change them.'
        for v in A_OWNER_ID A_SERVER_NAME A_WORLD_NAME A_WORLD_PASSWORD A_ADMIN_PASSWORD A_PORT A_MAX_PLAYERS A_DISCORD_TOKEN A_ADMIN_IDS A_RESTART_AT A_CONNECT; do
            printf '%s=%q\n' "$v" "${!v}"
        done
    } >"$ANSWERS"
    umask 022
    ok "Saved your answers in $ANSWERS"
else
    ok "Using your saved answers ($ANSWERS). To change them: sudo bash $SELF --reconfigure"
fi

# A running server is stopped for the update; say who'd be kicked.
WAS_RUNNING=false
if systemctl is-active --quiet dragonwilds 2>/dev/null; then
    WAS_RUNNING=true
    ONLINE=$(as_game node "$BOT_DIR/src/online.js" 2>/dev/null || echo "?")
    echo
    warn "The game server is running (players online: $ONLINE). It will be stopped to update and started again."
    yes_no "Continue?" Y || die "Nothing was changed after the questions. Run it again when nobody is on."
fi

# --- 3. Packages ---------------------------------------------------------------
step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
# steamcmd is a 32-bit program: lib32gcc-s1 and friends.
apt-get update -qq
PACKAGES=(ca-certificates curl git rsync tar gzip build-essential cron sudo lib32gcc-s1 lib32stdc++6 libc6-i386 procps)
apt-get install -y -qq "${PACKAGES[@]}" >/dev/null
ok "${PACKAGES[*]}"

NODE_MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
    step "Installing Node.js 22"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
fi
NODE=$(command -v node)
ok "Node.js $(node -v) at $NODE"

# --- 4. User -------------------------------------------------------------------
step "Setting up the '$GAME_USER' user"
if id "$GAME_USER" >/dev/null 2>&1; then
    ok "already there"
else
    useradd -m -s /bin/bash "$GAME_USER"
    ok "created (the server and bot run as this user, not root)"
fi
# Crash reports read the server's systemd log and the kernel log.
usermod -aG systemd-journal "$GAME_USER"
as_game mkdir -p "$SERVER_DIR" "$SCRIPTS_DIR" "$BACKUP_DIR" "$STEAMCMD_DIR"

# --- 5. Game server --------------------------------------------------------------
if [ "$WAS_RUNNING" = true ]; then
    step "Stopping the game server"
    as_game "$NODE" "$BOT_DIR/src/announce.js" restart "Server update" >/dev/null 2>&1 || true
    systemctl stop dragonwilds
    ok "stopped"
fi

step "Downloading the game server with steamcmd (about 6 GB the first time)"
if [ ! -x "$STEAMCMD_DIR/steamcmd.sh" ]; then
    as_game bash -c "cd '$STEAMCMD_DIR' && curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar xz"
fi
for attempt in 1 2 3; do
    as_game "$STEAMCMD_DIR/steamcmd.sh" +force_install_dir "$SERVER_DIR" +login anonymous +app_update "$APP_ID" validate +quit 2>&1 |
        grep --line-buffered -E "Update state|Success|ERROR|Error!" | sed -u 's/^/    /' || true
    [ -f "$SERVER_DIR/RSDragonwildsServer.sh" ] && break
    warn "steamcmd didn't finish (try $attempt of 3), trying again"
    sleep 5
done
[ -f "$SERVER_DIR/RSDragonwildsServer.sh" ] || die "steamcmd couldn't download the server. Check the disk space and network, then run the installer again."
chmod +x "$SERVER_DIR/RSDragonwildsServer.sh"
ok "game server in $SERVER_DIR"

# The game's own settings. Only the keys asked about are written; the game
# keeps the rest (known players, bans) itself. It removes AdminPassword once
# it has read it.
as_game mkdir -p "$(dirname "$GAME_INI")"
if [ ! -s "$GAME_INI" ]; then
    as_game bash -c "printf '%s\n' '[/Script/Dominion.DedicatedServerSettings]' > '$GAME_INI'"
fi
set_key "$GAME_INI" OwnerId "$A_OWNER_ID"
set_key "$GAME_INI" ServerName "$A_SERVER_NAME"
set_key "$GAME_INI" DefaultWorldName "$A_WORLD_NAME"
set_key "$GAME_INI" WorldPassword "$A_WORLD_PASSWORD"
if [ "$FIRST_INSTALL" = true ] || [ "$RECONFIGURE" = true ]; then set_key "$GAME_INI" AdminPassword "$A_ADMIN_PASSWORD"; fi
chown "$GAME_USER:$GAME_USER" "$GAME_INI"
ok "server settings in $GAME_INI"

# --- 6. This project: the mod and the bot ---------------------------------------
step "Getting RSDWServerAPI"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo /nonexistent)"
if [ -f "$HERE/Makefile" ] && [ -f "$HERE/bot/package.json" ] && [ "$HERE" = "$SRC_DIR" ]; then
    chown -R "$GAME_USER:$GAME_USER" "$SRC_DIR"
    ok "using $SRC_DIR as it is"
elif [ -f "$HERE/Makefile" ] && [ -f "$HERE/bot/package.json" ]; then
    # Run from a copy of the project: use that.
    rsync -a --delete --exclude=.git --exclude=node_modules --exclude=bot/.env --exclude=bot/data "$HERE/" "$SRC_DIR/"
    chown -R "$GAME_USER:$GAME_USER" "$SRC_DIR"
    ok "from $HERE"
else
    # The newest release, or main if there isn't one.
    TAG=$(curl -fsS --max-time 10 "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | grep -m1 '"tag_name"' | cut -d'"' -f4 || true)
    if [ -d "$SRC_DIR/.git" ]; then
        as_game git -C "$SRC_DIR" fetch -q --depth 1 origin "${TAG:+refs/tags/}${TAG:-main}"
        as_game git -C "$SRC_DIR" checkout -q -f FETCH_HEAD
    else
        rm -rf "$SRC_DIR"
        as_game git clone -q --depth 1 ${TAG:+--branch "$TAG"} "https://github.com/$REPO.git" "$SRC_DIR"
    fi
    ok "${TAG:-main} in $SRC_DIR"
fi

step "Building the mod"
# Objects from before the Makefile tracked headers could be stale: start over once.
[ -n "$(find "$SRC_DIR/src" -name '*.d' -print -quit)" ] || as_game make -C "$SRC_DIR" clean >/dev/null
as_game make -C "$SRC_DIR" -j"$CPUS" >/dev/null
MOD="$SERVER_DIR/librsdwapi.so"
if ! cmp -s "$SRC_DIR/dist/librsdwapi.so" "$MOD"; then
    [ -f "$MOD" ] && cp -p "$MOD" "$MOD.old"
    install -o "$GAME_USER" -g "$GAME_USER" -m 755 "$SRC_DIR/dist/librsdwapi.so" "$MOD.new"
    mv -f "$MOD.new" "$MOD"
fi
ok "mod built and installed as $MOD"

# The mod's settings: its API only listens on this machine, with a token the
# bot shares. The mod fills in everything else on its first start.
as_game mkdir -p "$MOD_DIR"
MOD_INI="$MOD_DIR/settings.ini"
API_TOKEN=$(get_key "$MOD_INI" BearerToken)
if [ ! -f "$MOD_INI" ]; then
    API_TOKEN=$(random_secret 40)
    as_game bash -c "printf '%s\n' '[API]' 'Enabled=true' 'BindAddress=127.0.0.1' 'Port=8080' 'BearerToken=$API_TOKEN' > '$MOD_INI'"
    ok "mod settings in $MOD_INI"
else
    ok "keeping the mod settings in $MOD_INI"
fi

step "Installing the Discord bot"
rsync -a --delete --exclude=.env --exclude=data/ --exclude=node_modules/ "$SRC_DIR/bot/" "$BOT_DIR/"
chown -R "$GAME_USER:$GAME_USER" "$BOT_DIR"
as_game bash -c "cd '$BOT_DIR' && npm install --omit=dev --no-audit --no-fund --loglevel=error" >/dev/null
ENV_FILE="$BOT_DIR/.env"
[ -f "$ENV_FILE" ] || as_game cp "$BOT_DIR/.env.example" "$ENV_FILE"
chmod 600 "$ENV_FILE"
set_key "$ENV_FILE" DISCORD_TOKEN "$A_DISCORD_TOKEN"
set_key "$ENV_FILE" API_TOKEN "$API_TOKEN"
set_key "$ENV_FILE" SERVER_NAME "$(env_value "$A_SERVER_NAME")"
set_key "$ENV_FILE" MAX_PLAYERS "$A_MAX_PLAYERS"
set_key "$ENV_FILE" ADMIN_USER_IDS "$A_ADMIN_IDS"
set_key "$ENV_FILE" CONNECT_ADDRESS "$A_CONNECT"
set_key "$ENV_FILE" WORLD_NAME "$(env_value "$A_WORLD_NAME")"
set_key "$ENV_FILE" SERVER_PASSWORD "$(env_value "$A_WORLD_PASSWORD")"
set_key "$ENV_FILE" DAILY_RESTART "$A_RESTART_AT"
set_key "$ENV_FILE" SERVER_DIR "$SERVER_DIR"
set_key "$ENV_FILE" SAVE_DIR "$SERVER_DIR/RSDragonwilds/Saved/SaveGames"
set_key "$ENV_FILE" BACKUP_DIR "$BACKUP_DIR"
set_key "$ENV_FILE" BACKUP_SCRIPT "$SCRIPTS_DIR/backup.sh"
set_key "$ENV_FILE" STEAMCMD "$STEAMCMD_DIR/steamcmd.sh"
chown "$GAME_USER:$GAME_USER" "$ENV_FILE"
ok "bot in $BOT_DIR (settings: $ENV_FILE, all explained in CONFIG.md)"

# --- 7. Services, backups, daily restart -----------------------------------------
step "Setting up the services"
cat >/etc/systemd/system/dragonwilds.service <<EOF
# Written by RSDWServerAPI's install.sh.
[Unit]
Description=RuneScape: Dragonwilds dedicated server (with RSDWServerAPI)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$GAME_USER
WorkingDirectory=$SERVER_DIR
Environment=LD_PRELOAD=$MOD
Environment=RSDWAPI_DIR=$MOD_DIR
ExecStart=$SERVER_DIR/RSDragonwildsServer.sh -log -port=$A_PORT
# One line per run with how it ended, for the bot's crash reports.
ExecStopPost=/bin/sh -c 'echo "\$\$(date +%%s) \$\$SERVICE_RESULT \$\$EXIT_CODE \$\$EXIT_STATUS" >> $MOD_DIR/exits.log'
Restart=on-failure
RestartSec=15
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
EOF
cat >/etc/systemd/system/rsdw-bot.service <<EOF
# Written by RSDWServerAPI's install.sh.
[Unit]
Description=Dragonwilds Discord bot (RSDWServerAPI)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$GAME_USER
WorkingDirectory=$BOT_DIR
ExecStart=$NODE src/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
ok "dragonwilds.service and rsdw-bot.service"

# The bot may start, stop and restart the game server - and nothing else.
SUDOERS=/etc/sudoers.d/rsdw-bot
RULE="$GAME_USER ALL=(root) NOPASSWD: /bin/systemctl start dragonwilds, /bin/systemctl stop dragonwilds, /bin/systemctl restart dragonwilds, /usr/bin/systemctl start dragonwilds, /usr/bin/systemctl stop dragonwilds, /usr/bin/systemctl restart dragonwilds"
echo "$RULE" >"$SUDOERS.tmp"
chmod 440 "$SUDOERS.tmp"
if visudo -cf "$SUDOERS.tmp" >/dev/null; then mv -f "$SUDOERS.tmp" "$SUDOERS"; ok "the bot can start/stop/restart the server (/server in Discord)"; else rm -f "$SUDOERS.tmp"; warn "couldn't add the sudo rule, so /server won't work"; fi

# Backups every hour, update and restart once a day.
for script in backup.sh update-and-restart.sh; do
    install -o "$GAME_USER" -g "$GAME_USER" -m 755 "$BOT_DIR/deploy/scripts/$script" "$SCRIPTS_DIR/$script"
    sed -i \
        -e "s#/usr/bin/node#$NODE#g" \
        -e "s#/home/dragonwilds/rsdw-bot#$BOT_DIR#g" \
        -e "s#/home/dragonwilds/rs_server#$SERVER_DIR#g" \
        -e "s#/home/dragonwilds/steamcmd#$STEAMCMD_DIR#g" \
        -e "s#/home/dragonwilds/backups#$BACKUP_DIR#g" \
        -e "s#/home/dragonwilds/#$HOME_DIR/#g" \
        "$SCRIPTS_DIR/$script"
done
HOUR=$((10#${A_RESTART_AT%%:*})); MINUTE=$((10#${A_RESTART_AT##*:}))
CRON=$(crontab -u "$GAME_USER" -l 2>/dev/null | grep -v -e "$SCRIPTS_DIR/backup.sh" -e "$SCRIPTS_DIR/update-and-restart.sh" -e '^# RSDWServerAPI' || true)
{
    [ -n "$CRON" ] && echo "$CRON"
    echo "# RSDWServerAPI: hourly backup (keeps 10), daily update + restart"
    echo "0 * * * * $SCRIPTS_DIR/backup.sh"
    echo "$MINUTE $HOUR * * * $SCRIPTS_DIR/update-and-restart.sh"
} | crontab -u "$GAME_USER" -
ok "hourly backups to $BACKUP_DIR, update and restart daily at $A_RESTART_AT"

# Open the game port if ufw is on. It isn't turned on here: that could lock
# out SSH on a box set up differently.
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "$A_PORT/udp" >/dev/null
    ok "firewall: opened $A_PORT/udp"
else
    ok "no local firewall to open (if your host has a firewall in its control panel, allow UDP $A_PORT there)"
fi

# --- 8. Start ---------------------------------------------------------------------
step "Starting the game server"
systemctl enable dragonwilds >/dev/null 2>&1
systemctl restart dragonwilds
echo -n "  waiting for it to load (a minute or two) "
READY=false
for _ in $(seq 1 60); do
    if curl -fsS --max-time 3 -H "Authorization: Bearer $API_TOKEN" http://127.0.0.1:8080/api/health 2>/dev/null | grep -q '"engineReady":true'; then READY=true; break; fi
    if ! systemctl is-active --quiet dragonwilds; then break; fi
    echo -n "."
    sleep 5
done
echo
if [ "$READY" = true ]; then
    ok "the server is up and the mod is live"
else
    warn "the server isn't answering yet. Check: journalctl -u dragonwilds -n 50   and   $MOD_DIR/logs/api.log"
fi

step "Starting the Discord bot"
systemctl enable rsdw-bot >/dev/null 2>&1
systemctl restart rsdw-bot
sleep 3
systemctl is-active --quiet rsdw-bot && ok "the bot is running" || warn "the bot didn't start: journalctl -u rsdw-bot -n 30"

# Is the bot in a Discord server yet, and is Message Content on?
APP=$(curl -fsS --max-time 10 -H "Authorization: Bot $A_DISCORD_TOKEN" https://discord.com/api/v10/applications/@me 2>/dev/null || true)
APP_ID_DISCORD=$(printf '%s' "$APP" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);console.log(a.id||"")}catch{}})')
APP_FLAGS=$(printf '%s' "$APP" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).flags||0)}catch{console.log(-1)}})')
INVITE="https://discord.com/developers/applications (OAuth2 -> URL Generator)"
[ -n "$APP_ID_DISCORD" ] && INVITE="https://discord.com/oauth2/authorize?client_id=$APP_ID_DISCORD&scope=bot+applications.commands&permissions=$BOT_PERMISSIONS"
if [ "$APP_FLAGS" -ge 0 ] 2>/dev/null && [ $((APP_FLAGS & (3 << 18))) -eq 0 ]; then
    warn "Message Content Intent is off, so Discord messages can't reach the game. Turn it on: https://discord.com/developers/applications/$APP_ID_DISCORD/bot"
fi
CHANNELS="$BOT_DIR/data/channels.json"
if [ -n "$APP_ID_DISCORD" ] && [ ! -f "$CHANNELS" ] && [ -z "$(get_key "$ENV_FILE" CHAT_CHANNEL_ID)" ]; then
    echo
    echo "  ${B}Last step: add the bot to your Discord server.${N} Open this link and pick your server:"
    echo
    echo "    ${C}$INVITE${N}"
    echo
    echo -n "  waiting for it to join and make its channels (Ctrl+C to skip; it finishes by itself later) "
    # Ctrl+C only ends the wait, so the summary below still shows.
    SKIP=false
    trap 'SKIP=true' INT
    for _ in $(seq 1 120); do
        [ -f "$CHANNELS" ] || [ "$SKIP" = true ] && break
        echo -n "."
        sleep 5 || true
    done
    trap - INT
    echo
    [ -f "$CHANNELS" ] && ok "the bot made its channels - have a look in Discord" || warn "not yet - the bot sets everything up as soon as it's invited."
fi

trap - ERR
cat <<EOF

${G}${B}All done!${N}

  ${B}Join the game${N}      Worlds -> Public -> search "${A_WORLD_NAME}"${A_WORLD_PASSWORD:+  (password: $A_WORLD_PASSWORD)}
  ${B}Become admin${N}       in game: Settings -> Server Management -> admin password from $ANSWERS
  ${B}Discord${N}            /help for everyone, /server and /admin for you. The server info channel shows how to join.
  ${B}Invite link${N}        $INVITE

  ${B}Useful commands${N}
    sudo systemctl restart dragonwilds        restart the game server
    sudo journalctl -u rsdw-bot -f            the bot's live log
    sudo nano $ENV_FILE    more bot settings (then: sudo systemctl restart rsdw-bot)
    sudo bash $SELF --reconfigure         change your answers
    /admin update in Discord                  update the bot and mod (the game updates itself daily)

  ${B}Need help?${N}  /admin contact in Discord, or message joaosilvajs: https://discord.com/users/169180385501118485
  ${B}Enjoying it?${N} https://ko-fi.com/paradoxjs

EOF
