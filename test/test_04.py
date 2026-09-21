"""Test del passo 3.1b (Memoria a 5 round da 3) su Postgres locale che simula Supabase.
Richiede DB con 00 + 01 + 02 + 03 + 04 caricati. Orologio simulato come in test_02."""
import json, sys, psycopg2

conn = psycopg2.connect(host="/tmp", port=5433, user="postgres", dbname="wb")
conn.autocommit = True
cur = conn.cursor()
fails = passes = 0

cur.execute("""
create or replace function public.wb_now() returns timestamptz
language sql stable set search_path = '' as
$$ select coalesce(nullif(current_setting('wb.fake_now', true), '')::timestamptz, now()) $$;
""")

def clock(ts): cur.execute("select set_config('wb.fake_now', %s, false)", (ts + "+02",))
def as_user(uid):
    cur.execute("reset role")
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (uid or "",))
    cur.execute("set role " + ("authenticated" if uid else "anon"))
def admin(): cur.execute("reset role")
def rpc(fn, *args):
    ph = ",".join(["%s"] * len(args))
    cur.execute(f"select public.{fn}({ph})", args)
    r = cur.fetchone()[0]
    return r if not isinstance(r, str) else json.loads(r)
def jrpc(fn, *args):
    casts = {"complete_game": ["jsonb"], "beta_check": ["text", "jsonb", "jsonb"]}[fn]
    ph = ",".join(f"%s::{c}" for c in casts)
    vals = [a if c == "text" else json.dumps(a) for a, c in zip(args, casts)]
    cur.execute(f"select public.{fn}({ph})", vals)
    return cur.fetchone()[0]
def check(label, got, exp):
    global fails, passes
    if got == exp: passes += 1
    else:
        fails += 1; print(f"FAIL {label}: atteso {exp!r}, ottenuto {got!r}")
def expect_error(label, sql, args=()):
    global fails, passes
    try:
        cur.execute(sql, args); fails += 1; print(f"FAIL {label}: nessun errore")
    except psycopg2.Error:
        passes += 1
def ans(p, k, **extra):
    """risposta giusta: 5 sequenze dalla posizione k"""
    return {"inizio": k, "sequenze": p["sequenze"][k:k + p["round"]], **extra}

admin()
cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('b@x.it') returning id"); B = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('c@x.it') returning id"); C = str(cur.fetchone()[0])
cur.execute("insert into public.couples (created_by) values (%s) returning id", (A,)); CP = cur.fetchone()[0]
cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-09-20 09:00+02'),(%s,%s,'2026-09-20 09:00+02')", (CP, A, CP, B))

# --- parametri ---------------------------------------------------------------
clock("2026-09-20 10:00"); as_user(C)
check("beta_list: solo memoria pronta", [g["codice"] for g in rpc("beta_list")["giochi"] if g["pronto"]], ["memoria"])
g = rpc("beta_start", "memoria"); p = g["parametri"]
check("beta_start ok", (g["ok"], g["nome"]), (True, "Memoria"))
check("parametri: gioco, 5 round da 3, 3 s, 9 simboli",
      (p["gioco"], p["round"], p["lunghezza"], p["mostra_ms"], p["simboli"]), ("memoria", 5, 3, 3000, 9))
S = p["sequenze"]
check("200 sequenze", len(S), 200)
check("ogni sequenza: 3 simboli diversi 0..8", all(len(s) == 3 and len(set(s)) == 3 and all(0 <= x <= 8 for x in s) for s in S), True)
check("mai due uguali di fila", any(S[i] == S[i + 1] for i in range(199)), False)
check("tutti i 9 simboli usati", sorted({x for s in S for x in s}), list(range(9)))
check("sequenze variate", len({tuple(s) for s in S}) > 150, True)
check("diverse a ogni partita", rpc("beta_start", "memoria")["parametri"]["sequenze"] != S, True)
cur.execute("select octet_length(%s::jsonb::text)", (json.dumps(p),))
check("parametri sotto il limite della beta (20000 byte)", cur.fetchone()[0] < 20000, True)

