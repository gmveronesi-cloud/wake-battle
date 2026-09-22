"""Test del passo 3.5 (Riflessi) su Postgres locale che simula Supabase.
Richiede DB con 00 + 01..10 caricati."""
import json

from _lib import admin, as_user, check, clock, cur, expect_error, jrpc, report, rpc


def ans(inizio=0, errori=0, tempi=None):
    """risposta corretta in forma: usate = errori + 5 tempi >= 0."""
    return {"inizio": inizio, "usate": errori + 5, "tempi": tempi or [100, 120, 90, 150, 110], "errori": errori}


admin()
cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('b@x.it') returning id"); B = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('c@x.it') returning id"); C = str(cur.fetchone()[0])
cur.execute("insert into public.couples (created_by) values (%s) returning id", (A,)); CP = cur.fetchone()[0]
cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-09-20 09:00+02'),(%s,%s,'2026-09-20 09:00+02')", (CP, A, CP, B))

# --- parametri ---------------------------------------------------------------
clock("2026-09-20 10:00"); as_user(C)
check("beta_list: memoria, numeri, colore_parola, riflessi pronti",
      {"memoria", "numeri", "colore_parola", "riflessi"} <= {g["codice"] for g in rpc("beta_list")["giochi"] if g["pronto"]}, True)
g = rpc("beta_start", "riflessi"); p = g["parametri"]
check("beta_start ok", (g["ok"], g["nome"]), (True, "Riflessi"))
check("parametri: gioco, 5 volte, 1000 attese", (p["gioco"], p["volte"], len(p["attese"])), ("riflessi", 5, 1000))
check("attese tra 1000 e 4000 ms", all(1000 <= a <= 4000 for a in p["attese"]), True)
check("attese non tutte uguali", len(set(p["attese"])) > 100, True)
check("diverse a ogni partita", rpc("beta_start", "riflessi")["parametri"]["attese"] != p["attese"], True)
check("memoria ancora a round dopo il 10", rpc("beta_start", "memoria")["parametri"]["round"], 5)
check("numeri ancora 5x5 dopo il 10", len(rpc("beta_start", "numeri")["parametri"]["disposizione"]), 25)
check("colore_parola ancora 10 turni dopo il 10", rpc("beta_start", "colore_parola")["parametri"]["turni"], 10)

# --- controllo risposta --------------------------------------------------------
bc = lambda a, pp=p, code="riflessi": jrpc("beta_check", code, pp, a)["corretto"]
check("giusta, nessun anticipo (inizio 0)", bc(ans()), True)
check("giusta con 2 anticipi (inizio 3)", bc(ans(inizio=3, errori=2)), True)
check("giusta all'ultimo posto utile (inizio 995)", bc(ans(inizio=995)), True)
check("inizio 996: sfora le 1000 attese", bc(ans(inizio=996)), False)
check("inizio 0.0 (numero intero come float)", bc({"inizio": 0.0, "usate": 5, "tempi": [1, 2, 3, 4, 5], "errori": 0}), True)
check("tempi scritti come float", bc({"inizio": 0, "usate": 5, "tempi": [1.0, 2.0, 3.0, 4.0, 5.0], "errori": 0}), True)
check("usate non coerente con errori (6 invece di 5)", bc({"inizio": 0, "usate": 6, "tempi": [1, 2, 3, 4, 5], "errori": 0}), False)
check("errori negativo", bc({"inizio": 0, "usate": 4, "tempi": [1, 2, 3, 4, 5], "errori": -1}), False)
check("inizio negativo", bc(ans(inizio=-1)), False)
check("inizio decimale", bc({"inizio": 0.5, "usate": 5, "tempi": [1, 2, 3, 4, 5], "errori": 0}), False)
check("inizio testo", bc({"inizio": "0", "usate": 5, "tempi": [1, 2, 3, 4, 5], "errori": 0}), False)
check("solo 4 tempi", bc({"inizio": 0, "usate": 5, "tempi": [1, 2, 3, 4], "errori": 0}), False)
check("6 tempi", bc({"inizio": 0, "usate": 5, "tempi": [1, 2, 3, 4, 5, 6], "errori": 0}), False)
check("tempo negativo", bc({"inizio": 0, "usate": 5, "tempi": [1, 2, 3, 4, -1], "errori": 0}), False)
check("tempo testo", bc({"inizio": 0, "usate": 5, "tempi": [1, 2, 3, 4, "5"], "errori": 0}), False)
check("tempo null", bc({"inizio": 0, "usate": 5, "tempi": [1, 2, 3, 4, None], "errori": 0}), False)
check("senza inizio", bc({"usate": 5, "tempi": [1, 2, 3, 4, 5], "errori": 0}), False)
check("senza usate", bc({"inizio": 0, "tempi": [1, 2, 3, 4, 5], "errori": 0}), False)
check("senza errori", bc({"inizio": 0, "usate": 5, "tempi": [1, 2, 3, 4, 5]}), False)
check("senza tempi", bc({"inizio": 0, "usate": 5, "errori": 0}), False)
check("tempi come testo", bc({"inizio": 0, "usate": 5, "tempi": "x", "errori": 0}), False)
check("risposta null intera", bc(None), False)
check("risposta vuota {}", bc({}), False)
check("risposta lista", bc([1, 2, 3, 4, 5]), False)
check("formato numeri", bc({"tocchi": list(range(25))}), False)
check("formato colore_parola", bc({"tentativo": 0, "risposte": [0, 1, 2, 3, 4, 5, 0, 1, 2, 3]}), False)
check("params senza attese", bc(ans(), {"gioco": "riflessi", "volte": 5}), False)
check("params attese corta", bc(ans(inizio=0, errori=0), {"volte": 5, "attese": p["attese"][:4]}), False)
check("risposta riflessi su gioco memoria", bc(ans(), p, "memoria"), False)
check("risposta riflessi su gioco numeri", bc(ans(), p, "numeri"), False)
check("gioco sconosciuto", bc(ans(), p, "qr"), False)
admin()
cur.execute("select public.wb_check_answer('riflessi', null, null) is null, public.wb_check_answer('riflessi', %s::jsonb, '{}') is null, public.wb_check_answer('riflessi', %s::jsonb, '{\"inizio\": 0, \"usate\": 5, \"errori\": 0, \"tempi\": [null,1,2,3,4]}') is null", (json.dumps(p), json.dumps(p)))
check("mai NULL", cur.fetchone(), (False, False, False))

