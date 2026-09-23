"""Test del passo 3.10 (Trova l'oggetto) su Postgres locale che simula Supabase.
Richiede DB con 00 + 01..17 caricati. Quarto gioco con fotocamera: NESSUNA IA di
riconoscimento, il server non riceve né verifica l'oggetto reale inquadrato,
solo la conferma {fatto:true} (come "luce"/"qr"/"caccia_colori"). Novità: le
foto scattate (save_object_photos) e i campi 'foto' di get_today()."""
import json

from _lib import admin, as_user, check, clock, cur, expect_error, jrpc, report, rpc

admin()
cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('b@x.it') returning id"); B = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('c@x.it') returning id"); C = str(cur.fetchone()[0])
cur.execute("insert into public.couples (created_by) values (%s) returning id", (A,)); CP = cur.fetchone()[0]
cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-09-20 09:00+02'),(%s,%s,'2026-09-20 09:00+02')", (CP, A, CP, B))

OGGETTI = {"spazzolino", "tazza", "frigorifero", "lavandino", "bottiglia", "sedia", "libro",
           "telefono", "forbici", "orologio", "scarpa", "chiave", "specchio", "asciugamano", "spazzola"}


def foto(n, tag="a"):
    return ["data:image/jpeg;base64,X" + tag + str(i) for i in range(n)]


# --- parametri ---------------------------------------------------------------
clock("2026-09-20 10:00"); as_user(C)
check("beta_list: tutti i 9 giochi pronti",
      {"memoria", "numeri", "colore_parola", "riflessi", "anagramma", "luce", "qr", "caccia_colori", "oggetto"} <=
      {g["codice"] for g in rpc("beta_list")["giochi"] if g["pronto"]}, True)
g = rpc("beta_start", "oggetto"); p = g["parametri"]
check("beta_start ok", (g["ok"], g["nome"]), (True, "Trova l'oggetto"))
check("parametri: gioco e oggetti", (p["gioco"], p["oggetti"]), ("oggetto", 15))
S = p["sequenza"]
check("sequenza di 5 oggetti", len(S), 5)
check("oggetti tutti nella lista", set(S) <= OGGETTI, True)
check("mai due uguali consecutivi", all(S[i] != S[i + 1] for i in range(4)), True)
check("diversa a ogni partita", rpc("beta_start", "oggetto")["parametri"]["sequenza"] != S, True)
check("caccia_colori ancora 4 colori dopo il 17", rpc("beta_start", "caccia_colori")["parametri"]["colori"], 4)
check("qr ancora {gioco:qr} dopo il 17", rpc("beta_start", "qr")["parametri"], {"gioco": "qr"})
check("luce ancora {gioco:luce} dopo il 17", rpc("beta_start", "luce")["parametri"], {"gioco": "luce"})
check("memoria ancora a round dopo il 17", rpc("beta_start", "memoria")["parametri"]["round"], 5)
check("numeri ancora 5x5 dopo il 17", len(rpc("beta_start", "numeri")["parametri"]["disposizione"]), 25)
check("colore_parola ancora 10 turni dopo il 17", rpc("beta_start", "colore_parola")["parametri"]["turni"], 10)
check("riflessi ancora 5 round dopo il 17", rpc("beta_start", "riflessi")["parametri"]["round"], 5)
check("anagramma ancora 5 parole dopo il 17", rpc("beta_start", "anagramma")["parametri"]["parole"], 5)

