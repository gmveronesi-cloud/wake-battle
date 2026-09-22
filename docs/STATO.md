# Wake Battle — Stato lavori (aggiornato 22/09/2026, notte — v6)

## Metodo di lavoro (dal 22/09/2026)
- Una chat per gioco, aperta da https://claude.ai/code col repository gmveronesi-cloud/wake-battle collegato; prompt in docs/PROMPT_GIOCO.md.
- Documenti di riferimento NEL REPO: docs/STATO.md e docs/DECISIONI.md (DECISIONI prevale). Claude li aggiorna e fa commit + push su main: GitHub Pages si aggiorna da solo.
- Gianmarco fa solo: eseguire in Supabase il nuovo file sql/, provare in beta, eseguire la riga di attivazione.
- L'ambiente di Claude NON raggiunge *.supabase.co e non usa il browser. Mai chiedere/salvare segreti (niente token nella chat).
- Da fare (Gianmarco), se non già fatto: cambiare la password del database; cancellare il token GitHub `wake-battle-claude` (erano stati scritti in chat).

## Passo 3.2 — Numeri in ordine (CHIUSO 22/09: online v5, 05 eseguito su Supabase, attivato nella sfida)
- Regole in DECISIONI.md (griglia 5×5 coperta fino a "Inizia", errore = lampeggio rosso senza penalità, al 25 invio automatico).
- SQL: `sql/05_numeri.sql` (da eseguire UNA volta in Supabase; rilanciarlo non fa danni). Sostituisce solo wb_game_params e wb_check_answer, con dentro Memoria a round (04) + Memoria vecchia (03) + numeri. Mai NULL.
  - Params {gioco:'numeri', lato:5, disposizione:[1..25 mescolati]}; risposta {tocchi:[25 posizioni], errori} (errori ignorato dal server).
- App v5: games.js (numeri; classe casella fatta = `preso`, NON `done`: `button.done` è già usato in style.css), style.css (.num-grid/.num-cell, colonne minmax(0,1fr) sennò la griglia si allarga), beta.js (mostra "errori: N"), app.js riga 2 v5, index.html/beta.html ?v=5.
- Attivato: `update public.challenge_types set game_live = true where code = 'numeri';` (false per tornare al "Fatto").

## PROSSIMO: Passo 3.4 — Trova l'intruso (file sql/07_..., ui_test_07, test_07, versione v7)

## Passo 3.3 — Colore della parola (v6 pronta nel repo, 22/09 notte)
- Da fare (Gianmarco): eseguire `sql/06_colore_parola.sql` in Supabase, provare in beta, attivare: `update public.challenge_types set game_live = true where code = 'colore_parola';` (false per tornare al "Fatto").
- Regole in DECISIONI.md (6 colori, 10 turni, errore → da capo con parole nuove, nessun limite per turno).
- SQL 06: sostituisce solo wb_game_params e wb_check_answer, con dentro Numeri (05) + Memoria a round (04) + Memoria vecchia (03) + colore_parola. Mai NULL. Rilanciarlo non fa danni.
- App v6: games.js (colore_parola; classi solo `cp-*`: cp-word, cp-ink0..5, cp-keys, cp-key, cp-wrong, cp-dots, cp-ok, cp-now), style.css, app.js riga 2 v6, index.html/beta.html ?v=6. beta.js invariato nel codice (mostra già "tentativi: N").
- test_05 ora accetta altri giochi pronti oltre a memoria e numeri.

## Passo 3.1b — Memoria a round (v4 online dal 22/09 01:45)
- Da confermare da Gianmarco: 04 eseguito su Supabase, prova in beta, attivazione (`update public.challenge_types set game_live = true where code = 'memoria';`).
- SQL `sql/04_memoria_round.sql`: params {gioco:'memoria', simboli:9, mostra_ms:3000, round:5, lunghezza:3, sequenze:[200×3]}; risposta {inizio, sequenze:[5], tentativi}. Giornate col formato vecchio (03, senza "round") ancora controllate come {tentativo, sequenza}. Corretto buco del 03 (risposta {} accettata).
- In beta il cronometro parte da "Prova"; nella sfida dalla sveglia (scritte chiare in entrambe).

