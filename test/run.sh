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
if [ -f sql/06_colore_parola.sql ]; then
  L="$P -d wb -f sql/03_giochi.sql -f sql/04_memoria_round.sql -f sql/05_numeri.sql -f sql/06_colore_parola.sql"
  echo "--- 02 ancora valido dopo 06 ---";  reset_db; $L; python3 test/test_02.py
  echo "--- 04 (Memoria) ancora valido dopo 06 ---"; reset_db; $L; python3 test/test_04.py
  echo "--- 05 (Numeri) ancora valido dopo 06 ---"; reset_db; $L; python3 test/test_05.py
  echo "--- test 06 (Colore della parola) ---"; reset_db; $L; python3 test/test_06.py
  echo "--- 06 rilanciato due volte: nessun errore ---"
  $P -d wb -f sql/06_colore_parola.sql && echo ok
fi
if [ -f sql/07_refactor_giochi.sql ]; then
  L="$P -d wb -f sql/03_giochi.sql -f sql/04_memoria_round.sql -f sql/05_numeri.sql -f sql/06_colore_parola.sql -f sql/07_refactor_giochi.sql"
  echo "--- 02 ancora valido dopo 07 (refactor a dispatcher) ---"; reset_db; $L; python3 test/test_02.py
  echo "--- 04 (Memoria) ancora valido dopo 07 ---"; reset_db; $L; python3 test/test_04.py
  echo "--- 05 (Numeri) ancora valido dopo 07 ---"; reset_db; $L; python3 test/test_05.py
  echo "--- 06 (Colore della parola) ancora valido dopo 07 ---"; reset_db; $L; python3 test/test_06.py
  echo "--- 07 rilanciato due volte: nessun errore ---"
  $P -d wb -f sql/07_refactor_giochi.sql && echo ok
fi
if [ -f sql/09_rimuovi_intruso.sql ]; then
  L="$P -d wb -f sql/03_giochi.sql -f sql/04_memoria_round.sql -f sql/05_numeri.sql -f sql/06_colore_parola.sql -f sql/07_refactor_giochi.sql -f sql/08_intruso.sql -f sql/09_rimuovi_intruso.sql"
  echo "--- 02 ancora valido dopo 09 ---";  reset_db; $L; python3 test/test_02.py
  echo "--- 04 (Memoria) ancora valido dopo 09 ---"; reset_db; $L; python3 test/test_04.py
  echo "--- 05 (Numeri) ancora valido dopo 09 ---"; reset_db; $L; python3 test/test_05.py
  echo "--- 06 (Colore della parola) ancora valido dopo 09 ---"; reset_db; $L; python3 test/test_06.py
  echo "--- test 09 (rimozione Trova l'intruso) ---"; reset_db; $L; python3 test/test_09.py
  echo "--- 09 rilanciato due volte: nessun errore ---"
  $P -d wb -f sql/09_rimuovi_intruso.sql && echo ok
fi
if [ -f sql/11_riflessi_babbo.sql ]; then
  L="$P -d wb -f sql/03_giochi.sql -f sql/04_memoria_round.sql -f sql/05_numeri.sql -f sql/06_colore_parola.sql -f sql/07_refactor_giochi.sql -f sql/08_intruso.sql -f sql/09_rimuovi_intruso.sql -f sql/10_riflessi.sql -f sql/11_riflessi_babbo.sql"
  echo "--- 02 ancora valido dopo 11 ---";  reset_db; $L; python3 test/test_02.py
  echo "--- 04 (Memoria) ancora valido dopo 11 ---"; reset_db; $L; python3 test/test_04.py
  echo "--- 05 (Numeri) ancora valido dopo 11 ---"; reset_db; $L; python3 test/test_05.py
  echo "--- 06 (Colore della parola) ancora valido dopo 11 ---"; reset_db; $L; python3 test/test_06.py
  echo "--- 09 (rimozione intruso) ancora valido dopo 11 ---"; reset_db; $L; python3 test/test_09.py
  echo "--- test 11 (Riflessi Babbo/Schiacciami) ---"; reset_db; $L; python3 test/test_11.py
  echo "--- 11 rilanciato due volte: nessun errore ---"
  $P -d wb -f sql/11_riflessi_babbo.sql && echo ok