# --- sfida vera ------------------------------------------------------------------
cur.execute("update public.challenge_types set enabled = (code = 'riflessi'), game_live = (code = 'riflessi')")
clock("2026-09-20 10:00")
as_user(A); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(B); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])

clock("2026-09-21 07:00:40"); as_user(A)
t = rpc("get_today"); ch = t["io"]["challenge"]; pa = ch["parametri"]
check("lun: challenge riflessi col gioco", (ch["codice"], ch["nome"], pa["volte"], len(pa["attese"])), ("riflessi", "Riflessi", 5, 1000))
check("lun: Fatto semplice rifiutato", rpc("complete_challenge")["error"], "serve_il_gioco")
check("lun: risposta con soli 3 tempi rifiutata", jrpc("complete_game", {"inizio": 0, "usate": 5, "tempi": [1, 2, 3], "errori": 0})["error"], "risposta_sbagliata")
check("lun: risposta vuota rifiutata", jrpc("complete_game", {})["error"], "risposta_sbagliata")
check("lun: ancora in corso", rpc("get_today")["io"]["stato"], "in_corso")
clock("2026-09-21 07:00:47.6")
r = jrpc("complete_game", ans(inizio=0, errori=2))
check("lun: giusta con 2 anticipi -> 47,6 s dalla sveglia", (r["ok"], r["secondi"]), (True, 47.6))
check("lun: di nuovo -> gia_fatto", jrpc("complete_game", ans())["error"], "gia_fatto")
clock("2026-09-21 07:31:00"); as_user(B)
check("lun: B stesse attese", rpc("get_today")["io"]["challenge"]["parametri"]["attese"], pa["attese"])
clock("2026-09-21 07:35:00.1")
check("lun: B oltre 5 min", jrpc("complete_game", ans())["error"], "tempo_scaduto")

# giornate già create con altri giochi: il dispatcher li riconosce ancora
admin()
cur.execute("update public.challenge_types set game_live = true where code in ('memoria', 'numeri', 'colore_parola')")
np_ = {"gioco": "numeri", "lato": 5, "disposizione": list(range(25, 0, -1))}
cur.execute("insert into public.couple_days (couple_id, day, challenge, params) values (%s, '2026-09-22', 'numeri', %s)", (CP, json.dumps(np_)))
clock("2026-09-22 07:00:10"); as_user(A)
check("mar (numeri): riflessi non vale", jrpc("complete_game", ans())["error"], "risposta_sbagliata")
check("mar (numeri): giusta", jrpc("complete_game", {"tocchi": list(range(24, -1, -1))})["secondi"], 10.0)

# --- sicurezza ---------------------------------------------------------------------
as_user(A)
expect_error("client non chiama wb_gp_riflessi", "select public.wb_gp_riflessi()")
expect_error("client non chiama wb_ca_riflessi", "select public.wb_ca_riflessi('{}', '{}')")
expect_error("client non chiama wb_game_params", "select public.wb_game_params('riflessi')")
expect_error("client non chiama wb_check_answer", "select public.wb_check_answer('riflessi', '{}', '{}')")
as_user(None)
expect_error("anonimo non chiama beta_start", "select public.beta_start('riflessi')")

report()
