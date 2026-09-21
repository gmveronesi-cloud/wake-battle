#!/bin/sh
# Esegue TUTTI i test (SQL + UI) e stampa solo i risultati e gli errori.
# Uso: sh test/tutti.sh          (tutto)
#      sh test/tutti.sh sql      (solo SQL)
cd "$(dirname "$0")/.."
F='FAIL|controlli|---|Error|ERROR|errore'
sh test/run.sh 2>&1 | grep -E "$F"
[ "$1" = "sql" ] && exit 0
echo "--- UI passo 2 ---";  sh test/prep_db.sh >/dev/null 2>&1 && node test/ui_test.js 2>&1 | grep -E "$F"
echo "--- UI passo 3.1 (DB senza 04) ---"; sh test/prep_db.sh senza04 >/dev/null 2>&1 && node test/ui_test_03.js 2>&1 | grep -E "$F"
for t in test/ui_test_0[4-9].js test/ui_test_[1-9][0-9].js; do
  [ -f "$t" ] || continue
  echo "--- UI $t ---"; sh test/prep_db.sh >/dev/null 2>&1 && node "$t" 2>&1 | grep -E "$F"
done
