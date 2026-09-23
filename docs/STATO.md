# Wake Battle — Stato lavori (aggiornato 23/09/2026, sera)

Stato corrente dei giochi e prossimi passi. Il log dei passi chiusi è in docs/STORICO.md.
Le regole di gioco sono SOLO in docs/DECISIONI.md (prevale su tutto): qui non ripeterle, solo lo stato.

## Metodo di lavoro
- Una chat per gioco, aperta da https://claude.ai/code col repository gmveronesi-cloud/wake-battle collegato; prompt in docs/PROMPT_GIOCO.md.
- Documenti di riferimento NEL REPO: docs/STATO.md e docs/DECISIONI.md (DECISIONI prevale). Claude li aggiorna e fa commit + push: GitHub Pages si aggiorna da solo dal branch main.
- Gianmarco fa solo: eseguire in Supabase il nuovo file sql/, provare in beta, eseguire la riga di attivazione.
- L'ambiente di Claude NON raggiunge *.supabase.co e non usa il browser. Mai chiedere/salvare segreti (niente token nella chat).
- Da fare (Gianmarco), se non già fatto: cambiare la password del database; cancellare il token GitHub `wake-battle-claude` (erano stati scritti in chat).

## Stato dei giochi (vedi DECISIONI.md per le regole)
| Gioco | App (repo) | SQL da eseguire su Supabase | Attivo nella sfida |
|---|---|---|---|
| Memoria | ✓ | eseguito | ✓ |
| Numeri in ordine | ✓ | eseguito | ✓ |
| Colore della parola | ✓ (v7) | 06 eseguito; **sql/07_refactor_giochi.sql** ancora da eseguire (facoltativo, vedi sotto) | ✓ (già attivata da Gianmarco col 06) |
| Riflessi | ✓ (v11, "Babbo/Schiacciami") | 10 eseguito (versione vecchia, superata); **sql/11_riflessi_babbo.sql** da eseguire | da attivare dopo la prova in beta |
| Anagramma | ✓ (v12) | **sql/12_anagramma.sql** e **sql/13_anagramma_parole.sql** da eseguire | da attivare dopo la prova in beta |
| Accendi la luce | ✓ (v16, rilevazione a punto di luce concentrato) | **sql/14_luce.sql** da eseguire (nessun nuovo file: le tarature sono solo lato client) | da attivare dopo la prova in beta (riverificare su telefono vero: vedi sotto) |
| QR o codice a barre | ✓ (v17, secondo gioco con fotocamera, libreria ZXing vendorizzata) | **sql/15_qr.sql** da eseguire | da attivare dopo la prova in beta |
| Caccia ai colori, occhi aperti, trova l'oggetto | da fare | — | — |
| Esercizi (video) | da fare | — | — |

