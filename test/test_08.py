"""Test del passo 3.4 (Trova l'intruso) su Postgres locale che simula Supabase.
Richiede DB con 00 + 01..08 caricati."""
import json

from _lib import admin, as_user, check, clock, cur, expect_error, jrpc, report, rpc


def ans(p, k=0, **extra):
    """risposta giusta per il tentativo k: posizioni dell'intrusa dei 5 turni"""
    return {"tentativo": k, "risposte": [t[2] for t in p["sequenze"][k]], **extra}

admin()
cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('b@x.it') returning id"); B = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('c@x.it') returning id"); C = str(cur.fetchone()[0])
cur.execute("insert into public.couples (created_by) values (%s) returning id", (A,)); CP = cur.fetchone()[0]
cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-09-20 09:00+02'),(%s,%s,'2026-09-20 09:00+02')", (CP, A, CP, B))

# --- parametri ---------------------------------------------------------------
clock("2026-09-20 10:00"); as_user(C)
check("beta_list: memoria, numeri, colore_parola, intruso pronti",
      {"memoria", "numeri", "colore_parola", "intruso"} <= {g["codice"] for g in rpc("beta_list")["giochi"] if g["pronto"]},
      True)
g = rpc("beta_start", "intruso"); p = g["parametri"]
check("beta_start ok", (g["ok"], g["nome"]), (True, "Trova l'intruso"))
check("parametri: gioco, 9 elementi, 5 turni, 3000 ms", (p["gioco"], p["elementi"], p["turni"], p["mostra_ms"]), ("intruso", 9, 5, 3000))
S = p["sequenze"]
check("200 tentativi da 5 turni", (len(S), all(len(s) == 5 for s in S)), (200, True))
T_ = [t for s in S for t in s]
check("turni [base, intruso, posizione] validi", all(len(t) == 3 and all(0 <= t[j] <= 8 for j in (0, 1)) and 0 <= t[2] <= 8 for t in T_), True)
check("simbolo dell'intrusa diverso dal base", all(t[0] != t[1] for t in T_), True)
check("posizione dell'intrusa mai uguale al turno prima", all(s[i][2] != s[i - 1][2] for s in S for i in range(1, 5)), True)
check("sequenze non tutte uguali", len({json.dumps(s) for s in S}) > 190, True)
check("diverse a ogni partita", rpc("beta_start", "intruso")["parametri"]["sequenze"] != S, True)
check("memoria ancora a round dopo il 08", rpc("beta_start", "memoria")["parametri"]["round"], 5)
check("numeri ancora 5x5 dopo il 08", len(rpc("beta_start", "numeri")["parametri"]["disposizione"]), 25)
check("colore_parola ancora 10 turni dopo il 08", rpc("beta_start", "colore_parola")["parametri"]["turni"], 10)

