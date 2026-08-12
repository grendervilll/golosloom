#!/usr/bin/env bash
# =============================================================================
# Golosloom — автоматическая установка всего необходимого на VPS.
# Поддерживаются: Debian 13, Ubuntu 24.04 и новее.
#
# Использование:
#   Установка в одну строку:
#     curl -fsSL https://raw.githubusercontent.com/ОWNER/golosloom/main/deploy/install.sh | sudo bash
#
#   Явные режимы:
#     sudo bash install.sh install     # чистая установка
#     sudo bash install.sh reinstall   # переустановка начисто
#     sudo bash install.sh update      # обновление (без потери БД и портов)
#     sudo bash install.sh uninstall   # полное удаление
#     sudo bash install.sh certs       # обновить сертификаты (cron)
#
# Переменные окружения для полностью автоматического запуска:
#   DOMAIN=chat.example.com SSH_PORT=22 GOLOSLOOM_REPO=https://github.com/... 
# =============================================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/golosloom}"
REPO_DIR="$INSTALL_DIR/repo"
DATA_DIR="${DATA_DIR:-$INSTALL_DIR/data}"
LIVEKIT_CONFIG="${LIVEKIT_CONFIG:-$INSTALL_DIR/livekit.yaml}"
STATE_FILE="$INSTALL_DIR/.state"
DEPLOY_DIR="$REPO_DIR/deploy"
GOLOSLOOM_REPO="${GOLOSLOOM_REPO:-}"
DEFAULT_REPO="https://github.com/grendervilll/golosloom.git"

log()  { echo -e "\033[1;32m[golosloom]\033[0m $*"; }
warn() { echo -e "\033[1;33m[golosloom]\033[0m $*"; }
die()  { echo -e "\033[1;31m[golosloom]\033[0m $*" >&2; exit 1; }

# Чтение ввода: при запуске через `curl | bash` stdin занят пайпом,
# поэтому вопросы читаем из /dev/tty. Если терминала нет — возвращаем пусто,
# а скрипт выдаст понятную ошибку (а не упадёт молча из-за set -e).
prompt_read() {
  local var="$1" prompt="$2" value=""
  if [ -t 0 ]; then
    read -r -p "$prompt" value || true
  elif [ -c /dev/tty ]; then
    printf "%s" "$prompt"
    value="$( (read -r line < /dev/tty && printf '%s' "$line") 2>/dev/null || true )"
  fi
  eval "$var=\$value"
}

# Чтение значения из файла состояния (файл нельзя подключать через source —
# значения портов содержат символы, которые bash воспринимает как команды).
state_get() {
  sed -n "s/^$1=//p" "$STATE_FILE" 2>/dev/null | head -1
}

# -----------------------------------------------------------------------------
# Проверка ОС: только Debian 13 и Ubuntu 24+.
# -----------------------------------------------------------------------------
check_os() {
  [ -f /etc/os-release ] || die "Не удаётся определить ОС (/etc/os-release отсутствует)"
  . /etc/os-release
  case "$ID" in
    debian)
      [ "${VERSION_ID:-}" = "13" ] || die "Поддерживается только Debian 13. У вас: Debian $VERSION_ID"
      ;;
    ubuntu)
      major="${VERSION_ID%%.*}"
      [ "$major" -ge 24 ] || die "Поддерживается только Ubuntu 24.04 и новее. У вас: Ubuntu $VERSION_ID"
      ;;
    *)
      die "Поддерживаются только Debian 13 и Ubuntu 24+. У вас: $ID"
      ;;
  esac
  log "ОС: $PRETTY_NAME — поддерживается"
}

