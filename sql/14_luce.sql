-- =====================================================================
-- Wake Battle — Accendi la luce (passo 3.7, primo gioco con fotocamera)
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..13 già eseguiti. Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni).
--
-- Regole (decise il 23/09/2026 in questa chat, vedi anche docs/DECISIONI.md):
--  - Il client chiede il permesso della fotocamera (posteriore), NON
--    mostra il video in diretta: solo una barra con il livello di
--    luminosità rilevato in tempo reale.
--  - "Accesa" = media dei toni di grigio del frame (0-255) sopra una
--    soglia fissa (120), per almeno 5 frame di fila (evita falsi
--    positivi). Tutta la logica di rilevazione è lato client (games.js).
--  - Nessun timeout dedicato: il limite è già quello di 5 minuti dalla
--    sveglia (DECISIONI.md #2). Permesso negato o fotocamera non
--    disponibile -> messaggio con pulsante "Riprova".
--  - Il server NON riceve né verifica dati reali del sensore (non ha
--    modo di controllare cosa inquadra davvero la fotocamera): si fida
--    della conferma del client una volta rilevata la soglia. Risposta:
--    {fatto:true}, sempre accettata se il campo è booleano true.
--
-- Parametri: {gioco:'luce'} (nessun dato da generare: non c'è nulla da
-- falsificare in modo utile lato server per questo gioco).
-- Risposta: {fatto:true}. wb_ca_luce controlla solo che 'fatto' sia
-- booleano true (mai NULL, mai un campo mancante che passa il controllo).
--
-- Solo le due funzioni nuove + una riga in ciascun dispatcher (vedi 07):
-- non si ricopiano le funzioni degli altri giochi. La riga 'luce' in
-- challenge_types esiste già dal 02 (kind 'fisica'): questo file non la
-- tocca, solo l'attivazione con game_live la fa entrare in gioco.
-- =====================================================================

-- ---------- ACCENDI LA LUCE ----------
create or replace function public.wb_gp_luce()
returns jsonb language plpgsql volatile set search_path = ''
as $$
begin
  return jsonb_build_object('gioco', 'luce');
end;
$$;

create or replace function public.wb_ca_luce(p_params jsonb, p_answer jsonb)
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

-- ---------- DISPATCHER: aggiunta la riga 'luce', il resto è identico al 12 ----------
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
  return false;
exception when others then
  return false;
end;
$$;

-- ---------- PERMESSI (funzioni interne, mai chiamabili dal client) ----------
revoke all on function public.wb_gp_luce()                        from public, anon, authenticated;
revoke all on function public.wb_ca_luce(jsonb, jsonb)             from public, anon, authenticated;
revoke all on function public.wb_game_params(text)                 from public, anon, authenticated;
revoke all on function public.wb_check_answer(text, jsonb, jsonb)  from public, anon, authenticated;
