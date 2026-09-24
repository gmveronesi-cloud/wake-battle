-- =====================================================================
-- Wake Battle — Esercizi (sesto gioco con fotocamera, ultimo della lista)
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..18 già eseguiti. Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni).
--
-- Regole (decise il 24/09/2026 in questa chat, vedi anche docs/DECISIONI.md):
--  - Un esercizio tra 10 piegamenti, 20 squat, 20 affondi, plank 30 secondi
--    (DECISIONI.md, invariato), estratto a caso dal server UNA volta per
--    challenge, uguale per la coppia, MAI uguale all'ultimo esercizio
--    assegnato a quella coppia (si guarda l'ultima riga couple_days con
--    challenge = 'esercizi' per quella coppia, non "il giorno prima": la
--    challenge del giorno non è mai due volte di fila la stessa — regola
--    #10 — quindi 'esercizi' due giorni consecutivi è già escluso a monte).
--  - Fotocamera FRONTALE (come "Occhi aperti", le altre quattro fisiche
--    usano la posteriore), video in diretta (ci si vede mentre ci si
--    allena). La registrazione parte da sola a fotocamera pronta, come
--    "Occhi aperti", ma qui NON si ferma da sola dopo un tempo fisso: un
--    pulsante "Fine registrazione" la ferma quando la persona ha finito
--    l'esercizio (il cronometro si ferma in quel momento, nessuna
--    anteprima da rivedere né altra conferma). Rete di sicurezza lato
--    client: oltre 3 minuti la registrazione si ferma comunque da sola
--    (nessuno dei quattro esercizi dovrebbe richiederne così tanti).
--  - Se l'app perde il focus durante la registrazione si scarta e riparte
--    da zero in automatico, come "Occhi aperti" (stesso meccanismo in
--    games.js, invariato).
--  - Il video (stringa "data:video/...") NON passa da complete_game/
--    beta_check (supererebbe il limite di byte): una funzione a parte,
--    save_exercise_video(p_video), lo salva SOLO nella sfida vera (mai in
--    beta). Limite 34.000.000 byte: margine sopra il caso limite teorico
--    (~30 MB in base64 per 3 minuti a ~1 Mbps), comunque sotto ai 50 MB
--    previsti in STATO.md.
--  - A differenza degli altri giochi con fotocamera il video NON sparisce
--    al cambio di "giornata di gioco": resta visibile (proprio subito,
--    partner con la stessa regola di visibilità del tempo, DECISIONI.md
--    #11 — solo a giornata chiusa, ma quella del giorno in cui il video è
--    stato girato, non necessariamente "oggi") per 48 ore piene dalla
--    registrazione, poi sparisce da solo (ripulito lato server al
--    prossimo salvataggio dello stesso utente, come gli altri video/foto
--    ma con 48h invece di 24h, nessun cron dedicato).
--  - Il server non riceve né verifica se l'esercizio è stato fatto
--    davvero (non può controllare cosa inquadra la fotocamera, come tutti
--    gli altri giochi con fotocamera; il partner non può contestarlo,
--    DECISIONI.md): risposta {fatto:true}, sempre accettata se booleana
--    true. Nessun timeout dedicato: vale il limite generale di 5 minuti
--    dalla sveglia (DECISIONI.md #2). Permesso negato o fotocamera non
--    disponibile -> messaggio con pulsante "Riprova".
--
-- Parametri: {gioco:'esercizi', esercizio:<uno dei 4 codici>, secondi_max:180}.
-- Risposta (complete_game/beta_check): {fatto:true} (il video viaggia a
-- parte, mai qui). wb_ca_esercizi controlla solo che 'fatto' sia booleano
-- true (mai NULL, mai un campo mancante che passa il controllo).
--
-- Solo le due funzioni nuove + una riga in ciascun dispatcher (vedi 07):
-- non si ricopiano le funzioni degli altri giochi. La riga 'esercizi' in
-- challenge_types esiste già dal 02 (kind 'fisica'): questo file non la
-- tocca, solo l'attivazione con game_live la fa entrare in gioco (finché
-- resta false, wb_challenge_params usa ancora il vecchio fallback senza
-- 'gioco' nei parametri, già presente dal 02, con "Fatto" semplice).
-- In più (come 17/18): la tabella exercise_videos e la funzione
-- save_exercise_video(), e get_today() viene riscritta per aggiungere i
-- campi 'video_esercizi' (io e partner), con la finestra di 48 ore al
-- posto del confronto con "oggi" usato da 'foto'/'video'.
-- =====================================================================

