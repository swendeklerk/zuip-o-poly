-- Zuip-O-Poly realtime basis.
-- Draai dit later in Supabase SQL Editor.

create table if not exists public.game_states (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.game_states enable row level security;

drop policy if exists "zuipopoly_read_game_state" on public.game_states;
drop policy if exists "zuipopoly_write_game_state" on public.game_states;

-- Voor deze prive-app gebruiken we de anon key plus team/admin codes in de app.
-- Later kunnen we dit aanscherpen met echte auth.
create policy "zuipopoly_read_game_state"
  on public.game_states
  for select
  using (true);

create policy "zuipopoly_write_game_state"
  on public.game_states
  for all
  using (true)
  with check (true);

insert into public.game_states (id, state)
values ('zuipopoly-main', '{}'::jsonb)
on conflict (id) do nothing;

-- Vergeet in Supabase niet realtime aan te zetten voor public.game_states:
-- Database > Replication > public > game_states.
