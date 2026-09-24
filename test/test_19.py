"""Test del passo 3.12 (Esercizi) su Postgres locale che simula Supabase.
Richiede DB con 00 + 01..19 caricati. Sesto (e ultimo) gioco con fotocamera,
FRONTALE come "Occhi aperti": NESSUNA analisi reale, il server non riceve né
verifica se l'esercizio è stato fatto davvero, solo la conferma {fatto:true}
(come "luce"/"qr"/"caccia_colori"/"oggetto"/"occhi"). Novità di questo gioco:
- l'esercizio estratto (uno tra i 4) non è mai uguale all'ultimo assegnato
  alla stessa coppia (wb_gp_esercizi legge couple_days);
- il video (save_exercise_video, UNA stringa come save_eye_video) resta
  visibile per 48 ORE PIENE dalla registrazione, non solo "oggi": get_today
  lo mostra anche il giorno di gioco successivo, e il video del partner è
  gated sulla chiusura della SUA giornata di ripresa (non su "oggi")."""
import json

from _lib import admin, as_user, check, clock, cur, expect_error, jrpc, report, rpc

admin()
cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('b@x.it') returning id"); B = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('c@x.it') returning id"); C = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('e@x.it') returning id"); E = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('f@x.it') returning id"); F = str(cur.fetchone()[0])
cur.execute("insert into public.couples (created_by) values (%s) returning id", (A,)); CP = cur.fetchone()[0]
cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-09-20 09:00+02'),(%s,%s,'2026-09-20 09:00+02')", (CP, A, CP, B))
cur.execute("insert into public.couples (created_by) values (%s) returning id", (E,)); CP2 = cur.fetchone()[0]
cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-09-20 09:00+02'),(%s,%s,'2026-09-20 09:00+02')", (CP2, E, CP2, F))

ESERCIZI = {"piegamenti_10", "squat_20", "affondi_20", "plank_30"}


def video(tag="a", n=100):
    return "data:video/webm;base64," + ("X" + tag) * n


# --- parametri ---------------------------------------------------------------
clock("2026-09-20 10:00"); as_user(C)
check("beta_list: tutti gli 11 giochi pronti",
      {"memoria", "numeri", "colore_parola", "riflessi", "anagramma", "luce", "qr",
       "caccia_colori", "oggetto", "occhi", "esercizi"} <=
      {g["codice"] for g in rpc("beta_list")["giochi"] if g["pronto"]}, True)
g = rpc("beta_start", "esercizi"); p = g["parametri"]
check("beta_start ok", (g["ok"], g["nome"]), (True, "Esercizi"))
check("parametri: gioco, esercizio valido, secondi_max",
      p["gioco"] == "esercizi" and p["esercizio"] in ESERCIZI and p["secondi_max"] == 180, True)
check("occhi ancora {gioco:occhi, secondi:10} dopo il 19", rpc("beta_start", "occhi")["parametri"], {"gioco": "occhi", "secondi": 10})
check("oggetto ancora 15 oggetti dopo il 19", rpc("beta_start", "oggetto")["parametri"]["oggetti"], 15)
check("caccia_colori ancora 4 colori dopo il 19", rpc("beta_start", "caccia_colori")["parametri"]["colori"], 4)
check("qr ancora {gioco:qr} dopo il 19", rpc("beta_start", "qr")["parametri"], {"gioco": "qr"})
check("luce ancora {gioco:luce} dopo il 19", rpc("beta_start", "luce")["parametri"], {"gioco": "luce"})
check("memoria ancora a round dopo il 19", rpc("beta_start", "memoria")["parametri"]["round"], 5)
check("numeri ancora 5x5 dopo il 19", len(rpc("beta_start", "numeri")["parametri"]["disposizione"]), 25)
check("colore_parola ancora 10 turni dopo il 19", rpc("beta_start", "colore_parola")["parametri"]["turni"], 10)
check("riflessi ancora 5 round dopo il 19", rpc("beta_start", "riflessi")["parametri"]["round"], 5)
check("anagramma ancora 5 parole dopo il 19", rpc("beta_start", "anagramma")["parametri"]["parole"], 5)

