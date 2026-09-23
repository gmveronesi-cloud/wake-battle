"""Test del passo 3.6 (Anagramma) su Postgres locale che simula Supabase.
Richiede DB con 00 + 01..12 caricati."""
import json

from _lib import admin, as_user, check, clock, cur, expect_error, jrpc, report, rpc


def ans(k=0, risposte=None, **extra):
    return {"tentativo": k, "risposte": risposte, **extra}


admin()
cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('b@x.it') returning id"); B = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('c@x.it') returning id"); C = str(cur.fetchone()[0])
cur.execute("insert into public.couples (created_by) values (%s) returning id", (A,)); CP = cur.fetchone()[0]
cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-09-20 09:00+02'),(%s,%s,'2026-09-20 09:00+02')", (CP, A, CP, B))

# --- parametri ---------------------------------------------------------------
clock("2026-09-20 10:00"); as_user(C)
check("beta_list: tutti i 5 giochi pronti",
      {"memoria", "numeri", "colore_parola", "riflessi", "anagramma"} <= {g["codice"] for g in rpc("beta_list")["giochi"] if g["pronto"]}, True)
g = rpc("beta_start", "anagramma"); p = g["parametri"]
check("beta_start ok", (g["ok"], g["nome"]), (True, "Anagramma"))
check("parametri: gioco, 5 parole", (p["gioco"], p["parole"]), ("anagramma", 5))
S = p["sequenze"]
check("40 tentativi da 5 parole", (len(S), all(len(s) == 5 for s in S)), (40, True))
words = [w for s in S for w in s]
check("parole lunghe 5-7 lettere", all(5 <= len(w) <= 7 for w in words), True)
check("solo lettere maiuscole A-Z", all(all(len(l) == 1 and l.isalpha() and l == l.upper() for l in w) for w in words), True)
check("parole varie (non tutte uguali)", len({tuple(w) for w in words}) > 20, True)
check("diverse a ogni partita", rpc("beta_start", "anagramma")["parametri"]["sequenze"] != S, True)
check("memoria ancora a round dopo il 12", rpc("beta_start", "memoria")["parametri"]["round"], 5)
check("numeri ancora 5x5 dopo il 12", len(rpc("beta_start", "numeri")["parametri"]["disposizione"]), 25)
check("colore_parola ancora 10 turni dopo il 12", rpc("beta_start", "colore_parola")["parametri"]["turni"], 10)
check("riflessi ancora 5 round dopo il 12", rpc("beta_start", "riflessi")["parametri"]["round"], 5)

# --- controllo risposta --------------------------------------------------------
bc = lambda a, pp=p, code="anagramma": jrpc("beta_check", code, pp, a)["corretto"]
check("giusta (tentativo 0)", bc(ans(0, S[0])), True)
check("giusta con tentativi (extra, ignorato)", bc(ans(7, S[7], tentativi=8)), True)
check("giusta al tentativo 39", bc(ans(39, S[39])), True)
check("tentativo 7.0", bc({"tentativo": 7.0, "risposte": S[7]}), True)
check("parola sbagliata (ordine diverso)", bc(ans(0, [list(reversed(w)) for w in S[0]])), False)
check("parola di un altro tentativo", bc(ans(0, S[1])), False)
check("meno di 5 parole", bc(ans(0, S[0][:4])), False)
check("più di 5 parole", bc(ans(0, S[0] + [S[0][0]])), False)
check("tentativo 40 (fuori)", bc(ans(40, S[0])), False)
check("tentativo negativo", bc(ans(-1, S[0])), False)
check("tentativo decimale", bc({"tentativo": 0.5, "risposte": S[0]}), False)
check("tentativo testo", bc({"tentativo": "0", "risposte": S[0]}), False)
check("senza tentativo", bc({"risposte": S[0]}), False)
check("senza risposte", bc({"tentativo": 0}), False)
check("risposta null intera", bc(None), False)
check("risposta lista", bc([0]), False)
check("formato numeri", bc({"tocchi": list(range(25))}), False)
check("formato riflessi", bc({"tentativo": 0, "tentativi": 1}), False)
check("params senza sequenze", bc(ans(0, S[0]), {"gioco": "anagramma", "parole": 5}), False)
check("params senza parole", bc(ans(0, S[0]), {"sequenze": S}), False)
check("params parole 4 (risposta da 5)", bc(ans(0, S[0]), {"parole": 4, "sequenze": S}), False)
check("risposta anagramma su gioco memoria", bc(ans(0, S[0]), p, "memoria"), False)
check("risposta anagramma su gioco riflessi", bc(ans(0, S[0]), p, "riflessi"), False)
check("gioco sconosciuto", bc(ans(0, S[0]), p, "qr"), False)
admin()
cur.execute("select public.wb_check_answer('anagramma', null, null) is null, public.wb_check_answer('anagramma', %s::jsonb, '{}') is null, public.wb_check_answer('anagramma', %s::jsonb, '{\"tentativo\": null}') is null", (json.dumps(p), json.dumps(p)))
check("mai NULL", cur.fetchone(), (False, False, False))