# --- controllo risposta --------------------------------------------------------
bc = lambda a, pp=p, code="oggetto": jrpc("beta_check", code, pp, a)["corretto"]
check("giusta (fatto:true)", bc({"fatto": True}), True)
check("giusta con extra ignorato (le foto non passano di qui)", bc({"fatto": True, "foto": foto(5)}), True)
check("fatto:false", bc({"fatto": False}), False)
check("fatto stringa 'true'", bc({"fatto": "true"}), False)
check("fatto numero 1", bc({"fatto": 1}), False)
check("fatto null", bc({"fatto": None}), False)
check("senza fatto", bc({}), False)
check("risposta null intera", bc(None), False)
check("risposta lista", bc([True]), False)
check("formato anagramma", bc({"tentativo": 0, "risposte": []}), False)
check("formato numeri", bc({"tocchi": list(range(25))}), False)
check("params con contenuto diverso ignorato (nessun segreto da verificare)", bc({"fatto": True}, {"gioco": "oggetto", "sequenza": ["tazza"] * 5}), True)
check("risposta oggetto su gioco memoria", bc({"fatto": True}, p, "memoria"), False)
check("risposta oggetto su gioco riflessi", bc({"fatto": True}, p, "riflessi"), False)
check("risposta oggetto su gioco qr (stessa forma {fatto:true}, nessun segreto da distinguere)", bc({"fatto": True}, p, "qr"), True)
check("risposta oggetto su gioco caccia_colori (stessa forma {fatto:true}, nessun segreto da distinguere)", bc({"fatto": True}, p, "caccia_colori"), True)
check("gioco sconosciuto", bc({"fatto": True}, p, "barcode"), False)
admin()
cur.execute("select public.wb_check_answer('oggetto', null, null) is null, public.wb_check_answer('oggetto', %s::jsonb, '{}') is null, public.wb_check_answer('oggetto', %s::jsonb, '{\"fatto\": null}') is null", (json.dumps(p), json.dumps(p)))
check("mai NULL", cur.fetchone(), (False, False, False))

# --- save_object_photos: validazione -----------------------------------------
as_user(A)
check("array vuoto rifiutato", jrpc("save_object_photos", [])["error"], "foto_non_valide")
check("6 foto rifiutate (max 5)", jrpc("save_object_photos", foto(6))["error"], "foto_non_valide")
check("stringa non valida (senza prefisso data:image/) rifiutata", jrpc("save_object_photos", ["ciao"])["error"], "foto_non_valide")
check("elemento non stringa rifiutato", jrpc("save_object_photos", [1, 2])["error"], "foto_non_valide")
check("non è un array (oggetto) rifiutato", jrpc("save_object_photos", {"a": 1})["error"], "foto_non_valide")
check("non è un array (stringa) rifiutato", jrpc("save_object_photos", "x")["error"], "foto_non_valide")
check("foto troppo grandi rifiutate", jrpc("save_object_photos", ["data:image/jpeg;base64," + ("A" * 500000)])["error"], "foto_non_valide")
check("1 foto valida accettata", jrpc("save_object_photos", foto(1))["ok"], True)
check("5 foto valide accettate", jrpc("save_object_photos", foto(5))["ok"], True)
as_user(None)
expect_error("anonimo non chiama save_object_photos", "select public.save_object_photos('[\"data:image/jpeg;base64,x\"]'::jsonb)")

# --- sfida vera: due giocatori, foto proprie subito visibili, partner solo a giornata chiusa ---
admin()
cur.execute("update public.challenge_types set enabled = (code = 'oggetto'), game_live = (code = 'oggetto')")
clock("2026-09-20 10:00")
as_user(A); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(B); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])

clock("2026-09-21 07:00:40"); as_user(A)
t = rpc("get_today"); ch = t["io"]["challenge"]; pa = ch["parametri"]
check("lun: challenge oggetto col gioco", (ch["codice"], ch["nome"], pa["gioco"], len(pa["sequenza"])), ("oggetto", "Trova l'oggetto", "oggetto", 5))
check("lun: niente foto prima del Fatto", rpc("get_today")["io"]["foto"], None)
check("lun: Fatto semplice rifiutato", rpc("complete_challenge")["error"], "serve_il_gioco")
check("lun: risposta vuota rifiutata", jrpc("complete_game", {})["error"], "risposta_sbagliata")
clock("2026-09-21 07:01:00.5")
r = jrpc("complete_game", {"fatto": True})
check("lun: giusta -> 60,5 s dalla sveglia", (r["ok"], r["secondi"]), (True, 60.5))
FA = foto(5, "a")
check("lun: A salva le sue 5 foto", jrpc("save_object_photos", FA)["ok"], True)
t = rpc("get_today")
check("lun: A vede le sue foto subito (giornata non chiusa)", (t["chiuso"], t["io"]["foto"]), (False, FA))
check("lun: foto del partner nascoste (giornata non chiusa)", t["partner"]["foto"], None)
check("lun: sovrascrive, non accumula", jrpc("save_object_photos", foto(2, "z"))["ok"], True)
check("lun: get_today mostra solo l'ultimo salvataggio", rpc("get_today")["io"]["foto"], foto(2, "z"))
jrpc("save_object_photos", FA)   # ripristina le 5 per il resto del test