**PROSSIMO passo (nuova chat): il prossimo gioco dalla lista** — uno degli altri "fisici" con fotocamera (caccia ai colori, occhi aperti, trova l'oggetto: riusano le funzioni generiche di games.js scritte per Accendi la luce, cambia solo l'analisi del frame) oppure Esercizi (video registrato nell'app).

## Da fare ora (Gianmarco)
QR o codice a barre (nuovo, secondo gioco con fotocamera):
1. Eseguire `sql/15_qr.sql` in Supabase (richiede 01..14 già eseguiti).
2. Provare in beta il gioco "QR o codice a barre": permesso fotocamera (posteriore), NON mostra il video in diretta (solo una barra). Inquadra un QR o un codice a barre qualsiasi (un'etichetta, una confezione, qualunque cosa): appena la libreria lo legge (basta un frame, nessun tempo di attesa come "Accendi la luce") il gioco finisce da solo. Se non legge: prova ad avvicinare/allontanare finché il codice riempie bene l'inquadratura.
3. Se va bene, attivare nella sfida vera con:
   `update public.challenge_types set enabled = true, game_live = true where code = 'qr';`

Accendi la luce (primo gioco con fotocamera — 2ª taratura del 23/09: ora rileva un PUNTO di luce concentrato invece della luminosità media di tutta l'inquadratura, dopo che la media era risultata troppo esigente/imprecisa):
1. Se non ancora fatto: eseguire `sql/14_luce.sql` in Supabase (richiede 01..13 già eseguiti). Se l'avevi già eseguito le volte scorse NON serve rilanciarlo: queste tarature sono solo lato client (games.js), nessun nuovo file SQL.
2. Riprovare in beta il gioco "Accendi la luce" DA UN TELEFONO: permesso fotocamera (posteriore), NON mostra il video in diretta (solo una barra col livello rilevato). Inquadra da vicino una lampada/torcia spenta, poi accendila e tieni il punto luminoso inquadrato: la barra sale quando la fotocamera vede abbastanza pixel "bruciati" (vicini al bianco) in una zona concentrata, poi mostra il countdown dei secondi mancanti (10 s) — basta un punto di luce, non serve che tutta la stanza sia illuminata. Se in pratica non va ancora bene (troppo/poco sensibile, falsi positivi con luce ambiente, o il tempo non va bene) dimmi cosa noti nel dettaglio: soglia per pixel attuale 225/255, minimo 15 pixel, tempo 10 s.
3. Se va bene, attivare nella sfida vera con:
   `update public.challenge_types set enabled = true, game_live = true where code = 'luce';`

Anagramma (nuovo):
1. Eseguire `sql/12_anagramma.sql` e poi `sql/13_anagramma_parole.sql` in Supabase (richiede 01..11 già eseguiti; il 13 amplia la lista da 79 a 146 parole possibili, nessun'altra regola cambia).
2. Provare in beta il gioco "Anagramma": 5 parole di fila, lettere mescolate come tessere da toccare nell'ordine giusto per ricomporre la parola. Un tocco sbagliato lampeggia di rosso senza penalità: si continua sulla stessa parola (nessuna ripartenza). Parola giusta → passa da sola alla successiva.
3. Se va bene, attivare nella sfida vera con:
   `update public.challenge_types set enabled = true, game_live = true where code = 'anagramma';`

Riflessi (a Gianmarco non piaceva la prima versione, cambiata):
1. Eseguire `sql/11_riflessi_babbo.sql` in Supabase (richiede 01..10 già eseguiti, incluso il 10 che hai già lanciato: non fa danno, la nuova versione lo sostituisce).
2. Provare in beta il gioco "Riflessi": dopo un'attesa compaiono due riquadri uguali per meno di un secondo, "BABBO" e "SCHIACCIAMI!" (posizione che si alterna a ogni round), poi restano al loro posto ma vuoti. Tocca "SCHIACCIAMI!" per andare avanti; se tocchi "BABBO" si riparte dal round 1. 5 round di fila per finire.
3. Se va bene, attivare nella sfida vera con:
   `update public.challenge_types set enabled = true, game_live = true where code = 'riflessi';`

Colore della parola è già attivo nella sfida (06 eseguito e attivato prima del refactor). Resta solo, quando vuoi, facoltativo:
1. Eseguire `sql/07_refactor_giochi.sql` in Supabase: sostituisce wb_game_params/wb_check_answer con lo stesso comportamento del 06, solo riorganizzato per gioco. Non serve riprovare in beta né toccare game_live: il gioco resta attivo come già impostato, nessun'altra azione richiesta.

"Trova l'intruso" eliminato (non piace a Gianmarco): non è mai stato attivato nella sfida vera, nessun dato storico da migrare.
1. Eseguire `sql/09_rimuovi_intruso.sql` in Supabase (richiede 01..08 già eseguiti). Toglie la riga da challenge_types, rimette wb_game_params/wb_check_answer come dopo il 07 e droppa wb_gp_intruso/wb_ca_intruso. Nessuna prova in beta né altra azione richiesta.

## Refactor 22/09: un file SQL a parte per gioco
Da sql/07 in poi, wb_game_params/wb_check_answer sono dispatcher: ogni gioco ha le sue funzioni private (wb_gp_<gioco>, wb_ca_<gioco>) in un file a sé. Un gioco nuovo non ricopia più le funzioni dei giochi vecchi — solo una riga in più in ciascun dispatcher. Comportamento identico al 06, verificato dai test (dettagli in STORICO.md).

## Lezioni pratiche
- A OGNI aggiornamento di app.js/games.js/beta.js/style.css: aumentare ?v= in index.html E beta.html e la riga 2 di app.js.
- Controllo versione online: `.../wake-battle/app.js?v=N`, riga 2. Dopo il push aspettare il deploy verde (Actions), aprire con Cmd+Shift+R o scheda privata.
- SQL: confronto con campo jsonb mancante = NULL e "not NULL" non respinge → sempre coalesce(..., false).
- CSS: non riusare nomi di classe già globali (es. `button.done`).
- Un gioco nuovo aggiunge solo le sue wb_gp_<gioco>/wb_ca_<gioco> + una riga in ciascun dispatcher: non ricopiare i giochi già fatti (vedi sopra).

## Test (cartella `test/`)
- Avvio: `sh test/setup.sh && sh test/tutti.sh` (~3-4 min).
- SQL: test_02 (83), test_03 (63, DB senza 04), test_04 (53, rilanciato anche dopo 05/06/07/09/11/12/14/15), test_05 (45, rilanciato dopo 06/07/09/11/12/14/15), test_06 (61, rilanciato dopo 07/09/11/12/14/15), test_09 (11, rimozione Trova l'intruso, rilanciato dopo 11/12/14/15), test_11 (46, Riflessi "Babbo/Schiacciami", rilanciato dopo 12/14/15), test_12 (52, Anagramma, rilanciato dopo 14/15), test_14 (41, Accendi la luce, rilanciato dopo 15), test_15 (43, QR o codice a barre); run.sh. prep_db.sh carica 01..03 + tutti i sql/0N_… presenti (`senza04` si ferma al 03). Boilerplate comune (connessione, orologio finto, ruoli, rpc/jrpc, contatori) in test/_lib.py. test_10.py/ui_test_10.js (prima versione di Riflessi) eliminati: sostituiti dall'11, stesso trattamento riservato a test_08/ui_test_08 quando è sparito Trova l'intruso. Il placeholder "gioco sconosciuto" usato da test_03..test_14 era il codice 'qr' (riservato ma non ancora implementato): dal 15 è un gioco vero, quindi tutti questi test sono stati aggiornati a usare 'barcode' come placeholder.
- UI: ui_test (33), ui_test_03 (43), ui_test_04 (34), ui_test_05 (27), ui_test_06 (32), ui_test_11 (22, Riflessi "Babbo/Schiacciami"), ui_test_12 (23, Anagramma), ui_test_14 (18, Accendi la luce), ui_test_15 (15, QR o codice a barre); tutti.sh prende da solo ogni ui_test_0N.js.
- Anagramma: solo 40 tentativi generati (non 200 come gli altri giochi), perché con lettere per esteso (non numeri) 200 supererebbero il limite di 20000 byte di beta_check/complete_game; qui va bene perché un errore non consuma un tentativo (tentativi illimitati sulla stessa parola).
- Accendi la luce (primo gioco con fotocamera; rileva un PUNTO di luce concentrato — almeno 15 pixel singoli sopra 225/255, non la media di tutto il frame — mantenuto 10 s di fila; 2ª taratura il 23/09 dopo la prova reale, la 1ª con la media a 200/255 era troppo esigente): ui_test_14 chiama `start({camera:true})` per usare la fotocamera FINTA di Chromium (flag `--use-fake-device-for-media-stream`/`--use-fake-ui-for-media-stream` in ui_lib.js, SOLO per questo test: rallentano/alterano i timer interni di Chromium e rompono i tempi stretti di Riflessi se attivi per tutti, visto rompersi quando erano globali) con un video di test `test/fixtures/luce.y4m` (generato a mano: 2 s buio poi 12 s con un quadrato luminoso al centro, ~14% dell'inquadratura, resto al buio — apposta NON uniforme, per verificare che si rilevi un punto concentrato e non la media dell'intero frame — in loop, 32×32). Un controllo verifica che il completamento richieda davvero almeno ~9-10 s dall'avvio (non istantaneo). Il "permesso negato" si testa invece iniettando un `getUserMedia` che rifiuta con `ctx.addInitScript` in un contesto separato: verifica il messaggio d'errore e "Riprova".
- QR o codice a barre (secondo gioco con fotocamera; basta UNA lettura valida, nessun tempo di mantenimento): la funzione `start()` di ui_lib.js accetta ora anche `camera:'<file>.y4m'` (non solo `camera:true`) per scegliere la fixture; ui_test_15 usa `start({camera:'qr.y4m'})` con `test/fixtures/qr.y4m` (generato con lo script Python `qrcode`+Pillow: un QR 240×240 leggibile — "https://wakebattle.test/qr" — in loop, 10 frame). Verificato anche a mano (script Node con la stessa libreria ZXing di games.js) che lo stesso identico procedimento (RGBLuminanceSource + HybridBinarizer + MultiFormatReader) decodifica correttamente sia un QR sia un codice a barre Code128, anche dopo un ridimensionamento bilineare come quello del canvas del gioco: nessun fixture di codice a barre nel repo perché "uno qualsiasi" (DECISIONI.md) rende sufficiente testare un solo formato end-to-end via UI, il resto è già verificato dalla libreria stessa.
- Orologio finto: wb_now legge 'wb.fake_now'.

## Poi
- Altri giochi con fotocamera (caccia ai colori, occhi aperti, trova l'oggetto): riusano cameraLoop()/cameraGame() in games.js (funzioni generiche scritte per Accendi la luce), cambia solo la funzione di analisi del frame. Verifica sul telefono per ognuno. Libreria di decodifica QR/barcode già inclusa (vendor/zxing.js, ZXing 0.21, niente CDN, niente worker/wasm/blob: CSP invariata).
- Esercizi: video nell'app (bassa risoluzione, max 50 MB), tempo fermato a "Fine registrazione", visibile solo alla coppia, cancellato dopo 48 h.
- Passo 4 — Comandi iOS (sveglie di controllo, comando "WB Fatto", automazione serale).
