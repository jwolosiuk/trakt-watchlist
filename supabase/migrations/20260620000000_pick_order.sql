-- ===========================================================================
-- Manual ordering for favorites — lets admins reorder their "Picks".
-- Run this in the Supabase SQL editor (or it deploys via GitHub if connected).
-- ===========================================================================

alter table public.favorites add column if not exists position int not null default 0;

-- New favorites append to the end of that device's list.
create or replace function public.set_favorite(
  p_device uuid, p_media_type text, p_trakt_id bigint,
  p_slug text, p_title text, p_year int, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into devices(id) values (p_device)
    on conflict (id) do update set last_seen = now();
  if p_on then
    insert into favorites(device_id, media_type, trakt_id, slug, title, year, position)
      values (p_device, p_media_type, p_trakt_id, p_slug, p_title, p_year,
              coalesce((select max(position) from favorites where device_id = p_device), 0) + 1)
      on conflict (device_id, media_type, trakt_id) do nothing;
  else
    delete from favorites
      where device_id = p_device and media_type = p_media_type and trakt_id = p_trakt_id;
  end if;
end; $$;

-- Pins everyone sees, in the admins' chosen order.
create or replace function public.admin_favorites()
returns table(media_type text, trakt_id bigint)
language sql security definer set search_path = public as $$
  select f.media_type, f.trakt_id
  from favorites f join devices d on d.id = f.device_id
  where d.is_admin
  group by f.media_type, f.trakt_id
  order by min(f.position), min(f.created_at);
$$;

-- Reorder a device's own favorites to match the given "type:id" key order.
create or replace function public.reorder_favorites(p_device uuid, p_keys text[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  update favorites f set position = t.ord
  from unnest(p_keys) with ordinality as t(key, ord)
  where f.device_id = p_device
    and f.media_type = split_part(t.key, ':', 1)
    and f.trakt_id = split_part(t.key, ':', 2)::bigint;
end; $$;

grant execute on function public.reorder_favorites(uuid, text[]) to anon, authenticated;
