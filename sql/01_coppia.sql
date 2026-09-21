-- =====================================================================
-- Wake Battle — Passo 1: profili, coppia, codice di collegamento
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Idempotente solo al primo lancio: se serve rilanciarlo, chiedi prima.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABELLE
-- ---------------------------------------------------------------------

-- Profilo (1 per utente). Il nome è mostrato al partner.
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 30),
  created_at   timestamptz not null default now()
);

-- Coppia
create table public.couples (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Membri: ogni utente può stare in UNA sola coppia (unique su user_id)
create table public.couple_members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id   uuid not null unique references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);

-- Codici di collegamento: MAI leggibili dal client, solo tramite funzioni
create table public.pairing_codes (
  code       text primary key,
  couple_id  uuid not null references public.couples(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);

-- Tentativi di inserimento codice (limite anti-indovinello)
create table public.pairing_attempts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index pairing_attempts_user_time on public.pairing_attempts (user_id, attempted_at);

-- ---------------------------------------------------------------------
-- 2. SICUREZZA DI BASE: RLS attiva ovunque, niente accesso anonimo
-- ---------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.couples          enable row level security;
alter table public.couple_members   enable row level security;
alter table public.pairing_codes    enable row level security;
alter table public.pairing_attempts enable row level security;

revoke all on public.profiles, public.couples, public.couple_members,
              public.pairing_codes, public.pairing_attempts from anon, authenticated;

-- Il client può solo LEGGERE profili/coppia e aggiornare il PROPRIO nome.
grant select on public.profiles, public.couples, public.couple_members to authenticated;
grant update (display_name) on public.profiles to authenticated;
-- pairing_codes e pairing_attempts: nessun grant, nessuna policy → inaccessibili.

-- Funzione di supporto: coppia dell'utente corrente (evita ricorsione nelle policy)
create or replace function public.my_couple_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select couple_id from public.couple_members where user_id = auth.uid();
$$;

-- Profili: vedo il mio e quello del mio partner
create policy "profili: io e partner" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or id in (select user_id from public.couple_members where couple_id = public.my_couple_id())
  );

-- Profili: modifico solo il mio (e solo il nome, per via del grant)
create policy "profili: modifica il mio" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Coppia: vedo solo la mia
create policy "coppia: la mia" on public.couples
  for select to authenticated
  using (id = public.my_couple_id());

-- Membri: vedo solo quelli della mia coppia
create policy "membri: della mia coppia" on public.couple_members
  for select to authenticated
  using (couple_id = public.my_couple_id());

-- ---------------------------------------------------------------------
-- 3. PROFILO AUTOMATICO alla prima registrazione
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. FUNZIONI DI COLLEGAMENTO (unico modo per toccare coppie e codici)
-- ---------------------------------------------------------------------

-- Crea (o rigenera) il codice per invitare il partner.
-- Valido 10 minuti, monouso. Rigenerarlo annulla i codici precedenti.
create or replace function public.create_pairing_code()
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_couple  uuid;
  v_members int;
  v_code    text;
  v_exp     timestamptz := now() + interval '10 minutes';
  v_alpha   constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- niente 0/O, 1/I/L
  v_bytes   bytea;
  i         int;
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;

  select couple_id into v_couple from public.couple_members where user_id = v_uid;

  if v_couple is not null then
    select count(*) into v_members from public.couple_members where couple_id = v_couple;
    if v_members >= 2 then
      raise exception 'Sei già in coppia' using errcode = 'P0001';
    end if;
  else
    insert into public.couples (created_by) values (v_uid) returning id into v_couple;
    insert into public.couple_members (couple_id, user_id) values (v_couple, v_uid);
  end if;

  -- annulla i codici ancora aperti di questa coppia
  delete from public.pairing_codes pc where pc.couple_id = v_couple and pc.used_at is null;

  -- genera 6 caratteri casuali crittograficamente sicuri (riprova se collisione)
  loop
    v_bytes := extensions.gen_random_bytes(6);
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % length(v_alpha)) + 1, 1);
    end loop;
    begin
      insert into public.pairing_codes (code, couple_id, created_by, expires_at)
      values (v_code, v_couple, v_uid, v_exp);
      exit;
    exception when unique_violation then
      -- collisione rarissima: riprova
    end;
  end loop;

  return query select v_code, v_exp;
end;
$$;

-- Entra nella coppia del partner con il suo codice.
-- Max 5 tentativi ogni 15 minuti per utente.
-- Restituisce un esito (non un errore), così il tentativo resta registrato:
--   {"ok": true, "couple_id": "..."} oppure {"ok": false, "error": "<motivo>"}
--   motivi: troppi_tentativi | codice_non_valido | codice_proprio | gia_in_coppia
create or replace function public.join_couple(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_code     text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_row      public.pairing_codes%rowtype;
  v_mine     uuid;
  v_mine_n   int;
  v_members  int;
  v_attempts int;
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;

  select count(*) into v_attempts
  from public.pairing_attempts
  where user_id = v_uid and attempted_at > now() - interval '15 minutes';
  if v_attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'troppi_tentativi');
  end if;
  insert into public.pairing_attempts (user_id) values (v_uid);

  select * into v_row from public.pairing_codes
  where code = v_code and used_at is null and expires_at > now()
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'codice_non_valido');
  end if;

  if v_row.created_by = v_uid then
    return jsonb_build_object('ok', false, 'error', 'codice_proprio');
  end if;

  -- se sono già in una coppia: ok solo se ci sono da solo (la abbandono)
  select couple_id into v_mine from public.couple_members where user_id = v_uid;
  if v_mine is not null then
    select count(*) into v_mine_n from public.couple_members where couple_id = v_mine;
    if v_mine_n >= 2 then
      return jsonb_build_object('ok', false, 'error', 'gia_in_coppia');
    end if;
  end if;

  select count(*) into v_members from public.couple_members where couple_id = v_row.couple_id;
  if v_members <> 1 then
    return jsonb_build_object('ok', false, 'error', 'codice_non_valido');
  end if;

  if v_mine is not null then
    delete from public.couples where id = v_mine;  -- cancella la mia coppia vuota
  end if;

  insert into public.couple_members (couple_id, user_id) values (v_row.couple_id, v_uid);
  update public.pairing_codes set used_at = now() where code = v_row.code;
  delete from public.pairing_attempts where user_id = v_uid;  -- riuscito: azzera

  return jsonb_build_object('ok', true, 'couple_id', v_row.couple_id);
end;
$$;

-- Esci dalla coppia (serve per test e per ricominciare).
-- Se la coppia resta vuota viene cancellata.
create or replace function public.leave_couple()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
begin
  if v_uid is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  delete from public.couple_members where user_id = v_uid returning couple_id into v_couple;
  if v_couple is not null
     and not exists (select 1 from public.couple_members where couple_id = v_couple) then
    delete from public.couples where id = v_couple;
  end if;
end;
$$;

-- Solo utenti autenticati possono chiamare le funzioni
revoke all on function public.my_couple_id()        from public, anon;
revoke all on function public.handle_new_user()     from public, anon, authenticated;
revoke all on function public.create_pairing_code() from public, anon;
revoke all on function public.join_couple(text)     from public, anon;
revoke all on function public.leave_couple()        from public, anon;
grant execute on function public.my_couple_id()        to authenticated;
grant execute on function public.create_pairing_code() to authenticated;
grant execute on function public.join_couple(text)     to authenticated;
grant execute on function public.leave_couple()        to authenticated;