# -----------------------------------------------------------------------------
# Установка зависимостей (проверка и доустановка).
# -----------------------------------------------------------------------------
install_deps() {
  local missing=()
  for cmd in curl git docker openssl; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  command -v ufw >/dev/null 2>&1 || missing+=("ufw")
  docker compose version >/dev/null 2>&1 || missing+=("docker-compose-plugin")

  if [ ${#missing[@]} -gt 0 ]; then
    log "Отсутствуют зависимости: ${missing[*]}. Устанавливаю..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y curl git ufw openssl ca-certificates
    if ! command -v docker >/dev/null 2>&1; then
      curl -fsSL https://get.docker.com | sh
    fi
    if ! docker compose version >/dev/null 2>&1; then
      apt-get install -y docker-compose-plugin || docker plugin install docker-compose 2>/dev/null || true
    fi
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  log "Все зависимости установлены: $(command -v docker), docker compose, ufw, git, curl, openssl"
}

# -----------------------------------------------------------------------------
# Ввод параметров (или из переменных окружения).
# -----------------------------------------------------------------------------
ask_params() {
  if [ -z "${DOMAIN:-}" ]; then
    prompt_read DOMAIN "Введите домен для сервера (обязательно, например chat.example.com): "
  fi
  [ -n "$DOMAIN" ] || die "Домен обязателен: задайте его переменной окружения DOMAIN или введите при запросе (без него Caddy не выпустит SSL-сертификат)"

  if [ -z "${SSH_PORT:-}" ]; then
    prompt_read SSH_PORT "Введите порт SSH (по умолчанию 22): "
  fi
  SSH_PORT="${SSH_PORT:-22}"
  case "$SSH_PORT" in
    ''|*[!0-9]*) die "Порт SSH должен быть числом" ;;
  esac

  if [ -z "$GOLOSLOOM_REPO" ]; then
    if [ -f "$STATE_FILE" ]; then
      GOLOSLOOM_REPO="$(sed -n 's/^repo=//p' "$STATE_FILE")"
    fi
  fi
  GOLOSLOOM_REPO="${GOLOSLOOM_REPO:-$DEFAULT_REPO}"
  log "Параметры: домен=$DOMAIN, ssh=$SSH_PORT, репозиторий=$GOLOSLOOM_REPO"
}

# -----------------------------------------------------------------------------
# Порты, которые открывает скрипт (в ufw). SSH — отдельно.
# Диапазон UDP LiveKit сужен до 100 портов (хватает на 100 одновременных
# участников медиа) и не пересекается с эфемерными портами хоста.
# Реле TURN — 100 портов (49160-49260): 20 участников + демонстрации.
NEEDED_PORTS="80/tcp 443/tcp 7880/tcp 7881/tcp 7882/tcp 50000:50100/udp 3478/udp 3478/tcp 5349/udp 5349/tcp 49160:49260/udp"

open_ports() {
  ufw status >/dev/null 2>&1 || { ufw --force enable >/dev/null 2>&1 || true; }
  ufw allow "$SSH_PORT/tcp" >/dev/null 2>&1 || true
  for p in $NEEDED_PORTS; do
    ufw allow "$p" >/dev/null 2>&1 || true
  done
  ufw --force enable >/dev/null 2>&1 || true
  log "Порты открыты: SSH=$SSH_PORT + $NEEDED_PORTS"
}

# Закрывает только те порты, которые открыл скрипт (кроме SSH).
close_ports() {
  local saved_ssh saved_ports
  saved_ssh="$(sed -n 's/^ssh_port=//p' "$STATE_FILE" 2>/dev/null || true)"
  saved_ports="$(sed -n 's/^ports=//p' "$STATE_FILE" 2>/dev/null || true)"
  if [ -n "$saved_ssh" ]; then
    ufw delete allow "$saved_ssh/tcp" >/dev/null 2>&1 || true
  fi
  for p in $saved_ports; do
    ufw delete allow "$p" >/dev/null 2>&1 || true
  done
  log "Закрыты порты, открытые скриптом (SSH сохранён)"
}

save_state() {
  cat > "$STATE_FILE" <<EOF
domain=$DOMAIN
ssh_port=$SSH_PORT
ports=$NEEDED_PORTS
repo=$GOLOSLOOM_REPO
installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
  chmod 600 "$STATE_FILE"
}

# -----------------------------------------------------------------------------
# VAPID-ключи для Web Push (RFC 8292). Формат: приватный — 32 байта,
# публичный — 65 байт (uncompressed P-256), оба в base64url.
# -----------------------------------------------------------------------------
gen_vapid_keys() {
  local tmp
  tmp="$(mktemp -d)"
  openssl ecparam -name prime256v1 -genkey -noout -out "$tmp/vapid.pem" 2>/dev/null
  VAPID_PRIVATE_KEY="$(openssl ec -in "$tmp/vapid.pem" -outform DER 2>/dev/null | tail -c +8 | head -c 32 | base64 | tr '+/' '-_' | tr -d '=')"
  VAPID_PUBLIC_KEY="$(openssl ec -in "$tmp/vapid.pem" -pubout -outform DER 2>/dev/null | tail -c +27 | head -c 65 | base64 | tr '+/' '-_' | tr -d '=')"
  rm -rf "$tmp"
  if [ -z "$VAPID_PRIVATE_KEY" ] || [ -z "$VAPID_PUBLIC_KEY" ]; then
    die "Не удалось сгенерировать VAPID-ключи"
  fi
}

# -----------------------------------------------------------------------------
# Генерация .env с секретами (запоминает и устанавливает ключи и пароли).
# -----------------------------------------------------------------------------
gen_env() {
  local livekit_key livekit_secret turn_secret jwt_secret
  livekit_key="$(openssl rand -hex 8)"
  livekit_secret="$(openssl rand -hex 32)"
  turn_secret="$(openssl rand -hex 32)"
  jwt_secret="$(openssl rand -hex 32)"
  gen_vapid_keys
  cat > "$DEPLOY_DIR/.env" <<EOF
DOMAIN=$DOMAIN
TURN_REALM=$DOMAIN
TURN_SHARED_SECRET=$turn_secret
LIVEKIT_API_KEY=$livekit_key
LIVEKIT_API_SECRET=$livekit_secret
JWT_SECRET=$jwt_secret
VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY
VAPID_SUBJECT=mailto:admin@$DOMAIN
TURN_URLS=turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp
ALLOW_ORIGINS=https://$DOMAIN,tauri://localhost,http://tauri.localhost,http://localhost:5173
DATA_DIR=$DATA_DIR
LIVEKIT_CONFIG=$LIVEKIT_CONFIG
FCM_SERVICE_ACCOUNT_FILE=/fcm-service-account.json
EOF
  chmod 600 "$DEPLOY_DIR/.env"
  log "Секреты сгенерированы и сохранены в $DEPLOY_DIR/.env (права 600)"
}

# Дописывает в .env отсутствующие переменные (при обновлении с более старых версий).
ensure_env_var() {
  local key="$1" value="$2"
  if ! grep -q "^$key=" "$DEPLOY_DIR/.env" 2>/dev/null; then
    echo "$key=$value" >> "$DEPLOY_DIR/.env"
    log "В .env добавлено: $key=$value"
  fi
}

# -----------------------------------------------------------------------------
# Конфигурация LiveKit (генерируется с реальными значениями, вне репозитория).
# -----------------------------------------------------------------------------
gen_livekit_config() {
  # Ключи LiveKit — строго в формате YAML "key: secret" (с пробелом), поэтому
  # они пишутся в конфиг, а не в env LIVEKIT_KEYS.
  local api_key api_secret
  api_key="$(grep '^LIVEKIT_API_KEY=' "$DEPLOY_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-)"
  api_secret="$(grep '^LIVEKIT_API_SECRET=' "$DEPLOY_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-)"
  cat > "$LIVEKIT_CONFIG" <<EOF
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  # LiveKit работает на host-сети: его локальный IP и есть публичный IP сервера,
  # поэтому внешний STUN-поиск не нужен (на многих VPS исходящий UDP к
  # публичным STUN-серверам заблокирован, и livekit не стартует).
  use_external_ip: false
  # На слабых VPS (1 CPU) контроль перегрузки сильно урезает канал
  # (до ~45 кбит/с) и медиа практически замирает — отключаем его.
  congestion_control:
    enabled: false
  allow_tcp_fallback: true
