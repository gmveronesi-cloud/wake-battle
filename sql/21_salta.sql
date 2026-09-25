-- =====================================================================
-- Wake Battle — Passo 4 (rifinitura 2/3): pulsante "Salta" (giorno di
-- assenza)
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..20 già eseguiti. Da lanciare UNA volta sola (rilanciarlo
-- per sbaglio non fa danni, tranne il "drop function" su wb_day_rows che
-- viene subito ricreata dallo stesso file).
--
-- Regole (decise in questa sessione, vedi anche docs/DECISIONI.md):
--  - Un pulsante in "Oggi" annulla la PROSSIMA sveglia di chi lo preme:
--    oggi se mancano almeno 30 minuti alla propria sveglia, altrimenti il
--    prossimo giorno lun-ven in cui ha una sveglia. Annullabile (stesso
--    pulsante diventa "Annulla salto") fino allo stesso limite di 30
--    minuti. Nessun limite al numero di salti.
--  - Annulla SOLO la sveglia di chi lo preme: il partner gioca
--    normalmente (sveglia, challenge, cronometro) e continua a vedere il
--    suo orario originale finché la sua giornata non è chiusa (partner
--    finito o 5 minuti scaduti) — poi vede "Giornata annullata: <nome>
--    ha saltato". La giornata non conta per nessuno (DECISIONI.md #7,
--    stessa regola di "manca la sveglia di uno dei due").
--  - Tecnicamente: NON tocchiamo alarm_settings/player_days (l'orario
--    resta quello vero, come lo vede il partner). Una tabella a parte,
--    skip_days, registra solo "questo utente ha saltato questo giorno";
--    wb_day_rows() la consulta per calcolare 'counts' (giorno che non
--    conta) e forza 'done' a true per chi ha saltato (cosi' 'closed'
--    dipende solo dal completamento del partner, non da un cronometro
--    che per chi salta non esiste). alarm_at resta quello originale.
-- =====================================================================

-- ---------- TABELLA DEI SALTI ----------
create table if not exists public.skip_days (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  created_at timestamptz not null default public.wb_now(),
  primary key (user_id, day)
);
alter table public.skip_days enable row level security;
revoke all on public.skip_days from public, anon, authenticated;

-- ---------- wb_day_rows(): aggiunta la colonna 'skip', 'counts'/'done' la considerano ----------
-- (cambia la forma della tabella restituita: va droppata e ricreata)
drop function if exists public.wb_day_rows(uuid, date);

create function public.wb_day_rows(p_couple uuid, p_day date)
returns table (user_id uuid, alarm_at timestamptz, finished_at timestamptz,
               seconds numeric, counts boolean, closed boolean,
               points numeric, week_seconds numeric, skip boolean)
language sql stable set search_path = ''
as $$
  with x as (
    select m.user_id,
           public.wb_alarm(m.user_id, p_day) as a,
           (select pd.finished_at from public.player_days pd
             where pd.user_id = m.user_id and pd.day = p_day) as f,
           exists(select 1 from public.skip_days sk
                   where sk.user_id = m.user_id and sk.day = p_day) as skip
    from public.couple_members m
    where m.couple_id = p_couple
  ), y as (
    select x.*, round(extract(epoch from (x.f - x.a))::numeric, 1) as s,
           (x.skip or x.f is not null or x.a is null
            or public.wb_now() > x.a + interval '5 minutes') as done
    from x
  ), g as (
    select count(*) = 2
           and count(a) = 2
           and not bool_or(skip)
           and extract(isodow from p_day) between 1 and 5
           and p_day >= public.wb_couple_start(p_couple) as counts,
           bool_and(done) as closed
    from y
  )
  select y.user_id, y.a, y.f, y.s, g.counts, g.closed,
         case when not (g.counts and g.closed) then null
              when y.s is null then 0
              when o.s is null then 1
              when y.s < o.s then 1
              when y.s = o.s then 0.5
              else 0 end,
         case when g.counts and g.closed then coalesce(y.s, 300) end,
         y.skip
  from y cross join g
  left join y o on o.user_id <> y.user_id
