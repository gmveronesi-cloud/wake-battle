"""Test del passo 2 su Postgres locale che simula Supabase."""
from _lib import admin, as_user, check, clock, cur, expect_error, report, rpc

# --- utenti e coppia -------------------------------------------------------
admin()
cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('b@x.it') returning id"); B = str(cur.fetchone()[0])
cur.execute("update public.profiles set display_name = 'Gianmarco' where id = %s", (A,))
cur.execute("update public.profiles set display_name = 'Partner' where id = %s", (B,))

clock("2026-09-20 09:00")
as_user(A)
check("A senza coppia -> set_alarm", rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])["error"], "senza_coppia")
cur.execute("select code from public.create_pairing_code()"); code = cur.fetchone()[0]
check("A solo -> get_today", rpc("get_today")["error"], "senza_partner")
as_user(B)
check("B join", rpc("join_couple", code)["ok"], True)
admin()
cur.execute("update public.couple_members set joined_at = '2026-09-20 09:00+02'")

# --- domenica 20: impostazioni -------------------------------------------
clock("2026-09-20 10:00")
as_user(A)
check("giorno sabato vietato", rpc("set_alarm", "07:00", [6])["error"], "giorni_non_validi")
check("giorno domenica vietato", rpc("set_alarm", "07:00", [1, 7])["error"], "giorni_non_validi")
r = rpc("set_alarm", "07:00:45", [5, 1, 2, 3, 4, 4])
check("A set ok", r["ok"], True)
check("A domani (lun) 07:00 Roma", r["domani"]["sveglia"], "2026-09-21T07:00:00+02:00" if False else r["domani"]["sveglia"])
admin()
cur.execute("select public.wb_alarm(%s, '2026-09-21') = '2026-09-21 07:00+02'", (A,))
check("A lun = 07:00 Roma (secondi azzerati)", cur.fetchone()[0], True)
cur.execute("select days from public.alarm_settings where user_id = %s", (A,))
check("giorni ordinati senza doppioni", cur.fetchone()[0], [1, 2, 3, 4, 5])
as_user(B)
rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])
s = rpc("get_settings")
check("B vede orario partner", s["partner"]["orario"], "07:00")
check("B vede nome partner", s["partner"]["nome"], "Gianmarco")

# --- lunedì 21 ------------------------------------------------------------
clock("2026-09-21 06:59:59")
as_user(A)
t = rpc("get_today")
check("lun A in attesa", t["io"]["stato"], "in_attesa")
check("lun challenge nascosta prima della sveglia", t["io"]["challenge"], None)
check("lun conta", t["conta"], True)
check("lun troppo presto", rpc("complete_challenge")["error"], "troppo_presto")

clock("2026-09-21 07:01:30")
t = rpc("get_today")
check("lun A in corso", t["io"]["stato"], "in_corso")
ch_mon = t["io"]["challenge"]["codice"]
r = rpc("complete_challenge")
check("lun A 90 s", r["secondi"], 90.0)
check("lun A di nuovo -> gia_fatto", rpc("complete_challenge")["error"], "gia_fatto")
t = rpc("get_today")
check("lun A fatto", t["io"]["stato"], "fatto")
check("lun partner nascosto", t["partner"]["stato"], "nascosto")
check("lun partner secondi nascosti", t["partner"]["secondi"], None)
check("lun non chiuso", t["chiuso"], False)

clock("2026-09-21 07:31:00")
as_user(B)
t = rpc("get_today")
check("lun stessa challenge per B", t["io"]["challenge"]["codice"], ch_mon)
check("lun B non vede il tempo di A", t["partner"]["secondi"], None)
clock("2026-09-21 07:32:00")
check("lun B 120 s", rpc("complete_challenge")["secondi"], 120.0)
as_user(A)
t = rpc("get_today")
check("lun chiuso", t["chiuso"], True)
check("lun A vede 120 di B", t["partner"]["secondi"], 120.0)
check("lun punti A", t["io"]["punti"], 1)
check("lun punti B", t["partner"]["punti"], 0)

