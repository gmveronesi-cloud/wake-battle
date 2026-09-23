"""Test del passo 3.8 (QR o codice a barre) su Postgres locale che simula Supabase.
Richiede DB con 00 + 01..15 caricati. Secondo gioco con fotocamera: il server
non riceve né verifica il codice reale letto, solo la conferma {fatto:true}."""
import json

from _lib import admin, as_user, check, clock, cur, expect_error, jrpc, report, rpc

admin()
cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('b@x.it') returning id"); B = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('c@x.it') returning id"); C = str(cur.fetchone()[0])
cur.execute("insert into public.couples (created_by) values (%s) returning id", (A,)); CP = cur.fetchone()[0]
cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-09-20 09:00+02'),(%s,%s,'2026-09-20 09:00+02')", (CP, A, CP, B))

# --- parametri ---------------------------------------------------------------
clock("2026-09-20 10:00"); as_user(C)
check("beta_list: tutti i 7 giochi pronti",
      {"memoria", "numeri", "colore_parola", "riflessi", "anagramma", "luce", "qr"} <= {g["codice"] for g in rpc("beta_list")["giochi"] if g["pronto"]}, True)
g = rpc("beta_start", "qr"); p = g["parametri"]
check("beta_start ok", (g["ok"], g["nome"]), (True, "QR o codice a barre"))
check("parametri: solo gioco", p, {"gioco": "qr"})
check("stessi parametri a ogni partita (nessun dato da generare)", rpc("beta_start", "qr")["parametri"], p)
check("luce ancora {gioco:luce} dopo il 15", rpc("beta_start", "luce")["parametri"], {"gioco": "luce"})
check("memoria ancora a round dopo il 15", rpc("beta_start", "memoria")["parametri"]["round"], 5)
check("numeri ancora 5x5 dopo il 15", len(rpc("beta_start", "numeri")["parametri"]["disposizione"]), 25)
check("colore_parola ancora 10 turni dopo il 15", rpc("beta_start", "colore_parola")["parametri"]["turni"], 10)
check("riflessi ancora 5 round dopo il 15", rpc("beta_start", "riflessi")["parametri"]["round"], 5)
check("anagramma ancora 5 parole dopo il 15", rpc("beta_start", "anagramma")["parametri"]["parole"], 5)

# --- controllo risposta --------------------------------------------------------
bc = lambda a, pp=p, code="qr": jrpc("beta_check", code, pp, a)["corretto"]
check("giusta (fatto:true)", bc({"fatto": True}), True)
check("giusta con extra ignorato", bc({"fatto": True, "testo": "https://esempio.it"}), True)
check("fatto:false", bc({"fatto": False}), False)
check("fatto stringa 'true'", bc({"fatto": "true"}), False)
check("fatto numero 1", bc({"fatto": 1}), False)
check("fatto null", bc({"fatto": None}), False)
check("senza fatto", bc({}), False)
check("risposta null intera", bc(None), False)
check("risposta lista", bc([True]), False)
check("formato anagramma", bc({"tentativo": 0, "risposte": []}), False)
check("formato numeri", bc({"tocchi": list(range(25))}), False)
check("params con contenuto diverso ignorato (nessun segreto da verificare)", bc({"fatto": True}, {"gioco": "qr", "extra": [1, 2]}), True)
check("risposta qr su gioco memoria", bc({"fatto": True}, p, "memoria"), False)
check("risposta qr su gioco riflessi", bc({"fatto": True}, p, "riflessi"), False)
check("risposta qr su gioco luce (stessa forma {fatto:true}, nessun segreto da distinguere)", bc({"fatto": True}, p, "luce"), True)
check("gioco sconosciuto", bc({"fatto": True}, p, "barcode"), False)
admin()
cur.execute("select public.wb_check_answer('qr', null, null) is null, public.wb_check_answer('qr', %s::jsonb, '{}') is null, public.wb_check_answer('qr', %s::jsonb, '{\"fatto\": null}') is null", (json.dumps(p), json.dumps(p)))
check("mai NULL", cur.fetchone(), (False, False, False))

# --- sfida vera ------------------------------------------------------------------
cur.execute("update public.challenge_types set enabled = (code = 'qr'), game_live = (code = 'qr')")
clock("2026-09-20 10:00")
as_user(A); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(B); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])

clock("2026-09-21 07:00:40"); as_user(A)
t = rpc("get_today"); ch = t["io"]["challenge"]; pa = ch["parametri"]
check("lun: challenge qr col gioco", (ch["codice"], ch["nome"], pa), ("qr", "QR o codice a barre", {"gioco": "qr"}))
check("lun: Fatto semplice rifiutato", rpc("complete_challenge")["error"], "serve_il_gioco")
check("lun: risposta vuota rifiutata", jrpc("complete_game", {})["error"], "risposta_sbagliata")
check("lun: fatto:false rifiutato", jrpc("complete_game", {"fatto": False})["error"], "risposta_sbagliata")
check("lun: ancora in corso", rpc("get_today")["io"]["stato"], "in_corso")
clock("2026-09-21 07:00:03.2")
r = jrpc("complete_game", {"fatto": True})
check("lun: giusta -> 3,2 s dalla sveglia", (r["ok"], r["secondi"]), (True, 3.2))
check("lun: di nuovo -> gia_fatto", jrpc("complete_game", {"fatto": True})["error"], "gia_fatto")
clock("2026-09-21 07:31:00"); as_user(B)
check("lun: B stessa challenge", rpc("get_today")["io"]["challenge"]["parametri"], pa)
clock("2026-09-21 07:35:00.1")
check("lun: B oltre 5 min", jrpc("complete_game", {"fatto": True})["error"], "tempo_scaduto")

# giornate già create con altri giochi: il dispatcher li riconosce ancora
admin()
cur.execute("update public.challenge_types set game_live = true where code in ('memoria', 'numeri', 'colore_parola', 'riflessi', 'anagramma', 'luce')")
np_ = {"gioco": "numeri", "lato": 5, "disposizione": list(range(25, 0, -1))}
cur.execute("insert into public.couple_days (couple_id, day, challenge, params) values (%s, '2026-09-22', 'numeri', %s)", (CP, json.dumps(np_)))
clock("2026-09-22 07:00:10"); as_user(A)
check("mar (numeri): qr non vale", jrpc("complete_game", {"fatto": True})["error"], "risposta_sbagliata")
check("mar (numeri): giusta", jrpc("complete_game", {"tocchi": list(range(24, -1, -1))})["secondi"], 10.0)

# --- sicurezza ---------------------------------------------------------------------
as_user(A)
expect_error("client non chiama wb_gp_qr", "select public.wb_gp_qr()")
expect_error("client non chiama wb_ca_qr", "select public.wb_ca_qr('{}', '{}')")
expect_error("client non chiama wb_game_params", "select public.wb_game_params('qr')")
expect_error("client non chiama wb_check_answer", "select public.wb_check_answer('qr', '{}', '{}')")
as_user(None)
expect_error("anonimo non chiama beta_start", "select public.beta_start('qr')")

report()
