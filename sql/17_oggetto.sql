-- =====================================================================
-- Wake Battle — Trova l'oggetto (quarto gioco con fotocamera)
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..16 già eseguiti. Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni).
--
-- Regole (decise il 23/09/2026 in questa chat, vedi anche docs/DECISIONI.md):
--  - NESSUN vero riconoscimento oggetti (niente modello di IA): come
--    "luce"/"qr"/"caccia_colori", il client si fida. Sequenza di 5 oggetti
--    da trovare in giro per casa, generata dal server UNA volta per
--    challenge (stessa per la coppia, come "caccia_colori"), da una lista
--    di 15 oggetti comuni; mai due oggetti uguali consecutivi.
--  - Il client chiede il permesso della fotocamera (posteriore) e MOSTRA
--    il video in diretta (serve per mirare l'oggetto), SENZA barra (come
--    "QR": niente livello progressivo, solo un pulsante "Trovato!" da
--    toccare quando l'oggetto è inquadrato — nessun mantenimento nel
--    tempo). Ogni tocco scatta anche una foto (lato client, games.js) che
--    si aggiunge alla raccolta della partita.
--  - Le 5 foto (miniature JPEG piccole, generate dal client) si vedono in
--    get_today() come tutto il resto della giornata (stesso "giorno di
--    gioco" d di wb_game_day, quello di secondi/punti): le PROPRIE sono
--    visibili subito (non c'è bisogno di aspettare che la giornata sia
--    chiusa, sono già sue); quelle del partner seguono invece la stessa
--    regola di visibilità del suo tempo (DECISIONI.md #11: solo a
--    giornata chiusa, r_me.closed). Non serve conservarle: spariscono da
--    sole dalla risposta con la giornata stessa (get_today mostra sempre
--    e solo "oggi"), quindi entro le prossime 24 ore al più. La riga resta
--    in tabella finché lo stesso utente non fa un nuovo scatto: a quel
--    punto save_object_photos ripulisce anche quelle più vecchie di 24
--    ore (nessun cron dedicato: con 5 miniature a partita e una sola
--    coppia il volume è comunque trascurabile).
--  - Le foto NON passano da complete_game/beta_check (supererebbero il
--    limite di byte della risposta, vedi beta_check): una funzione a
--    parte, save_object_photos(p_foto), le salva SOLO nella sfida vera
--    (mai in beta, dove "nessun salvataggio" vale come per gli altri
--    giochi).
--  - Il server non riceve né verifica dati reali del sensore (non può
--    controllare cosa inquadra davvero la fotocamera, come "luce"/"qr"/
--    "caccia_colori"): la risposta del gioco è {fatto:true}, sempre
--    accettata se il campo è booleano true. Nessun timeout dedicato: vale
--    il limite generale di 5 minuti dalla sveglia (DECISIONI.md #2).
--    Permesso negato o fotocamera non disponibile -> messaggio con
--    pulsante "Riprova".
--
-- Parametri: {gioco:'oggetto', oggetti:15, sequenza:[5 oggetti]}.
-- Risposta del gioco (complete_game/beta_check): {fatto:true}.
-- wb_ca_oggetto controlla solo che 'fatto' sia booleano true (mai NULL,
-- mai un campo mancante che passa il controllo).
--
-- Solo le due funzioni nuove + una riga in ciascun dispatcher (vedi 07):
-- non si ricopiano le funzioni degli altri giochi. La riga 'oggetto' in
-- challenge_types esiste già dal 02 (kind 'fisica'): questo file non la
-- tocca, solo l'attivazione con game_live la fa entrare in gioco.
-- In più (novità rispetto agli altri giochi con fotocamera): la tabella
-- object_photos e la funzione save_object_photos(), e get_today() viene
-- riscritta per aggiungere i campi 'foto' (uguale al resto, vedi 02).
-- =====================================================================

-- ---------- TABELLA DELLE FOTO ----------
-- Una riga per persona e giorno (come player_days): l'ultimo salvataggio
-- sovrascrive il precedente. Nessun accesso diretto dal client.
create table if not exists public.object_photos (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  foto       jsonb not null,
  created_at timestamptz not null default public.wb_now(),
  primary key (user_id, day)
);
alter table public.object_photos enable row level security;
revoke all on public.object_photos from public, anon, authenticated;

-- ---------- TROVA L'OGGETTO ----------
create or replace function public.wb_gp_oggetto()
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  v_oggetti text[] := array['spazzolino', 'tazza', 'frigorifero', 'lavandino', 'bottiglia',
                             'sedia', 'libro', 'telefono', 'forbici', 'orologio',
                             'scarpa', 'chiave', 'specchio', 'asciugamano', 'spazzola'];
  v_seq  jsonb := '[]'::jsonb;
  v_prev text := null;
  v_o    text;
  i      int;
begin
  for i in 1 .. 5 loop
    loop   -- mai due oggetti uguali consecutivi
      v_o := v_oggetti[1 + floor(random() * array_length(v_oggetti, 1))::int];
      exit when v_o is distinct from v_prev;
    end loop;
    v_seq := v_seq || to_jsonb(v_o);
    v_prev := v_o;
  end loop;
  return jsonb_build_object('gioco', 'oggetto', 'oggetti', array_length(v_oggetti, 1), 'sequenza', v_seq);
end;
$$;

create or replace function public.wb_ca_oggetto(p_params jsonb, p_answer jsonb)
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

-- Salva la raccolta di foto della partita in corso (SOLO sfida vera: nella
-- pagina di prova beta.js non la chiama, coerente con "nessun salvataggio"
-- di beta_start). p_foto: array jsonb di 1-5 stringhe "data:image/...".
create or replace function public.save_object_photos(p_foto jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_day date;
  i     int;
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  if jsonb_typeof(p_foto) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'foto_non_valide');
  end if;
  if jsonb_array_length(p_foto) < 1 or jsonb_array_length(p_foto) > 5
     or octet_length(p_foto::text) > 400000 then
    return jsonb_build_object('ok', false, 'error', 'foto_non_valide');
  end if;
  for i in 0 .. jsonb_array_length(p_foto) - 1 loop
    if jsonb_typeof(p_foto -> i) is distinct from 'string' or (p_foto ->> i) !~ '^data:image/' then
      return jsonb_build_object('ok', false, 'error', 'foto_non_valide');
    end if;
  end loop;

  v_day := public.wb_game_day(v_uid);
  insert into public.object_photos (user_id, day, foto, created_at)
  values (v_uid, v_day, p_foto, public.wb_now())
  on conflict (user_id, day) do update
    set foto = excluded.foto, created_at = excluded.created_at;

  -- pulizia: niente cron dedicato, si ripulisce da sola al prossimo scatto
  -- dello stesso utente (righe più vecchie di 24 ore, comunque già fuori
  -- dalla risposta di get_today)
  delete from public.object_photos
  where user_id = v_uid and created_at < public.wb_now() - interval '24 hours';

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- DISPATCHER: aggiunta la riga 'oggetto', il resto è identico al 16 ----------
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
  return false;
exception when others then
  return false;
end;
$$;

-- ---------- get_today(): aggiunti i campi 'foto' (io e partner) ----------
-- Stesso comportamento del 02 per il resto (vedi lì per i commenti):
-- 'io.foto' sono le proprie foto del giorno di gioco d (sempre visibili);
-- 'partner.foto' segue la stessa regola di visibilità del tempo del
-- partner (solo a giornata chiusa, r_me.closed). Legate a d come tutto il
-- resto qui: spariscono da sole al cambio di giornata di gioco.
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
      'foto', (select foto from public.object_photos where user_id = v_uid and day = d)),
    'partner', jsonb_build_object(
      'nome',    (select display_name from public.profiles where id = v_partner),
      'sveglia', r_pa.alarm_at,
      'stato',   v_pstate,
      'secondi', case when r_me.closed then r_pa.seconds end,
      'punti',   r_pa.points,
      'foto', case when r_me.closed then
                (select foto from public.object_photos where user_id = v_partner and day = d) end));
end;
$$;

-- ---------- PERMESSI (funzioni interne, mai chiamabili dal client) ----------
revoke all on function public.wb_gp_oggetto()               from public, anon, authenticated;
revoke all on function public.wb_ca_oggetto(jsonb, jsonb)    from public, anon, authenticated;
revoke all on function public.wb_game_params(text)           from public, anon, authenticated;
revoke all on function public.wb_check_answer(text, jsonb, jsonb) from public, anon, authenticated;

-- save_object_photos è una RPC per l'app: bloccata di default, poi
-- riaperta solo per utenti autenticati (come le altre RPC del passo 2/3).
revoke all on function public.save_object_photos(jsonb) from public, anon, authenticated;
grant execute on function public.save_object_photos(jsonb) to authenticated;
-- get_today() mantiene i permessi già concessi dal 02 (CREATE OR REPLACE
-- non li tocca): nessun nuovo grant necessario.
