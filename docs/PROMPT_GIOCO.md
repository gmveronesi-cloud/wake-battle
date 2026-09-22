# Prompt per ogni nuovo gioco

Apri https://claude.ai/code → scegli il repository gmveronesi-cloud/wake-battle → incolla il testo qui sotto sostituendo [GIOCO].

---

Continuiamo Wake Battle: in questa chat facciamo UN solo gioco, [GIOCO].

Avvio: leggi SOLO docs/STATO.md e docs/DECISIONI.md (DECISIONI prevale su tutto), poi sh test/setup.sh e sh test/tutti.sh (devono essere verdi; se no dimmelo prima di fare altro). Leggi solo i file che ti servono (sql/ più recente, games.js, le parti di app.js/beta.js che tocchi).

Regole di lavoro:
- Se in DECISIONI mancano regole di [GIOCO] (dimensioni, tempi, errori, verifica sul server), chiedimele TUTTE in una volta con una proposta per ognuna. Se ci sono già, parti subito.
- SQL in un file NUOVO col numero successivo in sql/; non toccare quelli già eseguiti. Dal 07 in poi wb_game_params/wb_check_answer sono dispatcher: aggiungi solo le tue due funzioni wb_gp_<gioco>/wb_ca_<gioco> + una riga if in ciascun dispatcher (copiale dal file più recente e aggiungi la riga). Non ricopiare le funzioni dei giochi già fatti. Mai NULL.
- Gioco in games.js (WBGames.mount → {destroy, retry}), uguale in beta e nella sfida.
- Test nuovi: test/test_0N.py (in run.sh) + test/ui_test_0N.js. sh test/tutti.sh una volta alla fine. Screenshot tutti in un'unica immagine.
- Aumenta ?v= in index.html e beta.html e la versione alla riga 2 di app.js.
- Quando è tutto verde: aggiorna docs/STATO.md (e docs/DECISIONI.md se cambiano regole), fai commit e push direttamente su main. Niente browser, niente Supabase (quello lo faccio io).
- Poi dimmi solo: quale file SQL eseguire in Supabase, cosa provare in beta, e la riga SQL per attivare il gioco nella sfida vera.
- Risposte brevi.