# senza coppia (utente C, mai unito): niente storico, pick libero tra i 4
picks_c = {rpc("beta_start", "esercizi")["parametri"]["esercizio"] for _ in range(8)}
check("senza coppia: i pick restano dentro i 4 validi", picks_c <= ESERCIZI, True)

# --- controllo risposta --------------------------------------------------------
bc = lambda a, pp=p, code="esercizi": jrpc("beta_check", code, pp, a)["corretto"]
check("giusta (fatto:true)", bc({"fatto": True}), True)
check("giusta con extra ignorato (il video non passa di qui)", bc({"fatto": True, "video": video()}), True)
check("fatto:false", bc({"fatto": False}), False)
check("fatto stringa 'true'", bc({"fatto": "true"}), False)
check("fatto numero 1", bc({"fatto": 1}), False)
check("fatto null", bc({"fatto": None}), False)
check("senza fatto", bc({}), False)
check("risposta null intera", bc(None), False)
check("risposta lista", bc([True]), False)
check("formato anagramma", bc({"tentativo": 0, "risposte": []}), False)
check("formato numeri", bc({"tocchi": list(range(25))}), False)
check("params con contenuto diverso ignorato (nessun segreto da verificare)", bc({"fatto": True}, {"gioco": "esercizi", "esercizio": "plank_30", "secondi_max": 999}), True)
check("risposta esercizi su gioco memoria", bc({"fatto": True}, p, "memoria"), False)
check("risposta esercizi su gioco riflessi", bc({"fatto": True}, p, "riflessi"), False)
check("risposta esercizi su gioco occhi (stessa forma {fatto:true}, nessun segreto da distinguere)", bc({"fatto": True}, p, "occhi"), True)
check("risposta esercizi su gioco oggetto (stessa forma {fatto:true}, nessun segreto da distinguere)", bc({"fatto": True}, p, "oggetto"), True)
check("gioco sconosciuto", bc({"fatto": True}, p, "barcode"), False)
admin()
cur.execute("select public.wb_check_answer('esercizi', null, null) is null, public.wb_check_answer('esercizi', %s::jsonb, '{}') is null, public.wb_check_answer('esercizi', %s::jsonb, '{\"fatto\": null}') is null", (json.dumps(p), json.dumps(p)))
check("mai NULL", cur.fetchone(), (False, False, False))

# --- save_exercise_video: validazione (limite 34.000.000 byte, non 3.000.000
# come occhi). Con l'utente C (mai unito a nessuna coppia, non usato più
# avanti): il video del 48h/get_today si basa solo su "entro 48 ore",
# nessun confronto col giorno della challenge, quindi qui non deve
# sporcare la cronologia di A/B usata più avanti per quello.
as_user(C)
check("stringa senza prefisso data:video/ rifiutata", rpc("save_exercise_video", "ciao")["error"], "video_non_valido")
check("prefisso data:image/ (non video) rifiutato", rpc("save_exercise_video", "data:image/jpeg;base64,x")["error"], "video_non_valido")
check("null rifiutato", rpc("save_exercise_video", None)["error"], "video_non_valido")
check("video da 3 MB (limite di occhi) qui accettato: limite più alto", rpc("save_exercise_video", "data:video/webm;base64," + ("A" * 3000000))["ok"], True)
check("video troppo grande (>34.000.000 byte) rifiutato", rpc("save_exercise_video", "data:video/webm;base64," + ("A" * 34000000))["error"], "video_non_valido")
check("video valido accettato", rpc("save_exercise_video", video("ok"))["ok"], True)
as_user(None)
expect_error("anonimo non chiama save_exercise_video", "select public.save_exercise_video('data:video/webm;base64,x')")

# --- esercizio mai uguale all'ultimo assegnato alla coppia (couple E/F, dedicata) ---
admin()
cur.execute("update public.challenge_types set enabled = (code = 'esercizi'), game_live = (code = 'esercizi')")
as_user(E); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(F); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])
giorni = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28"]  # lun-ven + lun succ.
picks = []
for d in giorni:
    clock(d + " 07:00:05"); as_user(E)
    t = rpc("get_today")
    picks.append(t["io"]["challenge"]["parametri"]["esercizio"])