# Лимиты комнат: защита слабого VPS (1 CPU / 1-2 ГБ) от перегруза.
room:
  # Максимум участников в комнате (расчёт — 10-20 человек, запас 30).
  max_participants: 30
  # Пустая комната закрывается сама через 5 минут — авто-очистка.
  empty_timeout: 300
  # Отвалившийся участник удаляется через 2 минуты (запас для слабого
  # мобильного интернета; без этого брошенные устройства висят вечно).
  departure_timeout: 120
limit:
  # Максимум публикуемых треков на участника: голос + камера + экран.
  # Один клиент не сможет залить SFU потоками.
  num_tracks: 3
# Однопоточный VPS: лимиты выбора ноды по нагрузке (0.9 по умолчанию)
# приводят к отказу в подключении (503) при обычной загрузке единственного
# ядра — поднимаем до потолка, у нас всегда одна нода.
node_selector:
  sysload_limit: 0.99
  cpu_load_limit: 0.99
keys:
  ${api_key}: ${api_secret}
logging:
  level: info
EOF
  chmod 644 "$LIVEKIT_CONFIG"
  log "Конфигурация LiveKit записана: $LIVEKIT_CONFIG"
}

# -----------------------------------------------------------------------------
# Сертификаты: dhparam + запасной самоподписанный сертификат, чтобы coturn и
# LiveKit стартовали сразу; реальные сертификаты Caddy подменят их через cron.
# -----------------------------------------------------------------------------
gen_certs() {
  mkdir -p "$DATA_DIR/certs"
  if [ ! -f "$DATA_DIR/certs/dhparam.pem" ]; then
    log "Генерирую dhparam.pem (может занять минуту)..."
    openssl dhparam -out "$DATA_DIR/certs/dhparam.pem" 2048
  fi
  if [ ! -f "$DATA_DIR/certs/fullchain.pem" ] || [ ! -f "$DATA_DIR/certs/privkey.pem" ]; then
    log "Генерирую запасной самоподписанный сертификат (заменится реальным после выпуска Caddy)..."
    openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
      -keyout "$DATA_DIR/certs/privkey.pem" \
      -out "$DATA_DIR/certs/fullchain.pem" \
      -subj "/CN=$DOMAIN" >/dev/null 2>&1
  fi
  chmod 600 "$DATA_DIR/certs/privkey.pem"
}

