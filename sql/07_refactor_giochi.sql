-- =====================================================================
-- Wake Battle — Refactor: wb_game_params / wb_check_answer a dispatcher
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..05 già eseguiti (funziona anche se il 06 non è ancora stato
-- eseguito: lo sostituisce). Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni).
--
-- SOLO riorganizzazione: nessuna regola di gioco cambia. Stesso identico
-- comportamento del 06 su tutte le suite di test (02, 04, 05, 06) — vedi
-- test/run.sh, sezione "dopo 07".
--
-- Perché: dal 03 in poi ogni nuovo gioco ricopiava per intero il codice di
-- TUTTI i giochi precedenti dentro wb_game_params/wb_check_answer (rischio
-- di copiare male un pezzo vecchio scrivendone uno nuovo). Da qui in poi
-- ogni gioco ha le sue due funzioni private (wb_gp_<gioco> per i parametri,
-- wb_ca_<gioco> per il controllo) e i due dispatcher sotto aggiungono solo
-- UNA riga per il gioco nuovo, senza toccare le funzioni dei giochi già
-- fatti. Il prossimo gioco (Trova l'intruso) aggiunge un file 08_... con
-- le sue wb_gp_intruso/wb_ca_intruso + una riga in ciascun dispatcher.
-- =====================================================================

-- ---------- MEMORIA (03: 6 simboli legacy + 04: 5 round da 3) ----------
create or replace function public.wb_gp_memoria()
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  v_list jsonb := '[]'::jsonb;
  v_seq  jsonb;
  v_prev jsonb := null;
  i      int := 0;
begin
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
end;
$$;

-- Controllo della risposta. Mai errori: risposta strana = false.
create or replace function public.wb_ca_memoria(p_params jsonb, p_answer jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  k int;
  n int;
  i int;
begin
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
exception when others then
  return false;
end;
$$;

-- ---------- NUMERI IN ORDINE (05) ----------
create or replace function public.wb_gp_numeri()
returns jsonb language sql volatile set search_path = ''
as $$
  select jsonb_build_object('gioco', 'numeri', 'lato', 5,
    'disposizione', (select jsonb_agg(n order by random()) from generate_series(1, 25) n));
$$;

create or replace function public.wb_ca_numeri(p_params jsonb, p_answer jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  k int;
  i int;
begin
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
exception when others then
  return false;
end;
$$;

-- ---------- COLORE DELLA PAROLA (06) ----------
create or replace function public.wb_gp_colore_parola()
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  v_list jsonb := '[]'::jsonb;
  v_seq  jsonb;
  i      int;
  j      int;
  w      int;
  c      int;
  pc     int;
begin
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
end;
$$;

create or replace function public.wb_ca_colore_parola(p_params jsonb, p_answer jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  k int;
  n int;
  i int;
begin
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
exception when others then
  return false;
end;
$$;

-- ---------- DISPATCHER: un gioco nuovo = una riga qui, non ricopiare nulla ----------
create or replace function public.wb_game_params(p_code text)
returns jsonb language plpgsql volatile set search_path = ''
as $$
begin
  if p_code = 'memoria' then return public.wb_gp_memoria(); end if;
  if p_code = 'numeri' then return public.wb_gp_numeri(); end if;
  if p_code = 'colore_parola' then return public.wb_gp_colore_parola(); end if;
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
  return false;
exception when others then
  return false;
end;
$$;

-- ---------- PERMESSI (funzioni interne, mai chiamabili dal client) ----------
revoke all on function public.wb_gp_memoria()                     from public, anon, authenticated;
revoke all on function public.wb_ca_memoria(jsonb, jsonb)         from public, anon, authenticated;
revoke all on function public.wb_gp_numeri()                      from public, anon, authenticated;
revoke all on function public.wb_ca_numeri(jsonb, jsonb)          from public, anon, authenticated;
revoke all on function public.wb_gp_colore_parola()                from public, anon, authenticated;
revoke all on function public.wb_ca_colore_parola(jsonb, jsonb)    from public, anon, authenticated;
revoke all on function public.wb_game_params(text)                 from public, anon, authenticated;
revoke all on function public.wb_check_answer(text, jsonb, jsonb)  from public, anon, authenticated;