clock("2026-09-21 07:31:20.2"); as_user(B)
check("lun: B stessa sequenza", rpc("get_today")["io"]["challenge"]["parametri"], pa)
r = jrpc("complete_game", {"fatto": True})
check("lun: B giusta -> 80,2 s dalla sveglia", (r["ok"], r["secondi"]), (True, 80.2))
FB = foto(3, "b")
check("lun: B salva le sue foto", jrpc("save_object_photos", FB)["ok"], True)
t = rpc("get_today")
check("lun: giornata chiusa (entrambi hanno finito)", t["chiuso"], True)
check("lun: B vede le sue foto", t["io"]["foto"], FB)
check("lun: B vede ora anche quelle di A", t["partner"]["foto"], FA)
as_user(A)
check("lun: A vede ora anche quelle di B", rpc("get_today")["partner"]["foto"], FB)

# --- spariscono col cambio di giornata (get_today mostra sempre solo "oggi");
# la riga resta in tabella (nessun cron), la ripulisce solo il prossimo
# scatto dello stesso utente, e solo se più vecchia di 24 ore ---
clock("2026-09-22 00:00:01"); as_user(B)
check("22/09 appena dopo mezzanotte: le foto di lunedì non sono più 'oggi'", rpc("get_today")["io"]["foto"], None)
admin()
cur.execute("select count(*) from public.object_photos where user_id = %s and day = '2026-09-21'", (B,))
check("la riga di lunedì è ancora in tabella (nessun cron dedicato)", cur.fetchone()[0], 1)

as_user(B)
clock("2026-09-22 07:31:00")   # meno di 24h dopo il salvataggio di lunedì (07:31:20.2)
check("scatto di martedì", jrpc("save_object_photos", foto(1, "presto"))["ok"], True)
admin()
cur.execute("select count(*) from public.object_photos where user_id = %s and day = '2026-09-21'", (B,))
check("scatto a <24h dal salvataggio di lunedì: quella riga non viene ancora ripulita", cur.fetchone()[0], 1)

as_user(B)
clock("2026-09-22 07:31:21")   # più di 24h dopo il salvataggio di lunedì
check("altro scatto di martedì", jrpc("save_object_photos", foto(1, "tardi"))["ok"], True)
admin()
cur.execute("select count(*) from public.object_photos where user_id = %s and day = '2026-09-21'", (B,))
check("scatto a >24h dal salvataggio di lunedì: quella riga viene ripulita", cur.fetchone()[0], 0)

# giornate già create con altri giochi: il dispatcher li riconosce ancora
admin()
cur.execute("update public.challenge_types set game_live = true where code in ('memoria', 'numeri', 'colore_parola', 'riflessi', 'anagramma', 'luce', 'qr', 'caccia_colori')")
np_ = {"gioco": "numeri", "lato": 5, "disposizione": list(range(25, 0, -1))}
cur.execute("insert into public.couple_days (couple_id, day, challenge, params) values (%s, '2026-09-23', 'numeri', %s)", (CP, json.dumps(np_)))
clock("2026-09-23 07:00:10"); as_user(A)
check("mer (numeri): oggetto non vale", jrpc("complete_game", {"fatto": True})["error"], "risposta_sbagliata")
check("mer (numeri): giusta", jrpc("complete_game", {"tocchi": list(range(24, -1, -1))})["secondi"], 10.0)

# --- sicurezza ---------------------------------------------------------------------
as_user(A)
expect_error("client non chiama wb_gp_oggetto", "select public.wb_gp_oggetto()")
expect_error("client non chiama wb_ca_oggetto", "select public.wb_ca_oggetto('{}', '{}')")
expect_error("client non chiama wb_game_params", "select public.wb_game_params('oggetto')")
expect_error("client non chiama wb_check_answer", "select public.wb_check_answer('oggetto', '{}', '{}')")
expect_error("client non legge object_photos direttamente", "select * from public.object_photos")
as_user(None)
expect_error("anonimo non chiama beta_start", "select public.beta_start('oggetto')")

report()