refresh_certs() {
  local caddy_cert_dir="$DATA_DIR/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$DOMAIN"
  if [ -f "$caddy_cert_dir/$DOMAIN.crt" ] && [ -f "$caddy_cert_dir/$DOMAIN.key" ]; then
    cat "$caddy_cert_dir/$DOMAIN.crt" > "$DATA_DIR/certs/fullchain.pem"
    cat "$caddy_cert_dir/$DOMAIN.key" > "$DATA_DIR/certs/privkey.pem"
    chmod 600 "$DATA_DIR/certs/privkey.pem"
    docker compose -f "$DEPLOY_DIR/docker-compose.yml" restart coturn >/dev/null 2>&1 || true
    log "Сертификаты обновлены для coturn"
  else
    warn "Сертификаты ещё не выпущены Caddy (обычно в течение первой минуты после старта)"
  fi
}

setup_cron() {
  cat > "$INSTALL_DIR/update-certs.sh" <<EOF
#!/usr/bin/env bash
export DOMAIN=$DOMAIN DATA_DIR=$DATA_DIR DEPLOY_DIR=$DEPLOY_DIR
$(declare -f refresh_certs)
refresh_certs
EOF
  chmod +x "$INSTALL_DIR/update-certs.sh"
  cat > /etc/cron.d/golosloom <<EOF
# Автоматический перевыпуск сертификатов (Caddy перевыпускает сам,
# здесь сертификаты синхронизируются с coturn).
0 4 * * * root $INSTALL_DIR/update-certs.sh >/dev/null 2>&1
EOF
  chmod 644 /etc/cron.d/golosloom
  log "Cron-задача для сертификатов установлена (/etc/cron.d/golosloom)"
}

