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
- Quick title search, responsive layout, dark theme.

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

## Running locally

Because browsers block `fetch` from `file://`, serve the folder over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## How it works

- `config.js` — your settings (the only file you edit).
- `index.html` — markup, filter tabs, search box.
- `app.js` — fetches `GET /users/<user>/watchlist?extended=full,images` from
  Trakt (paginated), sorts by `listed_at`, and renders cards using the poster
  URLs Trakt returns inline.
- `styles.css` — dark, responsive card grid.

No build step, no backend, no secrets required at runtime.

## Notes

- The Trakt Client ID is visible in page source. That's expected — it's a public,
  read-only key. Do **not** put any OAuth access token or client *secret* here.
- Anime detection relies on Trakt genre data; a title only appears under "Anime"
  if Trakt lists `anime` among its genres.
