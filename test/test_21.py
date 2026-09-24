"""Test del Passo 4, rifinitura 2/3 ("Salta", giorno di assenza) su
Postgres locale che simula Supabase. Richiede DB con 00 + 01..21 caricati.

Non tocchiamo enabled/game_live: lasciati ai valori di default (enabled
true dall'insert del 02, game_live false finché non attivato) cosi' ogni
challenge del giorno usa ancora i parametri "semplici" (nessuna chiave
'gioco'): complete_challenge() (il "Fatto" semplice) basta per tutti,
niente bisogno di rispondere a un gioco vero — qui si testa solo la
logica di skip_day/unskip_day, non i giochi."""
from _lib import admin, as_user, check, clock, cur, expect_error, report, rpc

admin()
cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('b@x.it') returning id"); B = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('c@x.it') returning id"); C = str(cur.fetchone()[0])
cur.execute("insert into public.couples (created_by) values (%s) returning id", (A,)); CP = cur.fetchone()[0]
cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-09-20 09:00+02'),(%s,%s,'2026-09-20 09:00+02')", (CP, A, CP, B))

clock("2026-09-20 10:00")
as_user(A); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(B); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])

# --- senza coppia ------------------------------------------------------------
as_user(C)
check("skip_day senza coppia", rpc("skip_day")["error"], "senza_coppia")
check("unskip_day: nessun salto (anche senza coppia)", rpc("unskip_day")["error"], "nessun_salto")

# --- A salta OGGI (lun, alle 06:00: mancano 60 min alla sveglia) ------------
clock("2026-09-21 06:00"); as_user(A)
check("A salta oggi", rpc("skip_day"), {"ok": True, "giorno": "2026-09-21"})
check("richiamarlo di nuovo non fa danni (stesso giorno)", rpc("skip_day"), {"ok": True, "giorno": "2026-09-21"})

t = rpc("get_today")
check("A: stato saltato", t["io"]["stato"], "saltato")
check("A: 'conta' reale, nessun segreto per sé", t["conta"], False)
check("A: nessuna challenge mostrata", t["io"]["challenge"], None)
check("A: salto annullabile", (t["io"]["salto_annullabile"], t["io"]["salto_giorno"]), (True, "2026-09-21"))
check("A: niente punti né secondi", (t["io"]["punti"], t["io"]["secondi"]), (None, None))

as_user(B)
tb = rpc("get_today")
check("B: non si accorge di nulla, 'conta' nascosto a True", tb["conta"], True)
check("B: partner nascosto come sempre (giornata di B non chiusa)", tb["partner"]["stato"], "nascosto")
check("B: la propria sveglia è quella vera, gioca normalmente", tb["io"]["stato"], "in_attesa")

# passata l'ora della sveglia ORIGINALE di A: A resta 'saltato', non torna 'scaduto'
clock("2026-09-21 07:10"); as_user(A)
check("A: resta saltato anche dopo l'orario originale", rpc("get_today")["io"]["stato"], "saltato")
check("A: 'Fatto' rifiutato (giorno saltato)", rpc("complete_challenge")["error"], "giorno_saltato")

as_user(B)
check("B ancora non si accorge di nulla", rpc("get_today")["conta"], True)

# B gioca normalmente: sveglia, challenge, cronometro, Fatto
clock("2026-09-21 07:30:10"); as_user(B)
check("B: in_corso normale", rpc("get_today")["io"]["stato"], "in_corso")
r = rpc("complete_challenge")
check("B completa normalmente", (r["ok"], r["secondi"]), (True, 10.0))

t = rpc("get_today")
check("B: ora la giornata è chiusa", t["chiuso"], True)
check("B: ora vede la verità (non conta)", t["conta"], False)
check("B: banner 'partner ha saltato'", t["partner"]["stato"], "saltato")
check("B: niente punti (giorno non conta per nessuno)", (t["io"]["punti"], t["partner"]["punti"]), (None, None))
as_user(A)
check("A: vede B fatto ma resta 'saltato' lui stesso", rpc("get_today")["io"]["stato"], "saltato")

# --- annulla salto entro la finestra -----------------------------------------
clock("2026-09-22 06:00"); as_user(A)
check("A salta martedì", rpc("skip_day"), {"ok": True, "giorno": "2026-09-22"})
check("A annulla il salto (ampio preavviso)", rpc("unskip_day"), {"ok": True, "giorno": "2026-09-22"})
t = rpc("get_today")
check("A: torna 'in_attesa' normale", t["io"]["stato"], "in_attesa")
check("A: nessun salto annullabile", t["io"]["salto_annullabile"], False)
check("annullarlo di nuovo: nessun salto pendente", rpc("unskip_day")["error"], "nessun_salto")

# --- confine dei 30 minuti: esattamente 30 min prima ammesso, 1s in più no --
clock("2026-09-22 06:30"); as_user(A)   # esattamente 30 min prima delle 07:00
check("A salta martedì a esattamente 30 min di preavviso: ammesso, resta oggi", rpc("skip_day"), {"ok": True, "giorno": "2026-09-22"})
check("annulla ancora ammesso a 30 min esatti", rpc("unskip_day"), {"ok": True, "giorno": "2026-09-22"})

clock("2026-09-22 06:30:01"); as_user(A)   # un secondo oltre: non basta più per "oggi"
r = rpc("skip_day")
check("a meno di 30 min: salta il PROSSIMO giorno con sveglia (mercoledì), non oggi", r, {"ok": True, "giorno": "2026-09-23"})

# a questo punto martedì (22/09) non è saltato: A gioca normalmente
t = rpc("get_today")
check("martedì: A NON è saltato (il salto è scattato su mercoledì)", t["io"]["stato"], "in_attesa")

# --- troppo tardi per annullare il salto di mercoledì -----------------------
clock("2026-09-23 06:35"); as_user(A)   # 25 min prima delle 07:00 di mercoledì
check("troppo tardi per annullare (meno di 30 min)", rpc("unskip_day")["error"], "troppo_tardi")
check("mercoledì: A resta saltato", rpc("get_today")["io"]["stato"], "saltato")

# --- nessuna sveglia futura: skip_day non trova nulla da saltare -----------
clock("2026-09-24 08:00"); as_user(A)   # giovedì, sveglia di A già passata da un pezzo
rpc("set_alarm", "07:00", [])   # A toglie tutte le sveglie
check("A senza sveglie: nessun giorno futuro da saltare", rpc("skip_day")["error"], "nessuna_sveglia_futura")
rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])   # ripristina per il resto del test

# --- nessun limite al numero di salti: più salti di fila in settimane diverse --
for giorno_test, atteso in [("2026-09-28 06:00", "2026-09-28"), ("2026-10-05 06:00", "2026-10-05")]:
    clock(giorno_test)
    check(f"salto senza limiti ({atteso})", rpc("skip_day"), {"ok": True, "giorno": atteso})

# --- sicurezza ---------------------------------------------------------------
as_user(None)
expect_error("anonimo non chiama skip_day", "select public.skip_day()")
expect_error("anonimo non chiama unskip_day", "select public.unskip_day()")
as_user(A)
expect_error("client non legge skip_days direttamente", "select * from public.skip_days")

report()
