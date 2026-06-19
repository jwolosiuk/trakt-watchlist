/* Public Trakt watchlist viewer — fetches the list client-side and renders it.
 * No login required for visitors; the owner's Trakt watchlist must be public.
 * Posters come straight from the Trakt API (extended=images). */
(function () {
  "use strict";

  var CFG = window.CONFIG || {};
  var TRAKT_API = "https://api.trakt.tv";

  var els = {
    title: document.getElementById("title"),
    subtitle: document.getElementById("subtitle"),
    status: document.getElementById("status"),
    grid: document.getElementById("grid"),
    search: document.getElementById("search"),
    filters: document.getElementById("filters"),
    profileLink: document.getElementById("trakt-profile-link"),
  };

  var state = {
    items: [],        // normalized watchlist items
    filter: "all",    // all | movies | series | anime
    query: "",
  };

  // --- Helpers ------------------------------------------------------------

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(html, isError) {
    els.status.innerHTML = html;
    els.status.classList.toggle("error", !!isError);
  }

  function isAnime(item) {
    return (item.genres || []).indexOf("anime") !== -1;
  }

  // Trakt returns protocol-relative-ish paths like "media.trakt.tv/.../x.webp".
  function fullImageUrl(arr) {
    if (!arr || !arr.length || !arr[0]) return null;
    var p = arr[0];
    if (/^https?:\/\//.test(p)) return p;
    return "https://" + p.replace(/^\/\//, "");
  }

  // --- Trakt --------------------------------------------------------------

  function traktHeaders() {
    return {
      "Content-Type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": CFG.TRAKT_CLIENT_ID,
    };
  }

  function makeError(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  // Fetch every page of the watchlist (movies + shows) with full info + images.
  function fetchWatchlist() {
    var user = encodeURIComponent(CFG.TRAKT_USERNAME);
    var all = [];

    function getPage(page) {
      var url =
        TRAKT_API +
        "/users/" +
        user +
        "/watchlist?extended=full,images&limit=100&page=" +
        page;
      return fetch(url, { headers: traktHeaders() }).then(function (res) {
        if (res.status === 403 || res.status === 423) {
          throw makeError(
            "private",
            "This Trakt watchlist is private. Set it to public under " +
              "Trakt → Settings → Privacy so it can be shown here."
          );
        }
        if (res.status === 401 || res.status === 412) {
          throw makeError(
            "auth",
            "Trakt rejected the request — check your TRAKT_CLIENT_ID in config.js."
          );
        }
        if (res.status === 404) {
          throw makeError(
            "notfound",
            'Trakt user "' +
              escapeHtml(CFG.TRAKT_USERNAME) +
              '" was not found — check TRAKT_USERNAME in config.js.'
          );
        }
        if (!res.ok) {
          throw makeError("http", "Trakt API error (HTTP " + res.status + ").");
        }
        var pageCount = parseInt(
          res.headers.get("X-Pagination-Page-Count") || "1",
          10
        );
        return res.json().then(function (data) {
          all = all.concat(data);
          if (page < pageCount) return getPage(page + 1);
          return all;
        });
      });
    }

    return getPage(1);
  }

  // Turn a raw Trakt watchlist row into a flat item we can render.
  function normalize(row) {
    var type = row.type === "movie" ? "movie" : "show";
    var media = row[type] || {};
    var ids = media.ids || {};
    var images = media.images || {};
    var slugType = type === "movie" ? "movies" : "shows";
    return {
      type: type, // "movie" | "show"
      listedAt: row.listed_at || media.released || "",
      title: media.title || "Untitled",
      year: media.year || null,
      genres: media.genres || [],
      overview: media.overview || "",
      poster: fullImageUrl(images.poster),
      traktUrl: ids.slug
        ? "https://trakt.tv/" + slugType + "/" + ids.slug
        : "https://trakt.tv/users/" + encodeURIComponent(CFG.TRAKT_USERNAME) + "/watchlist",
    };
  }

  // --- Rendering ----------------------------------------------------------

  function matchesFilter(item) {
    if (state.filter === "movies") return item.type === "movie";
    if (state.filter === "series") return item.type === "show";
    if (state.filter === "anime") return isAnime(item);
    return true;
  }

  function matchesQuery(item) {
    if (!state.query) return true;
    return item.title.toLowerCase().indexOf(state.query) !== -1;
  }

  function visibleItems() {
    return state.items.filter(function (it) {
      return matchesFilter(it) && matchesQuery(it);
    });
  }

  function cardMarkup(item) {
    var typeLabel = isAnime(item) ? "Anime" : item.type === "movie" ? "Movie" : "Series";
    var badgeClass = isAnime(item) ? "badge anime" : "badge";
    var posterInner = item.poster
      ? '<img src="' + escapeHtml(item.poster) + '" alt="" loading="lazy" />'
      : '<span class="placeholder">' + escapeHtml(item.title) + "</span>";
    var genres = (item.genres || [])
      .slice(0, 3)
      .map(function (g) {
        return g.charAt(0).toUpperCase() + g.slice(1);
      })
      .join(" · ");

    return (
      '<a class="poster-link" href="' +
      escapeHtml(item.traktUrl) +
      '" target="_blank" rel="noopener" title="' +
      escapeHtml(item.title) +
      ' on Trakt">' +
      '<div class="poster">' +
      '<span class="' + badgeClass + '">' + typeLabel + "</span>" +
      posterInner +
      "</div>" +
      '<div class="card-body">' +
      '<div class="card-title">' + escapeHtml(item.title) + "</div>" +
      '<div class="card-meta">' + (item.year || "") + "</div>" +
      (genres ? '<div class="card-genres">' + escapeHtml(genres) + "</div>" : "") +
      "</div>" +
      "</a>"
    );
  }

  function renderGrid() {
    var items = visibleItems();
    if (!items.length) {
      els.grid.innerHTML = "";
      setStatus(
        '<div class="card-msg">Nothing here yet for this filter.</div>',
        false
      );
      return;
    }
    setStatus("", false);
    els.grid.innerHTML = items
      .map(function (item) {
        return '<li class="card">' + cardMarkup(item) + "</li>";
      })
      .join("");
  }

  function renderSkeletons(n) {
    var cells = [];
    for (var i = 0; i < n; i++) {
      cells.push(
        '<li class="card skeleton"><div class="poster"></div>' +
          '<div class="card-body"><div class="card-title"></div>' +
          '<div class="card-meta"></div></div></li>'
      );
    }
    els.grid.innerHTML = cells.join("");
  }

  function updateSubtitle() {
    var m = 0, s = 0, a = 0;
    state.items.forEach(function (it) {
      if (it.type === "movie") m++;
      else s++;
      if (isAnime(it)) a++;
    });
    els.subtitle.textContent =
      state.items.length +
      " titles · " +
      m +
      " movies · " +
      s +
      " series" +
      (a ? " · " + a + " anime" : "");
  }

  // --- Events -------------------------------------------------------------

  function wireEvents() {
    els.filters.addEventListener("click", function (e) {
      var btn = e.target.closest(".filter");
      if (!btn) return;
      state.filter = btn.getAttribute("data-filter");
      Array.prototype.forEach.call(els.filters.children, function (b) {
        var active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-selected", active ? "true" : "false");
      });
      renderGrid();
    });

    var debounce;
    els.search.addEventListener("input", function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        state.query = els.search.value.trim().toLowerCase();
        renderGrid();
      }, 120);
    });
  }

  // --- Boot ---------------------------------------------------------------

  function configError() {
    var missing = [];
    if (!CFG.TRAKT_USERNAME) missing.push("TRAKT_USERNAME");
    if (!CFG.TRAKT_CLIENT_ID) missing.push("TRAKT_CLIENT_ID");
    return missing;
  }

  function init() {
    wireEvents();

    var missing = configError();
    if (missing.length) {
      setStatus(
        '<div class="card-msg">' +
          "<strong>Almost there — setup needed.</strong><br />" +
          "Open <code>config.js</code> and fill in: " +
          missing.map(function (m) { return "<code>" + m + "</code>"; }).join(", ") +
          ".</div>",
        true
      );
      return;
    }

    els.title.textContent = CFG.TRAKT_USERNAME + "’s Watchlist";
    els.profileLink.href =
      "https://trakt.tv/users/" + encodeURIComponent(CFG.TRAKT_USERNAME) + "/watchlist";
    els.subtitle.textContent = "Loading…";
    renderSkeletons(12);

    fetchWatchlist()
      .then(function (rows) {
        state.items = rows.map(normalize).filter(function (it) {
          return it.listedAt; // keep movies & shows only
        });
        // Sort by date added to the list, newest first.
        state.items.sort(function (a, b) {
          return (b.listedAt || "").localeCompare(a.listedAt || "");
        });
        updateSubtitle();
        renderGrid();
      })
      .catch(function (err) {
        console.error(err);
        els.grid.innerHTML = "";
        els.subtitle.textContent = "";
        setStatus(
          '<div class="card-msg">' + escapeHtml(err.message) + "</div>",
          true
        );
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
