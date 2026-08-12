#!/usr/bin/env bash
# Ежедневный бэкап golosloom: БД (безопасный .backup — корректно работает
# с WAL при живом сервере) + .env с секретами. Ротация: 7 последних.
# Устанавливается install.sh (setup_backup), крон: /etc/cron.d/golosloom-backup.
# Восстановление: остановить контейнер, вернуть файл на место, запустить.
set -euo pipefail
DEPLOY=/opt/golosloom/repo/deploy
DATA=/opt/golosloom/data
BK=/opt/golosloom/backups
LOG=/var/log/golosloom-backup.log
mkdir -p "$BK"
chmod 700 "$BK"
stamp=$(date +%Y%m%d-%H%M)
db="$BK/db-$stamp.sqlite3"
env="$BK/env-$stamp"
sqlite3 "$DATA/golosloom.db" ".backup \"$db\"" || { echo "$(date) FAIL db backup" >> "$LOG"; exit 1; }
if ! sqlite3 "$db" "PRAGMA integrity_check;" | grep -q "^ok$"; then
  echo "$(date) FAIL integrity" >> "$LOG"; rm -f "$db"; exit 1
fi
[ -f "$DEPLOY/.env" ] && cp "$DEPLOY/.env" "$env" && chmod 600 "$env"
ls -1t "$BK"/db-*.sqlite3 2>/dev/null | tail -n +8 | xargs -r rm -f
ls -1t "$BK"/env-* 2>/dev/null | tail -n +8 | xargs -r rm -f
size=$(du -h "$db" | cut -f1)
echo "$(date) OK db=$size env=$(basename "$env") total=$(ls "$BK" | wc -l) files" >> "$LOG"
