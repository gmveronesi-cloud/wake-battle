"""Test del passo 3.11 (Occhi aperti) su Postgres locale che simula Supabase.
Richiede DB con 00 + 01..18 caricati. Quinto gioco con fotocamera (frontale, le
altre usano la posteriore): NESSUNA analisi reale, il server non riceve né
verifica se gli occhi sono rimasti aperti, solo la conferma {fatto:true} (come
"luce"/"qr"/"caccia_colori"/"oggetto"). Novità: il video registrato
(save_eye_video, UNA stringa non un array) e i campi 'video' di get_today()."""
import json

from _lib import admin, as_user, check, clock, cur, expect_error, jrpc, report, rpc

admin()
cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('b@x.it') returning id"); B = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('c@x.it') returning id"); C = str(cur.fetchone()[0])
cur.execute("insert into public.couples (created_by) values (%s) returning id", (A,)); CP = cur.fetchone()[0]
cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-09-20 09:00+02'),(%s,%s,'2026-09-20 09:00+02')", (CP, A, CP, B))


def video(tag="a", n=100):
    return "data:video/webm;base64," + ("X" + tag) * n


# --- parametri ---------------------------------------------------------------
clock("2026-09-20 10:00"); as_user(C)
check("beta_list: tutti i 10 giochi pronti",
      {"memoria", "numeri", "colore_parola", "riflessi", "anagramma", "luce", "qr", "caccia_colori", "oggetto", "occhi"} <=
      {g["codice"] for g in rpc("beta_list")["giochi"] if g["pronto"]}, True)
g = rpc("beta_start", "occhi"); p = g["parametri"]
check("beta_start ok", (g["ok"], g["nome"]), (True, "Occhi aperti"))
check("parametri: gioco e secondi", p, {"gioco": "occhi", "secondi": 10})
check("stessi parametri ad ogni partita (niente da generare)", rpc("beta_start", "occhi")["parametri"], p)
check("oggetto ancora 15 oggetti dopo il 18", rpc("beta_start", "oggetto")["parametri"]["oggetti"], 15)
check("caccia_colori ancora 4 colori dopo il 18", rpc("beta_start", "caccia_colori")["parametri"]["colori"], 4)
check("qr ancora {gioco:qr} dopo il 18", rpc("beta_start", "qr")["parametri"], {"gioco": "qr"})
check("luce ancora {gioco:luce} dopo il 18", rpc("beta_start", "luce")["parametri"], {"gioco": "luce"})
check("memoria ancora a round dopo il 18", rpc("beta_start", "memoria")["parametri"]["round"], 5)
check("numeri ancora 5x5 dopo il 18", len(rpc("beta_start", "numeri")["parametri"]["disposizione"]), 25)
check("colore_parola ancora 10 turni dopo il 18", rpc("beta_start", "colore_parola")["parametri"]["turni"], 10)
check("riflessi ancora 5 round dopo il 18", rpc("beta_start", "riflessi")["parametri"]["round"], 5)
check("anagramma ancora 5 parole dopo il 18", rpc("beta_start", "anagramma")["parametri"]["parole"], 5)

# --- controllo risposta --------------------------------------------------------
bc = lambda a, pp=p, code="occhi": jrpc("beta_check", code, pp, a)["corretto"]
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
check("params con contenuto diverso ignorato (nessun segreto da verificare)", bc({"fatto": True}, {"gioco": "occhi", "secondi": 99}), True)
check("risposta occhi su gioco memoria", bc({"fatto": True}, p, "memoria"), False)
check("risposta occhi su gioco riflessi", bc({"fatto": True}, p, "riflessi"), False)
check("risposta occhi su gioco qr (stessa forma {fatto:true}, nessun segreto da distinguere)", bc({"fatto": True}, p, "qr"), True)
check("risposta occhi su gioco oggetto (stessa forma {fatto:true}, nessun segreto da distinguere)", bc({"fatto": True}, p, "oggetto"), True)
check("gioco sconosciuto", bc({"fatto": True}, p, "barcode"), False)
admin()
cur.execute("select public.wb_check_answer('occhi', null, null) is null, public.wb_check_answer('occhi', %s::jsonb, '{}') is null, public.wb_check_answer('occhi', %s::jsonb, '{\"fatto\": null}') is null", (json.dumps(p), json.dumps(p)))
check("mai NULL", cur.fetchone(), (False, False, False))