$$;
revoke all on function public.wb_day_rows(uuid, date) from public, anon, authenticated;

-- ---------- wb_complete(): rifiuta "Fatto"/gioco per chi ha saltato il giorno ----------
create or replace function public.wb_complete(p_uid uuid, p_answer jsonb, p_with_game boolean)
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  v_now    timestamptz := public.wb_now();
  v_couple uuid;
  d        date;
  v_a      timestamptz;
  v_f      timestamptz;
  cd       public.couple_days%rowtype;
  v_game   boolean;
begin
  select couple_id into v_couple from public.couple_members where user_id = p_uid;
  if v_couple is null then
    return jsonb_build_object('ok', false, 'error', 'senza_coppia');
  end if;

  d := public.wb_game_day(p_uid);

  if exists (select 1 from public.skip_days where user_id = p_uid and day = d) then
    return jsonb_build_object('ok', false, 'error', 'giorno_saltato');
  end if;

  v_a := public.wb_alarm(p_uid, d);

  if v_a is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna_sveglia');
  end if;
  if v_now < v_a then
    return jsonb_build_object('ok', false, 'error', 'troppo_presto', 'sveglia', v_a);
  end if;

  select finished_at into v_f from public.player_days where user_id = p_uid and day = d;
  if v_f is not null then
    return jsonb_build_object('ok', false, 'error', 'gia_fatto',
      'secondi', round(extract(epoch from (v_f - v_a))::numeric, 1));
  end if;
  if v_now > v_a + interval '5 minutes' then
    return jsonb_build_object('ok', false, 'error', 'tempo_scaduto');
  end if;

  cd := public.wb_ensure_challenge(v_couple, d);
  v_game := coalesce(cd.params ? 'gioco', false);
  if v_game and not p_with_game then
    return jsonb_build_object('ok', false, 'error', 'serve_il_gioco');
  end if;
  if p_with_game and not v_game then
    return jsonb_build_object('ok', false, 'error', 'nessun_gioco');
  end if;
  if v_game and not public.wb_check_answer(cd.challenge, cd.params, p_answer) then
    return jsonb_build_object('ok', false, 'error', 'risposta_sbagliata');
  end if;

  insert into public.player_days (user_id, day, alarm_at, finished_at)
  values (p_uid, d, v_a, v_now)
  on conflict (user_id, day) do update set finished_at = excluded.finished_at
    where public.player_days.finished_at is null
  returning finished_at into v_f;
  if v_f is null then
    return jsonb_build_object('ok', false, 'error', 'gia_fatto');
  end if;

  return jsonb_build_object('ok', true, 'giorno', d,
    'secondi', round(extract(epoch from (v_f - v_a))::numeric, 1));
end;
$$;

-- ---------- skip_day() / unskip_day(): RPC per l'app ----------
-- Errori: senza_coppia | nessuna_sveglia_futura (skip) | nessun_salto | troppo_tardi (unskip)
create or replace function public.skip_day()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_now   timestamptz := public.wb_now();
  v_today date := public.wb_today();
  d       date;
  v_a     timestamptz;
  i       int := 0;
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  if not exists (select 1 from public.couple_members where user_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'senza_coppia');
  end if;

  v_a := public.wb_alarm(v_uid, v_today);
  if v_a is not null and v_now <= v_a - interval '30 minutes' then
    d := v_today;
  else
    d := v_today + 1;
    loop
      v_a := public.wb_alarm(v_uid, d);
      exit when v_a is not null or i > 30;   -- 30 = rete di sicurezza, non dovrebbe mai servire
      d := d + 1;
      i := i + 1;
    end loop;
    if v_a is null then
      return jsonb_build_object('ok', false, 'error', 'nessuna_sveglia_futura');
    end if;
  end if;

  insert into public.skip_days (user_id, day, created_at)
  values (v_uid, d, v_now)
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'giorno', d);
end;
$$;

