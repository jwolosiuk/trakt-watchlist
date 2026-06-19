# Public Trakt Watchlist

A single-page, account-free public view of a [Trakt](https://trakt.tv)
watchlist. Visitors do **not** need a Trakt account to see it. The page fetches
the watchlist directly from the Trakt API in the browser, so it's just static
files — perfect for GitHub Pages.

## Features

- **Filters:** All / Movies / Series / Anime (anime = items tagged with Trakt's
  `anime` genre, since Trakt has no separate anime type).
- **Sorted by date added** to the watchlist, newest first.
- **Posters + details straight from Trakt** (no extra API key), each linking to
  its Trakt page.
- Quick title search, **grid/list views**, responsive layout, dark theme.
- **Favorites (optional, needs Supabase):** you (admin) pin favorites that float
  to the top for everyone; any visitor can mark their own favorites; you can
  filter by a device's picks and name/delete devices.

## Setup

### 1. Get a Trakt Client ID

1. Go to <https://trakt.tv/oauth/applications> and create a new application.
2. Name: anything. Redirect URI: `urn:ietf:wg:oauth:2.0:oob`.
3. Copy the **Client ID** (a read-only public key — safe to commit).

### 2. Make your watchlist public

Trakt → **Settings → Privacy** → set your profile/watchlist to public.
Otherwise the API returns "private" and visitors can't see it.

### 3. Fill in `config.js`

```js
window.CONFIG = {
  TRAKT_USERNAME: "your-trakt-username",
  TRAKT_CLIENT_ID: "your-trakt-client-id",
};
```

Commit and push. Posters are pulled directly from Trakt — no other key needed.

### 4. Enable GitHub Pages (one-time)

In the repo on GitHub go to **Settings → Pages → Build and deployment**, set
**Source: Deploy from a branch**, choose branch `main` and folder `/ (root)`,
then **Save**. After a minute the site is live at
`https://<username>.github.io/trakt-watchlist/`.

Every later push to `main` redeploys automatically — no further setup needed.

### 5. (Optional) Favorites + devices via Supabase

This adds shared favorites. It's entirely optional — leave the Supabase fields
in `config.js` empty and the site works exactly as before.

1. Create a free project at <https://supabase.com>.
2. Open **SQL Editor → New query**, paste the contents of
   [`supabase/schema.sql`](supabase/schema.sql), and run it.
3. In **Project Settings → API**, copy the **Project URL** and the **anon
   public** key into `config.js`:

   ```js
   SUPABASE_URL: "https://xxxx.supabase.co",
   SUPABASE_ANON_KEY: "eyJ...",   // the public "anon" key
   ```

   Both are safe to commit — all access is enforced by the SQL functions.
4. Commit, push, open the site, then click **⚙ Device** to see this device's id.
5. Make that device an admin (one time) in the Supabase SQL editor:

   ```sql
   update public.devices set is_admin = true, name = 'My phone'
   where id = '<the device id from step 4>';
   ```

   Reload — you now have the admin tools. Promote/name/delete other devices
   from **⚙ Device** afterwards; no more dashboard edits needed.

#### How the favorites model works

- Every browser gets a random **device id** (stored locally). Visitors never log
  in. A device is **admin** only if its `is_admin` flag is `true` in the database.
- **Admin favorites are pinned to the top for everyone** (shown with a ★ "Pick"
  badge). Each visitor's own favorites float to the top **for them only**.
- Only an admin can list devices or view another device's picks. This is enforced
  server-side: Row Level Security blocks all direct table access, so every read
  and write goes through `SECURITY DEFINER` functions that check admin rights.
- A device id therefore acts as a private capability — it's a random UUID that
  only lives in your browser and is only sent to Supabase over HTTPS. If one ever
  leaks, just delete that device (it cascades its favorites).

## Running locally

Because browsers block `fetch` from `file://`, serve the folder over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## How it works

- `config.js` — your settings (the only file you edit).
- `index.html` — markup, filter tabs, search box, view toggle, admin panel.
- `app.js` — fetches `GET /users/<user>/watchlist?extended=full,images` from
  Trakt (paginated), sorts by `listed_at`, and renders cards using the poster
  URLs Trakt returns inline. Handles favorites, ordering and the admin panel.
- `store.js` — thin client for the Supabase RPC functions (favorites/devices).
- `supabase/schema.sql` — the database schema + access-control functions.
- `styles.css` — dark, responsive card grid.

No build step. The base watchlist needs no backend; favorites are an opt-in
Supabase layer.

## Notes

- The Trakt Client ID is visible in page source. That's expected — it's a public,
  read-only key. Do **not** put any OAuth access token or client *secret* here.
- Anime detection relies on Trakt genre data; a title only appears under "Anime"
  if Trakt lists `anime` among its genres.
