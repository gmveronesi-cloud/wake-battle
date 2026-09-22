#!/bin/sh
# Ricrea il DB di prova da zero ed esegue tutti i test SQL, passo per passo
set -e
cd "$(dirname "$0")/.."
P="psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
reset_db() {
  $P -c "drop database if exists wb" -c "drop role if exists anon" -c "drop role if exists authenticated" -c "create database wb"
  $P -d wb -f test/00_supabase_sim.sql
  $P -d wb -f sql/01_coppia.sql
  $P -d wb -f sql/02_sveglie_risultati.sql
}
reset_db
python3 test/test_02.py
echo "--- 02 ancora valido dopo 03 ---"
reset_db; $P -d wb -f sql/03_giochi.sql; python3 test/test_02.py
echo "--- test 03 (Memoria vecchia, prima del 04) ---"
reset_db; $P -d wb -f sql/03_giochi.sql; python3 test/test_03.py
if [ -f sql/04_memoria_round.sql ]; then
  echo "--- 02 ancora valido dopo 03 + 04 ---"
  reset_db; $P -d wb -f sql/03_giochi.sql; $P -d wb -f sql/04_memoria_round.sql; python3 test/test_02.py
  echo "--- test 04 (Memoria a round) ---"
  reset_db; $P -d wb -f sql/03_giochi.sql; $P -d wb -f sql/04_memoria_round.sql; python3 test/test_04.py
  echo "--- 04 rilanciato due volte: nessun errore ---"
  $P -d wb -f sql/04_memoria_round.sql && echo ok
fi
if [ -f sql/05_numeri.sql ]; then
  L="$P -d wb -f sql/03_giochi.sql -f sql/04_memoria_round.sql -f sql/05_numeri.sql"
  echo "--- 02 ancora valido dopo 05 ---";  reset_db; $L; python3 test/test_02.py
  echo "--- 04 (Memoria) ancora valido dopo 05 ---"; reset_db; $L; python3 test/test_04.py
  echo "--- test 05 (Numeri in ordine) ---"; reset_db; $L; python3 test/test_05.py
  echo "--- 05 rilanciato due volte: nessun errore ---"
  $P -d wb -f sql/05_numeri.sql && echo ok
fi