## Passo 3.1 — struttura giochi (03_giochi.sql eseguito; non rilanciare)
- challenge_types.game_live (default false): true = gioco vero con risposta controllata dal server; false = pulsante "Fatto".
- Interne: wb_game_params(code) (null = non pronto), wb_check_answer(code, params, answer), wb_challenge_params, wb_complete.
- RPC: complete_challenge() (errore serve_il_gioco se il giorno ha un gioco), complete_game(p_answer jsonb) (nessun_gioco, risposta_sbagliata…), beta_list(), beta_start(p_code), beta_check(p_code, p_params, p_answer) — la beta non salva nulla.
- Il giorno già creato prima dell'attivazione resta com'era.
- games.js: WBGames.has / mount → {destroy, retry}; beta.html + beta.js (link dal Profilo); in Oggi il gioco sostituisce il Fatto; cambio scheda non ricomincia; risposta rifiutata → retry().
- Ordine giochi: memoria ✓, numeri ✓, colore della parola ✓, intruso, riflessi, anagramma; poi QR, luce, caccia ai colori, occhi aperti, trova l'oggetto; infine esercizi con video.

## Passi 1–2 (FUNZIONANTI online; SQL 01 e 02 eseguiti, non rilanciare)
- Supabase free `wake-battle`, URL `https://rxxqdseojllcniowrzxm.supabase.co`, regione EU. Accesso email + OTP 6 cifre (SMTP Gmail wakebattle.gianmarco@gmail.com, template con {{ .Token }}).
- 01: profiles, couples, couple_members, pairing_codes, pairing_attempts (RLS); RPC create_pairing_code, join_couple, leave_couple, my_couple_id. Codice coppia 6 caratteri, 10 min, monouso, max 5 tentativi/15 min.
- 02: challenge_types (12, colonna enabled), alarm_settings, player_days, couple_days, weekly_prizes (nessun accesso diretto). RPC set_alarm, get_settings, get_today, complete_challenge, get_week, get_history, set_prize. Niente job: tutto calcolato alla lettura. Cronometro ufficiale dal server.
- Frontend: GitHub Pages `https://gmveronesi-cloud.github.io/wake-battle/`, repo pubblico `gmveronesi-cloud/wake-battle` (radice: index.html, beta.html, style.css, app.js, beta.js, games.js, config.js, vendor/supabase.js 2.116). CSP restrittiva; testi utente solo via textContent.
- 2c prova reale con sveglia su due iPhone — da confermare.

## Lezioni pratiche
- A OGNI aggiornamento di app.js/games.js/beta.js/style.css: aumentare ?v= in index.html E beta.html e la riga 2 di app.js.
- Controllo versione online: `.../wake-battle/app.js?v=N`, riga 2. Dopo il push aspettare il deploy verde (Actions), aprire con Cmd+Shift+R o scheda privata.
- SQL: confronto con campo jsonb mancante = NULL e "not NULL" non respinge → sempre coalesce(..., false).
- CSS: non riusare nomi di classe già globali (es. `button.done`).

## Test (cartella `test/`)
- Avvio: `sh test/setup.sh && sh test/tutti.sh` (~3 min).
- SQL: test_02 (83), test_03 (63, DB senza 04), test_04 (53, rilanciato anche dopo 05 e 06), test_05 (45, rilanciato dopo il 06), test_06 (61); run.sh. prep_db.sh carica 01..03 + tutti i sql/04_… 05_… presenti (`senza04` si ferma al 03).
- UI: ui_test (33), ui_test_03 (43), ui_test_04 (34), ui_test_05 (27), ui_test_06 (28); tutti.sh prende da solo ogni ui_test_0N.js.
- Orologio finto: wb_now legge 'wb.fake_now'.

## Poi
- Giochi con fotocamera: verifica sul telefono, librerie incluse nel sito (niente CDN; CSP da aggiornare se servono worker/wasm/blob).
- Esercizi: video nell'app (bassa risoluzione, max 50 MB), tempo fermato a "Fine registrazione", visibile solo alla coppia, cancellato dopo 48 h.
- Passo 4 — Comandi iOS (sveglie di controllo, comando "WB Fatto", automazione serale).
