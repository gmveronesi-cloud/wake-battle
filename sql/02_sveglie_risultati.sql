-- =====================================================================
-- Wake Battle — Passo 2: sveglie, challenge del giorno, tempi, punteggi
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01_coppia.sql già eseguito. Non modifica nulla del passo 1.
-- Da lanciare UNA volta sola (la seconda dà "already exists").
--
-- Regole (DECISIONI.md + scelte del 21/09/2026):
--  - Fuso orario unico: Europe/Rome.
--  - Sveglie solo lun–ven. Settimana = lun–ven. Verdetto sabato alle 12:00.
--  - Cambio orario: vale anche per oggi/domani solo se la nuova sveglia è
--    almeno 30 minuti nel futuro; altrimenti quel giorno resta com'era.
--    Dopo che la sveglia di un giorno è suonata, quel giorno non cambia più.
--  - Cronometro: da orario sveglia al "Fatto" (ora del server). Oltre 5 min = persa.
--  - Giorno valido solo se ENTRAMBI hanno la sveglia.
--  - Punti: tempo minore = 1; pari (al decimo di secondo) = 0,5 a testa;
--    solo uno completa = 1 a lui; nessuno completa = 0 a entrambi.
--  - Pareggio settimanale: vince il tempo totale minore
--    (challenge non completata = 5:00).
--  - Il tempo del partner si vede solo a giornata chiusa.
--  - La challenge si scopre solo all'orario della propria sveglia.
--  - Premio: testo libero sempre modificabile (fino al verdetto della settimana).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABELLE
-- ---------------------------------------------------------------------

-- Elenco challenge. "enabled" permette di attivarle/disattivarle una a una.
create table public.challenge_types (
  code    text primary key,
  name    text not null,
  kind    text not null check (kind in ('fisica', 'schermo')),
  enabled boolean not null default true,
  sort    int not null default 0
);

insert into public.challenge_types (code, name, kind, sort) values
  ('qr',            'QR o codice a barre', 'fisica',   1),
  ('luce',          'Accendi la luce',     'fisica',   2),
  ('caccia_colori', 'Caccia ai colori',    'fisica',   3),
  ('oggetto',       'Trova l''oggetto',    'fisica',   4),
  ('occhi',         'Occhi aperti',        'fisica',   5),
  ('esercizi',      'Esercizi',            'fisica',   6),
  ('memoria',       'Memoria',             'schermo',  7),
  ('numeri',        'Numeri in ordine',    'schermo',  8),
  ('intruso',       'Trova l''intruso',    'schermo',  9),
  ('colore_parola', 'Colore della parola', 'schermo', 10),
  ('riflessi',      'Riflessi',            'schermo', 11),
  ('anagramma',     'Anagramma',           'schermo', 12);

-- Impostazione sveglia di ciascuno (orario + giorni lun=1 … ven=5).
-- effective_from: primo giorno calcolato da queste impostazioni
-- (i giorni precedenti sono "congelati" in player_days).
create table public.alarm_settings (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  alarm_time     time not null,
  days           smallint[] not null check (days <@ array[1,2,3,4,5]::smallint[]),
  effective_from date not null,
  updated_at     timestamptz not null default now()
);

-- Una riga per persona e giorno: sveglia congelata e ora del "Fatto".
-- alarm_at null = quel giorno niente sveglia.
create table public.player_days (
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date not null,
  alarm_at    timestamptz,
  finished_at timestamptz,
  primary key (user_id, day),
  check (finished_at is null or (alarm_at is not null
         and finished_at >= alarm_at
         and finished_at <= alarm_at + interval '5 minutes'))
);

-- Challenge del giorno: una per coppia e giorno, uguale per entrambi.
create table public.couple_days (
  couple_id  uuid not null references public.couples(id) on delete cascade,
  day        date not null,
  challenge  text not null references public.challenge_types(code),
  params     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (couple_id, day)
);

