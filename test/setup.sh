#!/bin/sh
# Prepara l'ambiente di test di Claude con un solo comando.
# Uso (nella cartella del repo clonato da GitHub): sh test/setup.sh
set -e
cd "$(dirname "$0")/.."
PGBIN=/usr/lib/postgresql/16/bin
if ! psql -h /tmp -p 5433 -U postgres -c 'select 1' >/dev/null 2>&1; then
  sudo mkdir -p /var/lib/wbpg && sudo chown postgres /var/lib/wbpg
  [ -f /var/lib/wbpg/PG_VERSION ] || sudo -u postgres $PGBIN/initdb -D /var/lib/wbpg -A trust >/dev/null
  sudo -u postgres $PGBIN/pg_ctl -D /var/lib/wbpg -o "-p 5433 -k /tmp -c listen_addresses=''" -l /tmp/pg.log start >/dev/null 2>&1
fi
[ -d node_modules/playwright ] || npm i --no-save --silent playwright@1.56.1 @supabase/supabase-js@2.116.0 pg@8 >/dev/null 2>&1
python3 -c 'import psycopg2' 2>/dev/null || pip install -q --break-system-packages psycopg2-binary >/dev/null 2>&1
echo "ambiente pronto"
