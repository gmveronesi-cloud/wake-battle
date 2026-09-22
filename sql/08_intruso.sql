-- =====================================================================
-- Wake Battle — Trova l'intruso (passo 3.4)
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..07 già eseguiti. Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni).
--
-- Regola (vedi docs/DECISIONI.md): 5 turni. In ogni turno una griglia 3×3
-- di 9 emoji (stesso set di Memoria) tutte uguali tranne una: resta
-- visibile mostra_ms, poi si copre e si tocca a memoria la casella
-- dell'intrusa. Turno giusto → il successivo parte da solo. Un tocco
-- sbagliato → si riparte dal turno 1 con emoji/posizioni nuove (come
-- Colore della parola), non solo il turno corrente.
--
-- Parametri compatti: ogni turno è [base, intruso, posizione] (non la
-- griglia intera di 9 caselle, che con 200 tentativi × 5 turni supera i
-- 20000 byte controllati da beta_check). Il client ricostruisce la
-- griglia: tutte le caselle = base, tranne "posizione" = intruso.
--
-- Solo le due funzioni nuove + una riga in ciascun dispatcher (vedi 07):
-- non si ricopiano le funzioni degli altri giochi.
-- =====================================================================

-- ---------- TROVA L'INTRUSO ----------
create or replace function public.wb_gp_intruso()
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  v_list jsonb := '[]'::jsonb;
  v_seq  jsonb;
  i      int;
  j      int;
  b      int;
  s      int;
  pos    int;
  ppos   int;
begin
  for i in 1 .. 200 loop
    v_seq := '[]'::jsonb;
    ppos := -1;
    for j in 1 .. 5 loop
      loop   -- posizione dell'intrusa diversa dal turno prima
        pos := floor(random() * 9)::int;
        exit when pos <> ppos;
      end loop;
      b := floor(random() * 9)::int;
      loop   -- emoji dell'intrusa diversa dal resto della griglia
        s := floor(random() * 9)::int;
        exit when s <> b;
      end loop;
      v_seq := v_seq || jsonb_build_array(jsonb_build_array(b, s, pos));
      ppos := pos;
    end loop;
    v_list := v_list || jsonb_build_array(v_seq);
  end loop;
  return jsonb_build_object('gioco', 'intruso', 'elementi', 9, 'turni', 5, 'mostra_ms', 3000, 'sequenze', v_list);
end;
$$;

create or replace function public.wb_ca_intruso(p_params jsonb, p_answer jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  k int;
  n int;
  i int;
begin
  -- {tentativo: k, risposte: [5 posizioni]}: risposte[i] = sequenze[k][i][2]
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
       or coalesce(jsonb_typeof(p_params->'sequenze'->k->i->2), '') <> 'number'
       or (p_answer->'risposte'->>i)::numeric is distinct from (p_params->'sequenze'->k->i->>2)::numeric then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

-- ---------- DISPATCHER: aggiunta la riga 'intruso', il resto è identico al 07 ----------
create or replace function public.wb_game_params(p_code text)
returns jsonb language plpgsql volatile set search_path = ''
as $$
begin
  if p_code = 'memoria' then return public.wb_gp_memoria(); end if;
  if p_code = 'numeri' then return public.wb_gp_numeri(); end if;
  if p_code = 'colore_parola' then return public.wb_gp_colore_parola(); end if;
  if p_code = 'intruso' then return public.wb_gp_intruso(); end if;
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
  if p_code = 'intruso' then return public.wb_ca_intruso(p_params, p_answer); end if;
  return false;
exception when others then
  return false;
end;
$$;

-- ---------- PERMESSI (funzioni interne, mai chiamabili dal client) ----------
revoke all on function public.wb_gp_intruso()                     from public, anon, authenticated;
revoke all on function public.wb_ca_intruso(jsonb, jsonb)          from public, anon, authenticated;
revoke all on function public.wb_game_params(text)                 from public, anon, authenticated;
revoke all on function public.wb_check_answer(text, jsonb, jsonb)  from public, anon, authenticated;
