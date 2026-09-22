-- =====================================================================
-- Wake Battle — Passo 3.3: Colore della parola
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..05 già eseguiti. Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni: sostituisce solo due funzioni).
--
-- Regole (decise da Gianmarco il 22/09/2026):
--  - 10 turni. In ogni turno una parola-colore scritta con l'inchiostro di un
--    ALTRO colore (es. ROSSO in blu): si tocca il colore dell'INCHIOSTRO.
--  - 6 colori: 0 rosso, 1 blu, 2 verde, 3 giallo, 4 viola, 5 arancione.
--    6 pulsanti col nome scritto in nero, ordine fisso. Nessun limite per turno.
--  - Errore -> lampeggio rosso, si riparte dal turno 1 con parole nuove.
--  - Coperto fino a "Inizia". Al 10° giusto la risposta parte da sola.
--
-- Come il server verifica: parametri {gioco:'colore_parola', colori:6, turni:10,
-- sequenze:[200 tentativi × 10 turni × [parola, inchiostro]]} (uguali per la coppia;
-- parola <> inchiostro; inchiostro mai uguale a quello del turno prima).
-- Risposta {tentativo, risposte:[10 inchiostri], tentativi}: il server controlla
-- che risposte[i] = sequenze[tentativo][i][1]. Campi extra ignorati.
--
-- Cosa cambia: solo wb_game_params e wb_check_answer (sostituite), con dentro
-- TUTTI i giochi già fatti: Numeri (05), Memoria a round (04), Memoria vecchia (03).
-- Mai NULL: ogni caso dubbio = false.
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
  j      int;
  w      int;
  c      int;
  pc     int;
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
  if p_code = 'numeri' then
    return jsonb_build_object('gioco', 'numeri', 'lato', 5,
      'disposizione', (select jsonb_agg(n order by random()) from generate_series(1, 25) n));
  end if;

  if p_code = 'colore_parola' then
    for i in 1 .. 200 loop
      v_seq := '[]'::jsonb;
      pc := -1;
      for j in 1 .. 10 loop
        loop   -- inchiostro diverso dal turno prima
          c := floor(random() * 6)::int;
          exit when c <> pc;
        end loop;
        w := (c + 1 + floor(random() * 5)::int) % 6;   -- parola sempre <> inchiostro
        v_seq := v_seq || jsonb_build_array(jsonb_build_array(w, c));
        pc := c;
      end loop;
      v_list := v_list || jsonb_build_array(v_seq);
    end loop;
    return jsonb_build_object('gioco', 'colore_parola', 'colori', 6, 'turni', 10, 'sequenze', v_list);
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

  if p_code = 'numeri' then
    -- {tocchi: [25 posizioni]}: tocchi[i] = posizione del numero i+1
    if coalesce(jsonb_typeof(p_answer->'tocchi'), '') <> 'array'
       or coalesce(jsonb_typeof(p_params->'disposizione'), '') <> 'array'
       or jsonb_array_length(p_params->'disposizione') <> 25
       or jsonb_array_length(p_answer->'tocchi') <> 25 then
      return false;
    end if;
    for i in 0 .. 24 loop
      if coalesce(jsonb_typeof(p_answer->'tocchi'->i), '') <> 'number' then
        return false;
      end if;
      k := round((p_answer->'tocchi'->>i)::numeric)::int;
      if (p_answer->'tocchi'->>i)::numeric <> k or k < 0 or k > 24
         or coalesce(jsonb_typeof(p_params->'disposizione'->k), '') <> 'number'
         or (p_params->'disposizione'->>k)::numeric is distinct from (i + 1) then
        return false;
      end if;
    end loop;
    return true;
  end if;

  if p_code = 'colore_parola' then
    -- {tentativo: k, risposte: [10 inchiostri]}: risposte[i] = sequenze[k][i][1]
    if coalesce(jsonb_typeof(p_answer->'tentativo'), '') <> 'number'
       or coalesce(jsonb_typeof(p_answer->'risposte'), '') <> 'array'
       or coalesce(jsonb_typeof(p_params->'sequenze'), '') <> 'array'
       or coalesce(jsonb_typeof(p_params->'turni'), '') <> 'number' then
      return false;
    end if;
    k := round((p_answer->>'tentativo')::numeric)::int;
    n := round((p_params->>'turni')::numeric)::int;
    if (p_answer->>'tentativo')::numeric <> k or k < 0
       or k >= jsonb_array_length(p_params->'sequenze') or n < 1
       or (p_params->>'turni')::numeric <> n
       or coalesce(jsonb_typeof(p_params->'sequenze'->k), '') <> 'array'
       or jsonb_array_length(p_params->'sequenze'->k) <> n
       or jsonb_array_length(p_answer->'risposte') <> n then
      return false;
    end if;
    for i in 0 .. n - 1 loop
      if coalesce(jsonb_typeof(p_answer->'risposte'->i), '') <> 'number'
         or coalesce(jsonb_typeof(p_params->'sequenze'->k->i->1), '') <> 'number'
         or (p_answer->'risposte'->>i)::numeric is distinct from (p_params->'sequenze'->k->i->>1)::numeric then
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

-- Permessi (come nel 03/04/05: funzioni interne, mai chiamabili dal client)
revoke all on function public.wb_game_params(text)                from public, anon, authenticated;
revoke all on function public.wb_check_answer(text, jsonb, jsonb) from public, anon, authenticated;
