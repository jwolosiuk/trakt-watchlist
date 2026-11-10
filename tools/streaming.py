#!/usr/bin/env python3
"""Which watchlist titles can be streamed on one service in one country.

Writes a small JSON file (streaming.json) that the page loads from next to
index.html and turns into a badge + a filter button. Without that file the page
simply doesn't show the feature, so this is optional (plain GitHub Pages works
as before).

Data sources:
  * the Trakt watchlist (public API, the read-only client id from config.js);
  * JustWatch's GraphQL endpoint (unofficial, no key) for offers per country.
    Trakt's own "watch now" endpoints are not open to regular API apps.

Titles are matched by IMDb id (falling back to TMDB id) — never by title alone,
so a remake or a namesake can't produce a false "on Netflix". JustWatch's search
for a country only returns titles that have SOME offer there, so a title that
isn't found is simply not streamable/rentable in that country at all.

Usage:
  tools/streaming.py --config config.js --out streaming.json
  tools/streaming.py --config config.js --out streaming.json --country TH \
      --packages nfx --label Netflix

Stdlib only. Exits non-zero (and leaves the old file alone) if Trakt is
unreachable or most JustWatch lookups fail.
"""
import argparse
import datetime
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request

TRAKT_API = "https://api.trakt.tv"
JUSTWATCH_API = "https://apis.justwatch.com/graphql"
# Trakt answers 403 to urllib's default User-Agent.
USER_AGENT = "trakt-watchlist-streaming/1.0 (+https://github.com/jwolosiuk/trakt-watchlist)"
BATCH = 10           # titles per JustWatch request (GraphQL aliases)
SEARCH_RESULTS = 20  # candidates per title to look for an id match (common titles rank low)
PAUSE = 1.0          # seconds between JustWatch requests, to be polite
STREAM_TYPES = {"FLATRATE", "ADS", "FREE"}  # not RENT / BUY


def http_json(url, data=None, headers=None, timeout=30):
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode() if data is not None else None,
        headers=dict({"User-Agent": USER_AGENT, "Content-Type": "application/json"}, **(headers or {})),
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.load(res), res.headers


def read_config(path):
    """Pull TRAKT_USERNAME / TRAKT_CLIENT_ID out of the page's config.js."""
    text = open(path, encoding="utf-8").read()
    out = {}
    for key in ("TRAKT_USERNAME", "TRAKT_CLIENT_ID"):
        m = re.search(key + r'\s*:\s*["\']([^"\']+)["\']', text)
        if m:
            out[key] = m.group(1)
    return out


def fetch_watchlist(user, client_id):
    headers = {"trakt-api-version": "2", "trakt-api-key": client_id}
    rows, page, pages = [], 1, 1
    while page <= pages:
        url = "%s/users/%s/watchlist?extended=full&limit=100&page=%d" % (TRAKT_API, user, page)
        data, h = http_json(url, headers=headers)
        rows.extend(data)
        pages = int(h.get("X-Pagination-Page-Count") or 1)
        page += 1
    return rows


def watchlist_items(rows):
    """Flatten Trakt rows the same way app.js does: key = "<movie|show>:<trakt id>"."""
    items, seen = [], set()
    for row in rows:
        kind = "movie" if row.get("type") == "movie" else "show"
        media = row.get(kind) or {}
        ids = media.get("ids") or {}
        if not ids.get("trakt"):
            continue
        key = "%s:%s" % (kind, ids["trakt"])
        if key in seen:
            continue
        seen.add(key)
        items.append({
            "key": key,
            "kind": kind,
            "title": media.get("title") or "",
            "year": media.get("year"),
            "imdb": ids.get("imdb"),
            "tmdb": str(ids["tmdb"]) if ids.get("tmdb") else None,
        })
    return items


def build_query(batch):
    """One GraphQL request with an aliased search per title (t0, t1, ...)."""
    params = ["$country: Country!", "$language: Language!", "$packages: [String!]"]
    parts = []
    for i, it in enumerate(batch):
        params.append("$q%d: String!" % i)
        parts.append(
            "t%d: popularTitles(country: $country, first: %d, filter: {searchQuery: $q%d, objectTypes: [%s]}) {"
            " edges { node { id"
            " content(country: $country, language: $language) { title originalReleaseYear externalIds { imdbId tmdbId } }"
            " ... on Show { totalSeasonCount }"
            " offers(country: $country, platform: WEB, filter: {packages: $packages}) {"
            " monetizationType elementCount standardWebURL package { clearName shortName } } } } }"
            % (i, SEARCH_RESULTS, i, "MOVIE" if it["kind"] == "movie" else "SHOW")
        )
    return "query(%s) {\n%s\n}" % (", ".join(params), "\n".join(parts))


