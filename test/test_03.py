"""Test del passo 3.1 (struttura giochi + Memoria) su Postgres locale che simula Supabase.
Richiede DB con 00 + 01 + 02 + 03 caricati."""
import json

from _lib import admin, as_user, check, clock, cur, expect_error, jrpc, report, rpc

# --- struttura -----------------------------------------------------------
admin()
cur.execute("select count(*) filter (where game_live), count(*) from public.challenge_types")
check("game_live parte spento per tutte", cur.fetchone(), (0, 12))

cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('b@x.it') returning id"); B = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('c@x.it') returning id"); C = str(cur.fetchone()[0])  # senza coppia
cur.execute("insert into public.couples (created_by) values (%s) returning id", (A,)); CP = cur.fetchone()[0]
cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-09-20 09:00+02'),(%s,%s,'2026-09-20 09:00+02')", (CP, A, CP, B))

# --- beta ------------------------------------------------------------------
clock("2026-09-20 10:00")
as_user(C)  # la beta funziona anche senza coppia
bl = rpc("beta_list")
check("beta_list ok", bl["ok"], True)
check("beta_list 12 giochi", len(bl["giochi"]), 12)
ready = {g["codice"]: g["pronto"] for g in bl["giochi"]}
check("solo memoria pronta", [k for k, v in ready.items() if v], ["memoria"])
check("nessuno in sfida", any(g["in_sfida"] for g in bl["giochi"]), False)
check("beta_start qr -> non pronto", rpc("beta_start", "qr")["error"], "gioco_non_pronto")
check("beta_start inesistente -> non pronto", rpc("beta_start", "boh")["error"], "gioco_non_pronto")

g = rpc("beta_start", "memoria")
p = g["parametri"]
check("beta_start ok", (g["ok"], g["codice"], g["nome"]), (True, "memoria", "Memoria"))
check("memoria: gioco", p["gioco"], "memoria")
check("memoria: 60 sequenze", len(p["sequenze"]), 60)
check("memoria: 6 simboli diversi 0..8", all(len(s) == 6 and len(set(s)) == 6 and all(0 <= x <= 8 for x in s) for s in p["sequenze"]), True)
check("memoria: sequenze variate", len({tuple(s) for s in p["sequenze"]}) > 50, True)
check("memoria: parametri diversi a ogni partita", rpc("beta_start", "memoria")["parametri"]["sequenze"] != p["sequenze"], True)
# distribuzione: ogni simbolo compare
check("memoria: tutti i 9 simboli usati", sorted({x for s in p["sequenze"] for x in s}), list(range(9)))

s0, s7 = p["sequenze"][0], p["sequenze"][7]
check("beta_check giusta", jrpc("beta_check", "memoria", p, {"tentativo": 0, "sequenza": s0})["corretto"], True)
check("beta_check giusta tentativo 7", jrpc("beta_check", "memoria", p, {"tentativo": 7, "sequenza": s7})["corretto"], True)
check("beta_check ordine sbagliato", jrpc("beta_check", "memoria", p, {"tentativo": 0, "sequenza": s0[::-1]})["corretto"], False)
check("beta_check sequenza di un altro tentativo", jrpc("beta_check", "memoria", p, {"tentativo": 1, "sequenza": s0})["corretto"], s0 == p["sequenze"][1])
check("beta_check 5 simboli", jrpc("beta_check", "memoria", p, {"tentativo": 0, "sequenza": s0[:5]})["corretto"], False)
check("beta_check tentativo fuori range", jrpc("beta_check", "memoria", p, {"tentativo": 60, "sequenza": s0})["corretto"], False)
check("beta_check tentativo negativo", jrpc("beta_check", "memoria", p, {"tentativo": -1, "sequenza": s0})["corretto"], False)
check("beta_check tentativo testo", jrpc("beta_check", "memoria", p, {"tentativo": "0", "sequenza": s0})["corretto"], False)
check("beta_check risposta stringa", jrpc("beta_check", "memoria", p, "ciao")["corretto"], False)
check("beta_check risposta null", jrpc("beta_check", "memoria", p, None)["corretto"], False)
check("beta_check params rotti", jrpc("beta_check", "memoria", {"sequenze": "x"}, {"tentativo": 0, "sequenza": s0})["corretto"], False)
check("beta_check tentativo decimale", jrpc("beta_check", "memoria", p, {"tentativo": 0.5, "sequenza": s0})["corretto"] in (False, True), True)
check("beta_check gioco sconosciuto", jrpc("beta_check", "barcode", p, {"tentativo": 0, "sequenza": s0})["corretto"], False)
check("beta_check params enormi", jrpc("beta_check", "memoria", {"x": "a" * 30000}, {})["corretto"], False)

# --- sfida vera: memoria unica attiva, gioco SPENTO -> vecchio "Fatto" -----
admin()
cur.execute("update public.challenge_types set enabled = (code = 'memoria')")
clock("2026-09-20 10:00")
as_user(A); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(B); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])

clock("2026-09-21 07:01:00"); as_user(A)
t = rpc("get_today")
check("lun memoria senza gioco", (t["io"]["challenge"]["codice"], t["io"]["challenge"]["parametri"]), ("memoria", {}))
check("lun complete_game -> nessun_gioco", jrpc("complete_game", {"tentativo": 0, "sequenza": []})["error"], "nessun_gioco")
check("lun Fatto semplice ok", rpc("complete_challenge")["secondi"], 60.0)