# --- sfida vera ------------------------------------------------------------------
cur.execute("update public.challenge_types set enabled = (code = 'anagramma'), game_live = (code = 'anagramma')")
clock("2026-09-20 10:00")
as_user(A); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(B); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])

clock("2026-09-21 07:00:40"); as_user(A)
t = rpc("get_today"); ch = t["io"]["challenge"]; pa = ch["parametri"]
check("lun: challenge anagramma col gioco", (ch["codice"], ch["nome"], pa["parole"], len(pa["sequenze"])), ("anagramma", "Anagramma", 5, 40))
check("lun: Fatto semplice rifiutato", rpc("complete_challenge")["error"], "serve_il_gioco")
check("lun: risposta vuota rifiutata", jrpc("complete_game", {})["error"], "risposta_sbagliata")
check("lun: ancora in corso", rpc("get_today")["io"]["stato"], "in_corso")
clock("2026-09-21 07:02:10.3")
r = jrpc("complete_game", ans(3, pa["sequenze"][3], tentativi=4))
check("lun: giusta al 4° tentativo -> 130,3 s dalla sveglia", (r["ok"], r["secondi"]), (True, 130.3))
check("lun: di nuovo -> gia_fatto", jrpc("complete_game", ans(0, pa["sequenze"][0]))["error"], "gia_fatto")
clock("2026-09-21 07:31:00"); as_user(B)
check("lun: B stesse sequenze", rpc("get_today")["io"]["challenge"]["parametri"]["sequenze"], pa["sequenze"])
clock("2026-09-21 07:35:00.1")
check("lun: B oltre 5 min", jrpc("complete_game", ans(0, pa["sequenze"][0]))["error"], "tempo_scaduto")

# giornate già create con altri giochi: il dispatcher li riconosce ancora
admin()
cur.execute("update public.challenge_types set game_live = true where code in ('memoria', 'numeri', 'colore_parola', 'riflessi')")
np_ = {"gioco": "numeri", "lato": 5, "disposizione": list(range(25, 0, -1))}
cur.execute("insert into public.couple_days (couple_id, day, challenge, params) values (%s, '2026-09-22', 'numeri', %s)", (CP, json.dumps(np_)))
clock("2026-09-22 07:00:10"); as_user(A)
check("mar (numeri): anagramma non vale", jrpc("complete_game", ans(0, S[0]))["error"], "risposta_sbagliata")
check("mar (numeri): giusta", jrpc("complete_game", {"tocchi": list(range(24, -1, -1))})["secondi"], 10.0)

# --- sicurezza ---------------------------------------------------------------------
as_user(A)
expect_error("client non chiama wb_gp_anagramma", "select public.wb_gp_anagramma()")
expect_error("client non chiama wb_ca_anagramma", "select public.wb_ca_anagramma('{}', '{}')")
expect_error("client non chiama wb_game_params", "select public.wb_game_params('anagramma')")
expect_error("client non chiama wb_check_answer", "select public.wb_check_answer('anagramma', '{}', '{}')")
as_user(None)
expect_error("anonimo non chiama beta_start", "select public.beta_start('anagramma')")

report()
