"""Test del passo 3.2 (Numeri in ordine) su Postgres locale che simula Supabase.
Richiede DB con 00 + 01..05 caricati."""
import json

from _lib import admin, as_user, check, clock, cur, expect_error, jrpc, report, rpc


def ans(p, **extra):
    """risposta giusta: posizione di 1, 2, ... 25"""
    d = p["disposizione"]
    return {"tocchi": [d.index(n) for n in range(1, 26)], **extra}

admin()
cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('b@x.it') returning id"); B = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('c@x.it') returning id"); C = str(cur.fetchone()[0])
cur.execute("insert into public.couples (created_by) values (%s) returning id", (A,)); CP = cur.fetchone()[0]
cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-09-20 09:00+02'),(%s,%s,'2026-09-20 09:00+02')", (CP, A, CP, B))

# --- parametri ---------------------------------------------------------------
clock("2026-09-20 10:00"); as_user(C)
check("beta_list: memoria e numeri pronti", {"memoria", "numeri"} <= {g["codice"] for g in rpc("beta_list")["giochi"] if g["pronto"]}, True)
g = rpc("beta_start", "numeri"); p = g["parametri"]
check("beta_start ok", (g["ok"], g["nome"]), (True, "Numeri in ordine"))
check("parametri: gioco numeri, lato 5", (p["gioco"], p["lato"]), ("numeri", 5))
D = p["disposizione"]
check("disposizione: 1..25 una volta sola", sorted(D), list(range(1, 26)))
check("disposizione mescolata", D != list(range(1, 26)), True)
check("diversa a ogni partita", rpc("beta_start", "numeri")["parametri"]["disposizione"] != D, True)
check("memoria ancora a round dopo il 05", rpc("beta_start", "memoria")["parametri"]["round"], 5)

# --- controllo risposta --------------------------------------------------------
bc = lambda a, pp=p, code="numeri": jrpc("beta_check", code, pp, a)["corretto"]
R = ans(p)["tocchi"]
check("giusta", bc(ans(p)), True)
check("giusta con errori (campo extra)", bc(ans(p, errori=4)), True)
check("giusta con posizioni scritte 3.0", bc({"tocchi": [float(x) for x in R]}), True)
sw = R[:]; sw[3], sw[4] = sw[4], sw[3]
check("4 e 5 scambiati", bc({"tocchi": sw}), False)
check("solo 24 tocchi", bc({"tocchi": R[:24]}), False)
check("26 tocchi", bc({"tocchi": R + [R[0]]}), False)
check("primo ripetuto", bc({"tocchi": [R[0]] * 25}), False)
check("posizione 25 (fuori griglia)", bc({"tocchi": R[:24] + [25]}), False)
check("posizione negativa", bc({"tocchi": [-1] + R[1:]}), False)
check("posizione decimale", bc({"tocchi": [R[0] + 0.5] + R[1:]}), False)
check("posizione testo", bc({"tocchi": [str(R[0])] + R[1:]}), False)
check("posizione null", bc({"tocchi": [None] + R[1:]}), False)
check("ordine 0..24 (non la disposizione)", bc({"tocchi": list(range(25))}), D == list(range(1, 26)))
check("tocchi come testo", bc({"tocchi": "x"}), False)
check("risposta null", bc(None), False)
check("risposta vuota {}", bc({}), False)
check("risposta lista", bc(R), False)
check("formato memoria", bc({"inizio": 0, "sequenze": [[0, 1, 2]]}), False)
check("params senza disposizione", bc(ans(p), {"gioco": "numeri"}), False)
check("params disposizione corta", bc(ans(p), {"disposizione": D[:24]}), False)
check("params disposizione di testi", bc(ans(p), {"disposizione": [str(x) for x in D]}), False)
check("risposta numeri su gioco memoria", bc(ans(p), p, "memoria"), False)
check("gioco sconosciuto", bc(ans(p), p, "barcode"), False)
admin()
cur.execute("select public.wb_check_answer('numeri', null, null) is null, public.wb_check_answer('numeri', %s::jsonb, '{}') is null", (json.dumps(p),))
check("mai NULL", cur.fetchone(), (False, False))

# --- sfida vera ------------------------------------------------------------------
cur.execute("update public.challenge_types set enabled = (code = 'numeri'), game_live = (code = 'numeri')")
clock("2026-09-20 10:00")
as_user(A); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(B); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])

clock("2026-09-21 07:00:40"); as_user(A)
t = rpc("get_today"); ch = t["io"]["challenge"]; pa = ch["parametri"]
check("lun: challenge numeri col gioco", (ch["codice"], ch["nome"], pa["lato"], len(pa["disposizione"])), ("numeri", "Numeri in ordine", 5, 25))
check("lun: Fatto semplice rifiutato", rpc("complete_challenge")["error"], "serve_il_gioco")
check("lun: risposta 0..24 rifiutata", jrpc("complete_game", {"tocchi": list(range(25))})["error"] if pa["disposizione"] != list(range(1, 26)) else "risposta_sbagliata", "risposta_sbagliata")
check("lun: risposta vuota rifiutata", jrpc("complete_game", {})["error"], "risposta_sbagliata")
check("lun: ancora in corso", rpc("get_today")["io"]["stato"], "in_corso")
clock("2026-09-21 07:00:52.3")
r = jrpc("complete_game", ans(pa, errori=2))
check("lun: giusta -> 52,3 s dalla sveglia", (r["ok"], r["secondi"]), (True, 52.3))
check("lun: di nuovo -> gia_fatto", jrpc("complete_game", ans(pa))["error"], "gia_fatto")
clock("2026-09-21 07:31:00"); as_user(B)
check("lun: B stessa disposizione", rpc("get_today")["io"]["challenge"]["parametri"]["disposizione"], pa["disposizione"])
clock("2026-09-21 07:35:00.1")
check("lun: B oltre 5 min", jrpc("complete_game", ans(pa))["error"], "tempo_scaduto")

# giornata già creata con Memoria (prima di attivare numeri): resta Memoria e si controlla
admin()
cur.execute("update public.challenge_types set game_live = true where code = 'memoria'")
mp = {"gioco": "memoria", "simboli": 9, "mostra_ms": 3000, "round": 1, "lunghezza": 3, "sequenze": [[0, 1, 2], [3, 4, 5]]}
cur.execute("insert into public.couple_days (couple_id, day, challenge, params) values (%s, '2026-09-22', 'memoria', %s)", (CP, json.dumps(mp)))
clock("2026-09-22 07:00:30"); as_user(A)
check("mar (memoria): numeri non vale", jrpc("complete_game", ans(pa))["error"], "risposta_sbagliata")
check("mar (memoria): giusta", jrpc("complete_game", {"inizio": 1, "sequenze": [[3, 4, 5]]})["secondi"], 30.0)

# --- sicurezza ---------------------------------------------------------------------
as_user(A)
expect_error("client non chiama wb_game_params", "select public.wb_game_params('numeri')")
expect_error("client non chiama wb_check_answer", "select public.wb_check_answer('numeri', '{}', '{}')")
as_user(None)
expect_error("anonimo non chiama beta_start", "select public.beta_start('numeri')")

report()
