"""Test del passo di rimozione di "Trova l'intruso" su Postgres locale che simula Supabase.
Richiede DB con 00 + 01..09 caricati."""
from _lib import admin, as_user, check, cur, expect_error, jrpc, report, rpc

admin()
cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])

# --- "intruso" sparito -------------------------------------------------------
as_user(A)
codici = {g["codice"] for g in rpc("beta_list")["giochi"]}
check("beta_list: intruso sparito del tutto", "intruso" in codici, False)
check("beta_list: gli altri giochi restano pronti",
      {"memoria", "numeri", "colore_parola"} <= {g["codice"] for g in rpc("beta_list")["giochi"] if g["pronto"]},
      True)
check("beta_start('intruso') -> gioco_non_pronto", rpc("beta_start", "intruso")["error"], "gioco_non_pronto")
check("beta_check('intruso', ...) sempre falso", jrpc("beta_check", "intruso", {"gioco": "intruso"}, {"tentativo": 0, "risposte": [0]})["corretto"], False)
admin()
cur.execute("select public.wb_game_params('intruso') is null, public.wb_check_answer('intruso', '{}'::jsonb, '{}'::jsonb)")
check("dispatcher: wb_game_params/wb_check_answer non conoscono più intruso", cur.fetchone(), (True, False))
expect_error("wb_gp_intruso() non esiste più", "select public.wb_gp_intruso()")
expect_error("wb_ca_intruso(jsonb, jsonb) non esiste più", "select public.wb_ca_intruso('{}'::jsonb, '{}'::jsonb)")

cur.execute("select count(*) from public.challenge_types where code = 'intruso'")
check("challenge_types: riga 'intruso' rimossa", cur.fetchone()[0], 0)

# --- gli altri giochi restano validi dopo il 09 -------------------------------
p_mem = rpc("beta_start", "memoria")["parametri"]
check("memoria ancora a round dopo il 09", p_mem["round"], 5)
p_num = rpc("beta_start", "numeri")["parametri"]
check("numeri ancora 5x5 dopo il 09", len(p_num["disposizione"]), 25)
p_cp = rpc("beta_start", "colore_parola")["parametri"]
check("colore_parola ancora 10 turni dopo il 09", p_cp["turni"], 10)

report()