-- Premio della settimana (week_start = lunedì).
create table public.weekly_prizes (
  couple_id  uuid not null references public.couples(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  prize      text not null check (char_length(prize) between 1 and 200),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (couple_id, week_start)
);

-- Nessun accesso diretto dal client: tutto passa dalle funzioni.
alter table public.challenge_types enable row level security;
alter table public.alarm_settings  enable row level security;
alter table public.player_days     enable row level security;
alter table public.couple_days     enable row level security;
alter table public.weekly_prizes   enable row level security;
revoke all on public.challenge_types, public.alarm_settings, public.player_days,
              public.couple_days, public.weekly_prizes from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. FUNZIONI INTERNE (non chiamabili dal client)
-- ---------------------------------------------------------------------

-- Ora ufficiale del server
create or replace function public.wb_now()
returns timestamptz language sql stable set search_path = ''
as $$ select now() $$;

-- Data di oggi a Roma
create or replace function public.wb_today()
returns date language sql stable set search_path = ''
as $$ select (public.wb_now() at time zone 'Europe/Rome')::date $$;

-- Lunedì della settimana che contiene p_day
create or replace function public.wb_week_start(p_day date)
returns date language sql immutable set search_path = ''
as $$ select (p_day - (extract(isodow from p_day)::int - 1)) $$;

-- Ora del verdetto: sabato alle 12:00 (Roma) della settimana
create or replace function public.wb_verdict_at(p_week_start date)
returns timestamptz language sql stable set search_path = ''
as $$ select ((p_week_start + 5) + time '12:00') at time zone 'Europe/Rome' $$;

-- Sveglia calcolata da orario + giorni
create or replace function public.wb_calc_alarm(p_time time, p_days smallint[], p_day date)
returns timestamptz language sql stable set search_path = ''
as $$
  select case when p_time is not null
               and extract(isodow from p_day)::smallint = any(p_days)
              then (p_day + p_time) at time zone 'Europe/Rome' end
$$;

-- Sveglia di una persona in un giorno: riga congelata se c'è, altrimenti impostazioni
create or replace function public.wb_alarm(p_user uuid, p_day date)
returns timestamptz language plpgsql stable set search_path = ''
as $$
declare
  v_a timestamptz;
  s   public.alarm_settings%rowtype;
begin
  select alarm_at into v_a from public.player_days where user_id = p_user and day = p_day;
  if found then
    return v_a;
  end if;
  select * into s from public.alarm_settings where user_id = p_user;
  if not found or p_day < s.effective_from then
    return null;
  end if;
  return public.wb_calc_alarm(s.alarm_time, s.days, p_day);
end;
$$;

-- Giorno di gioco: ieri se la sveglia di ieri è ancora nei suoi 5 minuti, altrimenti oggi
create or replace function public.wb_game_day(p_user uuid)
returns date language plpgsql stable set search_path = ''
as $$
declare
  v_y date := public.wb_today() - 1;
  v_a timestamptz := public.wb_alarm(p_user, v_y);
begin
  if v_a is not null and public.wb_now() <= v_a + interval '5 minutes' then
    return v_y;
  end if;
  return public.wb_today();
end;
$$;

-- Primo giorno valido della coppia (giorno in cui è diventata completa)
create or replace function public.wb_couple_start(p_couple uuid)
returns date language sql stable set search_path = ''
as $$
  select (max(joined_at) at time zone 'Europe/Rome')::date
  from public.couple_members where couple_id = p_couple
  having count(*) = 2
$$;

-- Risultato di un giorno per i due membri della coppia
create or replace function public.wb_day_rows(p_couple uuid, p_day date)
returns table (user_id uuid, alarm_at timestamptz, finished_at timestamptz,
               seconds numeric, counts boolean, closed boolean,
               points numeric, week_seconds numeric)
language sql stable set search_path = ''
as $$
  with x as (
    select m.user_id,
           public.wb_alarm(m.user_id, p_day) as a,
           (select pd.finished_at from public.player_days pd
             where pd.user_id = m.user_id and pd.day = p_day) as f
    from public.couple_members m
    where m.couple_id = p_couple
  ), y as (
    select x.*, round(extract(epoch from (x.f - x.a))::numeric, 1) as s,
           (x.f is not null or x.a is null
            or public.wb_now() > x.a + interval '5 minutes') as done
    from x
  ), g as (
    select count(*) = 2
           and count(a) = 2
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
         case when g.counts and g.closed then coalesce(y.s, 300) end
  from y cross join g
  left join y o on o.user_id <> y.user_id
$$;

-- Parametri della challenge (al passo 3 verranno aggiunti quelli dei giochi)
create or replace function public.wb_challenge_params(p_code text)
returns jsonb language plpgsql volatile set search_path = ''
as $$
begin
  if p_code = 'esercizi' then
    return jsonb_build_object('esercizio',
      (array['piegamenti_10', 'squat_20', 'affondi_20', 'plank_30'])[1 + floor(random() * 4)::int]);
  end if;
  return '{}'::jsonb;
end;
$$;

-- Challenge del giorno per la coppia: la crea se manca (mai uguale alla precedente)
create or replace function public.wb_ensure_challenge(p_couple uuid, p_day date)
returns public.couple_days language plpgsql volatile set search_path = ''
as $$
declare
  r      public.couple_days%rowtype;
  v_prev text;
  v_pick text;
begin
  select * into r from public.couple_days where couple_id = p_couple and day = p_day;
  if found then
    return r;
  end if;

  select challenge into v_prev from public.couple_days
  where couple_id = p_couple and day < p_day order by day desc limit 1;

  select code into v_pick from public.challenge_types
  where enabled and code is distinct from v_prev order by random() limit 1;
  if v_pick is null then  -- una sola challenge attiva
    select code into v_pick from public.challenge_types where enabled order by random() limit 1;
  end if;
  if v_pick is null then
    return null;          -- nessuna challenge attiva
  end if;

  insert into public.couple_days (couple_id, day, challenge, params)
  values (p_couple, p_day, v_pick, public.wb_challenge_params(v_pick))
  on conflict do nothing;

  select * into r from public.couple_days where couple_id = p_couple and day = p_day;
  return r;
end;
$$;

-- Riepilogo di una settimana visto da p_me
create or replace function public.wb_week(p_couple uuid, p_me uuid, p_week_start date)
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  v_partner uuid;
  v_days    jsonb := '[]'::jsonb;
  d         date;
  r_me      record;
  r_pa      record;
  v_ch      text;
  v_pt_me   numeric := 0;  v_pt_pa numeric := 0;
  v_s_me    numeric := 0;  v_s_pa  numeric := 0;
  v_counted int := 0;
  v_ready   boolean := public.wb_now() >= public.wb_verdict_at(p_week_start);
  v_winner  text := null;
begin
  select user_id into v_partner from public.couple_members
  where couple_id = p_couple and user_id <> p_me;

  for d in select generate_series(p_week_start::timestamp, (p_week_start + 4)::timestamp, interval '1 day')::date loop
    select * into r_me from public.wb_day_rows(p_couple, d) where user_id = p_me;
    select * into r_pa from public.wb_day_rows(p_couple, d) where user_id = v_partner;
    v_ch := null;
    if r_me.closed and r_me.counts then
      select ct.name into v_ch from public.couple_days cd
      join public.challenge_types ct on ct.code = cd.challenge
      where cd.couple_id = p_couple and cd.day = d;
      v_counted := v_counted + 1;
      v_pt_me := v_pt_me + r_me.points;  v_pt_pa := v_pt_pa + r_pa.points;
      v_s_me  := v_s_me + r_me.week_seconds;  v_s_pa := v_s_pa + r_pa.week_seconds;
    end if;
    v_days := v_days || jsonb_build_object(
      'giorno',    d,
      'conta',     coalesce(r_me.counts, false),
      'chiuso',    coalesce(r_me.closed, false),
      'challenge', v_ch,
      'io',        case when r_me.closed then jsonb_build_object(
                     'secondi', r_me.seconds, 'punti', r_me.points) end,
      'partner',   case when r_me.closed then jsonb_build_object(
                     'secondi', r_pa.seconds, 'punti', r_pa.points) end);
  end loop;

  if v_ready and v_counted > 0 then
    v_winner := case
      when v_pt_me > v_pt_pa then 'io'
      when v_pt_pa > v_pt_me then 'partner'
      when v_s_me < v_s_pa  then 'io'
      when v_s_pa < v_s_me  then 'partner'
      else 'pareggio' end;
  end if;

  return jsonb_build_object(
    'settimana',        p_week_start,
    'verdetto_alle',    public.wb_verdict_at(p_week_start),
    'verdetto_pronto',  v_ready,
    'giornate_valide',  v_counted,
    'giorni',           v_days,
    'totale',           jsonb_build_object(
                          'io',      jsonb_build_object('punti', v_pt_me, 'secondi', v_s_me),
                          'partner', jsonb_build_object('punti', v_pt_pa, 'secondi', v_s_pa)),
    'vincitore',        v_winner,
    'premio',           (select prize from public.weekly_prizes
                         where couple_id = p_couple and week_start = p_week_start));
end;
$$;

-- Settimana a cui si riferisce il premio modificabile adesso
create or replace function public.wb_prize_week()
returns date language sql stable set search_path = ''
as $$
  select case when public.wb_now() < public.wb_verdict_at(public.wb_week_start(public.wb_today()))
              then public.wb_week_start(public.wb_today())
              else public.wb_week_start(public.wb_today()) + 7 end
$$;

-- ---------------------------------------------------------------------
-- 3. FUNZIONI PER L'APP (RPC)
-- Errori restituiti come {"ok": false, "error": "<motivo>"}:
--   senza_coppia | senza_partner | giorni_non_validi | orario_mancante |
--   nessuna_sveglia | troppo_presto | tempo_scaduto | gia_fatto | premio_troppo_lungo
-- ---------------------------------------------------------------------

-- Imposta orario e giorni della propria sveglia.
-- p_days: numeri 1..5 (lun..ven). Array vuoto = nessuna sveglia.
-- Risposta: oggi/domani = "aggiornato" | "invariato" (troppo vicino, <30 min) | "bloccato" (già suonata)
create or replace function public.set_alarm(p_time time, p_days int[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_now   timestamptz := public.wb_now();
  v_today date := public.wb_today();
  v_time  time;
  v_days  smallint[];
  s       public.alarm_settings%rowtype;
  v_has   boolean;
  d       date;
  v_old   timestamptz;
  v_new   timestamptz;
  v_state text;
  v_res   jsonb := jsonb_build_object('ok', true);
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  if not exists (select 1 from public.couple_members where user_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'senza_coppia');
  end if;
  if p_time is null then
    return jsonb_build_object('ok', false, 'error', 'orario_mancante');
  end if;
  if exists (select 1 from unnest(coalesce(p_days, '{}')) x where x is null or x not between 1 and 5) then
    return jsonb_build_object('ok', false, 'error', 'giorni_non_validi');
  end if;

  v_time := make_time(extract(hour from p_time)::int, extract(minute from p_time)::int, 0);
  select coalesce(array_agg(distinct x::smallint order by x::smallint), '{}')
    into v_days from unnest(coalesce(p_days, '{}')) x;

  select * into s from public.alarm_settings where user_id = v_uid for update;
  v_has := found;

  -- congela i giorni passati con le impostazioni vecchie
  if v_has then
    insert into public.player_days (user_id, day, alarm_at)
    select v_uid, g::date, public.wb_calc_alarm(s.alarm_time, s.days, g::date)
    from generate_series(s.effective_from::timestamp, (v_today - 1)::timestamp, interval '1 day') g
    on conflict do nothing;
  end if;

  -- oggi e domani: regola dei 30 minuti
  foreach d in array array[v_today, v_today + 1] loop
    v_old := public.wb_alarm(v_uid, d);
    if v_old is not null and v_now >= v_old then
      insert into public.player_days (user_id, day, alarm_at)
      values (v_uid, d, v_old) on conflict do nothing;
      v_state := 'bloccato';
    else
      v_new := public.wb_calc_alarm(v_time, v_days, d);
      if v_new is null or v_new >= v_now + interval '30 minutes' then
        v_state := 'aggiornato';
      else
        v_new := v_old;
        v_state := 'invariato';
      end if;
      insert into public.player_days (user_id, day, alarm_at)
      values (v_uid, d, v_new)
      on conflict (user_id, day) do update set alarm_at = excluded.alarm_at;
    end if;
    v_res := v_res || jsonb_build_object(
      case when d = v_today then 'oggi' else 'domani' end,
      jsonb_build_object('stato', v_state, 'sveglia', public.wb_alarm(v_uid, d)));
  end loop;

  insert into public.alarm_settings (user_id, alarm_time, days, effective_from, updated_at)
  values (v_uid, v_time, v_days, v_today + 2, v_now)
  on conflict (user_id) do update
    set alarm_time = excluded.alarm_time, days = excluded.days,
        effective_from = excluded.effective_from, updated_at = excluded.updated_at;

  return v_res;
end;
$$;

-- Impostazioni sveglia mia e del partner (l'orario del partner è visibile)
create or replace function public.get_settings()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_couple  uuid;
  v_partner uuid;
  v_today   date := public.wb_today();
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

  return jsonb_build_object(
    'ok', true,
    'ora_server', public.wb_now(),
    'io', (select jsonb_build_object(
             'orario', to_char(s.alarm_time, 'HH24:MI'), 'giorni', to_jsonb(s.days))
           from public.alarm_settings s where s.user_id = v_uid),
    'io_oggi',   public.wb_alarm(v_uid, v_today),
    'io_domani', public.wb_alarm(v_uid, v_today + 1),
    'partner', case when v_partner is not null then jsonb_build_object(
       'nome',   (select display_name from public.profiles where id = v_partner),
       'orario', (select to_char(alarm_time, 'HH24:MI') from public.alarm_settings where user_id = v_partner),
       'giorni', (select to_jsonb(days) from public.alarm_settings where user_id = v_partner),
       'oggi',   public.wb_alarm(v_partner, v_today),
       'domani', public.wb_alarm(v_partner, v_today + 1)) end);
end;
$$;

-- Stato della giornata (schermata Oggi)
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
      'challenge', v_ch),
    'partner', jsonb_build_object(
      'nome',    (select display_name from public.profiles where id = v_partner),
      'sveglia', r_pa.alarm_at,
      'stato',   v_pstate,
      'secondi', case when r_me.closed then r_pa.seconds end,
      'punti',   r_pa.points));
end;
$$;

-- "Fatto": il server registra l'ora. Valido solo tra sveglia e sveglia + 5 min.
create or replace function public.complete_challenge()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := public.wb_now();
  v_couple uuid;
  d        date;
  v_a      timestamptz;
  v_f      timestamptz;
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  select couple_id into v_couple from public.couple_members where user_id = v_uid;
  if v_couple is null then
    return jsonb_build_object('ok', false, 'error', 'senza_coppia');
  end if;

  d := public.wb_game_day(v_uid);
  v_a := public.wb_alarm(v_uid, d);

  if v_a is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna_sveglia');
  end if;
  if v_now < v_a then
    return jsonb_build_object('ok', false, 'error', 'troppo_presto', 'sveglia', v_a);
  end if;

  select finished_at into v_f from public.player_days where user_id = v_uid and day = d;
  if v_f is not null then
    return jsonb_build_object('ok', false, 'error', 'gia_fatto',
      'secondi', round(extract(epoch from (v_f - v_a))::numeric, 1));
  end if;
  if v_now > v_a + interval '5 minutes' then
    return jsonb_build_object('ok', false, 'error', 'tempo_scaduto');
  end if;

  perform public.wb_ensure_challenge(v_couple, d);

  insert into public.player_days (user_id, day, alarm_at, finished_at)
  values (v_uid, d, v_a, v_now)
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

-- Settimana (schermata Sfida). p_week_start null = settimana corrente.
create or replace function public.get_week(p_week_start date default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_ws     date := public.wb_week_start(coalesce(p_week_start, public.wb_today()));
  v_pw     date := public.wb_prize_week();
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  select couple_id into v_couple from public.couple_members where user_id = v_uid;
  if v_couple is null then
    return jsonb_build_object('ok', false, 'error', 'senza_coppia');
  end if;
  if (select count(*) from public.couple_members where couple_id = v_couple) < 2 then
    return jsonb_build_object('ok', false, 'error', 'senza_partner');
  end if;

  return jsonb_build_object('ok', true, 'ora_server', public.wb_now())
      || public.wb_week(v_couple, v_uid, v_ws)
      || jsonb_build_object('premio_modificabile', jsonb_build_object(
           'settimana', v_pw,
           'testo', (select prize from public.weekly_prizes
                     where couple_id = v_couple and week_start = v_pw)));
end;
$$;

-- Storico: settimane concluse (con verdetto) e conteggio vittorie
create or replace function public.get_history()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_start  date;
  v_ws     date;
  v_w      jsonb;
  v_list   jsonb := '[]'::jsonb;
  v_io int := 0; v_pa int := 0; v_pari int := 0;
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  select couple_id into v_couple from public.couple_members where user_id = v_uid;
  if v_couple is null then
    return jsonb_build_object('ok', false, 'error', 'senza_coppia');
  end if;
  v_start := public.wb_couple_start(v_couple);
  if v_start is null then
    return jsonb_build_object('ok', false, 'error', 'senza_partner');
  end if;

  v_ws := public.wb_week_start(v_start);
  while public.wb_now() >= public.wb_verdict_at(v_ws) loop
    v_w := public.wb_week(v_couple, v_uid, v_ws);
    if (v_w->>'giornate_valide')::int > 0 then
      v_list := jsonb_build_array(jsonb_build_object(
        'settimana', v_ws,
        'vincitore', v_w->'vincitore',
        'totale',    v_w->'totale',
        'premio',    v_w->'premio')) || v_list;   -- più recente per prima
      case v_w->>'vincitore'
        when 'io' then v_io := v_io + 1;
        when 'partner' then v_pa := v_pa + 1;
        else v_pari := v_pari + 1;
      end case;
    end if;
    v_ws := v_ws + 7;
  end loop;

  return jsonb_build_object('ok', true,
    'vittorie', jsonb_build_object('io', v_io, 'partner', v_pa, 'pareggi', v_pari),
    'settimane', v_list);
end;
$$;

-- Premio della settimana: testo libero, vuoto = cancella.
-- Vale per la settimana in corso fino al verdetto, poi per la successiva.
create or replace function public.set_prize(p_text text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_pw     date := public.wb_prize_week();
  v_text   text := btrim(coalesce(p_text, ''));
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  select couple_id into v_couple from public.couple_members where user_id = v_uid;
  if v_couple is null then
    return jsonb_build_object('ok', false, 'error', 'senza_coppia');
  end if;
  if char_length(v_text) > 200 then
    return jsonb_build_object('ok', false, 'error', 'premio_troppo_lungo');
  end if;

  if v_text = '' then
    delete from public.weekly_prizes where couple_id = v_couple and week_start = v_pw;
  else
    insert into public.weekly_prizes (couple_id, week_start, prize, updated_by, updated_at)
    values (v_couple, v_pw, v_text, v_uid, public.wb_now())
    on conflict (couple_id, week_start) do update
      set prize = excluded.prize, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  return jsonb_build_object('ok', true, 'settimana', v_pw, 'testo', nullif(v_text, ''));
end;
$$;

-- ---------------------------------------------------------------------
-- 4. PERMESSI: interne bloccate, RPC solo per utenti autenticati
-- ---------------------------------------------------------------------
revoke all on function public.wb_now()                          from public, anon, authenticated;
revoke all on function public.wb_today()                        from public, anon, authenticated;
revoke all on function public.wb_week_start(date)               from public, anon, authenticated;
revoke all on function public.wb_verdict_at(date)               from public, anon, authenticated;
revoke all on function public.wb_calc_alarm(time, smallint[], date) from public, anon, authenticated;
revoke all on function public.wb_alarm(uuid, date)              from public, anon, authenticated;
revoke all on function public.wb_game_day(uuid)                 from public, anon, authenticated;
revoke all on function public.wb_couple_start(uuid)             from public, anon, authenticated;
revoke all on function public.wb_day_rows(uuid, date)           from public, anon, authenticated;
revoke all on function public.wb_challenge_params(text)         from public, anon, authenticated;
revoke all on function public.wb_ensure_challenge(uuid, date)   from public, anon, authenticated;
revoke all on function public.wb_week(uuid, uuid, date)         from public, anon, authenticated;
revoke all on function public.wb_prize_week()                   from public, anon, authenticated;

revoke all on function public.set_alarm(time, int[])  from public, anon;
revoke all on function public.get_settings()          from public, anon;
revoke all on function public.get_today()             from public, anon;
revoke all on function public.complete_challenge()    from public, anon;
revoke all on function public.get_week(date)          from public, anon;
revoke all on function public.get_history()           from public, anon;
revoke all on function public.set_prize(text)         from public, anon;
grant execute on function public.set_alarm(time, int[])  to authenticated;
grant execute on function public.get_settings()          to authenticated;
grant execute on function public.get_today()             to authenticated;
grant execute on function public.complete_challenge()    to authenticated;
grant execute on function public.get_week(date)          to authenticated;
grant execute on function public.get_history()           to authenticated;
grant execute on function public.set_prize(text)         to authenticated;
