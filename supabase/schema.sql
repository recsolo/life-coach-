-- First Light: partner sharing.
-- Two devices pair with a one-time code. Each device proves who it is with a long random
-- token it generated itself; only the token's hash is stored. The tables are closed to the
-- public API (row level security on, no policies); the only way in is the functions below.

create table public.fl_pairs (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  code_expires timestamptz,
  created_at timestamptz not null default now()
);

create table public.fl_members (
  token_hash text primary key,
  pair_id uuid not null references public.fl_pairs on delete cascade,
  slot smallint not null check (slot in (1, 2)),
  name text not null,
  seen_at timestamptz not null default now(),
  unique (pair_id, slot)
);

create table public.fl_tasks (
  id uuid primary key,
  pair_id uuid not null references public.fl_pairs on delete cascade,
  title text not null,
  area text,
  due date,
  effort text,
  created_by smallint not null,
  assignee smallint not null check (assignee in (1, 2)),
  split_of text,
  done_at date,
  done_by smallint,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by smallint
);
create index fl_tasks_pair on public.fl_tasks (pair_id);

alter table public.fl_pairs enable row level security;
alter table public.fl_members enable row level security;
alter table public.fl_tasks enable row level security;
revoke all on public.fl_pairs, public.fl_members, public.fl_tasks from anon, authenticated;

-- ---------- internal helpers (not callable from the API) ----------

create function public.fl_hash(p_token text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 200 then
    raise exception 'bad token';
  end if;
  return encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
end $$;

create function public.fl_new_code() returns text
language sql volatile set search_path = '' as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
$$;

create function public.fl_state(m public.fl_members) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'paired', true,
    'slot', m.slot,
    'partner', (select o.name from public.fl_members o where o.pair_id = m.pair_id and o.slot <> m.slot),
    'code', (select case when p.code_expires > now() then p.code end from public.fl_pairs p where p.id = m.pair_id),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'area', t.area, 'due', t.due, 'effort', t.effort,
        'created_by', t.created_by, 'assignee', t.assignee, 'split_of', t.split_of,
        'done_at', t.done_at, 'done_by', t.done_by, 'deleted', t.deleted,
        'updated_at', t.updated_at, 'updated_by', t.updated_by) order by t.updated_at)
      from public.fl_tasks t
      where t.pair_id = m.pair_id and (not t.deleted or t.updated_at > now() - interval '30 days')), '[]'::jsonb));
$$;

revoke execute on function public.fl_hash(text), public.fl_new_code(), public.fl_state(public.fl_members) from public, anon, authenticated;

-- ---------- the API ----------

-- Start a pair and get an invite code. Calling it again while paired just refreshes the code.
create function public.fl_create(p_token text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.fl_members; pid uuid;
begin
  select * into m from public.fl_members where token_hash = public.fl_hash(p_token);
  if m.pair_id is null then
    insert into public.fl_pairs default values returning id into pid;
    insert into public.fl_members (token_hash, pair_id, slot, name)
      values (public.fl_hash(p_token), pid, 1, left(coalesce(nullif(trim(p_name), ''), 'Partner'), 40))
      returning * into m;
  end if;
  if (select count(*) from public.fl_members where pair_id = m.pair_id) < 2 then
    update public.fl_pairs set code = public.fl_new_code(), code_expires = now() + interval '30 minutes' where id = m.pair_id;
  end if;
  return public.fl_state(m);
end $$;

-- Join a pair with the other person's code. Codes are single use and expire.
create function public.fl_join(p_token text, p_name text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.fl_members; p public.fl_pairs; free smallint;
begin
  select * into m from public.fl_members where token_hash = public.fl_hash(p_token);
  if m.pair_id is not null then raise exception 'already paired'; end if;
  select * into p from public.fl_pairs
    where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) and code_expires > now()
    for update;
  if p.id is null then raise exception 'code not found'; end if;
  select s into free from (values (1::smallint), (2::smallint)) v(s)
    where not exists (select 1 from public.fl_members o where o.pair_id = p.id and o.slot = v.s)
    order by s limit 1;
  if free is null then raise exception 'pair is full'; end if;
  insert into public.fl_members (token_hash, pair_id, slot, name)
    values (public.fl_hash(p_token), p.id, free, left(coalesce(nullif(trim(p_name), ''), 'Partner'), 40))
    returning * into m;
  update public.fl_pairs set code = null, code_expires = null where id = p.id;
  return public.fl_state(m);
end $$;

-- Leave the pair. When the last person leaves, the shared tasks are deleted with it.
create function public.fl_leave(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.fl_members;
begin
  select * into m from public.fl_members where token_hash = public.fl_hash(p_token);
  if m.pair_id is not null then
    delete from public.fl_members where token_hash = m.token_hash;
    if not exists (select 1 from public.fl_members where pair_id = m.pair_id) then
      delete from public.fl_pairs where id = m.pair_id;
    end if;
  end if;
  return jsonb_build_object('paired', false);
end $$;

-- Push local changes, then read back everything the pair shares. Last write wins.
create function public.fl_sync(p_token text, p_name text default null, p_changes jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.fl_members; c jsonb; n int;
begin
  select * into m from public.fl_members where token_hash = public.fl_hash(p_token);
  if m.pair_id is null then return jsonb_build_object('paired', false); end if;
  update public.fl_members
    set seen_at = now(), name = left(coalesce(nullif(trim(p_name), ''), name), 40)
    where token_hash = m.token_hash;
  if jsonb_typeof(p_changes) = 'array' then
    if jsonb_array_length(p_changes) > 200 then raise exception 'too many changes'; end if;
    select count(*) into n from public.fl_tasks where pair_id = m.pair_id;
    for c in select * from jsonb_array_elements(p_changes) loop
      if n >= 2000 and not exists (select 1 from public.fl_tasks where id = (c->>'id')::uuid) then continue; end if;
      insert into public.fl_tasks as t
        (id, pair_id, title, area, due, effort, created_by, assignee, split_of, done_at, done_by, deleted, updated_at, updated_by)
      values (
        (c->>'id')::uuid, m.pair_id, left(coalesce(c->>'title', ''), 300), left(c->>'area', 30),
        (c->>'due')::date, left(c->>'effort', 10), m.slot,
        case when (c->>'assignee')::int = 2 then 2 else 1 end, left(c->>'split_of', 300),
        (c->>'done_at')::date, case when c->>'done_at' is null then null else m.slot end,
        coalesce((c->>'deleted')::boolean, false), now(), m.slot)
      on conflict (id) do update set
        title = excluded.title, area = excluded.area, due = excluded.due, effort = excluded.effort,
        assignee = excluded.assignee, split_of = excluded.split_of,
        done_by = case when excluded.done_at is null then null when t.done_at is null then excluded.done_by else t.done_by end,
        done_at = excluded.done_at, deleted = excluded.deleted, updated_at = now(), updated_by = excluded.updated_by
      where t.pair_id = m.pair_id;
      n := n + 1;
    end loop;
  end if;
  return public.fl_state(m);
end $$;