# --- save_eye_video: validazione -----------------------------------------
as_user(A)
check("stringa senza prefisso data:video/ rifiutata", rpc("save_eye_video", "ciao")["error"], "video_non_valido")
check("prefisso data:image/ (non video) rifiutato", rpc("save_eye_video", "data:image/jpeg;base64,x")["error"], "video_non_valido")
check("null rifiutato", rpc("save_eye_video", None)["error"], "video_non_valido")
check("video troppo grande rifiutato", rpc("save_eye_video", "data:video/webm;base64," + ("A" * 3000000))["error"], "video_non_valido")
check("video valido accettato", rpc("save_eye_video", video("ok"))["ok"], True)
as_user(None)
expect_error("anonimo non chiama save_eye_video", "select public.save_eye_video('data:video/webm;base64,x')")

# --- sfida vera: due giocatori, video proprio subito visibile, partner solo a giornata chiusa ---
admin()
cur.execute("update public.challenge_types set enabled = (code = 'occhi'), game_live = (code = 'occhi')")
clock("2026-09-20 10:00")
as_user(A); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(B); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])

clock("2026-09-21 07:00:40"); as_user(A)
t = rpc("get_today"); ch = t["io"]["challenge"]; pa = ch["parametri"]
check("lun: challenge occhi col gioco", (ch["codice"], ch["nome"], pa), ("occhi", "Occhi aperti", {"gioco": "occhi", "secondi": 10}))
check("lun: niente video prima del Fatto (flag)", rpc("get_today")["io"]["ha_video"], False)
check("lun: niente video prima del Fatto (RPC)", rpc("get_eye_video")["video"], None)
check("lun: Fatto semplice rifiutato", rpc("complete_challenge")["error"], "serve_il_gioco")
check("lun: risposta vuota rifiutata", jrpc("complete_game", {})["error"], "risposta_sbagliata")
clock("2026-09-21 07:01:00.5")
r = jrpc("complete_game", {"fatto": True})
check("lun: giusta -> 60,5 s dalla sveglia", (r["ok"], r["secondi"]), (True, 60.5))
VA = video("a")
check("lun: A salva il suo video", rpc("save_eye_video", VA)["ok"], True)
t = rpc("get_today")
check("lun: A vede il flag subito (giornata non chiusa)", (t["chiuso"], t["io"]["ha_video"]), (False, True))
check("lun: A scarica il suo video con la RPC", rpc("get_eye_video")["video"], VA)
check("lun: video del partner nascosto (giornata non chiusa, flag)", t["partner"]["ha_video"], False)
check("lun: video del partner non scaricabile (giornata non chiusa)", rpc("get_eye_video", True)["error"], "non_visibile")
check("lun: sovrascrive, non accumula", rpc("save_eye_video", video("z"))["ok"], True)
check("lun: get_eye_video mostra solo l'ultimo salvataggio", rpc("get_eye_video")["video"], video("z"))
rpc("save_eye_video", VA)   # ripristina per il resto del test

