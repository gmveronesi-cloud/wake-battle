-- =====================================================================
-- Wake Battle — Anagramma (passo 3.6)
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..11 già eseguiti. Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni).
--
-- Regole (decise il 23/09/2026 in questa chat, vedi anche docs/DECISIONI.md):
--  - 5 parole di fila (lunghezza 5-7 lettere, da una lista di parole
--    italiane comuni generata qui sotto).
--  - Le lettere della parola sono mostrate mescolate come tessere; si
--    toccano nell'ordine giusto per ricomporre la parola. L'ordine del
--    mescolamento è calcolato dal client in modo deterministico dalle
--    lettere stesse (stessa parola -> stesso mescolamento), quindi
--    uguale per la coppia, senza bisogno di un campo apposta dal server
--    (stesso trucco della disposizione dei pulsanti di Colore della
--    parola).
--  - Tentativi illimitati: un tocco sbagliato lampeggia di rosso 0,3 s,
--    nessuna penalità, si continua sulla STESSA parola (nessuna
--    ripartenza, a differenza di Colore della parola/Riflessi).
--  - Parola completata -> passa da sola alla successiva ("Inizia" solo
--    all'inizio). Dopo la 5ª parola la risposta parte da sola.
--  - Risposta rifiutata dal server (raro: solo se il client manda dati
--    manomessi) -> nuovo tentativo con 5 parole nuove, come Colore della
--    parola/Riflessi (ogni tentativo consuma il prossimo set generato).
--
-- Parametri: {gioco:'anagramma', parole:5, sequenze:[40 tentativi × 5
--   parole, ognuna = array delle lettere in ordine corretto]}. Solo 40
--   (non 200 come gli altri giochi): qui un errore non consuma un
--   tentativo (tentativi illimitati sulla stessa parola), quindi il
--   client ne usa uno solo quasi sempre; con le lettere per esteso (non
--   numeri) 200 supererebbe il limite di 20000 byte di beta_check/
--   complete_game (~32000 byte con 200, ~6500 con 40).
-- Risposta: {tentativo, risposte:[5 parole di lettere], tentativi}. Il
-- server verifica che risposte[i] sia identica (stesso ordine esatto,
-- niente altri anagrammi validi) a sequenze[tentativo][i] — il client può
-- costruire risposte[i] solo toccando le lettere giuste in ordine, quindi
-- coincide sempre con la parola bersaglio quando arriva qui.
--
-- Solo le due funzioni nuove + una riga in ciascun dispatcher (vedi 07):
-- non si ricopiano le funzioni degli altri giochi.
-- =====================================================================

-- ---------- ANAGRAMMA ----------
create or replace function public.wb_gp_anagramma()
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  v_words text[] := array[
    'PORTA','LIBRO','GATTO','TRENO','FORNO','VERDE','PIZZA','SEDIA','FIUME','MONTE',
    'PONTE','CAMPO','LETTO','FIORE','CUORE','TORTA','PESCE','AMICO','FUOCO','VOLPE',
    'TIGRE','NONNA','NONNO','PANNA','CANNA','MERLO','LEONE','CIELO','VENTO','PRATO',
    'FUNGO','GESSO','SASSO','CASSA','TAZZA',
    'NUVOLA','STELLA','NEBBIA','FRUTTA','TAVOLO','GIACCA','CUCINA','GIORNO','FARINA','SCUOLA',
    'MUSICA','GELATO','PATATA','FINALE','SALICE','DIVANO','GABBIA','SEDANO',
    'BAMBINO','SORELLA','FRECCIA','PALLONE','ARANCIA','CANZONE','CAMICIA','CARTINA','MERCATO','CAMMINO',
    'BOTTONE','COLLINA','ARMADIO','FUMETTO','VULCANO','FONTANA','BALCONE','PALAZZO','PATTINO','SORRISO',
    'TAPPETO','FORMICA','GALLINA','CAMPANA','CANDELA','VALIGIA'
  ];
  v_list    jsonb := '[]'::jsonb;
  v_seq     jsonb;
  v_word    text;
  v_letters jsonb;
  i int;
  j int;
begin
  for i in 1 .. 40 loop
    v_seq := '[]'::jsonb;
    for j in 1 .. 5 loop
      v_word := v_words[1 + floor(random() * array_length(v_words, 1))::int];
      select jsonb_agg(substring(v_word from n for 1) order by n) into v_letters
      from generate_series(1, length(v_word)) n;
      v_seq := v_seq || jsonb_build_array(v_letters);
    end loop;
    v_list := v_list || jsonb_build_array(v_seq);
  end loop;
  return jsonb_build_object('gioco', 'anagramma', 'parole', 5, 'sequenze', v_list);
end;
$$;

create or replace function public.wb_ca_anagramma(p_params jsonb, p_answer jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  k int;
  n int;
  i int;
begin
  -- {tentativo:k, risposte:[parole × lettere], tentativi}: risposte[i]
  -- deve essere identica (stesso ordine) a sequenze[k][i].
  if coalesce(jsonb_typeof(p_answer->'tentativo'), '') <> 'number'
     or coalesce(jsonb_typeof(p_answer->'risposte'), '') <> 'array'
     or coalesce(jsonb_typeof(p_params->'sequenze'), '') <> 'array'
     or coalesce(jsonb_typeof(p_params->'parole'), '') <> 'number' then
    return false;
  end if;
  k := round((p_answer->>'tentativo')::numeric)::int;
  n := round((p_params->>'parole')::numeric)::int;
  if (p_answer->>'tentativo')::numeric <> k or k < 0
     or k >= jsonb_array_length(p_params->'sequenze') or n < 1
     or (p_params->>'parole')::numeric <> n
     or coalesce(jsonb_typeof(p_params->'sequenze'->k), '') <> 'array'
     or jsonb_array_length(p_params->'sequenze'->k) <> n
     or jsonb_array_length(p_answer->'risposte') <> n then
    return false;
  end if;
  for i in 0 .. n - 1 loop
    if (p_params->'sequenze'->k->i) is null
       or (p_params->'sequenze'->k->i) is distinct from (p_answer->'risposte'->i) then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

-- ---------- DISPATCHER: aggiunta la riga 'anagramma', il resto è identico al 10/11 ----------
create or replace function public.wb_game_params(p_code text)
returns jsonb language plpgsql volatile set search_path = ''
as $$
begin
  if p_code = 'memoria' then return public.wb_gp_memoria(); end if;
  if p_code = 'numeri' then return public.wb_gp_numeri(); end if;
  if p_code = 'colore_parola' then return public.wb_gp_colore_parola(); end if;
  if p_code = 'riflessi' then return public.wb_gp_riflessi(); end if;
  if p_code = 'anagramma' then return public.wb_gp_anagramma(); end if;
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
  return false;
exception when others then
  return false;
end;
$$;

-- ---------- PERMESSI (funzioni interne, mai chiamabili dal client) ----------
revoke all on function public.wb_gp_anagramma()                   from public, anon, authenticated;
revoke all on function public.wb_ca_anagramma(jsonb, jsonb)        from public, anon, authenticated;
revoke all on function public.wb_game_params(text)                 from public, anon, authenticated;
revoke all on function public.wb_check_answer(text, jsonb, jsonb)  from public, anon, authenticated;
