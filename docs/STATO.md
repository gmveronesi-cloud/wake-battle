# Wake Battle — Stato lavori (aggiornato 23/09/2026)

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
| QR/barcode, luce, caccia ai colori, occhi aperti, trova l'oggetto | da fare | — | — |
| Esercizi (video) | da fare | — | — |

**PROSSIMO passo (nuova chat): il prossimo gioco dalla lista** — o uno dei "fisici" (QR/barcode, luce, caccia ai colori, occhi aperti, trova l'oggetto: richiedono fotocamera, da verificare sul telefono) oppure Esercizi (video registrato nell'app).

## Da fare ora (Gianmarco)
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
- Avvio: `sh test/setup.sh && sh test/tutti.sh` (~3 min).
- SQL: test_02 (83), test_03 (63, DB senza 04), test_04 (53, rilanciato anche dopo 05/06/07/09/11/12), test_05 (45, rilanciato dopo 06/07/09/11/12), test_06 (61, rilanciato dopo 07/09/11/12), test_09 (11, rimozione Trova l'intruso, rilanciato dopo 11/12), test_11 (46, Riflessi "Babbo/Schiacciami", rilanciato dopo 12), test_12 (52, Anagramma); run.sh. prep_db.sh carica 01..03 + tutti i sql/0N_… presenti (`senza04` si ferma al 03). Boilerplate comune (connessione, orologio finto, ruoli, rpc/jrpc, contatori) in test/_lib.py. test_10.py/ui_test_10.js (prima versione di Riflessi) eliminati: sostituiti dall'11, stesso trattamento riservato a test_08/ui_test_08 quando è sparito Trova l'intruso.
- UI: ui_test (33), ui_test_03 (43), ui_test_04 (34), ui_test_05 (27), ui_test_06 (32), ui_test_11 (22, Riflessi "Babbo/Schiacciami"), ui_test_12 (23, Anagramma); tutti.sh prende da solo ogni ui_test_0N.js.
- Anagramma: solo 40 tentativi generati (non 200 come gli altri giochi), perché con lettere per esteso (non numeri) 200 supererebbero il limite di 20000 byte di beta_check/complete_game; qui va bene perché un errore non consuma un tentativo (tentativi illimitati sulla stessa parola).
- Orologio finto: wb_now legge 'wb.fake_now'.

## Poi
- Giochi con fotocamera: verifica sul telefono, librerie incluse nel sito (niente CDN; CSP da aggiornare se servono worker/wasm/blob).
- Esercizi: video nell'app (bassa risoluzione, max 50 MB), tempo fermato a "Fine registrazione", visibile solo alla coppia, cancellato dopo 48 h.
- Passo 4 — Comandi iOS (sveglie di controllo, comando "WB Fatto", automazione serale).