clock("2026-09-21 07:31:20.2"); as_user(B)
check("lun: B stessa challenge", rpc("get_today")["io"]["challenge"]["parametri"], pa)
r = jrpc("complete_game", {"fatto": True})
check("lun: B giusta -> 80,2 s dalla sveglia", (r["ok"], r["secondi"]), (True, 80.2))
VB = video("b")
check("lun: B salva il suo video", rpc("save_eye_video", VB)["ok"], True)
t = rpc("get_today")
check("lun: giornata chiusa (entrambi hanno finito)", t["chiuso"], True)
check("lun: B vede il proprio flag", t["io"]["ha_video"], True)
check("lun: B scarica il proprio video", rpc("get_eye_video")["video"], VB)
check("lun: B vede ora anche il flag di A", t["partner"]["ha_video"], True)
check("lun: B scarica ora anche il video di A", rpc("get_eye_video", True)["video"], VA)
as_user(A)
check("lun: A vede ora anche il flag di B", rpc("get_today")["partner"]["ha_video"], True)
check("lun: A scarica ora anche il video di B", rpc("get_eye_video", True)["video"], VB)

# --- spariscono col cambio di giornata (get_today mostra sempre solo "oggi");
# la riga resta in tabella (nessun cron), la ripulisce solo il prossimo
# salvataggio dello stesso utente, e solo se più vecchia di 24 ore ---
clock("2026-09-22 00:00:01"); as_user(B)
check("22/09 appena dopo mezzanotte: il video di lunedì non è più 'oggi' (flag)", rpc("get_today")["io"]["ha_video"], False)
check("22/09 appena dopo mezzanotte: la RPC non lo restituisce più", rpc("get_eye_video")["video"], None)
admin()
cur.execute("select count(*) from public.eye_videos where user_id = %s and day = '2026-09-21'", (B,))
check("la riga di lunedì è ancora in tabella (nessun cron dedicato)", cur.fetchone()[0], 1)

as_user(B)
clock("2026-09-22 07:31:00")   # meno di 24h dopo il salvataggio di lunedì (07:31:20.2)
check("registrazione di martedì", rpc("save_eye_video", video("presto"))["ok"], True)
admin()
cur.execute("select count(*) from public.eye_videos where user_id = %s and day = '2026-09-21'", (B,))
check("registrazione a <24h dal salvataggio di lunedì: quella riga non viene ancora ripulita", cur.fetchone()[0], 1)

as_user(B)
clock("2026-09-22 07:31:21")   # più di 24h dopo il salvataggio di lunedì
check("altra registrazione di martedì", rpc("save_eye_video", video("tardi"))["ok"], True)
admin()
cur.execute("select count(*) from public.eye_videos where user_id = %s and day = '2026-09-21'", (B,))
check("registrazione a >24h dal salvataggio di lunedì: quella riga viene ripulita", cur.fetchone()[0], 0)

# giornate già create con altri giochi: il dispatcher li riconosce ancora
admin()
cur.execute("update public.challenge_types set game_live = true where code in ('memoria', 'numeri', 'colore_parola', 'riflessi', 'anagramma', 'luce', 'qr', 'caccia_colori', 'oggetto')")
np_ = {"gioco": "numeri", "lato": 5, "disposizione": list(range(25, 0, -1))}
cur.execute("insert into public.couple_days (couple_id, day, challenge, params) values (%s, '2026-09-23', 'numeri', %s)", (CP, json.dumps(np_)))
clock("2026-09-23 07:00:10"); as_user(A)
check("mer (numeri): occhi non vale", jrpc("complete_game", {"fatto": True})["error"], "risposta_sbagliata")
check("mer (numeri): giusta", jrpc("complete_game", {"tocchi": list(range(24, -1, -1))})["secondi"], 10.0)

# --- sicurezza ---------------------------------------------------------------------
as_user(A)
expect_error("client non chiama wb_gp_occhi", "select public.wb_gp_occhi()")
expect_error("client non chiama wb_ca_occhi", "select public.wb_ca_occhi('{}', '{}')")
expect_error("client non chiama wb_game_params", "select public.wb_game_params('occhi')")
expect_error("client non chiama wb_check_answer", "select public.wb_check_answer('occhi', '{}', '{}')")
expect_error("client non legge eye_videos direttamente", "select * from public.eye_videos")
as_user(None)
expect_error("anonimo non chiama beta_start", "select public.beta_start('occhi')")

report()
