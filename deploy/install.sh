#!/usr/bin/env bash
# =============================================================================
# AeraNexa 一键安装 / 恢复 / 更新脚本
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/opxqo/AeraNexa/main/deploy/install.sh)
#
# 按服务器实际情况一步步引导：环境检查 → swap → Node/pnpm/MySQL/Caddy → 数据库
# → 代码 → .env.local → 建表或恢复备份 → 编译 → systemd → HTTPS。
# 每一步先检测再动手，中途失败修好问题后直接重跑即可；重跑绝不会重新生成已有密钥。
#
# 支持系统：Ubuntu 22.04 / 24.04、Debian 12（x86_64 / arm64），需要 root。
#
# 无人值守（测试 / 自动化）：预先设置环境变量即可跳过对应提问，AERANEXA_YES=1 时其余提问取默认值。
#   AERANEXA_MODE=install|restore|update  AERANEXA_DOMAIN  AERANEXA_DIR  AERANEXA_DB=local|external
#   AERANEXA_DB_HOST/PORT/NAME/USER/PASSWORD（外部数据库）  AERANEXA_BOT=y|n  AERANEXA_BACKUP（备份文件）
#   AERANEXA_HTTPS=auto|force|skip  AERANEXA_REPO  AERANEXA_BRANCH
# =============================================================================
set -Eeuo pipefail

REPO_URL="${AERANEXA_REPO:-https://github.com/opxqo/AeraNexa.git}"
BRANCH="${AERANEXA_BRANCH:-main}"
APP_USER="aeranexa"
DEFAULT_DIR="/opt/aeranexa/app"
LOG_FILE="/var/log/aeranexa-install.log"
INFO_FILE="/root/aeranexa-install-info.txt"
MIN_NODE="22.18.0"
# 与 .env.example / src/lib/server/backup.ts 的 SECRET_ENV_KEYS 一致（沙箱回调密钥仅本地使用，不生成）
SECRET_KEYS=(AUTH_SESSION_SECRET SMTP_CONFIG_ENCRYPTION_KEY PAYMENT_CONFIG_ENCRYPTION_KEY SETTINGS_ENCRYPTION_KEY
  EMAIL_VERIFICATION_PEPPER RECHARGE_CARD_SECRET TELEGRAM_BINDING_PEPPER)

export DEBIAN_FRONTEND=noninteractive
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# ----------------------------------------------------------------------------- 输出
if [[ -t 1 ]]; then
  C_RESET=$'\e[0m' C_BOLD=$'\e[1m' C_RED=$'\e[31m' C_GREEN=$'\e[32m' C_YELLOW=$'\e[33m' C_BLUE=$'\e[34m'
else
  C_RESET="" C_BOLD="" C_RED="" C_GREEN="" C_YELLOW="" C_BLUE=""
fi
STEP_NO=0
CURRENT_STEP="准备"

