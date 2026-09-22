-- =====================================================================
-- Wake Battle — Rimozione "Trova l'intruso"
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..08 già eseguiti. Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni).
--
-- "Trova l'intruso" non è mai stato attivato nella sfida vera (game_live
-- è rimasto false, nessuna giornata l'ha mai usato): nessun dato storico
-- da migrare. Il file 08_intruso.sql NON si tocca (già eseguito su
-- Supabase, la storia dei file eseguiti non si modifica).
--
-- Cosa fa:
--   1. toglie la riga 'intruso' da challenge_types;
--   2. rimette wb_game_params/wb_check_answer come dopo il 07 (dispatcher
--      senza il ramo 'intruso');
--   3. droppa wb_gp_intruso() e wb_ca_intruso(jsonb, jsonb).
-- =====================================================================

delete from public.challenge_types where code = 'intruso';

-- ---------- DISPATCHER: tolto il ramo 'intruso', il resto è identico al 07 ----------
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

revoke all on function public.wb_game_params(text)                 from public, anon, authenticated;
revoke all on function public.wb_check_answer(text, jsonb, jsonb)  from public, anon, authenticated;

-- ---------- FUNZIONI DI "TROVA L'INTRUSO": non servono più ----------
drop function if exists public.wb_gp_intruso();
drop function if exists public.wb_ca_intruso(jsonb, jsonb);
