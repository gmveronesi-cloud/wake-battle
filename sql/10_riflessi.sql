-- =====================================================================
-- Wake Battle — Riflessi (passo 3.5)
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..09 già eseguiti. Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni).
--
-- Regole (vedi docs/DECISIONI.md + scelte del 22/09/2026 in questa chat):
--  - Riquadro rosso "ASPETTA…"; dopo un'attesa casuale (1-4 s, dal server,
--    uguale per la coppia) diventa verde "TOCCA!" e va toccato. 5 volte
--    di fila riuscite per finire.
--  - Tocco mentre è ancora rosso (anticipo): SOLO quel turno si ripete
--    (non l'intera serie, a differenza di Memoria/Colore della parola).
--    Nessun timeout: il riquadro aspetta finché non lo si tocca.
--  - Il vero tempo di reazione è misurabile solo dal telefono: il server
--    controlla solo la forma della risposta (mai NULL), non la
--    plausibilità dei tempi — come le challenge fisiche.
--
-- Parametri: {gioco:'riflessi', volte:5, attese:[1000 attese in ms]}, un
-- flusso unico (non a "tentativi" come gli altri giochi, perché qui un
-- errore consuma solo un'attesa in più, non ricomincia tutto da capo).
-- Risposta: {inizio, usate, tempi:[5 tempi di reazione ms], errori} con
-- usate = errori + 5 (errori = anticipi). Il server controlla solo che
-- inizio/usate/errori siano coerenti e dentro il flusso "attese", e che
-- tempi sia un array di 5 numeri >= 0. Campo "errori" (non "anticipi")
-- per riusare la sottoscritta generica di beta.js (già mostra "errori: N").
--
-- Solo le due funzioni nuove + una riga in ciascun dispatcher (vedi 07):
-- non si ricopiano le funzioni degli altri giochi.
-- =====================================================================

-- ---------- RIFLESSI ----------
create or replace function public.wb_gp_riflessi()
returns jsonb language sql volatile set search_path = ''
as $$
  select jsonb_build_object('gioco', 'riflessi', 'volte', 5,
    'attese', (select jsonb_agg(1000 + floor(random() * 3001)::int) from generate_series(1, 1000)));
$$;

create or replace function public.wb_ca_riflessi(p_params jsonb, p_answer jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  k int;
  n int;
  e int;
  i int;
begin
  -- {inizio:k, usate:n, tempi:[5 tempi reazione ms], errori:e}: n = e + 5,
  -- inizio+usate dentro "attese". I tempi non sono verificabili lato server
  -- (misurati dal telefono): si controlla solo che siano numeri >= 0.
  if coalesce(jsonb_typeof(p_answer->'inizio'), '') <> 'number'
     or coalesce(jsonb_typeof(p_answer->'usate'), '') <> 'number'
     or coalesce(jsonb_typeof(p_answer->'errori'), '') <> 'number'
     or coalesce(jsonb_typeof(p_answer->'tempi'), '') <> 'array'
     or coalesce(jsonb_typeof(p_params->'attese'), '') <> 'array' then
    return false;
  end if;
  k := round((p_answer->>'inizio')::numeric)::int;
  n := round((p_answer->>'usate')::numeric)::int;
  e := round((p_answer->>'errori')::numeric)::int;
  if (p_answer->>'inizio')::numeric <> k or (p_answer->>'usate')::numeric <> n
     or (p_answer->>'errori')::numeric <> e or k < 0 or e < 0 or n <> e + 5
     or k + n > jsonb_array_length(p_params->'attese')
     or jsonb_array_length(p_answer->'tempi') <> 5 then
    return false;
  end if;
  for i in 0 .. 4 loop
    if coalesce(jsonb_typeof(p_answer->'tempi'->i), '') <> 'number'
       or (p_answer->'tempi'->>i)::numeric < 0 then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

-- ---------- DISPATCHER: aggiunta la riga 'riflessi', il resto è identico al 09 ----------
create or replace function public.wb_game_params(p_code text)
returns jsonb language plpgsql volatile set search_path = ''
as $$
begin
  if p_code = 'memoria' then return public.wb_gp_memoria(); end if;
  if p_code = 'numeri' then return public.wb_gp_numeri(); end if;
  if p_code = 'colore_parola' then return public.wb_gp_colore_parola(); end if;
  if p_code = 'riflessi' then return public.wb_gp_riflessi(); end if;
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
  return false;
exception when others then
  return false;
end;
$$;

-- ---------- PERMESSI (funzioni interne, mai chiamabili dal client) ----------
revoke all on function public.wb_gp_riflessi()                    from public, anon, authenticated;
revoke all on function public.wb_ca_riflessi(jsonb, jsonb)         from public, anon, authenticated;
revoke all on function public.wb_game_params(text)                 from public, anon, authenticated;
revoke all on function public.wb_check_answer(text, jsonb, jsonb)  from public, anon, authenticated;