remove_cron() {
  rm -f /etc/cron.d/golosloom /etc/cron.d/golosloom-backup "$INSTALL_DIR/update-certs.sh" "$INSTALL_DIR/backup.sh"
  log "Cron-задачи удалены"
}

# -----------------------------------------------------------------------------
# Ежедневный бэкап: БД (безопасный .backup — корректно работает с WAL при
# живом сервере) + .env с секретами, ротация 7 дней. Идемпотентно, можно
# вызывать при каждом update.
# -----------------------------------------------------------------------------
setup_backup() {
  cat > "$INSTALL_DIR/backup.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
DEPLOY=$DEPLOY_DIR
DATA=$DATA_DIR
BK=$INSTALL_DIR/backups
LOG=/var/log/golosloom-backup.log
mkdir -p "\$BK"
chmod 700 "\$BK"
stamp=\$(date +%Y%m%d-%H%M)
db="\$BK/db-\$stamp.sqlite3"
env="\$BK/env-\$stamp"
sqlite3 "\$DATA/golosloom.db" ".backup \"\$db\"" || { echo "\$(date) FAIL db backup" >> "\$LOG"; exit 1; }
if ! sqlite3 "\$db" "PRAGMA integrity_check;" | grep -q "^ok\$"; then
  echo "\$(date) FAIL integrity" >> "\$LOG"; rm -f "\$db"; exit 1
fi
[ -f "\$DEPLOY/.env" ] && cp "\$DEPLOY/.env" "\$env" && chmod 600 "\$env"
[ -f "$INSTALL_DIR/fcm-service-account.json" ] && cp "$INSTALL_DIR/fcm-service-account.json" "\$BK/fcm-\$stamp.json" && chmod 600 "\$BK/fcm-\$stamp.json"
ls -1t "\$BK"/db-*.sqlite3 2>/dev/null | tail -n +8 | xargs -r rm -f
ls -1t "\$BK"/env-* 2>/dev/null | tail -n +8 | xargs -r rm -f
ls -1t "\$BK"/fcm-* 2>/dev/null | tail -n +8 | xargs -r rm -f
size=\$(du -h "\$db" | cut -f1)
echo "\$(date) OK db=\$size env=\$(basename "\$env") total=\$(ls "\$BK" | wc -l) files" >> "\$LOG"
EOF
  chmod +x "$INSTALL_DIR/backup.sh"
  if [ ! -f /etc/cron.d/golosloom-backup ]; then
    cat > /etc/cron.d/golosloom-backup <<EOF
# Ежедневный бэкап базы данных и .env (7 дней ротации).
10 3 * * * root $INSTALL_DIR/backup.sh >/dev/null 2>&1
EOF
    chmod 644 /etc/cron.d/golosloom-backup
    log "Ежедневный бэкап установлен (/etc/cron.d/golosloom-backup, 03:10)"
  else
    log "Ежедневный бэкап уже настроен"
  fi
}

# -----------------------------------------------------------------------------
# Настройка Docker и сети для медиа-сервисов.
# userland-proxy выключен: иначе Docker создаёт отдельный процесс docker-proxy
# на каждый из 10 000 UDP-портов LiveKit — старт зависает, сервер тормозит.
# -----------------------------------------------------------------------------
configure_docker() {
  if [ ! -f /etc/docker/daemon.json ]; then
    echo '{"userland-proxy": false}' > /etc/docker/daemon.json
    systemctl restart docker
    log "userland-proxy отключён (Docker перезапущен)"
  elif ! grep -q '"userland-proxy"' /etc/docker/daemon.json 2>/dev/null; then
    cp /etc/docker/daemon.json /etc/docker/daemon.json.bak
    python3 - <<'EOF'
import json
p = "/etc/docker/daemon.json"
with open(p) as f:
    cfg = json.load(f)
cfg["userland-proxy"] = False
with open(p, "w") as f:
    json.dump(cfg, f, indent=2)
EOF
    systemctl restart docker
    log "userland-proxy отключён (Docker перезапущен)"
  fi

  # Буферы сокетов для WebRTC (рекомендации LiveKit).
  cat > /etc/sysctl.d/99-golosloom.conf <<'EOF'
net.core.rmem_max = 2500000
net.core.wmem_max = 2500000
net.ipv4.udp_mem = 65536 131072 262144
EOF
  sysctl --system >/dev/null 2>&1 || true
  log "Сетевые буферы для WebRTC настроены"
}

