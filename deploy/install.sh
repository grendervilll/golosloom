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
# -----------------------------------------------------------------------------
NEEDED_PORTS="80/tcp 443/tcp 7880/tcp 7881/tcp 7882/tcp 50000:50100/udp 3478/udp 3478/tcp 5349/udp 5349/tcp 49160:49200/udp"

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
# Генерация .env с секретами (запоминает и устанавливает ключи и пароли).
# -----------------------------------------------------------------------------
gen_env() {
  local livekit_key livekit_secret turn_secret jwt_secret
  livekit_key="$(openssl rand -hex 8)"
  livekit_secret="$(openssl rand -hex 32)"
  turn_secret="$(openssl rand -hex 32)"
  jwt_secret="$(openssl rand -hex 32)"
  cat > "$DEPLOY_DIR/.env" <<EOF
DOMAIN=$DOMAIN
TURN_REALM=$DOMAIN
TURN_SHARED_SECRET=$turn_secret
LIVEKIT_API_KEY=$livekit_key
LIVEKIT_API_SECRET=$livekit_secret
JWT_SECRET=$jwt_secret
TURN_URLS=turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp
ALLOW_ORIGINS=https://$DOMAIN,tauri://localhost,http://tauri.localhost,http://localhost:5173
DATA_DIR=$DATA_DIR
LIVEKIT_CONFIG=$LIVEKIT_CONFIG
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
  rm -f /etc/cron.d/golosloom "$INSTALL_DIR/update-certs.sh"
  log "Cron-задачи удалены"
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
  ask_params
  mkdir -p "$INSTALL_DIR" "$DATA_DIR"
  clone_repo
  gen_env
  gen_livekit_config
  gen_certs
  check_ports
  open_ports
  setup_cron
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

  cd "$REPO_DIR"
  log "Скачиваю последние изменения с GitHub..."
  git pull --ff-only
  gen_livekit_config
  gen_certs
  log "Пересобираю контейнеры (база данных и порты не изменяются)..."
  docker compose -f "$DEPLOY_DIR/docker-compose.yml" up -d --build
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
    "")
      if [ -f "$STATE_FILE" ]; then
        echo "Golosloom уже установлен. Выберите действие:"
        echo "  1) Переустановить начисто (удалить файлы, базу данных и открытые порты кроме SSH)"
        echo "  2) Обновить (скачать последние изменения, без изменения баз данных и портов)"
        echo "  3) Полное удаление с сервера"
        echo "  4) Выйти"
        prompt_read choice "Ваш выбор [1-4]: "
        case "$choice" in
          1) do_reinstall ;;
          2) do_update ;;
          3) do_uninstall ;;
          *) echo "Выход"; exit 0 ;;
        esac
      else
        install_fresh
      fi
      ;;
    *)
      die "Неизвестный режим: $mode. Допустимо: install, reinstall, update, uninstall, certs"
      ;;
  esac
}

main "$@"
