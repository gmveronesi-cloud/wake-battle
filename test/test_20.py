"""Test del Passo 4, rifinitura 1/3 (video/foto a richiesta) su Postgres
locale che simula Supabase. Richiede DB con 00 + 01..20 caricati.
get_today() non manda più il contenuto di foto/video, solo un flag
booleano ('ha_foto'/'ha_video'/'ha_video_esercizi', separati io/partner);
il contenuto si scarica con get_object_photos/get_eye_video/
get_exercise_video, stesso gate di visibilità di sempre (proprio subito,
partner solo a giornata chiusa). La copertura funzionale completa di
questo comportamento (fotografie/video reali, sovrascrittura, pulizia a
24h) resta nei test dei singoli giochi (17/18/19, aggiornati in questa
stessa sessione); qui si controllano solo le cose NUOVE: forma della
risposta, errori, permessi."""
from _lib import admin, as_user, check, clock, cur, expect_error, jrpc, report, rpc

admin()
cur.execute("insert into auth.users (email) values ('a@x.it') returning id"); A = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('b@x.it') returning id"); B = str(cur.fetchone()[0])
cur.execute("insert into auth.users (email) values ('c@x.it') returning id"); C = str(cur.fetchone()[0])
cur.execute("insert into public.couples (created_by) values (%s) returning id", (A,)); CP = cur.fetchone()[0]
cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-09-20 09:00+02'),(%s,%s,'2026-09-20 09:00+02')", (CP, A, CP, B))

admin()
cur.execute("update public.challenge_types set enabled = (code = 'oggetto'), game_live = (code = 'oggetto')")
clock("2026-09-20 10:00")
as_user(A); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
as_user(B); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])

# --- senza coppia/senza partner: le tre RPC rispondono come get_today ---
as_user(C)
check("get_object_photos senza coppia", rpc("get_object_photos")["error"], "senza_coppia")
check("get_eye_video senza coppia", rpc("get_eye_video")["error"], "senza_coppia")
check("get_exercise_video senza coppia", rpc("get_exercise_video")["error"], "senza_coppia")

# --- get_today non contiene più 'foto'/'video'/'video_esercizi', solo i flag ---
clock("2026-09-21 07:00:40"); as_user(A)
t = rpc("get_today")
check("niente 'foto' nella risposta", "foto" in t["io"], False)
check("niente 'video' nella risposta", "video" in t["io"], False)
check("niente 'video_esercizi' nella risposta", "video_esercizi" in t["io"], False)
check("i flag ci sono e sono booleani",
      all(isinstance(t["io"][k], bool) for k in ("ha_foto", "ha_video", "ha_video_esercizi")), True)
check("flag falsi prima di qualunque scatto/registrazione",
      (t["io"]["ha_foto"], t["io"]["ha_video"], t["io"]["ha_video_esercizi"]), (False, False, False))
check("stesso per il partner", (t["partner"]["ha_foto"], t["partner"]["ha_video"], t["partner"]["ha_video_esercizi"]), (False, False, False))

# --- p_partner di default false ---
check("get_object_photos senza argomenti = proprie", rpc("get_object_photos")["ok"], True)
check("get_eye_video senza argomenti = proprio", rpc("get_eye_video")["ok"], True)
check("get_exercise_video senza argomenti = proprio", rpc("get_exercise_video")["ok"], True)

# --- prima che la giornata sia chiusa: le foto del partner non si scaricano ---
r = jrpc("complete_game", {"fatto": True})
check("A completa oggetto", r["ok"], True)
FA = ["data:image/jpeg;base64,Xa" + str(i) for i in range(5)]
check("A salva le foto", jrpc("save_object_photos", FA)["ok"], True)
check("A: flag proprio true", rpc("get_today")["io"]["ha_foto"], True)
check("A prova a scaricare le foto del partner (giornata non chiusa)", rpc("get_object_photos", True)["error"], "non_visibile")

# --- sicurezza: anonimo non chiama le nuove RPC ---
as_user(None)
expect_error("anonimo non chiama get_object_photos", "select public.get_object_photos()")
expect_error("anonimo non chiama get_eye_video", "select public.get_eye_video()")
expect_error("anonimo non chiama get_exercise_video", "select public.get_exercise_video()")

report()