# -----------------------------------------------------------------------------
# Ограничение системных логов (journald): без лимита они могут занять весь
# диск дешёвого VPS (15-20 ГБ). Логи контейнеров ограничены в compose.
# -----------------------------------------------------------------------------
configure_logs() {
  mkdir -p /etc/systemd/journald.conf.d
  cat > /etc/systemd/journald.conf.d/golosloom.conf <<'EOF'
[Journal]
SystemMaxUse=200M
SystemMaxFileSize=20M
MaxRetentionSec=7d
EOF
  systemctl restart systemd-journald >/dev/null 2>&1 || true
  log "Системные логи ограничены (journald: 200 МБ, 7 дней)"
}

# -----------------------------------------------------------------------------
# Проверка занятости портов: медиа-сервисы используют host-сеть, поэтому
# конфликтующие процессы на хосте (например, системные coturn/caddy) помешают
# запуску. Ловим это до начала установки.
# -----------------------------------------------------------------------------
check_ports() {
  local used=""
  for p in 80 443 3478 5349 7880 7881 7882; do
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$p\$"; then
      used="$used $p/tcp"
    fi
  done
  if ss -uln 2>/dev/null | awk '{print $4}' | grep -q ":3478\$"; then
    used="$used 3478/udp"
  fi
  if [ -n "$used" ]; then
    warn "Порты уже заняты процессами на хосте:$used"
    ss -ltnp 2>/dev/null | grep -E ":(80|443|3478|5349|7880|7881|7882)\b" || true
    warn "Остановите конфликтующие сервисы, например:"
    warn "  systemctl stop coturn caddy && systemctl disable coturn caddy"
    die "Порты заняты — освободите их и повторите установку"
  fi
}

# -----------------------------------------------------------------------------
# Режимы работы.
# -----------------------------------------------------------------------------
clone_repo() {
  if [ ! -d "$REPO_DIR/.git" ]; then
    log "Клонирую репозиторий $GOLOSLOOM_REPO"
    git clone --depth 1 "$GOLOSLOOM_REPO" "$REPO_DIR"
  fi
}

install_fresh() {
  check_os
  install_deps
  configure_docker
  configure_logs
  ask_params
  mkdir -p "$INSTALL_DIR" "$DATA_DIR"
  clone_repo
  gen_env
  gen_livekit_config
  gen_certs
  check_ports
  open_ports
  setup_cron
  setup_backup
  save_state
  docker compose -f "$DEPLOY_DIR/docker-compose.yml" up -d --build
  sleep 5
  refresh_certs
  log "Golosloom установлен!"
  log "Веб-клиент: https://$DOMAIN"
  log "Админ сервера — первый зарегистрированный пользователь."
}

do_reinstall() {
  if [ -f "$STATE_FILE" ]; then
    log "Удаляю старую установку (контейнеры, тома, файлы, порты кроме SSH)..."
    docker compose -f "$DEPLOY_DIR/docker-compose.yml" down -v >/dev/null 2>&1 || true
    close_ports
    remove_cron
    rm -rf "$INSTALL_DIR"
    log "Старая установка полностью удалена"
  fi
  install_fresh
}