fi
if [ -f sql/12_anagramma.sql ]; then
  L="$P -d wb -f sql/03_giochi.sql -f sql/04_memoria_round.sql -f sql/05_numeri.sql -f sql/06_colore_parola.sql -f sql/07_refactor_giochi.sql -f sql/08_intruso.sql -f sql/09_rimuovi_intruso.sql -f sql/10_riflessi.sql -f sql/11_riflessi_babbo.sql -f sql/12_anagramma.sql"
  echo "--- 02 ancora valido dopo 12 ---";  reset_db; $L; python3 test/test_02.py
  echo "--- 04 (Memoria) ancora valido dopo 12 ---"; reset_db; $L; python3 test/test_04.py
  echo "--- 05 (Numeri) ancora valido dopo 12 ---"; reset_db; $L; python3 test/test_05.py
  echo "--- 06 (Colore della parola) ancora valido dopo 12 ---"; reset_db; $L; python3 test/test_06.py
  echo "--- 09 (rimozione intruso) ancora valido dopo 12 ---"; reset_db; $L; python3 test/test_09.py
  echo "--- 11 (Riflessi Babbo/Schiacciami) ancora valido dopo 12 ---"; reset_db; $L; python3 test/test_11.py
  echo "--- test 12 (Anagramma) ---"; reset_db; $L; python3 test/test_12.py
  echo "--- 12 rilanciato due volte: nessun errore ---"
  $P -d wb -f sql/12_anagramma.sql && echo ok
fi
if [ -f sql/13_anagramma_parole.sql ]; then
  L="$P -d wb -f sql/03_giochi.sql -f sql/04_memoria_round.sql -f sql/05_numeri.sql -f sql/06_colore_parola.sql -f sql/07_refactor_giochi.sql -f sql/08_intruso.sql -f sql/09_rimuovi_intruso.sql -f sql/10_riflessi.sql -f sql/11_riflessi_babbo.sql -f sql/12_anagramma.sql -f sql/13_anagramma_parole.sql"
  echo "--- test 12 (Anagramma) ancora valido dopo 13 (più parole) ---"; reset_db; $L; python3 test/test_12.py
  echo "--- 13 rilanciato due volte: nessun errore ---"
  $P -d wb -f sql/13_anagramma_parole.sql && echo ok
fi
if [ -f sql/14_luce.sql ]; then
  L="$P -d wb -f sql/03_giochi.sql -f sql/04_memoria_round.sql -f sql/05_numeri.sql -f sql/06_colore_parola.sql -f sql/07_refactor_giochi.sql -f sql/08_intruso.sql -f sql/09_rimuovi_intruso.sql -f sql/10_riflessi.sql -f sql/11_riflessi_babbo.sql -f sql/12_anagramma.sql -f sql/13_anagramma_parole.sql -f sql/14_luce.sql"
  echo "--- 02 ancora valido dopo 14 ---";  reset_db; $L; python3 test/test_02.py
  echo "--- 04 (Memoria) ancora valido dopo 14 ---"; reset_db; $L; python3 test/test_04.py
  echo "--- 05 (Numeri) ancora valido dopo 14 ---"; reset_db; $L; python3 test/test_05.py
  echo "--- 06 (Colore della parola) ancora valido dopo 14 ---"; reset_db; $L; python3 test/test_06.py
  echo "--- 09 (rimozione intruso) ancora valido dopo 14 ---"; reset_db; $L; python3 test/test_09.py
  echo "--- 11 (Riflessi Babbo/Schiacciami) ancora valido dopo 14 ---"; reset_db; $L; python3 test/test_11.py
  echo "--- test 12 (Anagramma) ancora valido dopo 14 ---"; reset_db; $L; python3 test/test_12.py
  echo "--- test 14 (Accendi la luce) ---"; reset_db; $L; python3 test/test_14.py
  echo "--- 14 rilanciato due volte: nessun errore ---"
  $P -d wb -f sql/14_luce.sql && echo ok
