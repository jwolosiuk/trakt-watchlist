"""Offline tests for tools/streaming.py: python3 -m unittest discover -s tools"""
import json
import os
import tempfile
import unittest
from unittest import mock

import streaming


def node(imdb=None, tmdb=None, offers=(), seasons=None):
    n = {"content": {"externalIds": {"imdbId": imdb, "tmdbId": tmdb}}, "offers": list(offers)}
    if seasons:
        n["totalSeasonCount"] = seasons
    return n


def offer(kind="FLATRATE", count=None, url="https://www.netflix.com/title/1"):
    return {"monetizationType": kind, "elementCount": count, "standardWebURL": url}


MOVIE = {"key": "movie:1", "kind": "movie", "title": "Legend", "year": 2015, "imdb": "tt3569230", "tmdb": "276907"}
SHOW = {"key": "show:2", "kind": "show", "title": "Show", "year": 2020, "imdb": None, "tmdb": "42"}


def read(path):
    with open(path) as f:
        return json.load(f)


class Matching(unittest.TestCase):
    def test_imdb_beats_position(self):
        namesake = node("tt0089469", "11976")  # Legend (1985) ranks first
        real = node("tt3569230", "276907")
        self.assertIs(streaming.match_node(MOVIE, [{"node": namesake}, {"node": real}]), real)

    def test_no_id_match_means_none_even_with_same_title(self):
        self.assertIsNone(streaming.match_node(MOVIE, [{"node": node("tt0089469", "11976")}]))

    def test_tmdb_fallback_when_no_imdb(self):
        n = node(None, "42")
        self.assertIs(streaming.match_node(SHOW, [{"node": node(None, "7")}, {"node": n}]), n)

    def test_empty_search(self):
        self.assertIsNone(streaming.match_node(MOVIE, None))


class Availability(unittest.TestCase):
    def test_rent_and_buy_do_not_count(self):
        self.assertIsNone(streaming.availability(MOVIE, node(offers=[offer("RENT"), offer("BUY")])))

    def test_movie(self):
        self.assertEqual(streaming.availability(MOVIE, node(offers=[offer()])),
                         {"url": "https://www.netflix.com/title/1"})

    def test_show_seasons(self):
        got = streaming.availability(SHOW, node(offers=[offer(count=1), offer(count=2)], seasons=4))
        self.assertEqual(got, {"url": "https://www.netflix.com/title/1", "seasons": 2, "total_seasons": 4})


class Flatten(unittest.TestCase):
    def test_keys_match_app_js(self):
        rows = [
            {"type": "movie", "movie": {"title": "A", "ids": {"trakt": 1, "imdb": "tt1", "tmdb": 5}}},
            {"type": "show", "show": {"title": "B", "ids": {"trakt": 2}}},
            {"type": "season", "show": {"title": "B", "ids": {"trakt": 2}}},  # dup of the show
        ]
        items = streaming.watchlist_items(rows)
        self.assertEqual([i["key"] for i in items], ["movie:1", "show:2"])
        self.assertEqual(items[0]["tmdb"], "5")


class Run(unittest.TestCase):
    def run_main(self, out, lookup):
        with mock.patch.object(streaming, "fetch_watchlist", return_value=[
            {"type": "movie", "movie": {"title": "Legend", "ids": {"trakt": 1, "imdb": "tt3569230"}}},
            {"type": "movie", "movie": {"title": "Other", "ids": {"trakt": 3, "imdb": "tt3"}}},
        ]), mock.patch.object(streaming, "lookup", side_effect=lookup), \
                mock.patch.object(streaming, "PAUSE", 0):
            return streaming.main(["--user", "u", "--client-id", "c", "--out", out])

    def test_writes_readable_file(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "streaming.json")
            rc = self.run_main(out, lambda b, c, p: {
                "t0": {"edges": [{"node": node("tt3569230", offers=[offer()])}]},
                "t1": {"edges": []},
            })
            self.assertEqual(rc, 0)
            self.assertEqual(os.stat(out).st_mode & 0o777, 0o644)  # Caddy reads it as another user
            data = read(out)
            self.assertEqual(data["items"], {"movie:1": {"url": "https://www.netflix.com/title/1"}})
            self.assertEqual((data["label"], data["country"], data["not_offered"]), ("Netflix", "TH", 1))

    def test_total_failure_keeps_old_file(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "streaming.json")
            with open(out, "w") as f:
                f.write('{"label":"Netflix","items":{"movie:1":{"url":"x"}}}')

            def boom(*a):
                raise RuntimeError("down")
            self.assertEqual(self.run_main(out, boom), 1)
            self.assertEqual(read(out)["items"], {"movie:1": {"url": "x"}})
            self.assertEqual([f for f in os.listdir(d)], ["streaming.json"])  # no temp leftovers


if __name__ == "__main__":
    unittest.main()