-- Annulla il salto più vicino ancora nella finestra dei 30 minuti (se il
-- salto era per oggi e mancano meno di 30 minuti alla sveglia, o è già
-- passata, non si può più annullare).
create or replace function public.unskip_day()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_now   timestamptz := public.wb_now();
  v_today date := public.wb_today();
  d       date;
  v_a     timestamptz;
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;

  select sk.day into d from public.skip_days sk
  where sk.user_id = v_uid and sk.day >= v_today
  order by sk.day limit 1;

  if d is null then
    return jsonb_build_object('ok', false, 'error', 'nessun_salto');
  end if;

  v_a := public.wb_alarm(v_uid, d);
  if v_a is not null and v_now > v_a - interval '30 minutes' then
    return jsonb_build_object('ok', false, 'error', 'troppo_tardi');
  end if;

  delete from public.skip_days where user_id = v_uid and day = d;
  return jsonb_build_object('ok', true, 'giorno', d);
end;
$$;

-- ---------- get_today(): stato 'saltato', banner del partner, flag per il pulsante ----------
-- Il resto è identico al 20 (foto/video a richiesta): qui in più, 'conta'
-- resta il valore "come se non fosse successo nulla" per chi non ha
-- saltato finché la SUA giornata non è chiusa (niente banner "non conta"
-- in anticipo: il partner non deve accorgersi del salto prima che finisca
-- di giocare o scadano i suoi 5 minuti).
create or replace function public.get_today()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid          uuid := auth.uid();
  v_now          timestamptz := public.wb_now();
  v_today        date := public.wb_today();
  v_couple       uuid;
  v_partner      uuid;
  d              date;
  r_me           record;
  r_pa           record;
  cd             public.couple_days%rowtype;
  v_state        text;
  v_pstate       text;
  v_ch           jsonb := null;
  v_conta        boolean;
  v_salto_giorno date;
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
    when r_me.skip then 'saltato'
    when r_me.alarm_at is null then 'nessuna_sveglia'
    when r_me.finished_at is not null then 'fatto'
    when v_now < r_me.alarm_at then 'in_attesa'
    when v_now <= r_me.alarm_at + interval '5 minutes' then 'in_corso'
    else 'scaduto' end;

  -- la challenge si vede solo dall'orario della propria sveglia (mai per chi ha saltato)
  if not r_me.skip and r_me.alarm_at is not null and v_now >= r_me.alarm_at then
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
    when r_pa.skip then 'saltato'
    when r_pa.finished_at is not null then 'fatto'
    else 'scaduto' end;

  -- 'conta' nascosto (mostrato true) se il salto è del partner e la MIA
  -- giornata non è ancora chiusa: io continuo a giocare senza saperlo.
  v_conta := case when r_pa.skip and not r_me.skip and not r_me.closed
                  then true else r_me.counts end;

  -- salto mio più vicino ancora annullabile (per il pulsante "Annulla salto")
  select sk.day into v_salto_giorno
  from public.skip_days sk
  where sk.user_id = v_uid and sk.day >= v_today
    and (public.wb_alarm(v_uid, sk.day) is null
         or v_now <= public.wb_alarm(v_uid, sk.day) - interval '30 minutes')
  order by sk.day limit 1;

  return jsonb_build_object(
    'ok', true,
    'ora_server', v_now,
    'giorno',     d,
    'conta',      v_conta,
    'chiuso',     r_me.closed,
    'io', jsonb_build_object(
      'sveglia',   r_me.alarm_at,
      'scadenza',  r_me.alarm_at + interval '5 minutes',
      'stato',     v_state,
      'secondi',   r_me.seconds,
      'punti',     r_me.points,
      'challenge', v_ch,
      'salto_annullabile', v_salto_giorno is not null,
      'salto_giorno',      v_salto_giorno,
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

-- ---------- PERMESSI ----------
revoke all on function public.skip_day()   from public, anon;
revoke all on function public.unskip_day() from public, anon;
grant execute on function public.skip_day()   to authenticated;
grant execute on function public.unskip_day() to authenticated;
-- get_today()/complete_challenge()/complete_game() mantengono i permessi
-- già concessi dal 02/03 (CREATE OR REPLACE non li tocca).
