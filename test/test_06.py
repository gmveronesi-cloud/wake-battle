"""Test del passo 3.3 (Colore della parola) su Postgres locale che simula Supabase.
Richiede DB con 00 + 01..06 caricati."""
import json

from _lib import admin, as_user, check, clock, cur, expect_error, jrpc, report, rpc


def ans(p, k=0, **extra):
    """risposta giusta per il tentativo k: inchiostri della sequenza k"""
    return {"tentativo": k, "risposte": [t[1] for t in p["sequenze"][k]], **extra}

admin()
cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('b@x.it') returning id"); B = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('c@x.it') returning id"); C = str(cur.fetchone()[0])
cur.execute("insert into public.couples (created_by) values (%s) returning id", (A,)); CP = cur.fetchone()[0]
cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-09-20 09:00+02'),(%s,%s,'2026-09-20 09:00+02')", (CP, A, CP, B))

# --- parametri ---------------------------------------------------------------
clock("2026-09-20 10:00"); as_user(C)
check("beta_list: memoria, numeri, colore_parola pronti", {"memoria", "numeri", "colore_parola"} <= {g["codice"] for g in rpc("beta_list")["giochi"] if g["pronto"]}, True)
g = rpc("beta_start", "colore_parola"); p = g["parametri"]
check("beta_start ok", (g["ok"], g["nome"]), (True, "Colore della parola"))
check("parametri: gioco, 6 colori, 10 turni", (p["gioco"], p["colori"], p["turni"]), ("colore_parola", 6, 10))
S = p["sequenze"]
check("200 tentativi da 10 turni", (len(S), all(len(s) == 10 for s in S)), (200, True))
T = [t for s in S for t in s]
check("coppie [parola, inchiostro] 0..5", all(len(t) == 2 and 0 <= t[0] <= 5 and 0 <= t[1] <= 5 for t in T), True)
check("parola mai del suo colore", all(t[0] != t[1] for t in T), True)
check("inchiostro mai uguale al turno prima", all(s[i][1] != s[i - 1][1] for s in S for i in range(1, 10)), True)
check("usati tutti e 6 gli inchiostri e le parole", (sorted({t[1] for t in T}), sorted({t[0] for t in T})), (list(range(6)), list(range(6))))
check("sequenze non tutte uguali", len({json.dumps(s) for s in S}) > 190, True)
check("diverse a ogni partita", rpc("beta_start", "colore_parola")["parametri"]["sequenze"] != S, True)
check("memoria ancora a round dopo il 06", rpc("beta_start", "memoria")["parametri"]["round"], 5)
check("numeri ancora 5x5 dopo il 06", len(rpc("beta_start", "numeri")["parametri"]["disposizione"]), 25)

# --- controllo risposta --------------------------------------------------------
bc = lambda a, pp=p, code="colore_parola": jrpc("beta_check", code, pp, a)["corretto"]
R = ans(p)["risposte"]
check("giusta (tentativo 0)", bc(ans(p)), True)
check("giusta al tentativo 7 con tentativi (extra)", bc(ans(p, 7, tentativi=8)), True)
check("giusta al tentativo 199", bc(ans(p, 199)), True)
check("tentativo 7.0", bc({"tentativo": 7.0, "risposte": ans(p, 7)["risposte"]}), True)
check("risposte scritte 3.0", bc({"tentativo": 0, "risposte": [float(x) for x in R]}), True)
check("risposte del tentativo 1 col tentativo 0", bc({"tentativo": 0, "risposte": ans(p, 1)["risposte"]}), ans(p, 1)["risposte"] == R)
check("parole invece degli inchiostri", bc({"tentativo": 0, "risposte": [t[0] for t in S[0]]}), False)
w = R[:]; w[9] = (w[9] + 1) % 6
check("ultimo turno sbagliato", bc({"tentativo": 0, "risposte": w}), False)
check("solo 9 risposte", bc({"tentativo": 0, "risposte": R[:9]}), False)
check("11 risposte", bc({"tentativo": 0, "risposte": R + [R[0]]}), False)
check("tentativo 200 (fuori)", bc({"tentativo": 200, "risposte": R}), False)
check("tentativo negativo", bc({"tentativo": -1, "risposte": R}), False)
check("tentativo decimale", bc({"tentativo": 0.5, "risposte": R}), False)
check("tentativo testo", bc({"tentativo": "0", "risposte": R}), False)
check("senza tentativo", bc({"risposte": R}), False)
check("risposta testo", bc({"tentativo": 0, "risposte": [str(R[0])] + R[1:]}), False)
check("risposta null", bc({"tentativo": 0, "risposte": [None] + R[1:]}), False)
check("risposta decimale", bc({"tentativo": 0, "risposte": [R[0] + 0.5] + R[1:]}), False)
check("risposte come testo", bc({"tentativo": 0, "risposte": "x"}), False)
check("risposta null intera", bc(None), False)
check("risposta vuota {}", bc({}), False)
check("risposta lista", bc(R), False)
check("formato numeri", bc({"tocchi": list(range(25))}), False)
check("formato memoria", bc({"inizio": 0, "sequenze": [[0, 1, 2]]}), False)
check("params senza sequenze", bc(ans(p), {"gioco": "colore_parola", "turni": 10}), False)
check("params senza turni", bc(ans(p), {"sequenze": S}), False)
check("params turni 9 (risposta da 10)", bc(ans(p), {"turni": 9, "sequenze": S}), False)
check("params sequenza corta", bc(ans(p), {"turni": 10, "sequenze": [S[0][:9]]}), False)
check("params inchiostri testo", bc(ans(p), {"turni": 10, "sequenze": [[[a, str(b)] for a, b in S[0]]]}), False)
check("risposta colore su gioco memoria", bc(ans(p), p, "memoria"), False)
check("risposta colore su gioco numeri", bc(ans(p), p, "numeri"), False)
check("gioco sconosciuto", bc(ans(p), p, "barcode"), False)
admin()
cur.execute("select public.wb_check_answer('colore_parola', null, null) is null, public.wb_check_answer('colore_parola', %s::jsonb, '{}') is null, public.wb_check_answer('colore_parola', %s::jsonb, '{\"tentativo\": 0, \"risposte\": [null]}') is null", (json.dumps(p), json.dumps(p)))
check("mai NULL", cur.fetchone(), (False, False, False))

