-- ===========================================================================
-- Make the admin "Picks" a single SHARED list across all admin devices.
-- (One person, possibly several devices.) Visitors' personal favorites stay
-- per-device. Run in the Supabase SQL editor (or auto-deploys via GitHub).
-- ===========================================================================

-- Adding / removing a favorite:
--  * admin device  -> shared pick (remove clears it from every admin device,
--    new picks append after the last shared pick)
--  * visitor       -> their own per-device favorite (unchanged)
create or replace function public.set_favorite(
  p_device uuid, p_media_type text, p_trakt_id bigint,
  p_slug text, p_title text, p_year int, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean;
begin
  insert into devices(id) values (p_device)
    on conflict (id) do update set last_seen = now();
  v_admin := public.is_admin(p_device);

  if p_on then
    insert into favorites(device_id, media_type, trakt_id, slug, title, year, position)
      values (p_device, p_media_type, p_trakt_id, p_slug, p_title, p_year,
        case when v_admin then
          coalesce((select max(f.position) from favorites f
                    join devices d on d.id = f.device_id where d.is_admin), 0) + 1
        else
          coalesce((select max(position) from favorites where device_id = p_device), 0) + 1
        end)
      on conflict (device_id, media_type, trakt_id) do nothing;
  elsif v_admin then
    -- Removing a shared pick: drop it from every admin device.
    delete from favorites f using devices d
      where f.device_id = d.id and d.is_admin
        and f.media_type = p_media_type and f.trakt_id = p_trakt_id;
  else
    delete from favorites
      where device_id = p_device and media_type = p_media_type and trakt_id = p_trakt_id;
  end if;
end; $$;

-- Reorder: an admin reorders the shared picks (updates every admin device's
-- matching rows so the order is consistent); a visitor reorders only their own.
create or replace function public.reorder_favorites(p_device uuid, p_keys text[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin(p_device) then
    update favorites f set position = t.ord
    from unnest(p_keys) with ordinality as t(key, ord), devices d
    where f.device_id = d.id and d.is_admin
      and f.media_type = split_part(t.key, ':', 1)
      and f.trakt_id = split_part(t.key, ':', 2)::bigint;
  else
    update favorites f set position = t.ord
    from unnest(p_keys) with ordinality as t(key, ord)
    where f.device_id = p_device
      and f.media_type = split_part(t.key, ':', 1)
      and f.trakt_id = split_part(t.key, ':', 2)::bigint;
  end if;
end; $$;
