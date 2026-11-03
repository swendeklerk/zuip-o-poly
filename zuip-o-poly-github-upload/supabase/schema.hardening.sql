-- =====================================================================
-- Zuip-O-Poly: beveiligings-hardening voor Supabase
-- =====================================================================
-- Draai dit in de Supabase SQL Editor NA supabase/schema.sql.
-- Het bestand is idempotent (meerdere keren draaien is veilig) en
-- niet-destructief: er worden geen tabellen of rijen verwijderd.
--
-- Achtergrond (zie docs/security.md): de oude policies lieten iedereen met
-- de anon key ALLE spelkamers lezen, overschrijven en VERWIJDEREN
-- (policy "for all using (true)"). Dit bestand doet in drie delen:
--
--   DEEL 1  Rechten en validatie op de tabel (werkt met de huidige client).
--   DEEL 2  Beveiligde RPC-functies (de nieuwe client gebruikt die automatisch,
--           en valt terug op de tabel als ze nog niet bestaan).
--   DEEL 3  (uitgecommentarieerd) De tabel helemaal sluiten voor de anon key,
--           zodat spelkamers niet meer opgesomd kunnen worden. Alleen aanzetten
--           nadat de nieuwe client live staat, anders stopt de synchronisatie.
--
-- Wat dit NIET oplost: een speler in dezelfde kamer kan nog steeds de eigen
-- state aanpassen (valse worp, positie, timers), omdat de spellogica in de
-- browser draait. Daarvoor is een server nodig (Edge Function). Zie docs/security.md.
-- =====================================================================


-- =====================================================================
-- DEEL 1: tabelrechten, RLS-policies en validatie-trigger
-- =====================================================================

alter table public.game_states enable row level security;

-- Oude, te ruime policies weghalen.
drop policy if exists "zuipopoly_read_game_state" on public.game_states;
drop policy if exists "zuipopoly_write_game_state" on public.game_states;
drop policy if exists "zuipopoly_select_valid_rooms" on public.game_states;
drop policy if exists "zuipopoly_insert_valid_rooms" on public.game_states;
drop policy if exists "zuipopoly_update_valid_rooms" on public.game_states;

-- Rechten: anon/authenticated mogen lezen, aanmaken en bijwerken, maar NOOIT
-- verwijderen of de tabel leegmaken. (Geen delete-policy = geen delete.)
revoke all on table public.game_states from anon, authenticated;
grant select, insert, update on table public.game_states to anon, authenticated;

-- Alleen rijen met een geldig room-id zijn zichtbaar/schrijfbaar. 'zuipopoly-main'
-- blijft toegestaan omdat schema.sql die rij aanmaakt; de app gebruikt 'room_<CODE>'.
create policy "zuipopoly_select_valid_rooms"
  on public.game_states for select
  using (id ~ '^room_[A-Z0-9]{3,12}$' or id = 'zuipopoly-main');

create policy "zuipopoly_insert_valid_rooms"
  on public.game_states for insert
  with check (id ~ '^room_[A-Z0-9]{3,12}$');

create policy "zuipopoly_update_valid_rooms"
  on public.game_states for update
  using (id ~ '^room_[A-Z0-9]{3,12}$')
  with check (id ~ '^room_[A-Z0-9]{3,12}$');

-- Vorm van de data afdwingen. NOT VALID = bestaande rijen worden niet
-- afgekeurd, nieuwe/gewijzigde rijen wel.
alter table public.game_states drop constraint if exists game_states_id_format;
alter table public.game_states
  add constraint game_states_id_format
  check (id ~ '^room_[A-Z0-9]{3,12}$' or id = 'zuipopoly-main') not valid;

alter table public.game_states drop constraint if exists game_states_state_is_object;
alter table public.game_states
  add constraint game_states_state_is_object
  check (jsonb_typeof(state) = 'object') not valid;