fi
if [ -f sql/15_qr.sql ]; then
  L="$P -d wb -f sql/03_giochi.sql -f sql/04_memoria_round.sql -f sql/05_numeri.sql -f sql/06_colore_parola.sql -f sql/07_refactor_giochi.sql -f sql/08_intruso.sql -f sql/09_rimuovi_intruso.sql -f sql/10_riflessi.sql -f sql/11_riflessi_babbo.sql -f sql/12_anagramma.sql -f sql/13_anagramma_parole.sql -f sql/14_luce.sql -f sql/15_qr.sql"
  echo "--- 02 ancora valido dopo 15 ---";  reset_db; $L; python3 test/test_02.py
  echo "--- 04 (Memoria) ancora valido dopo 15 ---"; reset_db; $L; python3 test/test_04.py
  echo "--- 05 (Numeri) ancora valido dopo 15 ---"; reset_db; $L; python3 test/test_05.py
  echo "--- 06 (Colore della parola) ancora valido dopo 15 ---"; reset_db; $L; python3 test/test_06.py
  echo "--- 09 (rimozione intruso) ancora valido dopo 15 ---"; reset_db; $L; python3 test/test_09.py
  echo "--- 11 (Riflessi Babbo/Schiacciami) ancora valido dopo 15 ---"; reset_db; $L; python3 test/test_11.py
  echo "--- test 12 (Anagramma) ancora valido dopo 15 ---"; reset_db; $L; python3 test/test_12.py
  echo "--- test 14 (Accendi la luce) ancora valido dopo 15 ---"; reset_db; $L; python3 test/test_14.py
  echo "--- test 15 (QR o codice a barre) ---"; reset_db; $L; python3 test/test_15.py
  echo "--- 15 rilanciato due volte: nessun errore ---"
  $P -d wb -f sql/15_qr.sql && echo ok
fi
if [ -f sql/16_caccia_colori.sql ]; then
  L="$P -d wb -f sql/03_giochi.sql -f sql/04_memoria_round.sql -f sql/05_numeri.sql -f sql/06_colore_parola.sql -f sql/07_refactor_giochi.sql -f sql/08_intruso.sql -f sql/09_rimuovi_intruso.sql -f sql/10_riflessi.sql -f sql/11_riflessi_babbo.sql -f sql/12_anagramma.sql -f sql/13_anagramma_parole.sql -f sql/14_luce.sql -f sql/15_qr.sql -f sql/16_caccia_colori.sql"
  echo "--- 02 ancora valido dopo 16 ---";  reset_db; $L; python3 test/test_02.py
  echo "--- 04 (Memoria) ancora valido dopo 16 ---"; reset_db; $L; python3 test/test_04.py
  echo "--- 05 (Numeri) ancora valido dopo 16 ---"; reset_db; $L; python3 test/test_05.py
  echo "--- 06 (Colore della parola) ancora valido dopo 16 ---"; reset_db; $L; python3 test/test_06.py
  echo "--- 09 (rimozione intruso) ancora valido dopo 16 ---"; reset_db; $L; python3 test/test_09.py
  echo "--- 11 (Riflessi Babbo/Schiacciami) ancora valido dopo 16 ---"; reset_db; $L; python3 test/test_11.py
  echo "--- test 12 (Anagramma) ancora valido dopo 16 ---"; reset_db; $L; python3 test/test_12.py
  echo "--- test 14 (Accendi la luce) ancora valido dopo 16 ---"; reset_db; $L; python3 test/test_14.py
  echo "--- test 15 (QR o codice a barre) ancora valido dopo 16 ---"; reset_db; $L; python3 test/test_15.py
  echo "--- test 16 (Caccia ai colori) ---"; reset_db; $L; python3 test/test_16.py
  echo "--- 16 rilanciato due volte: nessun errore ---"
  $P -d wb -f sql/16_caccia_colori.sql && echo ok