check("ogni pick è uno dei 4 validi", set(picks) <= ESERCIZI, True)
for i in range(1, len(picks)):
    check(f"{giorni[i]}: esercizio diverso da quello del {giorni[i-1]}", picks[i] != picks[i - 1], True)

# --- sfida vera (coppia A/B): tempo si ferma al tocco di "Fine registrazione"
# (qui simulato: il video arriva SEPARATO dal Fatto, come da DECISIONI.md),
# video proprio subito visibile, partner solo a giornata chiusa ---
admin()
cur.execute("update public.challenge_types set enabled = (code = 'esercizi'), game_live = (code = 'esercizi')")
clock("2026-09-20 10:00")
as_user(A); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(B); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])

clock("2026-09-21 07:00:40"); as_user(A)
t = rpc("get_today"); ch = t["io"]["challenge"]; pa = ch["parametri"]
check("lun: challenge esercizi col gioco", (ch["codice"], ch["nome"], pa["gioco"], pa["secondi_max"]), ("esercizi", "Esercizi", "esercizi", 180))
check("lun: niente video_esercizi prima del Fatto", rpc("get_today")["io"]["video_esercizi"], None)
check("lun: Fatto semplice rifiutato", rpc("complete_challenge")["error"], "serve_il_gioco")
check("lun: risposta vuota rifiutata", jrpc("complete_game", {})["error"], "risposta_sbagliata")
clock("2026-09-21 07:01:00.5")
r = jrpc("complete_game", {"fatto": True})
check("lun: giusta -> 60,5 s dalla sveglia (il tempo si è fermato al tocco di Fine registrazione)", (r["ok"], r["secondi"]), (True, 60.5))

clock("2026-09-21 07:01:05")
VA = video("a")
check("lun: A salva il suo video (può arrivare anche dopo il Fatto)", rpc("save_exercise_video", VA)["ok"], True)
t = rpc("get_today")
check("lun: A vede il suo video subito (giornata non chiusa)", (t["chiuso"], t["io"]["video_esercizi"]), (False, VA))
check("lun: video del partner nascosto (giornata non chiusa)", t["partner"]["video_esercizi"], None)
check("lun: sovrascrive, non accumula", rpc("save_exercise_video", video("z"))["ok"], True)
check("lun: get_today mostra solo l'ultimo salvataggio", rpc("get_today")["io"]["video_esercizi"], video("z"))
rpc("save_exercise_video", VA)   # ripristina per il resto del test

clock("2026-09-21 07:31:20.2"); as_user(B)
check("lun: B stessa challenge", rpc("get_today")["io"]["challenge"]["parametri"], pa)
r = jrpc("complete_game", {"fatto": True})
check("lun: B giusta -> 80,2 s dalla sveglia", (r["ok"], r["secondi"]), (True, 80.2))
VB = video("b")
check("lun: B salva il suo video", rpc("save_exercise_video", VB)["ok"], True)
t = rpc("get_today")
check("lun: giornata chiusa (entrambi hanno finito)", t["chiuso"], True)
check("lun: B vede il suo video", t["io"]["video_esercizi"], VB)
check("lun: B vede ora anche quello di A", t["partner"]["video_esercizi"], VA)
as_user(A)
check("lun: A vede ora anche quello di B", rpc("get_today")["partner"]["video_esercizi"], VB)

# --- A DIFFERENZA di "Occhi aperti": NON sparisce col cambio di giornata di
# gioco, resta visibile (a entrambi, non solo al proprietario) finché siamo
# entro 48 ore piene dalla registrazione ---
clock("2026-09-22 07:00:05"); as_user(B)
t = rpc("get_today")
check("mar, ancora entro 48h: B vede ancora il proprio video di lunedì", t["io"]["video_esercizi"], VB)
check("mar, ancora entro 48h: B vede ancora quello di A (la giornata di lunedì resta chiusa)", t["partner"]["video_esercizi"], VA)
as_user(A)
check("mar, ancora entro 48h: A vede ancora entrambi i video", (rpc("get_today")["io"]["video_esercizi"], rpc("get_today")["partner"]["video_esercizi"]), (VA, VB))