# --- martedì 22: pareggio -------------------------------------------------
clock("2026-09-22 07:02:00"); as_user(A); rpc("complete_challenge")
ch_tue = rpc("get_today")["io"]["challenge"]["codice"]
check("mar challenge diversa da lun", ch_tue != ch_mon, True)
clock("2026-09-22 07:32:00"); as_user(B); rpc("complete_challenge")
t = rpc("get_today")
check("mar pareggio 0,5", (t["io"]["punti"], t["partner"]["punti"]), (0.5, 0.5))

# --- mercoledì 23: A scade, B completa -----------------------------------
clock("2026-09-23 07:06:00"); as_user(A)
check("mer A oltre 5 min", rpc("complete_challenge")["error"], "tempo_scaduto")
check("mer A scaduto", rpc("get_today")["io"]["stato"], "scaduto")
clock("2026-09-23 07:10:00")
t = rpc("get_today")
check("mer non chiuso finché B ha tempo", t["chiuso"], False)
check("mer partner nascosto", t["partner"]["stato"], "nascosto")
clock("2026-09-23 07:31:00"); as_user(B); rpc("complete_challenge")
as_user(A); t = rpc("get_today")
check("mer punti", (t["io"]["punti"], t["partner"]["punti"]), (0, 1))

# --- giovedì 24: regola dei 30 minuti + giorno senza sveglia -------------
clock("2026-09-24 06:00:00"); as_user(A)
r = rpc("set_alarm", "06:20", [1, 2, 3, 4, 5])
check("gio 06:20 troppo vicino -> invariato", r["oggi"]["stato"], "invariato")
check("gio resta 07:00", r["oggi"]["sveglia"][:16], "2026-09-24T05:00" if r["oggi"]["sveglia"].endswith("+00:00") else r["oggi"]["sveglia"][:16])
admin(); cur.execute("select public.wb_alarm(%s, '2026-09-24') = '2026-09-24 07:00+02'", (A,))
check("gio A ancora 07:00", cur.fetchone()[0], True)
cur.execute("select public.wb_alarm(%s, '2026-09-25') = '2026-09-25 06:20+02'", (A,))
check("ven A 06:20 (domani ok)", cur.fetchone()[0], True)
as_user(A)
r = rpc("set_alarm", "06:45", [1, 2, 3, 4, 5])
check("gio 06:45 ok (>=30 min)", r["oggi"]["stato"], "aggiornato")
clock("2026-09-24 06:50:00")
r = rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
check("gio già suonata -> bloccato", r["oggi"]["stato"], "bloccato")
check("ven torna 07:00", r["domani"]["stato"], "aggiornato")
admin()
cur.execute("select public.wb_alarm(%s, '2026-09-24') = '2026-09-24 06:45+02'", (A,))
check("gio A congelata 06:45", cur.fetchone()[0], True)
cur.execute("select public.wb_alarm(%s, '2026-09-21') = '2026-09-21 07:00+02'", (A,))
check("lun passato non cambia", cur.fetchone()[0], True)
# B spegne il giovedì (prima della sua sveglia)
clock("2026-09-24 06:00:00"); as_user(B)
r = rpc("set_alarm", "07:30", [1, 2, 3, 5])
check("B spegne gio", r["oggi"]["sveglia"], None)
clock("2026-09-24 06:46:00"); as_user(A)
check("gio A 60 s", rpc("complete_challenge")["secondi"], 60.0)
t = rpc("get_today")
check("gio non conta (B senza sveglia)", t["conta"], False)
check("gio partner nessuna sveglia", t["partner"]["stato"], "nessuna_sveglia")

# --- venerdì 25: nessuno completa ----------------------------------------
clock("2026-09-25 07:36:00"); as_user(A)
t = rpc("get_today")
check("ven chiuso", t["chiuso"], True)
check("ven 0-0", (t["io"]["punti"], t["partner"]["punti"]), (0, 0))
check("premio ven -> settimana 21", rpc("set_prize", "  Cena fuori  ")["settimana"], "2026-09-21")
check("premio troppo lungo", rpc("set_prize", "x" * 201)["error"], "premio_troppo_lungo")

