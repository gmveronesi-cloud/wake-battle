-- =====================================================================
-- Wake Battle — Passo 3.1b: Memoria più semplice (5 round da 3 emoji)
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01, 02 e 03 già eseguiti. Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni: sostituisce solo due funzioni).
--
-- Nuove regole di Memoria (decise da Gianmarco il 22/09/2026):
--  - 5 round di fila; in ogni round 3 emoji diverse (su 9) visibili 3 s,
--    poi vanno toccate nello stesso ordine.
--  - Round riuscito -> il successivo parte da solo. "Inizia" solo all'inizio.
--  - Un tocco sbagliato -> si riparte dal round 1 con emoji nuove.
--  - Il cronometro della sfida vera resta quello di sempre:
--    dall'orario della sveglia al "Fatto" (lo misura il server).
--
-- Come il server verifica: prepara una lista di 200 sequenze da 3.
-- Il telefono le usa in ordine (ogni round, anche sbagliato, consuma la
-- sequenza successiva). A fine partita manda {inizio, sequenze}: il
-- server controlla che le 5 sequenze toccate siano esattamente quelle
-- dalla posizione "inizio" in poi.
--
-- Cosa cambia: solo wb_game_params e wb_check_answer (sostituite).
-- Corregge anche un buco del 03: una risposta vuota {} veniva accettata
-- (un confronto con un campo mancante dava "sconosciuto" invece di "falso").
-- Ora ogni caso dubbio vale "risposta sbagliata".
-- Le giornate già create con la Memoria vecchia (6 emoji) restano
-- valide e vengono ancora controllate come prima.
-- Nessun altro gioco esiste ancora: niente da conservare oltre a Memoria.
-- =====================================================================

-- Parametri di un gioco. null = gioco non ancora pronto.
create or replace function public.wb_game_params(p_code text)
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  v_list jsonb := '[]'::jsonb;
  v_seq  jsonb;
  v_prev jsonb := null;
  i      int := 0;
begin
  if p_code = 'memoria' then
    while i < 200 loop
      select jsonb_agg(s order by r) into v_seq
      from (select s, random() as r from generate_series(0, 8) s order by r limit 3) q;
      if v_seq is distinct from v_prev then   -- mai due sequenze uguali di fila
        v_list := v_list || jsonb_build_array(v_seq);
        v_prev := v_seq;
        i := i + 1;
      end if;
    end loop;
    return jsonb_build_object('gioco', 'memoria', 'simboli', 9, 'mostra_ms', 3000,
                              'round', 5, 'lunghezza', 3, 'sequenze', v_list);
  end if;
  return null;
end;
$$;

-- Controllo della risposta. Mai errori: risposta strana = false.
create or replace function public.wb_check_answer(p_code text, p_params jsonb, p_answer jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  k  int;
  n  int;
  i  int;
begin
  if p_params is null or p_answer is null or jsonb_typeof(p_answer) <> 'object' then
    return false;
  end if;

  if p_code = 'memoria' then
    -- Memoria vecchia (passo 3.1: 6 emoji, un solo giro) — giornate create prima del 04
    if not (p_params ? 'round') then
      if coalesce(jsonb_typeof(p_answer->'tentativo'), '') <> 'number'
         or coalesce(jsonb_typeof(p_answer->'sequenza'), '') <> 'array' then
        return false;
      end if;
      k := (p_answer->>'tentativo')::int;
      if k < 0 or k >= jsonb_array_length(p_params->'sequenze') then
        return false;
      end if;
      return coalesce((p_params->'sequenze'->k) = (p_answer->'sequenza'), false);
    end if;

    -- Memoria a round: {inizio: numero, sequenze: [round × sequenza]}
    if coalesce(jsonb_typeof(p_answer->'inizio'), '') <> 'number'
       or coalesce(jsonb_typeof(p_answer->'sequenze'), '') <> 'array'
       or coalesce(jsonb_typeof(p_params->'sequenze'), '') <> 'array' then
      return false;
    end if;
    k := (p_answer->>'inizio')::int;
    n := (p_params->>'round')::int;
    if n is null or (p_answer->>'inizio')::numeric <> k or n < 1
       or jsonb_array_length(p_answer->'sequenze') <> n
       or k < 0 or k + n > jsonb_array_length(p_params->'sequenze') then
      return false;
    end if;
    for i in 0 .. n - 1 loop
      if (p_params->'sequenze'->(k + i)) is null
         or (p_params->'sequenze'->(k + i)) is distinct from (p_answer->'sequenze'->i) then
        return false;
      end if;
    end loop;
    return true;
  end if;

  return false;
exception when others then
  return false;
end;
$$;

-- Permessi (come nel 03: funzioni interne, mai chiamabili dal client)
revoke all on function public.wb_game_params(text)                from public, anon, authenticated;
revoke all on function public.wb_check_answer(text, jsonb, jsonb) from public, anon, authenticated;