do_update() {
  [ -f "$STATE_FILE" ] || die "Установка не найдена. Запустите install.sh (без аргументов) для установки."
  check_os
  configure_docker
  configure_logs
  DOMAIN="$(state_get domain)"
  SSH_PORT="$(state_get ssh_port)"
  GOLOSLOOM_REPO="$(state_get repo)"

  # Перенос данных из deploy/data (старая раскладка) в единый каталог данных.
  if [ -d "$DEPLOY_DIR/data" ] && [ ! -d "$DATA_DIR" ]; then
    log "Переношу данные из $DEPLOY_DIR/data в $DATA_DIR..."
    mkdir -p "$DATA_DIR"
    mv "$DEPLOY_DIR/data"/* "$DATA_DIR"/ 2>/dev/null || true
    rm -rf "$DEPLOY_DIR/data"
  fi
  mkdir -p "$DATA_DIR/certs"

  # Дополняем .env новыми переменными (если .env с более старой версии).
  ensure_env_var "DATA_DIR" "$DATA_DIR"
  ensure_env_var "LIVEKIT_CONFIG" "$INSTALL_DIR/livekit.yaml"
  if ! grep -q "^VAPID_PRIVATE_KEY=" "$DEPLOY_DIR/.env" 2>/dev/null; then
    log "Генерирую VAPID-ключи для Web Push..."
    gen_vapid_keys
    ensure_env_var "VAPID_PUBLIC_KEY" "$VAPID_PUBLIC_KEY"
    ensure_env_var "VAPID_PRIVATE_KEY" "$VAPID_PRIVATE_KEY"
    ensure_env_var "VAPID_SUBJECT" "mailto:admin@$DOMAIN"
  fi
  # FCM: путь к файлу сервисного аккаунта Firebase (нативные пуши Android).
  # Путь контейнерный: файл монтируется в контейнер из $INSTALL_DIR.
  ensure_env_var "FCM_SERVICE_ACCOUNT_FILE" "/fcm-service-account.json"
  # Заглушка: docker-compose монтирует файл как ro; если файла нет — docker
  # создал бы каталог на его месте. Пустой файл безопасен: гейтвей не включится.
  [ -f "$INSTALL_DIR/fcm-service-account.json" ] || : > "$INSTALL_DIR/fcm-service-account.json"

  cd "$REPO_DIR"
  log "Скачиваю последние изменения с GitHub..."
  # Жёсткая синхронизация с upstream: локальные правки отслеживаемых файлов
  # (например, временные ручные правки Caddyfile) не блокируют обновление.
  # Все данные (БД, .env, сертификаты) лежат вне репозитория и не затрагиваются.
  git fetch origin
  git reset --hard origin/main
  gen_livekit_config
  gen_certs
  log "Пересобираю контейнеры (база данных и порты не изменяются)..."
  docker compose -f "$DEPLOY_DIR/docker-compose.yml" up -d --build
  # Кэш сборки растёт на ~1-2 ГБ при каждом обновлении и может съесть весь
  # диск дешёвого VPS — оставляем только последнюю неделю.
  docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
  # Caddyfile монтируется bind-mount'ом: контейнер читает его при старте,
  # а up -d не перезапускает уже работающие контейнеры — перезапускаем явно.
  docker compose -f "$DEPLOY_DIR/docker-compose.yml" restart caddy
  setup_backup
  log "Обновление завершено. База данных сохранена."
}

do_uninstall() {
  [ -f "$STATE_FILE" ] || die "Установка не найдена."
  log "Полное удаление Golosloom..."
  docker compose -f "$DEPLOY_DIR/docker-compose.yml" down -v >/dev/null 2>&1 || true
  docker system prune -f >/dev/null 2>&1 || true
  close_ports
  remove_cron
  rm -rf "$INSTALL_DIR"
  log "Golosloom полностью удалён (контейнеры, тома, база данных, порты, cron)."
}

do_certs() {
  [ -f "$STATE_FILE" ] || die "Установка не найдена."
  DOMAIN="$(state_get domain)"
  refresh_certs
}

# Полная очистка файрвола: оставить только нужные для работы порты и SSH.
do_lockdown() {
  check_os
  [ -f "$STATE_FILE" ] || die "Установка не найдена."
  SSH_PORT="$(state_get ssh_port)"
  log "Закрываю все порты, кроме нужных для работы сервера и SSH ($SSH_PORT)..."
  ufw --force disable
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow "$SSH_PORT/tcp" >/dev/null
  for p in $NEEDED_PORTS; do
    ufw allow "$p" >/dev/null
  done
  ufw --force enable
  # ufw reset сносит iptables-правила Docker (цепочки FORWARD), и контейнеры
  # перестают ходить к хосту (host.docker.internal) и друг к другу.
  # Перезапуск Docker восстанавливает его правила.
  systemctl restart docker
  sleep 5
  log "Открыты только: SSH($SSH_PORT) + $NEEDED_PORTS"
  log "Проверка: ufw status numbered"
}

# Усиление безопасности: отключение парольного входа по SSH, fail2ban
# (SSH + веб-логин/регистрация), автоматические обновления безопасности.
do_harden() {
  check_os
  [ -f "$STATE_FILE" ] || die "Установка не найдена."
  SSH_PORT="$(state_get ssh_port)"
  log "Устанавливаю fail2ban и unattended-upgrades..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq fail2ban unattended-upgrades >/dev/null

  log "Отключаю парольный вход по SSH (только ключи)..."
  mkdir -p /etc/ssh/sshd_config.d
  cat > /etc/ssh/sshd_config.d/99-golosloom.conf <<CFG
PasswordAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
CFG
  sshd -t && systemctl reload ssh || die "Ошибка конфигурации sshd — вход по паролю НЕ отключён"

  log "Настраиваю автоматические обновления безопасности..."
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<CFG
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CFG

  log "Настраиваю fail2ban (SSH на порту $SSH_PORT + веб-логин)..."
  mkdir -p /etc/fail2ban/filter.d
  cat > /etc/fail2ban/filter.d/golosloom-web.conf <<'CFG'
[Definition]
failregex = ^\{"level":"info","ts":[0-9.]+,"logger":"http\.log\.access\.log0","msg":"handled request","request":\{.*"remote_ip":"<HOST>".*"uri":"/api/(login|register)".*"status":401
ignoreregex =
CFG
  cat > /etc/fail2ban/jail.local <<CFG
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
banaction = ufw
# polling (а не auto/pyinotify): Caddy ротирует access.log переименованием
# файла, и inotify-бэкенд потерял бы журнал после ротации.
backend = polling

[sshd]
enabled = true
port = $SSH_PORT
maxretry = 4

[golosloom-web]
enabled = true
filter = golosloom-web
logpath = $DATA_DIR/caddy/access.log
maxretry = 5
findtime = 300
bantime = 7200
CFG
  rm -f /var/run/fail2ban/fail2ban.sock
  systemctl enable fail2ban >/dev/null 2>&1
  systemctl restart fail2ban
  sleep 2
  log "Готово: SSH-только-ключи, fail2ban (jail: sshd, golosloom-web), автообновления"
}

# -----------------------------------------------------------------------------
# Точка входа: выбор режима при уже установленном сервере.
# -----------------------------------------------------------------------------
main() {
  [ "$(id -u)" = "0" ] || die "Запустите скрипт от root: sudo bash install.sh"
  local mode="${1:-}"

  case "$mode" in
    install)   install_fresh ;;
    reinstall) do_reinstall ;;
    update)    do_update ;;
    uninstall) do_uninstall ;;
    certs)     do_certs ;;
    lockdown)  do_lockdown ;;
    harden)    do_harden ;;
    "")
      if [ -f "$STATE_FILE" ]; then
        echo "Golosloom уже установлен. Выберите действие:"
        echo "  1) Переустановить начисто (удалить файлы, базу данных и открытые порты кроме SSH)"
        echo "  2) Обновить (скачать последние изменения, без изменения баз данных и портов)"
        echo "  3) Полное удаление с сервера"
        echo "  4) Усилить безопасность (fail2ban, SSH только по ключам, автообновления)"
        echo "  5) Выйти"
        prompt_read choice "Ваш выбор [1-5]: "
        case "$choice" in
          1) do_reinstall ;;
          2) do_update ;;
          3) do_uninstall ;;
          4) do_harden ;;
          *) echo "Выход"; exit 0 ;;
        esac
      else
        install_fresh
      fi
      ;;
    *)
      die "Неизвестный режим: $mode. Допустимо: install, reinstall, update, uninstall, certs, lockdown, harden"
      ;;
  esac
}

main "$@"