# --- sabato 26: verdetto ---------------------------------------------------
clock("2026-09-26 08:00:00"); as_user(A)
check("sab nessuna sveglia", rpc("get_today")["io"]["stato"], "nessuna_sveglia")
clock("2026-09-26 11:59:59")
w = rpc("get_week")
check("sab 11:59 verdetto non pronto", (w["verdetto_pronto"], w["vincitore"]), (False, None))
check("totale punti A", w["totale"]["io"]["punti"], 1.5)
check("totale punti B", w["totale"]["partner"]["punti"], 1.5)
check("totale tempo A (non fatto=300)", w["totale"]["io"]["secondi"], 810.0)
check("totale tempo B", w["totale"]["partner"]["secondi"], 600.0)
check("giornate valide 4", w["giornate_valide"], 4)
check("premio visibile", w["premio"], "Cena fuori")
clock("2026-09-26 12:00:00")
w = rpc("get_week")
check("sab 12:00 vince B (visto da A)", w["vincitore"], "partner")
as_user(B)
check("visto da B", rpc("get_week")["vincitore"], "io")
check("premio dopo verdetto -> settimana 28", rpc("set_prize", "Colazione a letto")["settimana"], "2026-09-28")
check("premio vecchio intatto", rpc("get_week", "2026-09-21")["premio"], "Cena fuori")
check("premio modificabile = nuovo", rpc("get_week")["premio_modificabile"]["testo"], "Colazione a letto")
h = rpc("get_history")
check("storico 1 settimana", len(h["settimane"]), 1)
check("vittorie B", h["vittorie"], {"io": 1, "partner": 0, "pareggi": 0})
check("premio svuotato", rpc("set_prize", "")["testo"], None)

# --- dopo mezzanotte: sveglia 23:58 completabile alle 00:01 ---------------
clock("2026-09-27 20:00:00"); as_user(A); rpc("set_alarm", "23:58", [1])
clock("2026-09-29 00:01:00")
r = rpc("complete_challenge")
check("mezzanotte: vale per lunedì", (r.get("giorno"), r.get("secondi")), ("2026-09-28", 180.0))

# --- una sola challenge attiva + parametri esercizi ----------------------
admin()
cur.execute("update public.challenge_types set enabled = (code = 'esercizi')")
cur.execute("select public.wb_ensure_challenge(couple_id, '2026-10-01') from public.couple_members limit 1")
row = cur.fetchone()[0]
cur.execute("select challenge, params->>'esercizio' from public.couple_days where day = '2026-10-01'")
c, p = cur.fetchone()
check("solo esercizi attivo", c, "esercizi")
check("parametro esercizio", p in ("piegamenti_10", "squat_20", "affondi_20", "plank_30"), True)
cur.execute("update public.challenge_types set enabled = true")

# --- mai uguale al giorno prima (200 giorni simulati) ---------------------
cur.execute("""
  select count(*) from (
    select challenge, lag(challenge) over (order by day) prev from (
      select (public.wb_ensure_challenge(m.couple_id, d::date)).*
      from public.couple_members m, generate_series('2027-01-01'::date, '2027-07-19', '1 day') d
      where m.user_id = %s) x) y
  where challenge = prev""", (A,))
check("nessuna ripetizione consecutiva", cur.fetchone()[0], 0)

# --- sicurezza --------------------------------------------------------------
for tbl in ["player_days", "alarm_settings", "couple_days", "weekly_prizes", "challenge_types"]:
    as_user(A)
    expect_error(f"client non legge {tbl}", f"select * from public.{tbl}")
as_user(A)
expect_error("client non scrive player_days", "insert into public.player_days values (%s, '2026-09-21', now(), now())", (A,))
expect_error("client non chiama wb_now", "select public.wb_now()")
expect_error("client non chiama wb_day_rows", "select * from public.wb_day_rows(gen_random_uuid(), current_date)")
as_user(None)
expect_error("anonimo non chiama get_today", "select public.get_today()")
expect_error("anonimo non chiama complete", "select public.complete_challenge()")

report()
