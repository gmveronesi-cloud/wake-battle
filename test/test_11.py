"""Test del passo 3.5b (Riflessi "Babbo/Schiacciami") su Postgres locale che
simula Supabase. Richiede DB con 00 + 01..11 caricati. Sostituisce la
meccanica di test_10.py (Riflessi v1, valido solo fino al file 10)."""
import json

from _lib import admin, as_user, check, clock, cur, expect_error, jrpc, report, rpc


def ans(k=0, **extra):
    return {"tentativo": k, **extra}


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
check("parametri: gioco, 5 round, 400 ms", (p["gioco"], p["round"], p["mostra_ms"]), ("riflessi", 5, 400))
S = p["sequenze"]
check("200 tentativi da 5 round", (len(S), all(len(s) == 5 for s in S)), (200, True))
W = [w for s in S for w in s]
check("attese tra 3000 e 6000 ms", all(3000 <= w <= 6000 for w in W), True)
check("attese non tutte uguali", len(set(W)) > 100, True)
check("diverse a ogni partita", rpc("beta_start", "riflessi")["parametri"]["sequenze"] != S, True)
check("memoria ancora a round dopo l'11", rpc("beta_start", "memoria")["parametri"]["round"], 5)
check("numeri ancora 5x5 dopo l'11", len(rpc("beta_start", "numeri")["parametri"]["disposizione"]), 25)
check("colore_parola ancora 10 turni dopo l'11", rpc("beta_start", "colore_parola")["parametri"]["turni"], 10)

# --- controllo risposta --------------------------------------------------------
bc = lambda a, pp=p, code="riflessi": jrpc("beta_check", code, pp, a)["corretto"]
check("giusta (tentativo 0)", bc(ans(0)), True)
check("giusta con tentativi (extra, ignorato)", bc(ans(7, tentativi=8)), True)
check("giusta al tentativo 199", bc(ans(199)), True)
check("tentativo 7.0", bc({"tentativo": 7.0}), True)
check("tentativo 200 (fuori)", bc(ans(200)), False)
check("tentativo negativo", bc(ans(-1)), False)
check("tentativo decimale", bc({"tentativo": 0.5}), False)
check("tentativo testo", bc({"tentativo": "0"}), False)
check("senza tentativo", bc({}), False)
check("risposta null intera", bc(None), False)
check("risposta lista", bc([0]), False)
check("formato numeri", bc({"tocchi": list(range(25))}), False)
check("formato riflessi vecchio (v1)", bc({"inizio": 0, "usate": 5, "tempi": [1, 2, 3, 4, 5], "errori": 0}), False)
check("params senza sequenze", bc(ans(0), {"gioco": "riflessi", "round": 5}), False)
check("params senza round", bc(ans(0), {"sequenze": S}), False)
check("params round 4 (risposta da 5)", bc(ans(0), {"round": 4, "sequenze": S}), False)
check("params sequenza corta", bc(ans(0), {"round": 5, "sequenze": [S[0][:4]]}), False)
check("risposta riflessi su gioco memoria", bc(ans(0), p, "memoria"), False)
check("risposta riflessi su gioco numeri", bc(ans(0), p, "numeri"), False)
check("gioco sconosciuto", bc(ans(0), p, "qr"), False)
admin()
cur.execute("select public.wb_check_answer('riflessi', null, null) is null, public.wb_check_answer('riflessi', %s::jsonb, '{}') is null, public.wb_check_answer('riflessi', %s::jsonb, '{\"tentativo\": null}') is null", (json.dumps(p), json.dumps(p)))
check("mai NULL", cur.fetchone(), (False, False, False))

# --- sfida vera ------------------------------------------------------------------
cur.execute("update public.challenge_types set enabled = (code = 'riflessi'), game_live = (code = 'riflessi')")
clock("2026-09-20 10:00")
as_user(A); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(B); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])

clock("2026-09-21 07:00:40"); as_user(A)
t = rpc("get_today"); ch = t["io"]["challenge"]; pa = ch["parametri"]
check("lun: challenge riflessi col gioco", (ch["codice"], ch["nome"], pa["round"], len(pa["sequenze"])), ("riflessi", "Riflessi", 5, 200))
check("lun: Fatto semplice rifiutato", rpc("complete_challenge")["error"], "serve_il_gioco")
check("lun: risposta vuota rifiutata", jrpc("complete_game", {})["error"], "risposta_sbagliata")
check("lun: ancora in corso", rpc("get_today")["io"]["stato"], "in_corso")
clock("2026-09-21 07:00:47.6")
r = jrpc("complete_game", ans(3, tentativi=4))
check("lun: giusta al 4° tentativo -> 47,6 s dalla sveglia", (r["ok"], r["secondi"]), (True, 47.6))
check("lun: di nuovo -> gia_fatto", jrpc("complete_game", ans(0))["error"], "gia_fatto")
clock("2026-09-21 07:31:00"); as_user(B)
check("lun: B stesse sequenze", rpc("get_today")["io"]["challenge"]["parametri"]["sequenze"], pa["sequenze"])
clock("2026-09-21 07:35:00.1")
check("lun: B oltre 5 min", jrpc("complete_game", ans(0))["error"], "tempo_scaduto")

# giornate già create con altri giochi: il dispatcher li riconosce ancora
admin()
cur.execute("update public.challenge_types set game_live = true where code in ('memoria', 'numeri', 'colore_parola')")
np_ = {"gioco": "numeri", "lato": 5, "disposizione": list(range(25, 0, -1))}
cur.execute("insert into public.couple_days (couple_id, day, challenge, params) values (%s, '2026-09-22', 'numeri', %s)", (CP, json.dumps(np_)))
clock("2026-09-22 07:00:10"); as_user(A)
check("mar (numeri): riflessi non vale", jrpc("complete_game", ans(0))["error"], "risposta_sbagliata")
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