# --- controllo risposta --------------------------------------------------------
bc = lambda a, pp=p, code="intruso": jrpc("beta_check", code, pp, a)["corretto"]
R = ans(p)["risposte"]
check("giusta (tentativo 0)", bc(ans(p)), True)
check("giusta al tentativo 7 con tentativi (extra)", bc(ans(p, 7, tentativi=8)), True)
check("giusta al tentativo 199", bc(ans(p, 199)), True)
check("tentativo 7.0", bc({"tentativo": 7.0, "risposte": ans(p, 7)["risposte"]}), True)
check("risposte scritte 3.0", bc({"tentativo": 0, "risposte": [float(x) for x in R]}), True)
check("risposte del tentativo 1 col tentativo 0", bc({"tentativo": 0, "risposte": ans(p, 1)["risposte"]}), ans(p, 1)["risposte"] == R)
w = R[:]; w[4] = (w[4] + 1) % 9
check("ultimo turno sbagliato", bc({"tentativo": 0, "risposte": w}), False)
check("solo 4 risposte", bc({"tentativo": 0, "risposte": R[:4]}), False)
check("6 risposte", bc({"tentativo": 0, "risposte": R + [R[0]]}), False)
check("tentativo 200 (fuori)", bc({"tentativo": 200, "risposte": R}), False)
check("tentativo negativo", bc({"tentativo": -1, "risposte": R}), False)
check("tentativo decimale", bc({"tentativo": 0.5, "risposte": R}), False)
check("tentativo testo", bc({"tentativo": "0", "risposte": R}), False)
check("senza tentativo", bc({"risposte": R}), False)
check("risposta testo", bc({"tentativo": 0, "risposte": [str(R[0])] + R[1:]}), False)
check("risposta null", bc({"tentativo": 0, "risposte": [None] + R[1:]}), False)
check("risposta decimale non intera", bc({"tentativo": 0, "risposte": [R[0] + 0.5] + R[1:]}), False)
check("risposte come testo", bc({"tentativo": 0, "risposte": "x"}), False)
check("risposta null intera", bc(None), False)
check("risposta vuota {}", bc({}), False)
check("risposta lista", bc(R), False)
check("formato numeri", bc({"tocchi": list(range(25))}), False)
check("formato memoria", bc({"inizio": 0, "sequenze": [[0, 1, 2]]}), False)
check("params senza sequenze", bc(ans(p), {"gioco": "intruso", "turni": 5}), False)
check("params senza turni", bc(ans(p), {"sequenze": S}), False)
check("params turni 4 (risposta da 5)", bc(ans(p), {"turni": 4, "sequenze": S}), False)
check("params sequenza corta", bc(ans(p), {"turni": 5, "sequenze": [S[0][:4]]}), False)
check("risposta intruso su gioco memoria", bc(ans(p), p, "memoria"), False)
check("risposta intruso su gioco numeri", bc(ans(p), p, "numeri"), False)
check("gioco sconosciuto", bc(ans(p), p, "qr"), False)
admin()
cur.execute("select public.wb_check_answer('intruso', null, null) is null, public.wb_check_answer('intruso', %s::jsonb, '{}') is null, public.wb_check_answer('intruso', %s::jsonb, '{\"tentativo\": 0, \"risposte\": [null]}') is null", (json.dumps(p), json.dumps(p)))
check("mai NULL", cur.fetchone(), (False, False, False))

# --- sfida vera ------------------------------------------------------------------
cur.execute("update public.challenge_types set enabled = (code = 'intruso'), game_live = (code = 'intruso')")
clock("2026-09-20 10:00")
as_user(A); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(B); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])

clock("2026-09-21 07:00:40"); as_user(A)
t = rpc("get_today"); ch = t["io"]["challenge"]; pa = ch["parametri"]
check("lun: challenge intruso col gioco", (ch["codice"], ch["nome"], pa["turni"], len(pa["sequenze"])), ("intruso", "Trova l'intruso", 5, 200))
check("lun: Fatto semplice rifiutato", rpc("complete_challenge")["error"], "serve_il_gioco")
check("lun: risposta vuota rifiutata", jrpc("complete_game", {})["error"], "risposta_sbagliata")
check("lun: ancora in corso", rpc("get_today")["io"]["stato"], "in_corso")
clock("2026-09-21 07:00:47.6")
r = jrpc("complete_game", ans(pa, 3, tentativi=4))
check("lun: giusta al 4° tentativo -> 47,6 s dalla sveglia", (r["ok"], r["secondi"]), (True, 47.6))
check("lun: di nuovo -> gia_fatto", jrpc("complete_game", ans(pa))["error"], "gia_fatto")
clock("2026-09-21 07:31:00"); as_user(B)
check("lun: B stesse sequenze", rpc("get_today")["io"]["challenge"]["parametri"]["sequenze"], pa["sequenze"])
clock("2026-09-21 07:35:00.1")
check("lun: B oltre 5 min", jrpc("complete_game", ans(pa))["error"], "tempo_scaduto")

# --- sicurezza ---------------------------------------------------------------------
as_user(A)
expect_error("client non chiama wb_game_params", "select public.wb_game_params('intruso')")
expect_error("client non chiama wb_check_answer", "select public.wb_check_answer('intruso', '{}', '{}')")
as_user(None)
expect_error("anonimo non chiama beta_start", "select public.beta_start('intruso')")

report()