# --- controllo risposta (beta_check = stessa funzione della sfida) -------------
bc = lambda a, pp=p: jrpc("beta_check", "memoria", pp, a)["corretto"]
check("giusta dall'inizio", bc(ans(p, 0)), True)
check("giusta dopo errori (inizio 7)", bc(ans(p, 7)), True)
check("giusta con campo extra tentativi", bc(ans(p, 3, tentativi=2)), True)
check("giusta all'ultima posizione utile (195)", bc(ans(p, 195)), True)
check("oltre la fine (196)", bc({"inizio": 196, "sequenze": S[196:200] + [S[0]]}), False)
check("inizio negativo", bc({"inizio": -1, "sequenze": S[0:5]}), False)
check("inizio decimale", bc({"inizio": 0.5, "sequenze": S[0:5]}), False)
check("inizio testo", bc({"inizio": "0", "sequenze": S[0:5]}), False)
check("solo 4 round", bc({"inizio": 0, "sequenze": S[0:4]}), False)
check("6 round", bc({"inizio": 0, "sequenze": S[0:6]}), False)
wrong = [s[:] for s in S[0:5]]; wrong[4] = wrong[4][::-1]
check("ultimo round in ordine sbagliato", bc({"inizio": 0, "sequenze": wrong}), False)
check("round saltato (0,1,2,3,5)", bc({"inizio": 0, "sequenze": S[0:4] + [S[5]]}), S[4] == S[5])
check("sequenze spostate di uno", bc({"inizio": 1, "sequenze": S[0:5]}), False)
check("round come stringa", bc({"inizio": 0, "sequenze": "x"}), False)
check("formato vecchio su parametri nuovi", bc({"tentativo": 0, "sequenza": S[0]}), False)
check("risposta null", bc(None), False)
check("risposta vuota {} (buco del 03)", bc({}), False)
check("solo inizio", bc({"inizio": 0}), False)
check("solo sequenze", bc({"sequenze": S[0:5]}), False)
check("params senza sequenze", bc(ans(p, 0), {"round": 5}), False)
check("params senza round e senza sequenze", bc({"tentativo": 0, "sequenza": [1]}, {"gioco": "memoria"}), False)
check("risposta lista", bc([1, 2]), False)
check("params rotti", bc(ans(p, 0), {"round": "x", "sequenze": S}), False)
check("gioco sconosciuto", jrpc("beta_check", "qr", p, ans(p, 0))["corretto"], False)

# formato vecchio (giornate create col 03) ancora accettato
old = {"gioco": "memoria", "simboli": 9, "mostra_ms": 5000, "sequenze": [[0, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 0]]}
check("vecchio: giusta", bc({"tentativo": 1, "sequenza": [5, 4, 3, 2, 1, 0]}, old), True)
check("vecchio: sbagliata", bc({"tentativo": 0, "sequenza": [5, 4, 3, 2, 1, 0]}, old), False)
check("vecchio: risposta vuota {}", bc({}, old), False)
check("vecchio: formato nuovo non vale", bc({"inizio": 0, "sequenze": [[0, 1, 2, 3, 4, 5]]}, old), False)

# --- sfida vera ------------------------------------------------------------------
admin()
cur.execute("update public.challenge_types set enabled = (code = 'memoria'), game_live = (code = 'memoria')")
clock("2026-09-20 10:00")
as_user(A); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(B); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])

clock("2026-09-21 07:00:40"); as_user(A)
t = rpc("get_today"); pa = t["io"]["challenge"]["parametri"]
check("lun: parametri nuovi nella sfida", (t["io"]["challenge"]["codice"], pa["round"], len(pa["sequenze"])), ("memoria", 5, 200))
check("lun: Fatto semplice rifiutato", rpc("complete_challenge")["error"], "serve_il_gioco")
check("lun: risposta sbagliata", jrpc("complete_game", {"inizio": 0, "sequenze": pa["sequenze"][1:6]})["error"], "risposta_sbagliata")
check("lun: risposta vuota {} rifiutata", jrpc("complete_game", {})["error"], "risposta_sbagliata")
check("lun: ancora in corso", rpc("get_today")["io"]["stato"], "in_corso")
clock("2026-09-21 07:00:58.4")
r = jrpc("complete_game", ans(pa, 12))
check("lun: giusta -> 58,4 s dalla sveglia", (r["ok"], r["secondi"]), (True, 58.4))
check("lun: di nuovo -> gia_fatto", jrpc("complete_game", ans(pa, 12))["error"], "gia_fatto")
clock("2026-09-21 07:31:00"); as_user(B)
check("lun: B stesse sequenze", rpc("get_today")["io"]["challenge"]["parametri"]["sequenze"], pa["sequenze"])
clock("2026-09-21 07:35:00.1")
check("lun: B oltre 5 min", jrpc("complete_game", ans(pa, 0))["error"], "tempo_scaduto")

# giornata creata col formato vecchio (prima del 04): ancora giocabile
admin()
cur.execute("insert into public.couple_days (couple_id, day, challenge, params) values (%s, '2026-09-22', 'memoria', %s)", (CP, json.dumps(old)))
clock("2026-09-22 07:01:00"); as_user(A)
check("mar (vecchio): formato nuovo rifiutato", jrpc("complete_game", {"inizio": 0, "sequenze": [[0, 1, 2, 3, 4, 5]]})["error"], "risposta_sbagliata")
check("mar (vecchio): risposta vuota {} rifiutata", jrpc("complete_game", {})["error"], "risposta_sbagliata")
check("mar (vecchio): formato vecchio ok", jrpc("complete_game", {"tentativo": 0, "sequenza": [0, 1, 2, 3, 4, 5]})["secondi"], 60.0)

# --- sicurezza ---------------------------------------------------------------------
as_user(A)
expect_error("client non chiama wb_game_params", "select public.wb_game_params('memoria')")
expect_error("client non chiama wb_check_answer", "select public.wb_check_answer('memoria', '{}', '{}')")
as_user(None)
expect_error("anonimo non chiama beta_start", "select public.beta_start('memoria')")

admin()
print(f"\n{passes} controlli superati, {fails} falliti")
sys.exit(1 if fails else 0)
