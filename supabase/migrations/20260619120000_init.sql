-- ===========================================================================
-- Trakt watchlist — shared favorites + device management (Supabase / Postgres)
-- ===========================================================================
-- Run this whole file once in the Supabase SQL editor (SQL → New query).
--
-- Design notes:
--  * Every browser gets a random device-id (uuid) stored locally. Visitors do
--    not log in. A device becomes "admin" by setting devices.is_admin = true
--    (do this once for your own device in the dashboard; afterwards you can
--    manage everything from the app).
--  * Row Level Security is ON for both tables with NO policies, so the public
--    "anon" role cannot touch the tables directly. All access goes through the
--    SECURITY DEFINER functions below, which embed the access rules. This is
--    what actually enforces "only admins can see another device's picks".
--  * A device-id therefore acts like a per-user secret capability. Keep it
--    private; if one leaks, delete that device (cascades its favorites).
-- ===========================================================================

create extension if not exists pgcrypto;

-- --- Tables ----------------------------------------------------------------

create table if not exists public.devices (
  id         uuid primary key,
  name       text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

create table if not exists public.favorites (
  device_id  uuid not null references public.devices(id) on delete cascade,
  media_type text not null check (media_type in ('movie', 'show')),
  trakt_id   bigint not null,
  slug       text,
  title      text,
  year       int,
  created_at timestamptz not null default now(),
  primary key (device_id, media_type, trakt_id)
);

create index if not exists favorites_item_idx on public.favorites (media_type, trakt_id);

-- Lock down direct access; everything must go through the functions below.
alter table public.devices   enable row level security;
alter table public.favorites enable row level security;

-- --- Helper ----------------------------------------------------------------

create or replace function public.is_admin(p_device uuid)
returns boolean
language sql security definer set search_path = public as $$
  select coalesce((select is_admin from devices where id = p_device), false);
$$;

-- --- Public / per-device functions -----------------------------------------

-- Register or heartbeat a device. Returns its admin flag + name.
create or replace function public.register_device(p_device uuid)
returns table(is_admin boolean, name text)
language plpgsql security definer set search_path = public as $$
begin
  insert into devices(id) values (p_device)
    on conflict (id) do update set last_seen = now();
  return query select d.is_admin, d.name from devices d where d.id = p_device;
end; $$;

-- Toggle a favorite for the calling device.
create or replace function public.set_favorite(
  p_device uuid, p_media_type text, p_trakt_id bigint,
  p_slug text, p_title text, p_year int, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into devices(id) values (p_device)
    on conflict (id) do update set last_seen = now();
  if p_on then
    insert into favorites(device_id, media_type, trakt_id, slug, title, year)
      values (p_device, p_media_type, p_trakt_id, p_slug, p_title, p_year)
      on conflict (device_id, media_type, trakt_id) do nothing;
  else
    delete from favorites
      where device_id = p_device and media_type = p_media_type and trakt_id = p_trakt_id;
  end if;
end; $$;

-- The calling device's own favorites.
create or replace function public.my_favorites(p_device uuid)
returns table(media_type text, trakt_id bigint)
language sql security definer set search_path = public as $$
  select media_type, trakt_id from favorites where device_id = p_device;
$$;

-- Public: items favorited by ANY admin device (the pins everyone sees on top).
create or replace function public.admin_favorites()
returns table(media_type text, trakt_id bigint)
language sql security definer set search_path = public as $$
  select distinct f.media_type, f.trakt_id
  from favorites f join devices d on d.id = f.device_id
  where d.is_admin;
$$;

-- --- Admin-only functions (require the caller to be an admin device) --------

create or replace function public.admin_list_devices(p_admin uuid)
returns table(id uuid, name text, is_admin boolean,
              created_at timestamptz, last_seen timestamptz, fav_count bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_admin) then raise exception 'not authorized'; end if;
  return query
    select d.id, d.name, d.is_admin, d.created_at, d.last_seen,
           (select count(*) from favorites f where f.device_id = d.id) as fav_count
    from devices d
    order by d.is_admin desc, d.last_seen desc;
end; $$;

create or replace function public.admin_device_favorites(p_admin uuid, p_target uuid)
returns table(media_type text, trakt_id bigint, slug text, title text,
              year int, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_admin) then raise exception 'not authorized'; end if;
  return query
    select f.media_type, f.trakt_id, f.slug, f.title, f.year, f.created_at
    from favorites f where f.device_id = p_target
    order by f.created_at desc;
end; $$;

create or replace function public.admin_rename_device(p_admin uuid, p_target uuid, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_admin) then raise exception 'not authorized'; end if;
  update devices set name = nullif(btrim(p_name), '') where id = p_target;
end; $$;

create or replace function public.admin_set_admin(p_admin uuid, p_target uuid, p_is_admin boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_admin) then raise exception 'not authorized'; end if;
  -- Don't allow removing the last admin (avoid locking yourself out).
  if p_is_admin = false
     and (select count(*) from devices where is_admin) <= 1
     and public.is_admin(p_target) then
    raise exception 'cannot remove the last admin';
  end if;
  update devices set is_admin = p_is_admin where id = p_target;
end; $$;

create or replace function public.admin_delete_device(p_admin uuid, p_target uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_admin) then raise exception 'not authorized'; end if;
  delete from devices where id = p_target;  -- cascades favorites
end; $$;

-- --- Permissions -----------------------------------------------------------
-- The anon role may only EXECUTE these functions (not read tables directly).

revoke all on table public.devices, public.favorites from anon, authenticated;

grant execute on function
  public.register_device(uuid),
  public.set_favorite(uuid, text, bigint, text, text, int, boolean),
  public.my_favorites(uuid),
  public.admin_favorites(),
  public.admin_list_devices(uuid),
  public.admin_device_favorites(uuid, uuid),
  public.admin_rename_device(uuid, uuid, text),
  public.admin_set_admin(uuid, uuid, boolean),
  public.admin_delete_device(uuid, uuid)
to anon, authenticated;

-- ===========================================================================
-- After running this and opening the site once, make your device an admin:
--   update public.devices set is_admin = true, name = 'My phone'
--   where id = '<the device id shown in the app>';
-- ===========================================================================