step() { STEP_NO=$((STEP_NO + 1)); CURRENT_STEP="$1"; printf '\n%s==> [%d] %s%s\n' "$C_BOLD$C_BLUE" "$STEP_NO" "$1" "$C_RESET"; }
ok()   { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
info() { printf '  · %s\n' "$*"; }
warn() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
die()  { printf '\n%s✗ %s%s\n' "$C_RED" "$*" "$C_RESET" >&2; exit 1; }

on_error() {
  local code=$? line=$1
  printf '\n%s✗ 第 %d 步「%s」失败（退出码 %d，脚本第 %d 行）。%s\n' "$C_RED" "$STEP_NO" "$CURRENT_STEP" "$code" "$line" "$C_RESET" >&2
  printf '  完整日志：%s。修好问题后重新运行脚本即可，已完成的步骤会自动跳过。\n' "$LOG_FILE" >&2
}
trap 'on_error $LINENO' ERR

# ----------------------------------------------------------------------------- 交互
HAS_TTY=0
if [[ -r /dev/tty && -w /dev/tty ]] && { : </dev/tty; } 2>/dev/null; then HAS_TTY=1; fi
ASSUME_YES="${AERANEXA_YES:-0}"

# ask 变量名 提示 默认值：环境变量 AERANEXA_<变量名> 已设置则直接采用
ask() {
  local var=$1 prompt=$2 default=${3:-} preset_name="AERANEXA_$1" answer=""
  local preset=${!preset_name:-}
  if [[ -n $preset ]]; then printf -v "$var" '%s' "$preset"; info "$prompt：$preset"; return; fi
  if [[ $HAS_TTY == 1 && $ASSUME_YES != 1 ]]; then
    printf '  %s?%s %s%s：' "$C_YELLOW" "$C_RESET" "$prompt" "${default:+ [$default]}" >/dev/tty
    IFS= read -r answer </dev/tty || true
  elif [[ -z $default ]]; then
    die "「$prompt」没有默认值，需要在交互终端运行，或设置环境变量 $preset_name"
  fi
  printf -v "$var" '%s' "${answer:-$default}"
}

# ask_secret：输入不回显
ask_secret() {
  local var=$1 prompt=$2 preset_name="AERANEXA_$1" answer=""
  local preset=${!preset_name:-}
  if [[ -n $preset ]]; then printf -v "$var" '%s' "$preset"; return; fi
  [[ $HAS_TTY == 1 ]] || die "「$prompt」需要在交互终端输入，或设置环境变量 $preset_name"
  printf '  %s?%s %s：' "$C_YELLOW" "$C_RESET" "$prompt" >/dev/tty
  IFS= read -rs answer </dev/tty || true
  printf '\n' >/dev/tty
  printf -v "$var" '%s' "$answer"
}

# confirm 提示 默认(y/n)
confirm() {
  local prompt=$1 default=${2:-n} answer=""
  if [[ $HAS_TTY == 1 && $ASSUME_YES != 1 ]]; then
    printf '  %s?%s %s [%s]：' "$C_YELLOW" "$C_RESET" "$prompt" "$([[ $default == y ]] && echo Y/n || echo y/N)" >/dev/tty
    IFS= read -r answer </dev/tty || true
  fi
  answer=${answer:-$default}
  [[ $answer =~ ^[Yy] ]]
}

# choose 变量名 标题 默认序号 选项...
choose() {
  local var=$1 title=$2 default=$3; shift 3
  local preset_name="AERANEXA_$var" preset answer=""
  preset=${!preset_name:-}
  if [[ -n $preset ]]; then printf -v "$var" '%s' "$preset"; info "$title：$preset"; return; fi
  if [[ $HAS_TTY == 1 && $ASSUME_YES != 1 ]]; then
    printf '  %s?%s %s\n' "$C_YELLOW" "$C_RESET" "$title" >/dev/tty
    local n=1 opt
    for opt in "$@"; do printf '      %d) %s\n' "$n" "${opt#*|}" >/dev/tty; n=$((n + 1)); done
    printf '    请输入序号 [%s]：' "$default" >/dev/tty
    IFS= read -r answer </dev/tty || true
  fi
  answer=${answer:-$default}
  [[ $answer =~ ^[0-9]+$ ]] && (( answer >= 1 && answer <= $# )) || die "无效的选择：$answer"
  local picked=${!answer}
  printf -v "$var" '%s' "${picked%%|*}"
}

# ----------------------------------------------------------------------------- 工具
app_home() { getent passwd "$APP_USER" | cut -d: -f6; }
run_as_app() { runuser -u "$APP_USER" -- env HOME="$(app_home)" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 PATH="$PATH" "$@"; }
in_app() { (cd "$INSTALL_DIR" && run_as_app "$@"); }
have() { command -v "$1" >/dev/null 2>&1; }
apt_install() { logged "安装 $*" apt-get install -y -qq --no-install-recommends "$@"; }
rand_hex() { openssl rand -hex "$1"; }
rand_b64() { openssl rand -base64 32; }
version_ge() { [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" == "$2" ]]; }

env_file() { echo "$INSTALL_DIR/.env.local"; }
env_get() {
  local file; file=$(env_file)
  [[ -f $file ]] || return 0
  grep -E "^$1=" "$file" | tail -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/'
}
ENV_BACKED_UP=0
# env_set 键 值：存在则原地替换（首次改动前备份原文件），不存在则追加
env_set() {
  local key=$1 value=$2 file; file=$(env_file)
  touch "$file"
  if grep -qE "^$key=" "$file"; then
    [[ "$(env_get "$key")" == "$value" ]] && return 0
    if [[ $ENV_BACKED_UP == 0 ]]; then cp -p "$file" "$file.bak.$(date +%Y%m%d%H%M%S)"; ENV_BACKED_UP=1; fi
    local tmp; tmp=$(mktemp)
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$file" >"$tmp"
    cat "$tmp" >"$file" && rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}
env_fill() { [[ -n "$(env_get "$1")" ]] || env_set "$1" "$2"; }

public_ip() { curl -4 -fsS --max-time 6 https://ifconfig.me 2>/dev/null || curl -4 -fsS --max-time 6 https://api.ipify.org 2>/dev/null || true; }
resolve_ip() { getent ahostsv4 "$1" 2>/dev/null | awk 'NR == 1 { print $1 }'; }

# logged 说明 命令…：完整输出只写日志，失败时打印最后 40 行
logged() {
  local what=$1; shift
  if ! "$@" >>"$LOG_FILE" 2>&1; then
    tail -n 40 "$LOG_FILE" >&2
    die "$what失败，上方是最后 40 行输出"
  fi
}

wait_http() { # wait_http URL 秒数 → 输出状态码，成功（2xx/3xx）返回 0
  local url=$1 timeout=$2 code="000" start=$SECONDS
  while (( SECONDS - start < timeout )); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)
    [[ $code =~ ^[23] ]] && { echo "$code"; return 0; }
    sleep 3
  done
  echo "$code"; return 1
}

# ============================================================================= 1. 环境检查
preflight() {
  step "环境检查"
  [[ $EUID -eq 0 ]] || die "请用 root 运行（先执行 sudo -i）"
  [[ -r /etc/os-release ]] || die "无法识别操作系统"
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID=$ID OS_VER=$VERSION_ID
  case "$OS_ID:$OS_VER" in
    ubuntu:22.04|ubuntu:24.04|debian:12) ok "系统：$PRETTY_NAME" ;;
    *) die "暂不支持 $PRETTY_NAME，请使用 Ubuntu 22.04 / 24.04 或 Debian 12" ;;
  esac
  case "$(uname -m)" in
    x86_64|aarch64) ok "架构：$(uname -m)" ;;
    *) die "暂不支持的 CPU 架构：$(uname -m)" ;;
  esac

  info "安装基础工具…"
  logged "更新软件源" apt-get update -qq
  apt_install ca-certificates curl gnupg git openssl iproute2 lsb-release procps util-linux
  ok "基础工具就绪"

  MEM_MB=$(awk '/MemTotal/ { printf "%d", $2 / 1024 }' /proc/meminfo)
  SWAP_MB=$(awk '/SwapTotal/ { printf "%d", $2 / 1024 }' /proc/meminfo)
  DISK_FREE_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
  ok "内存 ${MEM_MB}MB，swap ${SWAP_MB}MB，根分区剩余 ${DISK_FREE_GB}G"
  (( DISK_FREE_GB >= 5 )) || die "根分区剩余空间不足 5G"
  (( MEM_MB >= 900 )) || warn "内存不足 1G，编译可能非常慢，建议至少 2G"

  PORT_WARN=""
  local port holder
  for port in 80 443 3000; do
    holder=$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -oP 'users:\(\("\K[^"]+' | head -1 || true)
    if [[ -n $holder && $holder != caddy && ! ( $port == 3000 && $holder == node ) ]]; then
      warn "端口 $port 已被 $holder 占用"
      PORT_WARN+="$port($holder) "
    fi
  done
  [[ -z $PORT_WARN ]] && ok "端口 80 / 443 / 3000 可用"

  if [[ -f /etc/systemd/system/aeranexa-web.service ]]; then
    EXISTING_DIR=$(sed -n 's/^WorkingDirectory=//p' /etc/systemd/system/aeranexa-web.service | head -1)
    ok "检测到已有部署：$EXISTING_DIR"
  else
    EXISTING_DIR=""
  fi
}

