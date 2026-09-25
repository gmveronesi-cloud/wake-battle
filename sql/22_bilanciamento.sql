-- =====================================================================
-- Wake Battle — Passo 4 (rifinitura 3/3): bilanciamento dell'estrazione
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..21 già eseguiti. Da lanciare UNA volta sola (rilanciarlo
-- per sbaglio non fa danni: CREATE OR REPLACE sostituisce la stessa
-- funzione).
--
-- Regole (decise in questa sessione, vedi anche docs/DECISIONI.md):
--  - Resta: mai la stessa challenge due giorni di fila per la coppia.
--  - Categorie: 'fisica' (fotocamera: qr, luce, caccia_colori, oggetto,
--    occhi, esercizi) e 'schermo' (memoria, numeri, colore_parola,
--    riflessi, anagramma) — già in challenge_types.kind dal 02, nessuna
--    colonna nuova.
--  - Ogni settimana (lun-ven, 5 giorni) al massimo 3 della stessa
--    categoria: sempre 3/2, mai 4/1 o 5/0.
--  - Alternanza tra settimane: se la settimana precedente la maggioranza
--    è stata fotocamera, questa la maggioranza è schermo, e viceversa. Si
--    guardano i couple_days della settimana precedente (qualunque sia il
--    loro esito di punteggio: conta solo quale gioco è stato assegnato);
--    se assenti o in parità, si sceglie a caso — ma in modo STABILE per
--    tutta la settimana (un seme deterministico couple+settimana, non un
--    nuovo tiro ogni giorno: altrimenti la quota 3/2 non avrebbe senso).
--  - Dentro la settimana la scelta resta casuale nel rispetto dei limiti
--    (non un ordine fisso prevedibile: si continua a pescare a caso tra
--    le challenge enabled della/e categoria/e ancora sotto quota).
-- =====================================================================

create or replace function public.wb_ensure_challenge(p_couple uuid, p_day date)
returns public.couple_days language plpgsql volatile set search_path = ''
as $$
declare
  r               public.couple_days%rowtype;
  v_prev          text;
  v_ws            date := public.wb_week_start(p_day);
  v_pws           date := v_ws - 7;
  v_fis_prev      int;
  v_sch_prev      int;
  v_target_fisica int;
  v_used_fisica   int;
  v_used_schermo  int;
  v_allowed       text[] := array[]::text[];
  v_pick          text;
  v_seed          int;
begin
  select * into r from public.couple_days where couple_id = p_couple and day = p_day;
  if found then
    return r;
  end if;

  select challenge into v_prev from public.couple_days
  where couple_id = p_couple and day < p_day order by day desc limit 1;

  -- 1) quota della settimana (3/2, mai 4/1): la categoria maggioritaria è
  -- quella che la settimana PRECEDENTE non lo è stata; se assente o in
  -- parità, a caso ma stabile per tutta la settimana (seme deterministico
  -- da couple_id + lunedì della settimana, non da wb_now(): la quota non
  -- deve cambiare durante la settimana stessa).
  select count(*) filter (where ct.kind = 'fisica'),
         count(*) filter (where ct.kind = 'schermo')
    into v_fis_prev, v_sch_prev
  from public.couple_days cd join public.challenge_types ct on ct.code = cd.challenge
  where cd.couple_id = p_couple and cd.day between v_pws and v_pws + 4;

  v_seed := ('x' || substr(md5(p_couple::text || v_ws::text), 1, 8))::bit(32)::int;
  if coalesce(v_fis_prev, 0) > coalesce(v_sch_prev, 0) then
    v_target_fisica := 2;   -- settimana prima a maggioranza fotocamera -> ora schermo (3)
  elsif coalesce(v_sch_prev, 0) > coalesce(v_fis_prev, 0) then
    v_target_fisica := 3;   -- settimana prima a maggioranza schermo -> ora fotocamera (3)
  else
    v_target_fisica := case when mod(v_seed, 2) = 0 then 3 else 2 end;  -- assente/pari: a caso
  end if;

  -- 2) quanto già assegnato questa settimana, nei giorni prima di p_day
  select count(*) filter (where ct.kind = 'fisica'),
         count(*) filter (where ct.kind = 'schermo')
    into v_used_fisica, v_used_schermo
  from public.couple_days cd join public.challenge_types ct on ct.code = cd.challenge
  where cd.couple_id = p_couple and cd.day between v_ws and v_ws + 4 and cd.day < p_day;

  if coalesce(v_used_fisica, 0) < v_target_fisica then
    v_allowed := array_append(v_allowed, 'fisica');
  end if;
  if coalesce(v_used_schermo, 0) < (5 - v_target_fisica) then
    v_allowed := array_append(v_allowed, 'schermo');
  end if;
  if array_length(v_allowed, 1) is null then
    v_allowed := array['fisica', 'schermo'];   -- rete di sicurezza, non dovrebbe servire (5 = 3+2)
  end if;

  -- 3) pick casuale dentro le categorie ancora sotto quota, enabled, mai
  -- come ieri; se quel vincolo lascia il pool vuoto (poche challenge
  -- enabled in quella categoria), si allenta un vincolo alla volta invece
  -- di restituire null (meglio ripetere una categoria che restare senza
  -- challenge del giorno).
  select code into v_pick from public.challenge_types
  where enabled and kind = any(v_allowed) and code is distinct from v_prev
  order by random() limit 1;
  if v_pick is null then
    select code into v_pick from public.challenge_types
    where enabled and kind = any(v_allowed) order by random() limit 1;
  end if;
  if v_pick is null then
    select code into v_pick from public.challenge_types
    where enabled and code is distinct from v_prev order by random() limit 1;
  end if;
  if v_pick is null then
    select code into v_pick from public.challenge_types where enabled order by random() limit 1;
  end if;
  if v_pick is null then
    return null;   -- nessuna challenge enabled
  end if;

  insert into public.couple_days (couple_id, day, challenge, params)
  values (p_couple, p_day, v_pick, public.wb_challenge_params(v_pick))
  on conflict do nothing;

  select * into r from public.couple_days where couple_id = p_couple and day = p_day;
  return r;
end;
$$;

revoke all on function public.wb_ensure_challenge(uuid, date) from public, anon, authenticated;
