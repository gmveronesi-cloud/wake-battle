-- =====================================================================
-- Wake Battle — Occhi aperti (quinto gioco con fotocamera)
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..17 già eseguiti. Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni).
--
-- Regole (decise il 23-24/09/2026 in questa chat, vedi anche docs/DECISIONI.md):
--  - A differenza degli altri giochi con fotocamera, usa quella FRONTALE.
--    Il client chiede il permesso e MOSTRA il video in diretta (anteprima
--    mentre si registra), SENZA barra: un solo pulsante "Inizia" fa
--    partire la registrazione di un video di 10 secondi (risoluzione
--    bassa, punta a ~1,5 MB), che si ferma DA SOLA passati i 10 secondi.
--    Nessun pulsante "ho sbattuto le palpebre": appena la registrazione
--    finisce il gioco è completato in automatico, nessuna conferma dopo
--    aver rivisto il video.
--  - Se l'app perde il focus durante la registrazione (cambio scheda,
--    schermo spento), quella registrazione si scarta e riparte da zero in
--    automatico (nessun nuovo tocco richiesto): gestito lato client in
--    games.js (recordVideo()), il server non ne sa nulla.
--  - Il video registrato (una stringa "data:video/..." generata dal
--    client) NON passa da complete_game/beta_check (supererebbe il
--    limite di byte della risposta, vedi beta_check): una funzione a
--    parte, save_eye_video(p_video), lo salva SOLO nella sfida vera (mai
--    in beta, dove "nessun salvataggio" vale come per gli altri giochi
--    con fotocamera). Limite 3.000.000 byte (~3 MB, margine sopra il
--    target di ~1,5-2 MB lato client).
--  - Il video resta visibile in get_today() come le foto di "Trova
--    l'oggetto" (stesso "giorno di gioco" d di wb_game_day): il PROPRIO è
--    visibile subito, quello del partner segue la regola di visibilità
--    del suo tempo (DECISIONI.md #11: solo a giornata chiusa, r_me.closed).
--    Sparisce da solo al cambio di giornata (get_today mostra sempre e
--    solo "oggi"); la riga resta in tabella finché lo stesso utente non
--    registra un nuovo video, a quel punto save_eye_video ripulisce anche
--    le righe più vecchie di 24 ore (nessun cron dedicato, come
--    object_photos). "Schermo intero" si ottiene con i controlli nativi
--    del tag <video> (icona di ingrandimento): nessuna lightbox dedicata
--    come per le foto.
--  - Il server non riceve né verifica se gli occhi sono rimasti davvero
--    aperti (non può controllare cosa inquadra davvero la fotocamera,
--    come "luce"/"qr"/"caccia_colori"/"oggetto"): la risposta del gioco è
--    {fatto:true}, sempre accettata se il campo è booleano true. Nessun
--    timeout dedicato: vale il limite generale di 5 minuti dalla sveglia
--    (DECISIONI.md #2). Permesso negato o fotocamera non disponibile ->
--    messaggio con pulsante "Riprova".
--
-- Parametri: {gioco:'occhi', secondi:10} (nessun dato da generare).
-- Risposta del gioco (complete_game/beta_check): {fatto:true} (il video
-- viaggia a parte, mai qui). wb_ca_occhi controlla solo che 'fatto' sia
-- booleano true (mai NULL, mai un campo mancante che passa il controllo).
--
-- Solo le due funzioni nuove + una riga in ciascun dispatcher (vedi 07):
-- non si ricopiano le funzioni degli altri giochi. La riga 'occhi' in
-- challenge_types esiste già dal 02 (kind 'fisica'): questo file non la
-- tocca, solo l'attivazione con game_live la fa entrare in gioco.
-- In più (come 17): la tabella eye_videos e la funzione save_eye_video(),
-- e get_today() viene riscritta per aggiungere i campi 'video' (io e
-- partner, uguale a 'foto' del 17).
-- =====================================================================

-- ---------- TABELLA DEI VIDEO ----------
-- Una riga per persona e giorno (come object_photos): l'ultimo salvataggio
-- sovrascrive il precedente. Nessun accesso diretto dal client.
create table if not exists public.eye_videos (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  video      text not null,
  created_at timestamptz not null default public.wb_now(),
  primary key (user_id, day)
);
alter table public.eye_videos enable row level security;
revoke all on public.eye_videos from public, anon, authenticated;

-- ---------- OCCHI APERTI ----------
create or replace function public.wb_gp_occhi()
returns jsonb language plpgsql volatile set search_path = ''
as $$
begin
  return jsonb_build_object('gioco', 'occhi', 'secondi', 10);
end;
$$;

create or replace function public.wb_ca_occhi(p_params jsonb, p_answer jsonb)
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
create or replace function public.save_eye_video(p_video text)
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
  if p_video is null or p_video !~ '^data:video/' or octet_length(p_video) > 3000000 then
    return jsonb_build_object('ok', false, 'error', 'video_non_valido');
  end if;

  v_day := public.wb_game_day(v_uid);
  insert into public.eye_videos (user_id, day, video, created_at)
  values (v_uid, v_day, p_video, public.wb_now())
  on conflict (user_id, day) do update
    set video = excluded.video, created_at = excluded.created_at;

  -- pulizia: niente cron dedicato, si ripulisce da sola al prossimo scatto
  -- dello stesso utente (righe più vecchie di 24 ore, comunque già fuori
  -- dalla risposta di get_today)
  delete from public.eye_videos
  where user_id = v_uid and created_at < public.wb_now() - interval '24 hours';

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- DISPATCHER: aggiunta la riga 'occhi', il resto è identico al 17 ----------
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
  return false;
exception when others then
  return false;
end;
$$;

-- ---------- get_today(): aggiunti i campi 'video' (io e partner), identico a 'foto' del 17 ----------
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
      'foto',  (select foto from public.object_photos where user_id = v_uid and day = d),
      'video', (select video from public.eye_videos where user_id = v_uid and day = d)),
    'partner', jsonb_build_object(
      'nome',    (select display_name from public.profiles where id = v_partner),
      'sveglia', r_pa.alarm_at,
      'stato',   v_pstate,
      'secondi', case when r_me.closed then r_pa.seconds end,
      'punti',   r_pa.points,
      'foto',  case when r_me.closed then
                 (select foto from public.object_photos where user_id = v_partner and day = d) end,
      'video', case when r_me.closed then
                 (select video from public.eye_videos where user_id = v_partner and day = d) end));
end;
$$;

-- ---------- PERMESSI (funzioni interne, mai chiamabili dal client) ----------
revoke all on function public.wb_gp_occhi()                 from public, anon, authenticated;
revoke all on function public.wb_ca_occhi(jsonb, jsonb)      from public, anon, authenticated;
revoke all on function public.wb_game_params(text)           from public, anon, authenticated;
revoke all on function public.wb_check_answer(text, jsonb, jsonb) from public, anon, authenticated;

-- save_eye_video è una RPC per l'app: bloccata di default, poi riaperta
-- solo per utenti autenticati (come save_object_photos nel 17).
revoke all on function public.save_eye_video(text) from public, anon, authenticated;
grant execute on function public.save_eye_video(text) to authenticated;
-- get_today() mantiene i permessi già concessi dal 02 (CREATE OR REPLACE
-- non li tocca): nessun nuovo grant necessario.