-- ---------- TABELLA DEI VIDEO ----------
-- Una riga per persona e giorno (come eye_videos): l'ultimo salvataggio
-- sovrascrive il precedente. "day" resta il giorno di gioco in cui è stata
-- girata la registrazione (serve per controllare, alla lettura, se QUELLA
-- giornata è chiusa — non "oggi"). Nessun accesso diretto dal client.
create table if not exists public.exercise_videos (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  video      text not null,
  created_at timestamptz not null default public.wb_now(),
  primary key (user_id, day)
);
alter table public.exercise_videos enable row level security;
revoke all on public.exercise_videos from public, anon, authenticated;

-- ---------- ESERCIZI ----------
create or replace function public.wb_gp_esercizi()
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_prev   text;
  v_pick   text;
begin
  if v_uid is not null then
    select couple_id into v_couple from public.couple_members where user_id = v_uid;
  end if;
  if v_couple is not null then
    select cd.params->>'esercizio' into v_prev
    from public.couple_days cd
    where cd.couple_id = v_couple and cd.challenge = 'esercizi'
    order by cd.day desc limit 1;
  end if;
  select e into v_pick
  from unnest(array['piegamenti_10', 'squat_20', 'affondi_20', 'plank_30']) as e
  where e is distinct from v_prev
  order by random() limit 1;

  return jsonb_build_object('gioco', 'esercizi', 'esercizio', v_pick, 'secondi_max', 180);
end;
$$;