fi
if [ -f sql/17_oggetto.sql ]; then
  L="$P -d wb -f sql/03_giochi.sql -f sql/04_memoria_round.sql -f sql/05_numeri.sql -f sql/06_colore_parola.sql -f sql/07_refactor_giochi.sql -f sql/08_intruso.sql -f sql/09_rimuovi_intruso.sql -f sql/10_riflessi.sql -f sql/11_riflessi_babbo.sql -f sql/12_anagramma.sql -f sql/13_anagramma_parole.sql -f sql/14_luce.sql -f sql/15_qr.sql -f sql/16_caccia_colori.sql -f sql/17_oggetto.sql"
  echo "--- 02 ancora valido dopo 17 ---";  reset_db; $L; python3 test/test_02.py
  echo "--- 04 (Memoria) ancora valido dopo 17 ---"; reset_db; $L; python3 test/test_04.py
  echo "--- 05 (Numeri) ancora valido dopo 17 ---"; reset_db; $L; python3 test/test_05.py
  echo "--- 06 (Colore della parola) ancora valido dopo 17 ---"; reset_db; $L; python3 test/test_06.py
  echo "--- 09 (rimozione intruso) ancora valido dopo 17 ---"; reset_db; $L; python3 test/test_09.py
  echo "--- 11 (Riflessi Babbo/Schiacciami) ancora valido dopo 17 ---"; reset_db; $L; python3 test/test_11.py
  echo "--- test 12 (Anagramma) ancora valido dopo 17 ---"; reset_db; $L; python3 test/test_12.py
  echo "--- test 14 (Accendi la luce) ancora valido dopo 17 ---"; reset_db; $L; python3 test/test_14.py
  echo "--- test 15 (QR o codice a barre) ancora valido dopo 17 ---"; reset_db; $L; python3 test/test_15.py
  echo "--- test 16 (Caccia ai colori) ancora valido dopo 17 ---"; reset_db; $L; python3 test/test_16.py
  echo "--- test 17 (Trova l'oggetto) ---"; reset_db; $L; python3 test/test_17.py
  echo "--- 17 rilanciato due volte: nessun errore ---"
  $P -d wb -f sql/17_oggetto.sql && echo ok
fi
if [ -f sql/18_occhi_aperti.sql ]; then
  L="$P -d wb -f sql/03_giochi.sql -f sql/04_memoria_round.sql -f sql/05_numeri.sql -f sql/06_colore_parola.sql -f sql/07_refactor_giochi.sql -f sql/08_intruso.sql -f sql/09_rimuovi_intruso.sql -f sql/10_riflessi.sql -f sql/11_riflessi_babbo.sql -f sql/12_anagramma.sql -f sql/13_anagramma_parole.sql -f sql/14_luce.sql -f sql/15_qr.sql -f sql/16_caccia_colori.sql -f sql/17_oggetto.sql -f sql/18_occhi_aperti.sql"
  echo "--- 02 ancora valido dopo 18 ---";  reset_db; $L; python3 test/test_02.py
  echo "--- 04 (Memoria) ancora valido dopo 18 ---"; reset_db; $L; python3 test/test_04.py
  echo "--- 05 (Numeri) ancora valido dopo 18 ---"; reset_db; $L; python3 test/test_05.py
  echo "--- 06 (Colore della parola) ancora valido dopo 18 ---"; reset_db; $L; python3 test/test_06.py
  echo "--- 09 (rimozione intruso) ancora valido dopo 18 ---"; reset_db; $L; python3 test/test_09.py
  echo "--- 11 (Riflessi Babbo/Schiacciami) ancora valido dopo 18 ---"; reset_db; $L; python3 test/test_11.py
  echo "--- test 12 (Anagramma) ancora valido dopo 18 ---"; reset_db; $L; python3 test/test_12.py
  echo "--- test 14 (Accendi la luce) ancora valido dopo 18 ---"; reset_db; $L; python3 test/test_14.py
  echo "--- test 15 (QR o codice a barre) ancora valido dopo 18 ---"; reset_db; $L; python3 test/test_15.py
  echo "--- test 16 (Caccia ai colori) ancora valido dopo 18 ---"; reset_db; $L; python3 test/test_16.py
  echo "--- test 17 (Trova l'oggetto) ancora valido dopo 18 ---"; reset_db; $L; python3 test/test_17.py
  echo "--- test 18 (Occhi aperti) ---"; reset_db; $L; python3 test/test_18.py
  echo "--- 18 rilanciato due volte: nessun errore ---"
  $P -d wb -f sql/18_occhi_aperti.sql && echo ok
fi
