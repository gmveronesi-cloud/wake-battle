# Wake Battle — Storico dei passi chiusi

Log dei passi completati, tenuto separato da STATO.md (che ora contiene solo lo stato corrente).
Le regole di gioco restano SOLO in DECISIONI.md: qui si racconta solo cosa è stato fatto e quando.

## Passo 3.7b — Accendi la luce: taratura dopo prova reale (v15, 23/09)
- Dopo la prima prova sul telefono: soglia troppo bassa e rilevazione istantanea (5 frame, ~0,6 s) facevano passare il gioco troppo facilmente. Solo modifica lato client (games.js), nessun nuovo file SQL: `LUCE_SOGLIA` 120 → 200 (su 255) e `LUCE_FRAME_OK` (conteggio frame) sostituito da `LUCE_MS_MIN` = 10000 ms mantenuti SENZA INTERRUZIONI (tempo reale con `Date.now()`, non conteggio di frame: basta un frame sotto soglia per azzerare il conto). La barra mostra anche il countdown dei secondi mancanti mentre si è sopra soglia.
- Test: video finto `test/fixtures/luce.y4m` rigenerato (buio 2 s + luce forte 12 s, invece di 2+2 s) per coprire i nuovi 10 s richiesti; ui_test_14 aggiunge un controllo che il completamento non sia istantaneo (>= ~9 s dall'avvio) e che compaia il countdown "tieni ferma per altri N s".
- Bug trovato girando tutti.sh per intero: i flag della fotocamera finta erano globali in ui_lib.js `start()` (attivi per OGNI test, anche quelli senza fotocamera) e rallentavano/alteravano i timer interni di Chromium abbastanza da far scadere per timeout i tempi stretti di Riflessi (rivelazione "mostra" di 400 ms) quando ui_test_11 girava dopo altri test nella stessa sessione — riproducibile in sequenza, non un flake casuale. Corretto: `start()` accetta ora `{camera:true}` e i flag si attivano SOLO per ui_test_14 (unico test che usa la fotocamera).

## Passo 3.7 — Accendi la luce (v14 pronta nel repo, 23/09, primo gioco con fotocamera)
- Regole tecniche mancanti in DECISIONI.md (soglia, tempi, errori, verifica server) chieste e decise in questa chat: video nascosto (niente feed live, solo barra del livello), soglia fissa 120/255 su 5 frame di fila, nessun timeout dedicato (vale il limite dei 5 minuti), nessun dato reale del sensore verificato dal server.
- games.js: aggiunte funzioni GENERICHE riusabili da tutti i giochi con fotocamera — `cameraLoop()` (cattura un frame ogni tot ms su un canvas interno) e `cameraGame()` (permesso, video nascosto, barra, gestione errori/retry) — separate e commentate rispetto alla parte SPECIFICA di "luce" (`grayAvg()`, soglia, frame consecutivi). I prossimi giochi con fotocamera (QR, Caccia ai colori, Occhi aperti, Trova l'oggetto) riusano `cameraGame()` cambiando solo `onFrame`.
- SQL 14: solo wb_gp_luce/wb_ca_luce + riga nei dispatcher (pattern del 07). Params `{gioco:'luce'}` (niente da generare), risposta `{fatto:true}`: il server non può verificare cosa inquadra davvero la fotocamera, quindi controlla solo la forma della risposta.
- Test: test_14.py (41 controlli) + ui_test_14.js (16 controlli, beta + permesso negato + sfida vera). Prima volta con una fotocamera "finta" in Chromium per i test UI: flag `--use-fake-device-for-media-stream`/`--use-file-for-fake-video-capture` in ui_lib.js `start()` con un video generato a mano (`test/fixtures/luce.y4m`, 2 s buio poi 2 s luce, in loop); il permesso negato si testa iniettando un `getUserMedia` che rifiuta in un contesto a parte.
- style.css: classe `.cam-bar` (riusa `.bar`/`.game-bar`) per la barra del livello, pensata comune a tutti i giochi con fotocamera.

## Passo 3.3 — Colore della parola (v7 pronta nel repo, 22/09)
- v7: ordine dei 6 pulsanti mescolato a ogni turno (keyOrder in games.js, deterministico dai parametri: uguale per la coppia, nessun SQL nuovo; data-ordine sul box per i test).
- SQL 06: sostituiva wb_game_params/wb_check_answer con dentro Numeri (05) + Memoria a round (04) + Memoria vecchia (03) + colore_parola. Superato dal 07 (refactor a dispatcher): stesso comportamento, un file a parte per gioco.
- test_05 da qui in poi accetta altri giochi pronti oltre a memoria e numeri.

## Refactor 07 — wb_game_params/wb_check_answer a dispatcher (22/09)
- Da 03 a 06 ogni nuovo gioco ricopiava per intero il codice dei giochi precedenti dentro le due funzioni: rischio di copiare male un pezzo vecchio.
- sql/07_refactor_giochi.sql: una funzione per gioco (wb_gp_<gioco>/wb_ca_<gioco>), i due dispatcher aggiungono solo una riga per gioco nuovo. Nessuna regola cambiata: verificato dalle stesse suite di test (02, 04, 05, 06) rilanciate dopo il 07.
- Consolidati anche i test Python: boilerplate comune (connessione, orologio finto, ruoli, rpc/jrpc, contatori) spostato in test/_lib.py, importato da test_02..06.py.
- Rimosso da test/ui_lib.js un vecchio fallback per una struttura a cartella `web/` non più esistente nel repo.

## Passo 3.2 — Numeri in ordine (CHIUSO 22/09: online v5, 05 eseguito su Supabase, attivato nella sfida)
- SQL: sql/05_numeri.sql. App v5: games.js (classe casella fatta = `preso`, NON `done`), style.css (.num-grid/.num-cell), beta.js (mostra "errori: N"), app.js riga 2 v5, index.html/beta.html ?v=5.
- Attivato: `update public.challenge_types set game_live = true where code = 'numeri';`

## Passo 3.1b — Memoria a round (v4 online dal 22/09 01:45)
- SQL sql/04_memoria_round.sql: params {gioco:'memoria', simboli:9, mostra_ms:3000, round:5, lunghezza:3, sequenze:[200×3]}; risposta {inizio, sequenze:[5], tentativi}. Giornate col formato vecchio (03, senza "round") ancora controllate come {tentativo, sequenza}. Corretto buco del 03 (risposta {} accettata).
- In beta il cronometro parte da "Prova"; nella sfida dalla sveglia.

## Passo 3.1 — struttura giochi (03_giochi.sql eseguito; non rilanciare)
- challenge_types.game_live (default false): true = gioco vero con risposta controllata dal server; false = pulsante "Fatto".
- Interne: wb_game_params(code) (null = non pronto), wb_check_answer(code, params, answer), wb_challenge_params, wb_complete.
- RPC: complete_challenge() (errore serve_il_gioco se il giorno ha un gioco), complete_game(p_answer jsonb) (nessun_gioco, risposta_sbagliata…), beta_list(), beta_start(p_code), beta_check(p_code, p_params, p_answer) — la beta non salva nulla.
- Il giorno già creato prima dell'attivazione resta com'era.
- games.js: WBGames.has / mount → {destroy, retry}; beta.html + beta.js (link dal Profilo); in Oggi il gioco sostituisce il Fatto; cambio scheda non ricomincia; risposta rifiutata → retry().

## Passi 1–2 (FUNZIONANTI online; SQL 01 e 02 eseguiti, non rilanciare)
- Supabase free `wake-battle`, URL `https://rxxqdseojllcniowrzxm.supabase.co`, regione EU. Accesso email + OTP 6 cifre (SMTP Gmail wakebattle.gianmarco@gmail.com, template con {{ .Token }}).
- 01: profiles, couples, couple_members, pairing_codes, pairing_attempts (RLS); RPC create_pairing_code, join_couple, leave_couple, my_couple_id. Codice coppia 6 caratteri, 10 min, monouso, max 5 tentativi/15 min.
- 02: challenge_types (12, colonna enabled), alarm_settings, player_days, couple_days, weekly_prizes (nessun accesso diretto). RPC set_alarm, get_settings, get_today, complete_challenge, get_week, get_history, set_prize. Niente job: tutto calcolato alla lettura. Cronometro ufficiale dal server.
- Frontend: GitHub Pages `https://gmveronesi-cloud.github.io/wake-battle/`, repo pubblico `gmveronesi-cloud/wake-battle` (radice: index.html, beta.html, style.css, app.js, beta.js, games.js, config.js, vendor/supabase.js 2.116). CSP restrittiva; testi utente solo via textContent.
- 2c prova reale con sveglia su due iPhone — da confermare.