# --- gioco ACCESO ------------------------------------------------------------
admin()
cur.execute("update public.challenge_types set game_live = true where code = 'memoria'")
as_user(C)
check("beta_list: memoria in sfida", [g["codice"] for g in rpc("beta_list")["giochi"] if g["in_sfida"]], ["memoria"])

# il lunedì di B era già creato senza gioco: B usa ancora il Fatto semplice
clock("2026-09-21 07:31:00"); as_user(B)
check("lun B (giorno creato prima) Fatto ok", rpc("complete_challenge")["secondi"], 60.0)

clock("2026-09-22 06:59:00"); as_user(A)
check("mar prima della sveglia: troppo_presto", jrpc("complete_game", {"tentativo": 0, "sequenza": []})["error"], "troppo_presto")
check("mar prima della sveglia: challenge nascosta", rpc("get_today")["io"]["challenge"], None)
clock("2026-09-22 07:00:30")
t = rpc("get_today")
ch = t["io"]["challenge"]
check("mar challenge memoria", ch["codice"], "memoria")
check("mar parametri gioco", (ch["parametri"]["gioco"], len(ch["parametri"]["sequenze"])), ("memoria", 60))
seqs = ch["parametri"]["sequenze"]
check("mar Fatto semplice rifiutato", rpc("complete_challenge")["error"], "serve_il_gioco")
check("mar risposta sbagliata", jrpc("complete_game", {"tentativo": 0, "sequenza": seqs[0][::-1]})["error"], "risposta_sbagliata")
check("mar risposta vuota", jrpc("complete_game", None)["error"], "risposta_sbagliata")
check("mar ancora in corso dopo errore", rpc("get_today")["io"]["stato"], "in_corso")
clock("2026-09-22 07:01:12.3")
r = jrpc("complete_game", {"tentativo": 3, "sequenza": seqs[3]})
check("mar risposta giusta 72,3 s", (r["ok"], r["secondi"]), (True, 72.3))
check("mar di nuovo -> gia_fatto", jrpc("complete_game", {"tentativo": 3, "sequenza": seqs[3]})["error"], "gia_fatto")
check("mar Fatto semplice -> gia_fatto", rpc("complete_challenge")["error"], "gia_fatto")
check("mar stato fatto", rpc("get_today")["io"]["stato"], "fatto")

clock("2026-09-22 07:31:00"); as_user(B)
tb = rpc("get_today")
check("mar B stessa sequenza del partner", tb["io"]["challenge"]["parametri"]["sequenze"], seqs)
clock("2026-09-22 07:35:01"); as_user(B)
check("mar B oltre 5 min", jrpc("complete_game", {"tentativo": 0, "sequenza": seqs[0]})["error"], "tempo_scaduto")
as_user(A); t = rpc("get_today")
check("mar punti A 1 - B 0", (t["chiuso"], t["io"]["punti"], t["partner"]["punti"]), (True, 1, 0))

# --- altre challenge non toccate --------------------------------------------
admin()
cur.execute("update public.challenge_types set enabled = (code = 'esercizi')")
cur.execute("select (public.wb_ensure_challenge(%s, '2026-10-01')).params", (CP,))
pe = cur.fetchone()[0]
check("esercizi: parametro come prima", list(pe.keys()), ["esercizio"])
cur.execute("update public.challenge_types set enabled = (code = 'qr'), game_live = true where code = 'qr'")
cur.execute("update public.challenge_types set enabled = (code = 'qr')")
cur.execute("select (public.wb_ensure_challenge(%s, '2026-10-02')).params", (CP,))
check("gioco acceso ma non pronto -> {} (Fatto semplice)", cur.fetchone()[0], {})
cur.execute("update public.challenge_types set enabled = true, game_live = (code = 'memoria')")

# --- mai uguale al giorno prima, con memoria attiva --------------------------
cur.execute("""
  select count(*) from (
    select challenge, lag(challenge) over (order by day) prev from (
      select (public.wb_ensure_challenge(%s, d::date)).*
      from generate_series('2027-01-01'::date, '2027-04-10', '1 day') d) x) y
  where challenge = prev""", (CP,))
check("nessuna ripetizione consecutiva", cur.fetchone()[0], 0)
cur.execute("select count(*) from public.couple_days where challenge = 'memoria' and day >= '2027-01-01' and not params ? 'gioco'")
check("tutte le memoria nuove hanno il gioco", cur.fetchone()[0], 0)

# --- sicurezza ----------------------------------------------------------------
as_user(A)
expect_error("client non chiama wb_game_params", "select public.wb_game_params('memoria')")
expect_error("client non chiama wb_check_answer", "select public.wb_check_answer('memoria', '{}', '{}')")
expect_error("client non chiama wb_complete", "select public.wb_complete(%s, null, false)", (A,))
expect_error("client non chiama wb_challenge_params", "select public.wb_challenge_params('memoria')")
expect_error("client non legge challenge_types", "select * from public.challenge_types")
expect_error("client non cambia game_live", "update public.challenge_types set game_live = true")
as_user(None)
for f in ["beta_list()", "beta_start('memoria')", "beta_check('memoria', '{}', '{}')", "complete_game('{}')", "complete_challenge()"]:
    expect_error(f"anonimo non chiama {f}", f"select public.{f}")

report()
