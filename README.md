# Public Trakt Watchlist

A single-page, account-free public view of a [Trakt](https://trakt.tv)
watchlist. Visitors do **not** need a Trakt account to see it. The page fetches
the watchlist directly from the Trakt API in the browser, so it's just static
files — perfect for GitHub Pages.

## Features

- **Filters:** All / Movies / Series / Anime (anime = items tagged with Trakt's
  `anime` genre, since Trakt has no separate anime type).
- **Sorted by date added** to the watchlist, newest first.
- **Posters + details** via TMDB (optional), each linking to its Trakt page.
- Quick title search, responsive layout, dark theme, poster caching.

## Setup

### 1. Get a Trakt Client ID

1. Go to <https://trakt.tv/oauth/applications> and create a new application.
2. Name: anything. Redirect URI: `urn:ietf:wg:oauth:2.0:oob`.
3. Copy the **Client ID** (a read-only public key — safe to commit).

### 2. Make your watchlist public

Trakt → **Settings → Privacy** → set your profile/watchlist to public.
Otherwise the API returns "private" and visitors can't see it.

### 3. (Optional) Get a TMDB key for posters

1. Create a free account at <https://www.themoviedb.org/>.
2. Go to **Settings → API** and copy either the **API Read Access Token**
   (v4 bearer) or the **API Key** (v3). Either works.

If you skip this, the page still shows titles, years, genres and Trakt links —
just without poster images.

### 4. Fill in `config.js`

```js
window.CONFIG = {
  TRAKT_USERNAME: "your-trakt-username",
  TRAKT_CLIENT_ID: "your-trakt-client-id",
  TMDB_API_KEY: "your-tmdb-key-or-empty",
};
```

Commit and push.

### 5. Enable GitHub Pages

In the repo on GitHub: **Settings → Pages → Build and deployment**,
set **Source: Deploy from a branch**, branch `claude/public-trakt-watchlist-ydhlmx`
(or `main` once merged), folder `/ (root)`. Your site will be published at
`https://<username>.github.io/trakt-watchlist/`.

## Running locally

Because browsers block `fetch` from `file://`, serve the folder over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## How it works

- `config.js` — your settings (the only file you edit).
- `index.html` — markup, filter tabs, search box.
- `app.js` — fetches `GET /users/<user>/watchlist?extended=full` from Trakt
  (paginated), sorts by `listed_at`, and renders cards. If a TMDB key is set, it
  looks up each item's `poster_path` by its TMDB id and caches the result in
  `localStorage` for a week.
- `styles.css` — dark, responsive card grid.

No build step, no backend, no secrets required at runtime.

## Notes

- The Trakt Client ID is visible in page source. That's expected — it's a public,
  read-only key. Do **not** put any OAuth access token or client *secret* here.
- Anime detection relies on Trakt genre data; a title only appears under "Anime"
  if Trakt lists `anime` among its genres.
