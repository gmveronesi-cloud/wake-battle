-- =====================================================================
-- Wake Battle — Passo 3.1: struttura dei giochi + primo gioco (Memoria)
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01 e 02 già eseguiti. Da lanciare UNA volta sola.
--
-- Cosa aggiunge:
--  - challenge_types.game_live: se true, nella sfida vera quella challenge
--    si gioca con il gioco vero (e il server controlla la risposta);
--    se false resta il vecchio pulsante "Fatto". Tutte partono a false.
--  - Parametri generati dal server + controllo della risposta (per ora: memoria).
--  - complete_game(p_answer): "Fatto" con risposta verificata.
--  - complete_challenge(): rifiuta il "Fatto" semplice se il gioco è attivo.
--  - Pagina di prova: beta_list(), beta_start(p_code), beta_check(...).
--    Nella prova non si registra niente: nessun effetto su tempi e punti.
--
-- Memoria (DECISIONI.md): 6 simboli mostrati per 5 s, poi vanno toccati
-- nello stesso ordine; errore = nuova sequenza. Il server prepara 60
-- sequenze (6 simboli diversi su 9); la risposta indica quale sequenza
-- (tentativo) e l'ordine toccato.
--
-- Per ATTIVARE un gioco nella sfida vera (dopo averlo provato in beta):
--   update public.challenge_types set game_live = true where code = 'memoria';
-- Per tornare al pulsante "Fatto":
--   update public.challenge_types set game_live = false where code = 'memoria';
-- =====================================================================

alter table public.challenge_types
  add column game_live boolean not null default false;

-- ---------------------------------------------------------------------
-- 1. FUNZIONI INTERNE DEI GIOCHI
-- ---------------------------------------------------------------------

-- Parametri di un gioco. null = gioco non ancora pronto.
create or replace function public.wb_game_params(p_code text)
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  v_list jsonb := '[]'::jsonb;
  v_seq  jsonb;
  i      int;
begin
  if p_code = 'memoria' then
    for i in 1..60 loop
      select jsonb_agg(s order by r) into v_seq
      from (select s, random() as r from generate_series(0, 8) s order by r limit 6) q;
      v_list := v_list || jsonb_build_array(v_seq);
    end loop;
    return jsonb_build_object('gioco', 'memoria', 'simboli', 9, 'mostra_ms', 5000,
                              'sequenze', v_list);
  end if;
  return null;
end;
$$;

-- Controllo della risposta. Mai errori: risposta strana = false.
create or replace function public.wb_check_answer(p_code text, p_params jsonb, p_answer jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  k int;
begin
  if p_params is null or p_answer is null or jsonb_typeof(p_answer) <> 'object' then
    return false;
  end if;
  if p_code = 'memoria' then
    if jsonb_typeof(p_answer->'tentativo') <> 'number'
       or jsonb_typeof(p_answer->'sequenza') <> 'array' then
      return false;
    end if;
    k := (p_answer->>'tentativo')::int;
    if k < 0 or k >= jsonb_array_length(p_params->'sequenze') then
      return false;
    end if;
    return (p_params->'sequenze'->k) = (p_answer->'sequenza');
  end if;
  return false;
exception when others then
  return false;
end;
$$;

-- Parametri della challenge del giorno (sostituisce la versione del passo 2):
-- gioco vero se attivo nella sfida, altrimenti come prima.
create or replace function public.wb_challenge_params(p_code text)
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  v_g jsonb;
begin
  if exists (select 1 from public.challenge_types where code = p_code and game_live) then
    v_g := public.wb_game_params(p_code);
    if v_g is not null then
      return v_g;
    end if;
  end if;
  if p_code = 'esercizi' then
    return jsonb_build_object('esercizio',
      (array['piegamenti_10', 'squat_20', 'affondi_20', 'plank_30'])[1 + floor(random() * 4)::int]);
  end if;
  return '{}'::jsonb;
end;
$$;

-- Registrazione del "Fatto" (comune a complete_challenge e complete_game)
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

-- ---------------------------------------------------------------------
-- 2. FUNZIONI PER L'APP (RPC)
-- Nuovi errori: serve_il_gioco | nessun_gioco | risposta_sbagliata | gioco_non_pronto
-- ---------------------------------------------------------------------

-- "Fatto" semplice (stesso nome e risposte del passo 2).
-- Se la challenge del giorno è un gioco vero -> serve_il_gioco.
create or replace function public.complete_challenge()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  return public.wb_complete(auth.uid(), null, false);
end;
$$;

-- "Fatto" di un gioco: la risposta viene controllata dal server.
create or replace function public.complete_game(p_answer jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  return public.wb_complete(auth.uid(), p_answer, true);
end;
$$;

-- Pagina di prova: elenco challenge con stato
--   pronto = gioco disponibile nella prova; in_sfida = attivo nella sfida vera
create or replace function public.beta_list()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true, 'giochi', (
    select jsonb_agg(jsonb_build_object(
             'codice',   code,
             'nome',     name,
             'tipo',     kind,
             'pronto',   public.wb_game_params(code) is not null,
             'in_sfida', game_live and enabled) order by sort)
    from public.challenge_types));
end;
$$;

-- Pagina di prova: nuova partita (nessun salvataggio)
create or replace function public.beta_start(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_g jsonb;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  v_g := public.wb_game_params(p_code);
  if v_g is null then
    return jsonb_build_object('ok', false, 'error', 'gioco_non_pronto');
  end if;
  return jsonb_build_object('ok', true, 'codice', p_code,
    'nome', (select name from public.challenge_types where code = p_code),
    'parametri', v_g);
end;
$$;

-- Pagina di prova: controllo della risposta con la stessa funzione della sfida vera
create or replace function public.beta_check(p_code text, p_params jsonb, p_answer jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  if octet_length(coalesce(p_params::text, '')) > 20000
     or octet_length(coalesce(p_answer::text, '')) > 5000 then
    return jsonb_build_object('ok', true, 'corretto', false);
  end if;
  return jsonb_build_object('ok', true,
    'corretto', public.wb_check_answer(p_code, p_params, p_answer));
end;
$$;

-- ---------------------------------------------------------------------
-- 3. PERMESSI
-- ---------------------------------------------------------------------
revoke all on function public.wb_game_params(text)                 from public, anon, authenticated;
revoke all on function public.wb_check_answer(text, jsonb, jsonb)  from public, anon, authenticated;
revoke all on function public.wb_challenge_params(text)            from public, anon, authenticated;
revoke all on function public.wb_complete(uuid, jsonb, boolean)    from public, anon, authenticated;

revoke all on function public.complete_challenge()                 from public, anon;
revoke all on function public.complete_game(jsonb)                 from public, anon;
revoke all on function public.beta_list()                          from public, anon;
revoke all on function public.beta_start(text)                     from public, anon;
revoke all on function public.beta_check(text, jsonb, jsonb)       from public, anon;
grant execute on function public.complete_challenge()              to authenticated;
grant execute on function public.complete_game(jsonb)              to authenticated;
grant execute on function public.beta_list()                       to authenticated;
grant execute on function public.beta_start(text)                  to authenticated;
grant execute on function public.beta_check(text, jsonb, jsonb)    to authenticated;