# ============================================================================= 2. 收集参数
collect() {
  step "选择安装方式"
  local default_mode=1
  [[ -n $EXISTING_DIR ]] && default_mode=3
  choose MODE "要做什么" "$default_mode" \
    "install|全新安装" \
    "restore|从备份恢复安装（旧站后台「数据迁移」导出的 .ndjson.gz）" \
    "update|更新已有部署（拉代码 → 装依赖 → 编译 → 重启）"

  if [[ $MODE == update ]]; then
    ask DIR "安装目录" "${EXISTING_DIR:-$DEFAULT_DIR}"
    INSTALL_DIR=$DIR
    [[ -d $INSTALL_DIR/.git && -f $INSTALL_DIR/.env.local ]] || die "$INSTALL_DIR 不是已有部署（缺少 .git 或 .env.local）"
    return
  fi

  [[ -n $EXISTING_DIR ]] && warn "这台机器已部署过。继续会在原有基础上重新配置：已有密钥保留，数据库数据不会删除（恢复模式除外）。"

  step "填写部署信息"
  while :; do
    ask DOMAIN "面板域名（例如 panel.example.com，需已解析到本机）" ""
    DOMAIN=${DOMAIN,,}; DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN%%/*}
    [[ $DOMAIN =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] && break
    [[ -n ${AERANEXA_DOMAIN:-} ]] && die "域名格式不正确：$DOMAIN"
    warn "域名格式不正确，请重新输入"
  done

  ask DIR "安装目录" "${EXISTING_DIR:-$DEFAULT_DIR}"
  INSTALL_DIR=${DIR%/}

  choose DB "数据库" 1 "local|在本机安装 MySQL（推荐）" "external|使用已有的外部 MySQL"
  if [[ $DB == external ]]; then
    ask DB_HOST "数据库地址" "127.0.0.1"
    ask DB_PORT "数据库端口" "3306"
    ask DB_NAME "数据库名" "aeranexa"
    ask DB_USER "数据库账号" "aeranexa"
    ask_secret DB_PASSWORD "数据库密码"
    [[ -n $DB_PASSWORD ]] || die "数据库密码不能为空"
  fi

  if confirm "是否启用 Telegram Bot（需要在后台配置 Bot Token，以后也可以再装）" n; then BOT=y; else BOT=n; fi
  [[ -n ${AERANEXA_BOT:-} ]] && BOT=${AERANEXA_BOT:0:1}

  if [[ $MODE == restore ]]; then
    ask BACKUP "备份文件路径" ""
    [[ -f $BACKUP ]] || die "找不到备份文件：$BACKUP"
    gzip -t "$BACKUP" 2>/dev/null || die "备份文件损坏或不是 gzip 文件：$BACKUP"
    BACKUP=$(readlink -f "$BACKUP")
  fi

  step "确认"
  info "方式：$([[ $MODE == restore ]] && echo "从备份恢复（$BACKUP）" || echo 全新安装)"
  info "域名：https://$DOMAIN"
  info "目录：$INSTALL_DIR"
  info "数据库：$([[ $DB == local ]] && echo "本机 MySQL（库名 / 账号 aeranexa，密码自动生成）" || echo "$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME")"
  info "Telegram Bot：$([[ $BOT == y ]] && echo 启用 || echo 不启用)"
  [[ $MODE == restore ]] && warn "恢复会清空目标数据库后写入备份数据。"
  confirm "确认开始" y || die "已取消"
}

# ============================================================================= 3. swap
ensure_swap() {
  step "检查 swap"
  if (( SWAP_MB > 0 )); then ok "已有 ${SWAP_MB}MB swap，跳过"; return; fi
  if (( MEM_MB >= 4000 )); then ok "内存 ${MEM_MB}MB 充足，不需要 swap"; return; fi
  if [[ -e /swapfile ]]; then
    swapon /swapfile 2>/dev/null || true
  else
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  fi
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  ok "已添加 2G swap（内存只有 ${MEM_MB}MB，编译时防止被系统杀掉）"
}

# ============================================================================= 4. 装软件
install_packages() {
  step "安装运行环境"
  local node_ver=""
  have node && node_ver=$(node -v | tr -d v)
  if [[ -n $node_ver ]] && version_ge "$node_ver" "$MIN_NODE"; then
    ok "Node.js $node_ver 已安装"
  else
    info "安装 Node.js 22…"
    logged "配置 NodeSource 软件源" bash -c "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
    apt_install nodejs
    ok "Node.js $(node -v) 安装完成"
  fi

  if [[ $DB == local ]]; then
    if have mysqld || have mariadbd; then
      ok "MySQL 已安装"
    else
      info "安装 MySQL…"
      if [[ $OS_ID == debian ]]; then
        warn "Debian 官方源没有 MySQL，将安装兼容的 MariaDB"
        apt_install mariadb-server
      else
        apt_install mysql-server
      fi
      ok "数据库服务安装完成"
    fi
    systemctl enable --now "$(systemctl list-unit-files mysql.service >/dev/null 2>&1 && echo mysql || echo mariadb)" >/dev/null 2>&1 || true
  elif ! have mysql; then
    apt_install default-mysql-client
  fi

  if have caddy; then
    ok "Caddy 已安装"
  else
    info "安装 Caddy…"
    apt_install debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
    logged "更新软件源" apt-get update -qq
    apt_install caddy
    ok "Caddy 安装完成"
  fi
}

# ============================================================================= 5. 数据库
setup_database() {
  step "准备数据库"
  if [[ $DB == external ]]; then
    MYSQL_PWD="$DB_PASSWORD" mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -e "SELECT 1" >/dev/null 2>&1 \
      || die "连不上外部数据库 $DB_USER@$DB_HOST:$DB_PORT，请检查地址、账号密码和访问白名单"
    MYSQL_PWD="$DB_PASSWORD" mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" \
      -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" 2>/dev/null \
      || warn "没有建库权限，假设库 $DB_NAME 已存在"
    ok "外部数据库连接正常"
    return
  fi

  DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME=aeranexa DB_USER=aeranexa
  # 重跑时沿用 .env.local 里仍然有效的密码，不去改库里的账号
  DB_PASSWORD=$(env_get DB_PASSWORD 2>/dev/null || true)
  if [[ -n $DB_PASSWORD ]] && MYSQL_PWD="$DB_PASSWORD" mysql -h127.0.0.1 -u"$DB_USER" -e "SELECT 1" >/dev/null 2>&1; then
    mysql -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    ok "沿用已有的数据库账号"
    return
  fi
  DB_PASSWORD=$(rand_hex 16)
  mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
  ok "数据库 $DB_NAME 与账号 $DB_USER 已就绪（密码已自动写入配置文件）"
}

# ============================================================================= 6. 代码
setup_code() {
  step "获取代码"
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd -r -m -d /opt/aeranexa -s /usr/sbin/nologin "$APP_USER"
    ok "已创建系统用户 $APP_USER"
  fi
  if [[ -d $INSTALL_DIR/.git ]]; then
    local origin; origin=$(git -C "$INSTALL_DIR" config --get remote.origin.url || true)
    [[ ${origin%.git} == "${REPO_URL%.git}" ]] || die "$INSTALL_DIR 已是其他仓库（$origin），请换一个安装目录"
    chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"
    in_app git pull --ff-only origin "$BRANCH" >/dev/null
    ok "代码已更新到最新（$(git -C "$INSTALL_DIR" log -1 --format='%h %s')）"
  else
    if [[ -d $INSTALL_DIR && -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
      die "$INSTALL_DIR 已存在且不是空目录，请换一个安装目录"
    fi
    mkdir -p "$INSTALL_DIR" && chown "$APP_USER:$APP_USER" "$INSTALL_DIR"
    run_as_app git clone -q --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    ok "代码已下载到 $INSTALL_DIR（$(git -C "$INSTALL_DIR" log -1 --format='%h %s')）"
  fi

  local pm; pm=$(grep -oP '"packageManager":\s*"pnpm@\K[^"]+' "$INSTALL_DIR/package.json")
  corepack enable
  in_app corepack prepare "pnpm@$pm" --activate >/dev/null
  info "安装依赖（pnpm $pm）…"
  logged "安装依赖" in_app pnpm install --frozen-lockfile
  ok "依赖安装完成"
}

# ============================================================================= 7. 配置文件
write_env() {
  step "写入配置文件 .env.local"
  local file; file=$(env_file)
  [[ -f $file ]] && ok "已有 .env.local，只补缺失的项，已有密钥保持不变"
  env_set DB_HOST "$DB_HOST"
  env_set DB_PORT "$DB_PORT"
  env_set DB_NAME "$DB_NAME"
  env_set DB_USER "$DB_USER"
  env_set DB_PASSWORD "$DB_PASSWORD"
  # 只监听本机：外部必须经过 Caddy，无法绕过反向代理伪造来源 IP
  env_set HOSTNAME 127.0.0.1
  [[ $MODE == install ]] && fill_secrets
  chown "$APP_USER:$APP_USER" "$file" && chmod 600 "$file"
  ok "配置已写入 $file（权限 600）"
}

fill_secrets() {
  local key added=0
  for key in "${SECRET_KEYS[@]}"; do
    if [[ -z "$(env_get "$key")" ]]; then
      case $key in
        *_ENCRYPTION_KEY) env_set "$key" "$(rand_b64)" ;;
        *) env_set "$key" "$(rand_hex 32)" ;;
      esac
      added=$((added + 1))
    fi
  done
  (( added )) && ok "已生成 $added 项加密密钥" || true
}

# ============================================================================= 8. 数据与编译
prepare_data() {
  if [[ $MODE == restore ]]; then
    step "从备份恢复数据"
    # 恢复要求 worker 没在运行（否则会拒绝执行）
    systemctl stop aeranexa-worker aeranexa-bot 2>/dev/null || true
    local copy
    copy="$INSTALL_DIR/.restore-$(date +%s).ndjson.gz"
    install -o "$APP_USER" -g "$APP_USER" -m 600 "$BACKUP" "$copy"
    in_app pnpm -s backup:restore "$copy" --yes
    rm -f "$copy"
    # 备份里缺的密钥（例如旧站没配过）补齐，已有的不动
    fill_secrets
    chown "$APP_USER:$APP_USER" "$(env_file)" && chmod 600 "$(env_file)"
    ok "数据已恢复，备份里的密钥已合并进 .env.local"
  else
    step "初始化数据库表"
    logged "建表" in_app pnpm -s db:migrate
    ok "数据表已就绪"
  fi
}

build_app() {
  step "编译网站（约 1–3 分钟）"
  logged "编译" in_app pnpm build
  ok "编译完成"
}

# ============================================================================= 9. systemd
setup_services() {
  step "配置常驻服务"
  local services=(web worker) svc
  [[ ${BOT:-n} == y || -f /etc/systemd/system/aeranexa-bot.service ]] && services+=(bot)
  for svc in "${services[@]}"; do
    sed -e "s#^WorkingDirectory=.*#WorkingDirectory=$INSTALL_DIR#" \
        -e '/^\[Service\]/a Environment=COREPACK_ENABLE_DOWNLOAD_PROMPT=0' \
        "$INSTALL_DIR/deploy/aeranexa-$svc.service" >"/etc/systemd/system/aeranexa-$svc.service"
  done
  systemctl daemon-reload
  for svc in "${services[@]}"; do systemctl enable -q "aeranexa-$svc" && systemctl restart "aeranexa-$svc"; done

  local code
  if ! code=$(wait_http http://127.0.0.1:3000 90); then
    journalctl -u aeranexa-web -n 40 --no-pager || true
    die "网站没有正常启动（本地访问返回 $code），日志见上方"
  fi
  sleep 2
  for svc in "${services[@]}"; do
    if systemctl is-active -q "aeranexa-$svc"; then ok "aeranexa-$svc 运行中"; else
      journalctl -u "aeranexa-$svc" -n 40 --no-pager || true
      die "aeranexa-$svc 没有正常运行，日志见上方"
    fi
  done
  ok "本地访问返回 $code"
}

# ============================================================================= 10. HTTPS
CADDY_BEGIN="# BEGIN aeranexa（由 install.sh 生成，重跑会整块替换）"
CADDY_END="# END aeranexa"

# 安装包自带的默认配置：只有 :80 欢迎页，没有别的站点
is_default_caddyfile() {
  grep -qE '^:80[[:space:]]*\{' "$1" && grep -q '/usr/share/caddy' "$1" && ! grep -qF "$CADDY_BEGIN" "$1"
}

setup_https() {
  step "配置 HTTPS"
  HTTPS_OK=0
  local mode=${AERANEXA_HTTPS:-auto} pub dns
  if [[ $mode == skip ]]; then warn "按设置跳过 HTTPS"; return; fi
  if [[ $PORT_WARN == *"80("* || $PORT_WARN == *"443("* ]]; then
    warn "80/443 端口被其他程序占用（$PORT_WARN），Caddy 无法启动。"
    warn "请停掉占用程序后重跑脚本，或在现有 Web 服务器里把 $DOMAIN 反向代理到 127.0.0.1:3000。"
    return
  fi

  while [[ $mode != force ]]; do
    pub=$(public_ip); dns=$(resolve_ip "$DOMAIN")
    info "域名解析到：${dns:-（解析不到）}　本机公网 IP：${pub:-（获取失败）}"
    if [[ -n $dns && $dns == "$pub" ]]; then ok "域名解析正确"; break; fi
    warn "域名没有解析到本机。Caddy 申请证书需要域名 A 记录指向 ${pub:-本机公网 IP}，并开放 80 / 443 端口。"
    local next
    choose NEXT "怎么处理" 3 \
      "retry|我已改好解析，重新检测" \
      "force|仍然继续（例如用了 CDN 代理，解析 IP 本来就不同）" \
      "skip|先跳过 HTTPS，稍后重跑脚本"
    next=$NEXT; unset NEXT
    case $next in
      retry) sleep 5 ;;
      force) mode=force ;;
      skip) warn "已跳过 HTTPS。解析生效后重跑脚本（选「全新安装」，已有配置会保留）即可。"; return ;;
    esac
    [[ -n ${AERANEXA_NEXT:-} ]] && break
  done

  if have ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ok "已在 ufw 放行 80 / 443"
  fi

  local caddyfile=/etc/caddy/Caddyfile block tmp
  block=$(printf '%s\n%s {\n    encode gzip\n    reverse_proxy 127.0.0.1:3000\n}\n%s\n' "$CADDY_BEGIN" "$DOMAIN" "$CADDY_END")
  [[ -f $caddyfile ]] && cp -p "$caddyfile" "$caddyfile.bak.$(date +%Y%m%d%H%M%S)"
  tmp=$(mktemp)
  if [[ ! -f $caddyfile ]] || is_default_caddyfile "$caddyfile"; then
    printf '%s\n' "$block" >"$tmp"          # 安装包自带的默认欢迎页，直接替换
  else
    awk -v b="$CADDY_BEGIN" -v e="$CADDY_END" '$0 == b { skip = 1 } !skip { print } $0 == e { skip = 0 }' "$caddyfile" >"$tmp"
    printf '\n%s\n' "$block" >>"$tmp"       # 保留其他站点，只替换本脚本管理的那一块
  fi
  if ! caddy validate --adapter caddyfile --config "$tmp" >/dev/null 2>&1; then
    caddy validate --adapter caddyfile --config "$tmp" || true
    rm -f "$tmp"
    die "生成的 Caddy 配置校验失败，原配置未改动"
  fi
  cat "$tmp" >"$caddyfile" && rm -f "$tmp"
  systemctl enable -q caddy && systemctl reload caddy 2>/dev/null || systemctl restart caddy
  info "等待 Caddy 申请证书…"
  local code
  if code=$(wait_http "https://$DOMAIN/login" 90); then
    HTTPS_OK=1; ok "HTTPS 访问正常（返回 $code）"
  else
    journalctl -u caddy -n 30 --no-pager || true
    warn "HTTPS 暂时访问不通（返回 $code）。常见原因：云厂商安全组没开放 80/443、域名解析还没生效。"
    warn "处理后执行 systemctl reload caddy，或重跑脚本。"
  fi
}

# ============================================================================= 11. 收尾
summary() {
  step "完成"
  local url="https://$DOMAIN" update_cmd="bash <(curl -fsSL https://raw.githubusercontent.com/opxqo/AeraNexa/main/deploy/install.sh)"
  {
    echo "AeraNexa 部署信息（$(date '+%F %T')）"
    echo "访问地址：$url"
    echo "安装目录：$INSTALL_DIR"
    echo "配置文件：$INSTALL_DIR/.env.local（含全部加密主密钥，务必妥善保管）"
    echo "数据库：$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME  密码：$DB_PASSWORD"
    [[ $MODE == install ]] && echo "默认管理员：admin@admin.com / admin123456（首次登录后立即修改）"
    echo "服务：systemctl status aeranexa-web aeranexa-worker"
    echo "更新：$update_cmd  （选择「更新已有部署」）"
  } >"$INFO_FILE"
  chmod 600 "$INFO_FILE"

  printf '\n%s  AeraNexa 部署完成%s\n\n' "$C_BOLD$C_GREEN" "$C_RESET"
  if [[ ${HTTPS_OK:-0} == 1 ]]; then
    printf '  访问地址：%s%s%s\n' "$C_BOLD" "$url" "$C_RESET"
  else
    printf '  访问地址：%s（HTTPS 还没配好，处理后重跑脚本）\n' "$url"
    printf '  临时访问：在自己电脑执行 ssh -L 3000:127.0.0.1:3000 root@服务器IP，然后打开 http://127.0.0.1:3000\n'
  fi
  if [[ $MODE == install ]]; then
    printf '\n  %s默认管理员：admin@admin.com / admin123456%s\n' "$C_BOLD$C_YELLOW" "$C_RESET"
    printf '  %s这个密码是公开的，登录后立刻到「个人中心」修改！%s\n' "$C_RED" "$C_RESET"
  else
    printf '\n  用旧站的管理员账号登录。\n'
  fi
  cat <<EOF

  登录后台后请补齐：
    · 系统设置：订阅域名填 $url；填写 3x-ui 面板地址与 API Token
    · 邮件服务：配置 SMTP，否则用户注册收不到验证码
    · 支付渠道：易支付渠道的「回调域名」填 $url
    · 节点管理 → 同步状态：确认 worker 显示「运行中」
  云服务器（AWS、阿里云等）还需要在控制台安全组里开放 80 / 443 端口。

  部署信息已保存到 $INFO_FILE（含数据库密码，仅 root 可读）
  以后更新：$update_cmd
EOF
}

run_update() {
  step "更新代码"
  chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"
  local before; before=$(git -C "$INSTALL_DIR" rev-parse --short HEAD)
  in_app git pull --ff-only origin "$BRANCH" >/dev/null
  ok "代码：$before → $(git -C "$INSTALL_DIR" log -1 --format='%h %s')"
  local pm; pm=$(grep -oP '"packageManager":\s*"pnpm@\K[^"]+' "$INSTALL_DIR/package.json")
  in_app corepack prepare "pnpm@$pm" --activate >/dev/null
  logged "安装依赖" in_app pnpm install --frozen-lockfile
  ok "依赖已同步"
  build_app
  BOT=n
  setup_services
  printf '\n%s  更新完成%s（数据库表结构会在网站启动时自动迁移）\n' "$C_BOLD$C_GREEN" "$C_RESET"
}

# ============================================================================= main
main() {
  mkdir -p "$(dirname "$LOG_FILE")"
  exec > >(tee -a "$LOG_FILE") 2>&1
  printf '%s AeraNexa 安装脚本  %s%s\n' "$C_BOLD" "$(date '+%F %T')" "$C_RESET"
  preflight
  collect
  if [[ $MODE == update ]]; then run_update; return; fi
  ensure_swap
  install_packages
  setup_database
  setup_code
  write_env
  prepare_data
  build_app
  setup_services
  setup_https
  summary
}

main "$@"
