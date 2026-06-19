/* Backend store for favorites + device management, backed by Supabase RPC.
 * Talks to the locked-down SQL functions in supabase/schema.sql over REST,
 * so there's no SDK dependency. Exposes window.Store.
 *
 * If Supabase isn't configured in config.js, Store.enabled is false and the
 * app silently skips all favorite/admin features. */
(function () {
  "use strict";

  var CFG = window.CONFIG || {};
  var URL = (CFG.SUPABASE_URL || "").replace(/\/+$/, "");
  var KEY = CFG.SUPABASE_ANON_KEY || "";
  var DEVICE_KEY = "trakt-wl-device";

  function getDeviceId() {
    var id = null;
    try {
      id = localStorage.getItem(DEVICE_KEY);
    } catch (e) {
      /* storage disabled */
    }
    if (!id) {
      id =
        window.crypto && crypto.randomUUID
          ? crypto.randomUUID()
          : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
              var r = (Math.random() * 16) | 0;
              return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
            });
      try {
        localStorage.setItem(DEVICE_KEY, id);
      } catch (e) {
        /* ignore */
      }
    }
    return id;
  }

  // Call a Postgres function (RPC). Returns parsed JSON (array for table fns).
  function rpc(fn, params) {
    return fetch(URL + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        apikey: KEY,
        Authorization: "Bearer " + KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params || {}),
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error(t || "RPC " + fn + " failed (" + res.status + ")");
        });
      }
      return res.status === 204 ? null : res.json();
    });
  }

  function key(mediaType, traktId) {
    return mediaType + ":" + traktId;
  }
  function setFromRows(rows) {
    var s = {};
    (rows || []).forEach(function (r) {
      s[key(r.media_type, r.trakt_id)] = true;
    });
    return s;
  }

  var Store = {
    enabled: !!(URL && KEY),
    deviceId: null,
    isAdmin: false,
    name: null,

    key: key,

    // Register this device; resolves with { isAdmin }.
    init: function () {
      if (!this.enabled) return Promise.resolve({ isAdmin: false });
      this.deviceId = getDeviceId();
      var self = this;
      return rpc("register_device", { p_device: this.deviceId })
        .then(function (rows) {
          var row = (rows && rows[0]) || {};
          self.isAdmin = !!row.is_admin;
          self.name = row.name || null;
          return { isAdmin: self.isAdmin };
        })
        .catch(function (e) {
          console.error("register_device failed:", e);
          return { isAdmin: false };
        });
    },

    // Map of "type:id" -> true for this device's favorites.
    myFavorites: function () {
      if (!this.enabled) return Promise.resolve({});
      return rpc("my_favorites", { p_device: this.deviceId })
        .then(setFromRows)
        .catch(function () {
          return {};
        });
    },

    // Map of "type:id" -> true for items any admin has favorited (public pins).
    adminFavorites: function () {
      if (!this.enabled) return Promise.resolve({});
      return rpc("admin_favorites", {})
        .then(setFromRows)
        .catch(function () {
          return {};
        });
    },

    // Toggle a favorite for this device.
    setFavorite: function (item, on) {
      if (!this.enabled) return Promise.reject(new Error("disabled"));
      return rpc("set_favorite", {
        p_device: this.deviceId,
        p_media_type: item.type,
        p_trakt_id: item.traktId,
        p_slug: item.slug || null,
        p_title: item.title || null,
        p_year: item.year || null,
        p_on: !!on,
      });
    },

    admin: {
      listDevices: function () {
        return rpc("admin_list_devices", { p_admin: Store.deviceId });
      },
      deviceFavorites: function (targetId) {
        return rpc("admin_device_favorites", {
          p_admin: Store.deviceId,
          p_target: targetId,
        });
      },
      rename: function (targetId, name) {
        return rpc("admin_rename_device", {
          p_admin: Store.deviceId,
          p_target: targetId,
          p_name: name,
        });
      },
      setAdmin: function (targetId, isAdmin) {
        return rpc("admin_set_admin", {
          p_admin: Store.deviceId,
          p_target: targetId,
          p_is_admin: !!isAdmin,
        });
      },
      remove: function (targetId) {
        return rpc("admin_delete_device", {
          p_admin: Store.deviceId,
          p_target: targetId,
        });
      },
    },
  };

  window.Store = Store;
})();