# --- scadenza a 48 ore piene dalla registrazione (VA salvato lun 07:01:05,
# VB lun 07:31:20.2): oltre quel limite get_today non li mostra più, ma la
# riga resta in tabella (nessun cron) finché lo stesso utente non registra
# di nuovo (pulizia solo allora, come eye_videos/object_photos) ---
clock("2026-09-23 07:01:00"); as_user(A)   # pochi secondi PRIMA delle 48h di VA
check("mer, appena prima delle 48h: A vede ancora il proprio video", rpc("get_today")["io"]["video_esercizi"], VA)
clock("2026-09-23 07:01:06"); as_user(A)   # appena DOPO le 48h di VA
check("mer, appena dopo le 48h: il video di A non è più mostrato", rpc("get_today")["io"]["video_esercizi"], None)
admin()
cur.execute("select count(*) from public.exercise_videos where user_id = %s and day = '2026-09-21'", (A,))
check("la riga di lunedì (A) è ancora in tabella (nessun cron dedicato)", cur.fetchone()[0], 1)

as_user(B)
clock("2026-09-23 07:31:00")   # meno di 48h dopo il salvataggio di lunedì di B (07:31:20.2)
check("mer: B vede ancora il proprio video (appena prima delle 48h)", rpc("get_today")["io"]["video_esercizi"], VB)
check("registrazione a <48h dal salvataggio di lunedì: quella riga non viene ancora ripulita", rpc("save_exercise_video", video("presto"))["ok"], True)
admin()
cur.execute("select count(*) from public.exercise_videos where user_id = %s and day = '2026-09-21'", (B,))
check("registrazione a <48h dal salvataggio di lunedì: quella riga non viene ancora ripulita", cur.fetchone()[0], 1)

as_user(B)
clock("2026-09-23 07:31:21")   # più di 48h dopo il salvataggio di lunedì di B
check("altra registrazione di mercoledì", rpc("save_exercise_video", video("tardi"))["ok"], True)
admin()
cur.execute("select count(*) from public.exercise_videos where user_id = %s and day = '2026-09-21'", (B,))
check("registrazione a >48h dal salvataggio di lunedì: quella riga viene ripulita", cur.fetchone()[0], 0)

# giornate già create con altri giochi: il dispatcher li riconosce ancora
admin()
cur.execute("update public.challenge_types set game_live = true where code in ('memoria', 'numeri', 'colore_parola', 'riflessi', 'anagramma', 'luce', 'qr', 'caccia_colori', 'oggetto', 'occhi')")
np_ = {"gioco": "numeri", "lato": 5, "disposizione": list(range(25, 0, -1))}
cur.execute("insert into public.couple_days (couple_id, day, challenge, params) values (%s, '2026-09-24', 'numeri', %s)", (CP, json.dumps(np_)))
clock("2026-09-24 07:00:10"); as_user(A)
check("gio (numeri): esercizi non vale", jrpc("complete_game", {"fatto": True})["error"], "risposta_sbagliata")
check("gio (numeri): giusta", jrpc("complete_game", {"tocchi": list(range(24, -1, -1))})["secondi"], 10.0)

# --- sicurezza ---------------------------------------------------------------------
as_user(A)
expect_error("client non chiama wb_gp_esercizi", "select public.wb_gp_esercizi()")
expect_error("client non chiama wb_ca_esercizi", "select public.wb_ca_esercizi('{}', '{}')")
expect_error("client non chiama wb_game_params", "select public.wb_game_params('esercizi')")
expect_error("client non chiama wb_check_answer", "select public.wb_check_answer('esercizi', '{}', '{}')")
expect_error("client non legge exercise_videos direttamente", "select * from public.exercise_videos")
as_user(None)
expect_error("anonimo non chiama beta_start", "select public.beta_start('esercizi')")

report()