# --- sfida vera ------------------------------------------------------------------
cur.execute("update public.challenge_types set enabled = (code = 'colore_parola'), game_live = (code = 'colore_parola')")
clock("2026-09-20 10:00")
as_user(A); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(B); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])

clock("2026-09-21 07:00:40"); as_user(A)
t = rpc("get_today"); ch = t["io"]["challenge"]; pa = ch["parametri"]
check("lun: challenge colore col gioco", (ch["codice"], ch["nome"], pa["turni"], len(pa["sequenze"])), ("colore_parola", "Colore della parola", 10, 200))
check("lun: Fatto semplice rifiutato", rpc("complete_challenge")["error"], "serve_il_gioco")
check("lun: parole invece di inchiostri rifiutata", jrpc("complete_game", {"tentativo": 0, "risposte": [x[0] for x in pa["sequenze"][0]]})["error"], "risposta_sbagliata")
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

# giornate già create con altri giochi: restano quelle e si controllano
admin()
cur.execute("update public.challenge_types set game_live = true where code in ('memoria', 'numeri')")
mp = {"gioco": "memoria", "simboli": 9, "mostra_ms": 3000, "round": 1, "lunghezza": 3, "sequenze": [[0, 1, 2], [3, 4, 5]]}
cur.execute("insert into public.couple_days (couple_id, day, challenge, params) values (%s, '2026-09-22', 'memoria', %s)", (CP, json.dumps(mp)))
np_ = {"gioco": "numeri", "lato": 5, "disposizione": list(range(25, 0, -1))}
cur.execute("insert into public.couple_days (couple_id, day, challenge, params) values (%s, '2026-09-23', 'numeri', %s)", (CP, json.dumps(np_)))
clock("2026-09-22 07:00:30"); as_user(A)
check("mar (memoria): colore non vale", jrpc("complete_game", ans(pa))["error"], "risposta_sbagliata")
check("mar (memoria): giusta", jrpc("complete_game", {"inizio": 1, "sequenze": [[3, 4, 5]]})["secondi"], 30.0)
clock("2026-09-23 07:00:10"); as_user(A)
check("mer (numeri): colore non vale", jrpc("complete_game", ans(pa))["error"], "risposta_sbagliata")
check("mer (numeri): giusta", jrpc("complete_game", {"tocchi": list(range(24, -1, -1))})["secondi"], 10.0)

# --- sicurezza ---------------------------------------------------------------------
as_user(A)
expect_error("client non chiama wb_game_params", "select public.wb_game_params('colore_parola')")
expect_error("client non chiama wb_check_answer", "select public.wb_check_answer('colore_parola', '{}', '{}')")
as_user(None)
expect_error("anonimo non chiama beta_start", "select public.beta_start('colore_parola')")

report()