def match_node(item, edges):
    """The JustWatch node that is this exact title (by IMDb, then TMDB id), or None."""
    nodes = [e.get("node") or {} for e in edges or []]
    ext = lambda n: ((n.get("content") or {}).get("externalIds") or {})
    if item["imdb"]:
        for n in nodes:
            if ext(n).get("imdbId") == item["imdb"]:
                return n
    if item["tmdb"]:
        for n in nodes:
            if ext(n).get("tmdbId") == item["tmdb"]:
                return n
    return None


def availability(item, node):
    """{url, seasons?, total_seasons?} if the node has a streaming offer, else None."""
    offers = [o for o in node.get("offers") or [] if o.get("monetizationType") in STREAM_TYPES]
    if not offers:
        return None
    entry = {"url": next((o["standardWebURL"] for o in offers if o.get("standardWebURL")), None)}
    if item["kind"] == "show":
        seasons = max((o.get("elementCount") or 0) for o in offers)
        if seasons:
            entry["seasons"] = seasons
        if node.get("totalSeasonCount"):
            entry["total_seasons"] = node["totalSeasonCount"]
    return entry


def lookup(batch, country, packages):
    variables = {"country": country, "language": "en", "packages": packages}
    for i, it in enumerate(batch):
        variables["q%d" % i] = it["title"]
    body = {"query": build_query(batch), "variables": variables}
    last = None
    for attempt in range(3):
        try:
            data, _ = http_json(JUSTWATCH_API, data=body, headers={"Accept": "application/json"})
            if data.get("errors") and not data.get("data"):
                raise RuntimeError(data["errors"][0].get("message"))
            return data.get("data") or {}
        except (urllib.error.URLError, RuntimeError, ValueError) as e:
            last = e
            time.sleep(PAUSE * (2 + attempt * 3))
    raise RuntimeError("JustWatch lookup failed: %s" % last)


def load_previous(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("items") or {}
    except (OSError, ValueError):
        return {}


def write_atomic(path, payload):
    directory = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(prefix=".streaming-", suffix=".json", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
            f.write("\n")
        # mkstemp creates 0600; the web server (another user) must be able to read it.
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", help="config.js to read TRAKT_USERNAME / TRAKT_CLIENT_ID from")
    ap.add_argument("--user", help="Trakt username (overrides --config)")
    ap.add_argument("--client-id", help="Trakt client id (overrides --config)")
    ap.add_argument("--out", required=True, help="where to write streaming.json")
    ap.add_argument("--country", default="TH", help="ISO 3166-1 alpha-2 country (default TH)")
    ap.add_argument("--packages", default="nfx",
                    help="comma-separated JustWatch package short names (default nfx = Netflix)")
    ap.add_argument("--label", default="Netflix", help="service name shown on the page")
    args = ap.parse_args(argv)

    cfg = read_config(args.config) if args.config else {}
    user = args.user or cfg.get("TRAKT_USERNAME")
    client_id = args.client_id or cfg.get("TRAKT_CLIENT_ID")
    if not user or not client_id:
        ap.error("need a Trakt username and client id (--config or --user/--client-id)")
    country = args.country.upper()
    packages = [p.strip() for p in args.packages.split(",") if p.strip()]

    items = watchlist_items(fetch_watchlist(user, client_id))
    previous = load_previous(args.out)

    available, unmatched, failed = {}, [], []
    batches = [items[i:i + BATCH] for i in range(0, len(items), BATCH)]
    for n, batch in enumerate(batches):
        if n:
            time.sleep(PAUSE)
        try:
            data = lookup(batch, country, packages)
        except RuntimeError as e:
            print("batch %d/%d: %s" % (n + 1, len(batches), e), file=sys.stderr)
            failed.extend(batch)
            continue
        for i, it in enumerate(batch):
            node = match_node(it, (data.get("t%d" % i) or {}).get("edges"))
            if node is None:
                unmatched.append(it)
                continue
            entry = availability(it, node)
            if entry:
                available[it["key"]] = entry

    if len(failed) > len(items) / 2:
        print("too many failed lookups (%d/%d) — keeping the old file" % (len(failed), len(items)),
              file=sys.stderr)
        return 1
    # A transient failure shouldn't make titles blink off the page: keep what
    # we knew about them last time.
    for it in failed:
        if it["key"] in previous:
            available[it["key"]] = previous[it["key"]]

    write_atomic(args.out, {
        "label": args.label,
        "country": country,
        "source": "JustWatch",
        "updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "checked": len(items) - len(failed),
        "not_offered": len(unmatched),  # not on any service in the country
        "items": available,
    })
    print("%d titles · %d on %s (%s) · %d not offered in %s by any service · %d lookups failed"
          % (len(items), len(available), args.label, country, len(unmatched), country, len(failed)))
    for it in unmatched:
        print("  not offered in %s: %s (%s) [%s]" % (country, it["title"], it["year"], it["key"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
