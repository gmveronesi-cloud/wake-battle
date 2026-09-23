-- =====================================================================
-- Wake Battle — QR o codice a barre (passo 3.8, secondo gioco con fotocamera)
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..14 già eseguiti. Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni).
--
-- Regole (decise il 23/09/2026 in questa chat, vedi anche docs/DECISIONI.md):
--  - Il client chiede il permesso della fotocamera (posteriore) e MOSTRA il
--    video in diretta (serve per mirare il codice), senza barra (riusa
--    cameraGame() già scritto per "Accendi la luce", con showVideo:true e
--    showBar:false: a differenza di "Accendi la luce" qui vedere
--    l'inquadratura aiuta, e non c'è un livello progressivo da mostrare).
--  - Basta UNA lettura valida di un QR o di un codice a barre qualsiasi
--    (libreria ZXing lato client, vendor/zxing.js incluso nel sito senza
--    CDN: nessun worker/wasm/blob, CSP invariata) per finire subito: i
--    formati hanno un controllo di integrità incorporato, nessun falso
--    positivo plausibile, quindi nessun tempo di mantenimento come "Accendi
--    la luce". Nessun timeout dedicato: il limite è già quello di 5 minuti
--    dalla sveglia (DECISIONI.md #2). Permesso negato o fotocamera non
--    disponibile -> messaggio con pulsante "Riprova".
--  - Il server NON riceve né verifica il contenuto reale del codice letto
--    (non ha modo di controllare cosa inquadra davvero la fotocamera, e
--    "uno qualsiasi" non richiede un confronto): si fida della conferma
--    del client. Risposta: {fatto:true}, sempre accettata se il campo è
--    booleano true.
--
-- Parametri: {gioco:'qr'} (nessun dato da generare: non c'è nulla da
-- falsificare in modo utile lato server per questo gioco, come "luce").
-- Risposta: {fatto:true}. wb_ca_qr controlla solo che 'fatto' sia
-- booleano true (mai NULL, mai un campo mancante che passa il controllo).
--
-- Solo le due funzioni nuove + una riga in ciascun dispatcher (vedi 07):
-- non si ricopiano le funzioni degli altri giochi. La riga 'qr' in
-- challenge_types esiste già dal 02 (kind 'fisica'): questo file non la
-- tocca, solo l'attivazione con game_live la fa entrare in gioco.
-- =====================================================================

-- ---------- QR O CODICE A BARRE ----------
create or replace function public.wb_gp_qr()
returns jsonb language plpgsql volatile set search_path = ''
as $$
begin
  return jsonb_build_object('gioco', 'qr');
end;
$$;

create or replace function public.wb_ca_qr(p_params jsonb, p_answer jsonb)
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

-- ---------- DISPATCHER: aggiunta la riga 'qr', il resto è identico al 14 ----------
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
  return false;
exception when others then
  return false;
end;
$$;

-- ---------- PERMESSI (funzioni interne, mai chiamabili dal client) ----------
revoke all on function public.wb_gp_qr()                          from public, anon, authenticated;
revoke all on function public.wb_ca_qr(jsonb, jsonb)               from public, anon, authenticated;
revoke all on function public.wb_game_params(text)                 from public, anon, authenticated;
revoke all on function public.wb_check_answer(text, jsonb, jsonb)  from public, anon, authenticated;
