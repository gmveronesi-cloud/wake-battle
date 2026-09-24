-- =====================================================================
-- Wake Battle — Passo 4 (rifinitura 1/3): video/foto scaricati SOLO a
-- richiesta, non più dentro get_today()
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..19 già eseguiti. Da lanciare UNA volta sola (rilanciarlo
-- per sbaglio non fa danni).
--
-- Decisioni di questa sessione (vedi anche docs/DECISIONI.md):
--  - get_today() non manda più il contenuto delle foto ("Trova l'oggetto")
--    né dei video ("Occhi aperti"/"Esercizi"): solo un flag booleano
--    "c'è" (ha_foto/ha_video/ha_video_esercizi), separato per me e per il
--    partner, con lo STESSO gate di visibilità di sempre (proprio subito,
--    partner solo a giornata chiusa, DECISIONI.md #11). Il motivo: su
--    iPhone scaricare foto/video ad ogni giro di get_today() (ripetuto
--    ogni 20s in "Oggi") è inutile quando la persona non li guarda.
--  - Tre nuove RPC per scaricare il contenuto vero solo quando l'app lo
--    chiede esplicitamente (tocco su "Guarda video"/"Vedi foto"):
--    get_object_photos(p_partner), get_eye_video(p_partner),
--    get_exercise_video(p_partner). Stesso identico controllo di
--    visibilità di get_today (se p_partner: solo se la MIA giornata,
--    quella del chiamante, risulta chiusa).
--  - Esercizi: il video non resta più visibile 48 ore piene dalla
--    registrazione: da oggi si comporta come "Occhi aperti", visibile
--    solo per la giornata di gioco in cui è stato girato (sparisce da
--    solo il giorno dopo, stesso "day = d" di eye_videos/object_photos).
--    save_exercise_video ripulisce di conseguenza le righe più vecchie di
--    24 ore (come le altre due tabelle) invece di 48.
--  - Nessuna nuova tabella: object_photos/eye_videos/exercise_videos
--    restano quelle di 17/18/19, solo lette da funzioni diverse.
-- =====================================================================

-- ---------- get_today(): 'foto'/'video'/'video_esercizi' diventano flag ----------
create or replace function public.get_today()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_now     timestamptz := public.wb_now();
  v_couple  uuid;
  v_partner uuid;
  d         date;
  r_me      record;
  r_pa      record;
  cd        public.couple_days%rowtype;
  v_state   text;
  v_pstate  text;
  v_ch      jsonb := null;
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  select couple_id into v_couple from public.couple_members where user_id = v_uid;
  if v_couple is null then
    return jsonb_build_object('ok', false, 'error', 'senza_coppia');
  end if;
  select user_id into v_partner from public.couple_members
  where couple_id = v_couple and user_id <> v_uid;
  if v_partner is null then
    return jsonb_build_object('ok', false, 'error', 'senza_partner');
  end if;

  d := public.wb_game_day(v_uid);
  select * into r_me from public.wb_day_rows(v_couple, d) where user_id = v_uid;
  select * into r_pa from public.wb_day_rows(v_couple, d) where user_id = v_partner;

  v_state := case
    when r_me.alarm_at is null then 'nessuna_sveglia'
    when r_me.finished_at is not null then 'fatto'
    when v_now < r_me.alarm_at then 'in_attesa'
    when v_now <= r_me.alarm_at + interval '5 minutes' then 'in_corso'
    else 'scaduto' end;

  -- la challenge si vede solo dall'orario della propria sveglia
  if r_me.alarm_at is not null and v_now >= r_me.alarm_at then
    cd := public.wb_ensure_challenge(v_couple, d);
    if cd.challenge is not null then
      v_ch := jsonb_build_object(
        'codice', cd.challenge,
        'nome',   (select name from public.challenge_types where code = cd.challenge),
        'parametri', cd.params);
    end if;
  end if;

  v_pstate := case
    when r_pa.alarm_at is null then 'nessuna_sveglia'
    when not r_me.closed then 'nascosto'
    when r_pa.finished_at is not null then 'fatto'
    else 'scaduto' end;

  return jsonb_build_object(
    'ok', true,
    'ora_server', v_now,
    'giorno',     d,
    'conta',      r_me.counts,
    'chiuso',     r_me.closed,
    'io', jsonb_build_object(
      'sveglia',   r_me.alarm_at,
      'scadenza',  r_me.alarm_at + interval '5 minutes',
      'stato',     v_state,
      'secondi',   r_me.seconds,
      'punti',     r_me.points,
      'challenge', v_ch,
      'ha_foto',           exists(select 1 from public.object_photos where user_id = v_uid and day = d),
      'ha_video',          exists(select 1 from public.eye_videos where user_id = v_uid and day = d),
      'ha_video_esercizi', exists(select 1 from public.exercise_videos where user_id = v_uid and day = d)),
    'partner', jsonb_build_object(
      'nome',    (select display_name from public.profiles where id = v_partner),
      'sveglia', r_pa.alarm_at,
      'stato',   v_pstate,
      'secondi', case when r_me.closed then r_pa.seconds end,
      'punti',   r_pa.points,
      'ha_foto',           r_me.closed and
                           exists(select 1 from public.object_photos where user_id = v_partner and day = d),
      'ha_video',          r_me.closed and
                           exists(select 1 from public.eye_videos where user_id = v_partner and day = d),
      'ha_video_esercizi', r_me.closed and
                           exists(select 1 from public.exercise_videos where user_id = v_partner and day = d)));
end;
$$;

-- ---------- save_exercise_video: pulizia a 24h (non più 48h), il video ----------
-- ---------- ormai visibile solo per la giornata di gioco, come 'video' ----------
create or replace function public.save_exercise_video(p_video text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_day date;
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  if p_video is null or p_video !~ '^data:video/' or octet_length(p_video) > 34000000 then
    return jsonb_build_object('ok', false, 'error', 'video_non_valido');
  end if;

  v_day := public.wb_game_day(v_uid);
  insert into public.exercise_videos (user_id, day, video, created_at)
  values (v_uid, v_day, p_video, public.wb_now())
  on conflict (user_id, day) do update
    set video = excluded.video, created_at = excluded.created_at;

  -- pulizia: niente cron dedicato, si ripulisce da sola al prossimo scatto
  -- dello stesso utente (righe più vecchie di 24 ore, come object_photos/
  -- eye_videos: da questo passo il video è visibile solo per "day = d",
  -- non più 48 ore piene dalla registrazione)
  delete from public.exercise_videos
  where user_id = v_uid and created_at < public.wb_now() - interval '24 hours';

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- NUOVE RPC: scaricano il contenuto solo quando serve davvero ----------

-- Foto di "Trova l'oggetto" (proprie se p_partner = false, del partner se
-- true). Stesso gate di get_today: le proprie sempre, quelle del partner
-- solo se la giornata di CHI CHIAMA è chiusa (DECISIONI.md #11).
create or replace function public.get_object_photos(p_partner boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_couple  uuid;
  v_partner uuid;
  v_target  uuid;
  d         date;
  v_closed  boolean;
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  select couple_id into v_couple from public.couple_members where user_id = v_uid;
  if v_couple is null then
    return jsonb_build_object('ok', false, 'error', 'senza_coppia');
  end if;
  select user_id into v_partner from public.couple_members
  where couple_id = v_couple and user_id <> v_uid;
  if v_partner is null then
    return jsonb_build_object('ok', false, 'error', 'senza_partner');
  end if;

  d := public.wb_game_day(v_uid);
  v_target := case when p_partner then v_partner else v_uid end;

  if p_partner then
    select closed into v_closed from public.wb_day_rows(v_couple, d) where user_id = v_uid;
    if not coalesce(v_closed, false) then
      return jsonb_build_object('ok', false, 'error', 'non_visibile');
    end if;
  end if;

  return jsonb_build_object('ok', true,
    'foto', (select foto from public.object_photos where user_id = v_target and day = d));
end;
$$;

-- Video di "Occhi aperti" (stesso gate di get_object_photos).
create or replace function public.get_eye_video(p_partner boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_couple  uuid;
  v_partner uuid;
  v_target  uuid;
  d         date;
  v_closed  boolean;
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  select couple_id into v_couple from public.couple_members where user_id = v_uid;
  if v_couple is null then
    return jsonb_build_object('ok', false, 'error', 'senza_coppia');
  end if;
  select user_id into v_partner from public.couple_members
  where couple_id = v_couple and user_id <> v_uid;
  if v_partner is null then
    return jsonb_build_object('ok', false, 'error', 'senza_partner');
  end if;

  d := public.wb_game_day(v_uid);
  v_target := case when p_partner then v_partner else v_uid end;

  if p_partner then
    select closed into v_closed from public.wb_day_rows(v_couple, d) where user_id = v_uid;
    if not coalesce(v_closed, false) then
      return jsonb_build_object('ok', false, 'error', 'non_visibile');
    end if;
  end if;

  return jsonb_build_object('ok', true,
    'video', (select video from public.eye_videos where user_id = v_target and day = d));
end;
$$;

-- Video di "Esercizi" (stesso gate; da questo passo "day = d" come sopra,
-- non più una finestra di 48 ore svincolata dalla giornata).
create or replace function public.get_exercise_video(p_partner boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_couple  uuid;
  v_partner uuid;
  v_target  uuid;
  d         date;
  v_closed  boolean;
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  select couple_id into v_couple from public.couple_members where user_id = v_uid;
  if v_couple is null then
    return jsonb_build_object('ok', false, 'error', 'senza_coppia');
  end if;
  select user_id into v_partner from public.couple_members
  where couple_id = v_couple and user_id <> v_uid;
  if v_partner is null then
    return jsonb_build_object('ok', false, 'error', 'senza_partner');
  end if;

  d := public.wb_game_day(v_uid);
  v_target := case when p_partner then v_partner else v_uid end;

  if p_partner then
    select closed into v_closed from public.wb_day_rows(v_couple, d) where user_id = v_uid;
    if not coalesce(v_closed, false) then
      return jsonb_build_object('ok', false, 'error', 'non_visibile');
    end if;
  end if;

  return jsonb_build_object('ok', true,
    'video', (select video from public.exercise_videos where user_id = v_target and day = d));
end;
$$;

-- ---------- PERMESSI ----------
-- get_today() mantiene i permessi già concessi dal 02 (CREATE OR REPLACE
-- non li tocca); save_exercise_video idem dal 19.
revoke all on function public.get_object_photos(boolean) from public, anon;
revoke all on function public.get_eye_video(boolean)      from public, anon;
revoke all on function public.get_exercise_video(boolean) from public, anon;
grant execute on function public.get_object_photos(boolean) to authenticated;
grant execute on function public.get_eye_video(boolean)      to authenticated;
grant execute on function public.get_exercise_video(boolean) to authenticated;