create or replace function public.wb_ca_esercizi(p_params jsonb, p_answer jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
begin
  -- Nessun segreto da verificare: solo la forma della risposta.
  if coalesce(jsonb_typeof(p_answer->'fatto'), '') <> 'boolean' then
    return false;
  end if;
  return (p_answer->>'fatto')::boolean;
exception when others then
  return false;
end;
$$;

-- Salva il video della partita in corso (SOLO sfida vera: beta.js non la
-- chiama, coerente con "nessun salvataggio" di beta_start). p_video: una
-- stringa "data:video/...".
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
  -- dello stesso utente (righe più vecchie di 48 ore, comunque già fuori
  -- dalla finestra di visibilità di get_today)
  delete from public.exercise_videos
  where user_id = v_uid and created_at < public.wb_now() - interval '48 hours';

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- DISPATCHER: aggiunta la riga 'esercizi', il resto è identico al 18 ----------
create or replace function public.wb_game_params(p_code text)
returns jsonb language plpgsql volatile set search_path = ''
as $$
begin
  if p_code = 'memoria' then return public.wb_gp_memoria(); end if;
  if p_code = 'numeri' then return public.wb_gp_numeri(); end if;
  if p_code = 'colore_parola' then return public.wb_gp_colore_parola(); end if;
  if p_code = 'riflessi' then return public.wb_gp_riflessi(); end if;
  if p_code = 'anagramma' then return public.wb_gp_anagramma(); end if;
  if p_code = 'luce' then return public.wb_gp_luce(); end if;
  if p_code = 'qr' then return public.wb_gp_qr(); end if;
  if p_code = 'caccia_colori' then return public.wb_gp_caccia_colori(); end if;
  if p_code = 'oggetto' then return public.wb_gp_oggetto(); end if;
  if p_code = 'occhi' then return public.wb_gp_occhi(); end if;
  if p_code = 'esercizi' then return public.wb_gp_esercizi(); end if;
  return null;
end;
$$;

create or replace function public.wb_check_answer(p_code text, p_params jsonb, p_answer jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
begin
  if p_params is null or p_answer is null or jsonb_typeof(p_answer) <> 'object' then
    return false;
  end if;
  if p_code = 'memoria' then return public.wb_ca_memoria(p_params, p_answer); end if;
  if p_code = 'numeri' then return public.wb_ca_numeri(p_params, p_answer); end if;
  if p_code = 'colore_parola' then return public.wb_ca_colore_parola(p_params, p_answer); end if;
  if p_code = 'riflessi' then return public.wb_ca_riflessi(p_params, p_answer); end if;
  if p_code = 'anagramma' then return public.wb_ca_anagramma(p_params, p_answer); end if;
  if p_code = 'luce' then return public.wb_ca_luce(p_params, p_answer); end if;
  if p_code = 'qr' then return public.wb_ca_qr(p_params, p_answer); end if;
  if p_code = 'caccia_colori' then return public.wb_ca_caccia_colori(p_params, p_answer); end if;
  if p_code = 'oggetto' then return public.wb_ca_oggetto(p_params, p_answer); end if;
  if p_code = 'occhi' then return public.wb_ca_occhi(p_params, p_answer); end if;
  if p_code = 'esercizi' then return public.wb_ca_esercizi(p_params, p_answer); end if;
  return false;
exception when others then
  return false;
end;
$$;

-- ---------- get_today(): aggiunti i campi 'video_esercizi' (io e partner) ----------
-- io: ultimo video entro 48 ore, sempre visibile (come 'foto'/'video').
-- partner: ultimo video entro 48 ore la cui GIORNATA DI RIPRESA (non
-- "oggi": il video può risalire a un giorno di gioco precedente, restando
-- comunque nella finestra di 48 ore) risulta chiusa per la coppia
-- (wb_day_rows(v_couple, ev.day), stessa definizione di "chiuso" di
-- sempre, solo applicata al giorno del video invece che a "oggi").
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
  v_pa_vid  text;
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

  select ev.video into v_pa_vid
  from public.exercise_videos ev
  where ev.user_id = v_partner and ev.created_at >= v_now - interval '48 hours'
    and coalesce((select wd.closed from public.wb_day_rows(v_couple, ev.day) wd
                  where wd.user_id = v_partner), false)
  order by ev.created_at desc limit 1;

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
      'foto',  (select foto from public.object_photos where user_id = v_uid and day = d),
      'video', (select video from public.eye_videos where user_id = v_uid and day = d),
      'video_esercizi', (select video from public.exercise_videos
                          where user_id = v_uid and created_at >= v_now - interval '48 hours'
                          order by created_at desc limit 1)),
    'partner', jsonb_build_object(
      'nome',    (select display_name from public.profiles where id = v_partner),
      'sveglia', r_pa.alarm_at,
      'stato',   v_pstate,
      'secondi', case when r_me.closed then r_pa.seconds end,
      'punti',   r_pa.points,
      'foto',  case when r_me.closed then
                 (select foto from public.object_photos where user_id = v_partner and day = d) end,
      'video', case when r_me.closed then
                 (select video from public.eye_videos where user_id = v_partner and day = d) end,
      'video_esercizi', v_pa_vid));
end;
$$;

-- ---------- PERMESSI (funzioni interne, mai chiamabili dal client) ----------
revoke all on function public.wb_gp_esercizi()                 from public, anon, authenticated;
revoke all on function public.wb_ca_esercizi(jsonb, jsonb)      from public, anon, authenticated;
revoke all on function public.wb_game_params(text)           from public, anon, authenticated;
revoke all on function public.wb_check_answer(text, jsonb, jsonb) from public, anon, authenticated;

-- save_exercise_video è una RPC per l'app: bloccata di default, poi
-- riaperta solo per utenti autenticati (come save_eye_video nel 18).
revoke all on function public.save_exercise_video(text) from public, anon, authenticated;
grant execute on function public.save_exercise_video(text) to authenticated;
-- get_today() mantiene i permessi già concessi dal 02 (CREATE OR REPLACE
-- non li tocca): nessun nuovo grant necessario.
