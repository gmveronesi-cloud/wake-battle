-- =====================================================================
-- Wake Battle — Riflessi, nuova versione "Babbo/Schiacciami" (passo 3.5b)
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..10 già eseguiti. Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni).
--
-- Sostituisce la meccanica di Riflessi (a Gianmarco non piaceva): stesso
-- codice challenge 'riflessi', stesso nome, SOLO wb_gp_riflessi/wb_ca_riflessi
-- cambiano (nessuna riga di dispatcher da toccare: il dispatcher del 10
-- punta già a queste due funzioni).
--
-- Regole (decise il 22/09/2026 in questa chat):
--  - Dopo un'attesa casuale (3-6 s, dal server, uguale per la coppia)
--    compaiono due riquadri UGUALI affiancati per 400 ms, con scritto
--    "BABBO" e "SCHIACCIAMI!" (posizione che si alterna a ogni round:
--    pubblica, non serve generarla dal server). Poi si oscurano restando
--    nella stessa posizione (vuoti, ma cliccabili).
--  - Tocchi "SCHIACCIAMI!" -> passi al round successivo. Tocchi "BABBO"
--    -> perdi e riparti dal round 1 con dati nuovi (come Colore della
--    parola/Intruso: ogni tentativo consuma il prossimo set generato).
--  - 5 round di fila per finire.
--  - La posizione giusta è calcolabile da chiunque (alterna per indice di
--    round): il server non genera un segreto da verificare, quindi
--    controlla solo la forma della risposta (mai NULL) — come i tempi di
--    reazione della vecchia versione.
--
-- Parametri: {gioco:'riflessi', round:5, mostra_ms:400,
--   sequenze:[200 tentativi × 5 attese in ms (3000-6000)]}.
-- Risposta: {tentativo, tentativi}. Il server verifica solo che tentativo
-- sia un indice valido di sequenze e che sequenze[tentativo] abbia
-- esattamente 'round' elementi.
-- =====================================================================

create or replace function public.wb_gp_riflessi()
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  v_list jsonb := '[]'::jsonb;
  v_seq  jsonb;
  i      int;
  j      int;
begin
  for i in 1 .. 200 loop
    v_seq := '[]'::jsonb;
    for j in 1 .. 5 loop
      v_seq := v_seq || to_jsonb(3000 + floor(random() * 3001)::int);
    end loop;
    v_list := v_list || jsonb_build_array(v_seq);
  end loop;
  return jsonb_build_object('gioco', 'riflessi', 'round', 5, 'mostra_ms', 400, 'sequenze', v_list);
end;
$$;

create or replace function public.wb_ca_riflessi(p_params jsonb, p_answer jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  k int;
  n int;
begin
  -- {tentativo:k}: il round vinto (tap su "SCHIACCIAMI!") lo decide il
  -- client; la posizione giusta è pubblica (alterna per indice di round,
  -- non è un segreto del server), quindi si controlla solo che il
  -- tentativo sia dentro i dati generati dal server.
  if coalesce(jsonb_typeof(p_answer->'tentativo'), '') <> 'number'
     or coalesce(jsonb_typeof(p_params->'sequenze'), '') <> 'array'
     or coalesce(jsonb_typeof(p_params->'round'), '') <> 'number' then
    return false;
  end if;
  k := round((p_answer->>'tentativo')::numeric)::int;
  n := round((p_params->>'round')::numeric)::int;
  if (p_answer->>'tentativo')::numeric <> k or k < 0
     or k >= jsonb_array_length(p_params->'sequenze') or n < 1
     or (p_params->>'round')::numeric <> n
     or coalesce(jsonb_typeof(p_params->'sequenze'->k), '') <> 'array'
     or jsonb_array_length(p_params->'sequenze'->k) <> n then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

-- ---------- PERMESSI (funzioni interne, mai chiamabili dal client) ----------
revoke all on function public.wb_gp_riflessi()             from public, anon, authenticated;
revoke all on function public.wb_ca_riflessi(jsonb, jsonb)  from public, anon, authenticated;
