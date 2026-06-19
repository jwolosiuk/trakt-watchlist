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
    views: document.getElementById("views"),
    profileLink: document.getElementById("trakt-profile-link"),
    version: document.getElementById("version"),
    favFilter: document.getElementById("fav-filter"),
    adminBtn: document.getElementById("admin-btn"),
    adminPanel: document.getElementById("admin-panel"),
    adminClose: document.getElementById("admin-close"),
    adminBackdrop: document.getElementById("admin-backdrop"),
    adminDevices: document.getElementById("admin-devices"),
    adminThisDevice: document.getElementById("admin-this-device"),
    banner: document.getElementById("filter-banner"),
    bannerText: document.getElementById("filter-banner-text"),
    bannerClear: document.getElementById("filter-banner-clear"),
  };

  var Store = window.Store || { enabled: false };
  var VIEW_KEY = "trakt-wl-view";

  var state = {
    items: [],        // normalized watchlist items
    byKey: {},        // "type:id" -> item
    filter: "all",    // all | movies | series | anime
    query: "",
    view: readView(), // grid | list
    myFavs: {},       // "type:id" -> true (this device's favorites)
    adminFavs: {},    // "type:id" -> true (admin pins, shown for everyone)
    // Favorites filter: null | "mine" | { deviceId, name, favs }
    favView: null,
  };

  function readView() {
    try {
      return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch (e) {
      return "grid";
    }
  }

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

  function keyOf(item) {
    return item.type + ":" + item.traktId;
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
      traktId: ids.trakt || null,
      slug: ids.slug || null,
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

  // Which favorites-set (if any) the current favView restricts the list to.
  function favViewSet() {
    if (state.favView === "mine") return state.myFavs;
    if (state.favView && state.favView.favs) return state.favView.favs;
    return null;
  }

  function visibleItems() {
    var favSet = favViewSet();
    var items = state.items.filter(function (it) {
      if (!matchesFilter(it) || !matchesQuery(it)) return false;
      if (favSet && !favSet[keyOf(it)]) return false;
      return true;
    });

    // Pin admin favorites first, then this device's own favorites, then the
    // rest — each group keeps the date-added order. Skip when already viewing a
    // single favorites set (the list is small and self-explanatory then).
    if (!favSet) {
      items.sort(function (a, b) {
        return rank(a) - rank(b);
      });
    }
    return items;
  }

  // Lower rank floats to the top. Stable date order is preserved within a rank
  // because Array.sort is stable and state.items is pre-sorted by date.
  function rank(item) {
    var k = keyOf(item);
    if (state.adminFavs[k]) return 0;
    if (state.myFavs[k]) return 1;
    return 2;
  }

  function cardMarkup(item) {
    var k = keyOf(item);
    var kindLabel = item.type === "movie" ? "Movie" : "Series";
    var pinned = Store.enabled && state.adminFavs[k];
    var mine = Store.enabled && state.myFavs[k];
    var badges = "";
    if (pinned) badges += '<span class="badge pin" title="Pick">★</span>';
    if (isAnime(item)) badges += '<span class="badge anime">Anime</span>';
    badges += '<span class="badge">' + kindLabel + "</span>";
    var posterInner = item.poster
      ? '<img src="' + escapeHtml(item.poster) + '" alt="" loading="lazy" />'
      : '<span class="placeholder">' + escapeHtml(item.title) + "</span>";
    var genres = (item.genres || [])
      .slice(0, 3)
      .map(function (g) {
        return g.charAt(0).toUpperCase() + g.slice(1);
      })
      .join(" · ");

    // Favorite toggle (only when the backend is configured). Sits outside the
    // poster link so clicking it doesn't open Trakt.
    var favBtn = Store.enabled && item.traktId
      ? '<button class="fav-btn' +
        (mine ? " is-fav" : "") +
        '" type="button" data-key="' +
        escapeHtml(k) +
        '" aria-pressed="' +
        (mine ? "true" : "false") +
        '" title="' +
        (mine ? "Remove from my favorites" : "Add to my favorites") +
        '" aria-label="Favorite">♥</button>'
      : "";

    return (
      favBtn +
      '<a class="poster-link" href="' +
      escapeHtml(item.traktUrl) +
      '" target="_blank" rel="noopener" title="' +
      escapeHtml(item.title) +
      ' on Trakt">' +
      '<div class="poster">' +
      '<div class="badges">' + badges + "</div>" +
      posterInner +
      "</div>" +
      '<div class="card-body">' +
      // Shown only in list view (badges cover this in grid view).
      '<div class="card-kind">' +
      (pinned ? '<span class="kind-pin">★</span> ' : "") +
      (isAnime(item) ? '<span class="kind-anime">Anime</span> · ' : "") +
      kindLabel +
      "</div>" +
      '<div class="card-title">' + escapeHtml(item.title) + "</div>" +
      '<div class="card-meta">' + (item.year || "") + "</div>" +
      (genres ? '<div class="card-genres">' + escapeHtml(genres) + "</div>" : "") +
      "</div>" +
      "</a>"
    );
  }

  // Apply the current view (grid/list) to the container and toggle buttons.
  function applyView() {
    els.grid.classList.toggle("as-list", state.view === "list");
    if (!els.views) return;
    Array.prototype.forEach.call(els.views.children, function (b) {
      var active = b.getAttribute("data-view") === state.view;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-pressed", active ? "true" : "false");
    });
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

    if (els.views) {
      els.views.addEventListener("click", function (e) {
        var btn = e.target.closest(".view");
        if (!btn) return;
        state.view = btn.getAttribute("data-view") === "list" ? "list" : "grid";
        try {
          localStorage.setItem(VIEW_KEY, state.view);
        } catch (err) {
          /* storage disabled — view just won't persist */
        }
        applyView();
      });
    }

    // Favorite toggle (event-delegated on the grid).
    els.grid.addEventListener("click", function (e) {
      var btn = e.target.closest(".fav-btn");
      if (!btn) return;
      e.preventDefault();
      toggleFavorite(btn.getAttribute("data-key"), btn);
    });

    // "♥ Mine" filter.
    if (els.favFilter) {
      els.favFilter.addEventListener("click", function () {
        setFavView(state.favView === "mine" ? null : "mine");
      });
    }

    // Admin panel open/close.
    if (els.adminBtn) {
      els.adminBtn.addEventListener("click", openAdmin);
    }
    if (els.adminClose) els.adminClose.addEventListener("click", closeAdmin);
    if (els.adminBackdrop) els.adminBackdrop.addEventListener("click", closeAdmin);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && els.adminPanel && !els.adminPanel.hidden) closeAdmin();
    });

    // Admin device-row actions (event-delegated).
    if (els.adminDevices) {
      els.adminDevices.addEventListener("click", onAdminAction);
    }

    if (els.bannerClear) {
      els.bannerClear.addEventListener("click", function () {
        setFavView(null);
      });
    }
  }

  // --- Favorites ----------------------------------------------------------

  function toggleFavorite(k, btn) {
    if (!Store.enabled || !k) return;
    var item = state.byKey[k];
    if (!item) return;
    var on = !state.myFavs[k];
    // Optimistic update.
    if (on) state.myFavs[k] = true;
    else delete state.myFavs[k];
    if (btn) btn.disabled = true;
    Store.setFavorite(item, on)
      .then(function () {
        // If this device is an admin, its picks are the public pins too.
        if (Store.isAdmin) {
          if (on) state.adminFavs[k] = true;
          else delete state.adminFavs[k];
        }
      })
      .catch(function (err) {
        console.error("setFavorite failed:", err);
        // Roll back.
        if (on) delete state.myFavs[k];
        else state.myFavs[k] = true;
        alert("Couldn't save that favorite — please try again.");
      })
      .then(function () {
        updateBackendUI();
        renderGrid();
      });
  }

  function setFavView(view) {
    state.favView = view;
    if (els.favFilter) {
      var mineActive = view === "mine";
      els.favFilter.classList.toggle("is-active", mineActive);
      els.favFilter.setAttribute("aria-pressed", mineActive ? "true" : "false");
    }
    renderBanner();
    renderGrid();
  }

  function renderBanner() {
    if (!els.banner) return;
    var fv = state.favView;
    if (fv && fv.deviceId) {
      els.bannerText.textContent = "Showing favorites of " + (fv.name || shortId(fv.deviceId));
      els.banner.hidden = false;
    } else {
      els.banner.hidden = true;
    }
  }

  // --- Admin panel --------------------------------------------------------

  function shortId(id) {
    return (id || "").slice(0, 8);
  }

  function relTime(iso) {
    if (!iso) return "";
    var diff = Date.now() - new Date(iso).getTime();
    var mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    var days = Math.round(hrs / 24);
    if (days < 30) return days + "d ago";
    return new Date(iso).toLocaleDateString();
  }

  function favsFromRows(rows) {
    var s = {};
    (rows || []).forEach(function (r) {
      s[Store.key(r.media_type, r.trakt_id)] = true;
    });
    return s;
  }

  // Reveal the admin button to non-admins only when a setup hint is in the URL
  // (e.g. open ".../#setup" once to grab a new device's id for bootstrapping).
  var SETUP_MODE = /setup|admin|device/i.test(
    (location.hash || "") + " " + (location.search || "")
  );

  function hasMyFavs() {
    for (var k in state.myFavs) {
      if (state.myFavs[k]) return true;
    }
    return false;
  }

  // "♥ Mine" only matters once this device has favorited something; the admin
  // button is admin-only (plus the setup escape hatch).
  function updateBackendUI() {
    if (!Store.enabled) return;
    if (els.adminBtn) els.adminBtn.hidden = !(Store.isAdmin || SETUP_MODE);
    if (els.favFilter) {
      var showMine = Store.isAdmin || hasMyFavs();
      els.favFilter.hidden = !showMine;
      if (!showMine && state.favView === "mine") setFavView(null);
    }
  }

  function setupBackendUI() {
    updateBackendUI();
  }

  function loadFavorites() {
    if (!Store.enabled) return Promise.resolve();
    return Promise.all([Store.myFavorites(), Store.adminFavorites()]).then(
      function (res) {
        state.myFavs = res[0] || {};
        state.adminFavs = res[1] || {};
        updateBackendUI();
        renderGrid();
      }
    );
  }

  function reloadAdminFavs() {
    return Store.adminFavorites().then(function (s) {
      state.adminFavs = s || {};
      renderGrid();
    });
  }

  function openAdmin() {
    if (!Store.enabled) return;
    els.adminPanel.hidden = false;
    document.body.classList.add("modal-open");
    var idHtml = "This device: <code>" + escapeHtml(Store.deviceId) + "</code>";
    if (Store.isAdmin) {
      els.adminThisDevice.innerHTML = idHtml + " · <strong>admin</strong>";
      els.adminDevices.innerHTML = '<p class="admin-loading">Loading devices…</p>';
      loadAdminDevices();
    } else {
      els.adminThisDevice.innerHTML =
        idHtml +
        '<br><span class="admin-note">To manage devices and pin favorites for ' +
        "everyone, make this device an admin: in the Supabase SQL editor run " +
        "<code>update devices set is_admin=true where id='" +
        escapeHtml(Store.deviceId) +
        "';</code></span>";
      els.adminDevices.innerHTML = "";
    }
  }

  function closeAdmin() {
    if (!els.adminPanel) return;
    els.adminPanel.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function loadAdminDevices() {
    Store.admin
      .listDevices()
      .then(renderAdminDevices)
      .catch(function (err) {
        console.error(err);
        els.adminDevices.innerHTML =
          '<p class="admin-error">Couldn’t load devices. Are you still an admin?</p>';
      });
  }

  function renderAdminDevices(devices) {
    if (!devices || !devices.length) {
      els.adminDevices.innerHTML = '<p class="admin-loading">No devices yet.</p>';
      return;
    }
    els.adminDevices.innerHTML = devices
      .map(function (d) {
        var isMe = d.id === Store.deviceId;
        var name = d.name || "(unnamed)";
        var meta =
          shortId(d.id) +
          " · " +
          (d.fav_count || 0) +
          " favs · seen " +
          relTime(d.last_seen);
        return (
          '<div class="device-row">' +
          '<div class="device-info">' +
          '<div class="device-name">' +
          escapeHtml(name) +
          (d.is_admin ? ' <span class="device-tag">admin</span>' : "") +
          (isMe ? ' <span class="device-tag me">this device</span>' : "") +
          "</div>" +
          '<div class="device-meta">' + escapeHtml(meta) + "</div>" +
          "</div>" +
          '<div class="device-actions">' +
          '<button type="button" data-action="view" data-id="' + escapeHtml(d.id) +
          '" data-name="' + escapeHtml(name) + '">Picks</button>' +
          '<button type="button" data-action="rename" data-id="' + escapeHtml(d.id) +
          '" data-name="' + escapeHtml(d.name || "") + '">Rename</button>' +
          '<button type="button" data-action="admin" data-id="' + escapeHtml(d.id) +
          '" data-isadmin="' + (d.is_admin ? "true" : "false") + '">' +
          (d.is_admin ? "Revoke admin" : "Make admin") +
          "</button>" +
          '<button type="button" class="danger" data-action="delete" data-id="' +
          escapeHtml(d.id) + '">Delete</button>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function onAdminAction(e) {
    var btn = e.target.closest("button[data-action]");
    if (!btn) return;
    var action = btn.getAttribute("data-action");
    var id = btn.getAttribute("data-id");
    var name = btn.getAttribute("data-name") || "";

    if (action === "view") {
      btn.disabled = true;
      Store.admin
        .deviceFavorites(id)
        .then(function (rows) {
          state.favView = { deviceId: id, name: name, favs: favsFromRows(rows) };
          if (els.favFilter) {
            els.favFilter.classList.remove("is-active");
            els.favFilter.setAttribute("aria-pressed", "false");
          }
          renderBanner();
          renderGrid();
          closeAdmin();
        })
        .catch(function (err) {
          console.error(err);
          alert("Couldn’t load that device’s favorites.");
        })
        .then(function () {
          btn.disabled = false;
        });
    } else if (action === "rename") {
      var nn = prompt("Name for this device:", name);
      if (nn === null) return;
      Store.admin.rename(id, nn).then(loadAdminDevices).catch(adminErr);
    } else if (action === "admin") {
      var makeAdmin = btn.getAttribute("data-isadmin") !== "true";
      Store.admin
        .setAdmin(id, makeAdmin)
        .then(function () {
          loadAdminDevices();
          reloadAdminFavs();
        })
        .catch(adminErr);
    } else if (action === "delete") {
      if (!confirm("Delete this device and all its favorites?")) return;
      Store.admin
        .remove(id)
        .then(function () {
          if (state.favView && state.favView.deviceId === id) setFavView(null);
          loadAdminDevices();
          reloadAdminFavs();
        })
        .catch(adminErr);
    }
  }

  function adminErr(err) {
    console.error(err);
    alert("That action failed: " + (err && err.message ? err.message : "unknown error"));
  }

  // --- Build / commit info -----------------------------------------------

  // "owner/repo" — from config, or auto-detected from a *.github.io URL.
  function repoSlug() {
    if (CFG.GITHUB_REPO) return CFG.GITHUB_REPO;
    var m = location.hostname.match(/^([^.]+)\.github\.io$/);
    if (!m) return null;
    var seg = location.pathname.split("/").filter(Boolean)[0];
    return m[1] + "/" + (seg || m[1] + ".github.io");
  }

  // Show the latest main commit (short hash + time) in the header.
  function showVersion() {
    if (!els.version) return;
    var slug = repoSlug();
    if (!slug) return;
    fetch("https://api.github.com/repos/" + slug + "/commits/main", {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.sha) return;
        var sha = data.sha.slice(0, 7);
        var dateStr =
          data.commit && data.commit.committer && data.commit.committer.date;
        var when = "";
        if (dateStr) {
          when = new Date(dateStr).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          });
        }
        var url = "https://github.com/" + slug + "/commit/" + data.sha;
        els.version.innerHTML =
          'build <a href="' +
          escapeHtml(url) +
          '" target="_blank" rel="noopener">' +
          escapeHtml(sha) +
          "</a>" +
          (when ? " · " + escapeHtml(when) : "");
      })
      .catch(function () {
        /* offline / rate-limited / local dev — just leave it blank */
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
    applyView();
    showVersion();

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

    // Register the device / detect admin in parallel with the watchlist fetch.
    var backendReady = Store.enabled
      ? Store.init().then(setupBackendUI)
      : Promise.resolve();

    fetchWatchlist()
      .then(function (rows) {
        state.items = rows.map(normalize).filter(function (it) {
          return it.listedAt; // keep movies & shows only
        });
        // Sort by date added to the list, newest first.
        state.items.sort(function (a, b) {
          return (b.listedAt || "").localeCompare(a.listedAt || "");
        });
        state.byKey = {};
        state.items.forEach(function (it) {
          state.byKey[keyOf(it)] = it;
        });
        updateSubtitle();
        renderGrid();
        // Overlay favorites once both the list and device are ready.
        return backendReady.then(loadFavorites);
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