-- Hulpfunctie: is een (optioneel) JSON-getal binnen een bereik?
-- Afwezig of null = oke (de client vult standaardwaarden in).
create or replace function public.zuip_json_num_ok(p jsonb, k text, lo numeric, hi numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when not (p ? k) or jsonb_typeof(p -> k) = 'null' then true
    when jsonb_typeof(p -> k) <> 'number' then false
    else (p ->> k)::numeric between lo and hi
  end
$$;

-- Validatie-trigger: grootte, vorm, aantallen, bereiken, geen terugdraaien
-- van de revisieteller en de server bepaalt updated_at (niet de client-klok).
create or replace function public.zuip_validate_game_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_team record;
  v_old_rev numeric;
  v_new_rev numeric;
begin
  new.updated_at := now();

  if jsonb_typeof(new.state) is distinct from 'object' then
    raise exception 'zuipopoly: state moet een JSON-object zijn';
  end if;
  if octet_length(new.state::text) > 200000 then
    raise exception 'zuipopoly: state is te groot (max 200 kB)';
  end if;

  -- De lege seed-rij ('{}') is toegestaan.
  if new.state = '{}'::jsonb then
    return new;
  end if;

  if left(new.id, 5) = 'room_'
     and (new.state ->> 'roomCode') is distinct from substr(new.id, 6) then
    raise exception 'zuipopoly: roomCode in state komt niet overeen met de rij';
  end if;

  if (new.state ->> 'phase') is null
     or not ((new.state ->> 'phase') = any (array['lobby','countdown','running','ended'])) then
    raise exception 'zuipopoly: ongeldige phase';
  end if;

  if jsonb_typeof(new.state -> 'teams') is distinct from 'object' then
    raise exception 'zuipopoly: teams moet een object zijn';
  end if;
  if (select count(*) from jsonb_object_keys(new.state -> 'teams')) > 8 then
    raise exception 'zuipopoly: maximaal 8 teams per spelkamer';
  end if;
  if new.state ? 'eventLog'
     and (jsonb_typeof(new.state -> 'eventLog') is distinct from 'array'
          or jsonb_array_length(new.state -> 'eventLog') > 100) then
    raise exception 'zuipopoly: eventLog ongeldig of te lang';
  end if;

  for v_team in select key, value from jsonb_each(new.state -> 'teams') loop
    if v_team.key !~ '^[A-Za-z0-9_.:-]{1,80}$' then
      raise exception 'zuipopoly: ongeldig team-id';
    end if;
    if jsonb_typeof(v_team.value) is distinct from 'object' then
      raise exception 'zuipopoly: team moet een object zijn';
    end if;
    if jsonb_typeof(v_team.value -> 'name') is distinct from 'string'
       or char_length(v_team.value ->> 'name') not between 1 and 60 then
      raise exception 'zuipopoly: teamnaam moet 1 tot 60 tekens zijn';
    end if;
    if not (
      public.zuip_json_num_ok(v_team.value, 'position', 1, 40)
      and public.zuip_json_num_ok(v_team.value, 'completedRounds', 0, 1000)
      and public.zuip_json_num_ok(v_team.value, 'normalTurnsUsed', 0, 1000)
      and public.zuip_json_num_ok(v_team.value, 'playerCount', 1, 8)
      and public.zuip_json_num_ok(v_team.value, 'lastRoll', 1, 6)
    ) then
      raise exception 'zuipopoly: team-waarde buiten toegestaan bereik';
    end if;
    if v_team.value ? 'colorId'
       and not ((v_team.value ->> 'colorId') = any
         (array['geel','paars','ijsblauw','groen','oranje','roze','wit','blauw'])) then
      raise exception 'zuipopoly: ongeldige teamkleur';
    end if;
    if v_team.value ? 'status'
       and not ((v_team.value ->> 'status') = any
         (array['waiting_start','can_roll','task_active','waiting_timer','in_jail',
                'waiting_swap','choosing_powerup','choosing_team','finished','game_over'])) then
      raise exception 'zuipopoly: ongeldige teamstatus';
    end if;
  end loop;

  -- De revisieteller mag niet terug (geen oude snapshot terugzetten) en niet
  -- absurd ver vooruit springen (voorkomt dat iemand "voor altijd wint" bij
  -- het samenvoegen in de client).
  if tg_op = 'UPDATE'
     and jsonb_typeof(old.state -> 'syncRevision') = 'number'
     and jsonb_typeof(new.state -> 'syncRevision') = 'number' then
    v_old_rev := (old.state ->> 'syncRevision')::numeric;
    v_new_rev := (new.state ->> 'syncRevision')::numeric;
    if v_new_rev < v_old_rev then
      raise exception 'zuipopoly: verouderde schrijfactie (syncRevision loopt achter)';
    end if;
    if v_new_rev - v_old_rev > 1000 then
      raise exception 'zuipopoly: syncRevision springt te ver vooruit';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists zuip_validate_game_state on public.game_states;
create trigger zuip_validate_game_state
  before insert or update on public.game_states
  for each row execute function public.zuip_validate_game_state();


-- =====================================================================
-- DEEL 2: beveiligde RPC-functies (security definer)
-- =====================================================================
-- De client roept alleen deze twee functies aan. Daardoor hoeft de anon key
-- geen directe tabeltoegang meer te hebben (zie DEEL 3): je kunt een kamer
-- alleen lezen/schrijven als je de code kent, en nooit alle kamers opsommen.

create or replace function public.zuip_get_state(p_room text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select g.state
  from public.game_states g
  where p_room ~ '^[A-Za-z0-9]{3,12}$'
    and g.id = 'room_' || upper(p_room)
$$;

create or replace function public.zuip_save_state(p_room text, p_state jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_room is null or p_room !~ '^[A-Za-z0-9]{3,12}$' then
    raise exception 'zuipopoly: ongeldige spelcode';
  end if;
  -- De trigger zuip_validate_game_state controleert de inhoud.
  insert into public.game_states (id, state, updated_at)
  values ('room_' || upper(p_room), p_state, now())
  on conflict (id) do update
    set state = excluded.state,
        updated_at = now();
  return true;
end;
$$;

revoke all on function public.zuip_get_state(text) from public;
revoke all on function public.zuip_save_state(text, jsonb) from public;
grant execute on function public.zuip_get_state(text) to anon, authenticated;
grant execute on function public.zuip_save_state(text, jsonb) to anon, authenticated;


-- =====================================================================
-- DEEL 3 (HANDMATIG): tabel sluiten voor de anon key  -- AANBEVOLEN
-- =====================================================================
-- Haal de commentaartekens weg en draai dit PAS NADAT de nieuwe versie van de
-- app (met de RPC-aanroepen in src/services/remoteGameState.js) op Vercel live
-- staat. Een oude client kan daarna niet meer synchroniseren (hij valt terug op
-- lokale opslag). Gevolg: realtime-push stopt; de app pollt elke 2,5 s en dat
-- is voor dit spel voldoende.
--
-- drop policy if exists "zuipopoly_select_valid_rooms" on public.game_states;
-- drop policy if exists "zuipopoly_insert_valid_rooms" on public.game_states;
-- drop policy if exists "zuipopoly_update_valid_rooms" on public.game_states;
-- revoke all on table public.game_states from anon, authenticated;


-- =====================================================================
-- OPTIONEEL: oude spelkamers opruimen (houdt de database klein)
-- =====================================================================
-- Vereist de extensie pg_cron (Database > Extensions). Verwijdert kamers die
-- 3 dagen niet zijn bijgewerkt. Uitgecommentarieerd; zelf aanzetten indien gewenst.
--
-- select cron.schedule(
--   'zuipopoly-cleanup', '0 4 * * *',
--   $$ delete from public.game_states
--      where id like 'room\_%' and updated_at < now() - interval '3 days' $$
-- );
