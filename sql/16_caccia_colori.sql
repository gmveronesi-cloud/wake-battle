-- =====================================================================
-- Wake Battle — Caccia ai colori (terzo gioco con fotocamera)
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..15 già eseguiti. Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni).
--
-- Regole (decise il 23/09/2026 in questa chat, vedi anche docs/DECISIONI.md):
--  - Palette di 4 colori (rosso, verde, blu, giallo): scelti perché più
--    distanti tra loro in tonalità (HSV) rispetto ai 6 di "Colore della
--    parola", meno rischio di falsi positivi/negativi con la fotocamera.
--  - Sequenza di 5 colori da cacciare, generata dal server UNA volta per
--    challenge (come "numeri"/la sua disposizione): stessa sequenza per
--    la coppia. Mai due colori uguali consecutivi nella sequenza.
--  - Il client chiede il permesso della fotocamera (posteriore) e MOSTRA
--    il video in diretta (serve per mirare l'oggetto), con una barra che
--    mostra il progresso verso la soglia e poi il countdown del
--    mantenimento (riusa cameraGame() già scritto per "Accendi la luce"
--    e "QR", con showVideo:true; showBar di default true). Analisi HSV
--    del frame: conta i pixel nella tonalità del colore richiesto (con
--    soglie minime di saturazione/luminosità per escludere grigio,
--    bianco, nero); quando ce ne sono abbastanza, mantenuti SENZA
--    INTERRUZIONI per un tempo breve (1,5 s), si passa da soli al colore
--    successivo. Dopo il 5°, fine. Nessun timeout dedicato: vale il
--    limite generale di 5 minuti dalla sveglia (DECISIONI.md #2).
--    Permesso negato o fotocamera non disponibile -> messaggio con
--    pulsante "Riprova".
--  - Il server NON riceve né verifica dati reali del sensore (non può
--    controllare cosa inquadra davvero la fotocamera, come "luce" e
--    "qr"): si fida della conferma del client. Risposta {fatto:true},
--    sempre accettata se il campo è booleano true.
--
-- Parametri: {gioco:'caccia_colori', colori:4, sequenza:[5 colori]}.
-- Risposta: {fatto:true}. wb_ca_caccia_colori controlla solo che 'fatto'
-- sia booleano true (mai NULL, mai un campo mancante che passa il
-- controllo).
--
-- Solo le due funzioni nuove + una riga in ciascun dispatcher (vedi 07):
-- non si ricopiano le funzioni degli altri giochi. La riga 'caccia_colori'
-- in challenge_types esiste già dal 02 (kind 'fisica'): questo file non
-- la tocca, solo l'attivazione con game_live la fa entrare in gioco.
-- =====================================================================

-- ---------- CACCIA AI COLORI ----------
create or replace function public.wb_gp_caccia_colori()
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  v_colori text[] := array['rosso', 'verde', 'blu', 'giallo'];
  v_seq    jsonb := '[]'::jsonb;
  v_prev   text := null;
  v_c      text;
  i        int;
begin
  for i in 1 .. 5 loop
    loop   -- mai due colori uguali consecutivi
      v_c := v_colori[1 + floor(random() * array_length(v_colori, 1))::int];
      exit when v_c is distinct from v_prev;
    end loop;
    v_seq := v_seq || to_jsonb(v_c);
    v_prev := v_c;
  end loop;
  return jsonb_build_object('gioco', 'caccia_colori', 'colori', array_length(v_colori, 1), 'sequenza', v_seq);
end;
$$;

create or replace function public.wb_ca_caccia_colori(p_params jsonb, p_answer jsonb)
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

-- ---------- DISPATCHER: aggiunta la riga 'caccia_colori', il resto è identico al 15 ----------
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
  return false;
exception when others then
  return false;
end;
$$;

-- ---------- PERMESSI (funzioni interne, mai chiamabili dal client) ----------
revoke all on function public.wb_gp_caccia_colori()                from public, anon, authenticated;
revoke all on function public.wb_ca_caccia_colori(jsonb, jsonb)     from public, anon, authenticated;
revoke all on function public.wb_game_params(text)                 from public, anon, authenticated;
revoke all on function public.wb_check_answer(text, jsonb, jsonb)  from public, anon, authenticated;
