// ---------------------------------------------------------------------------
// Configuration — fill in your details below, then commit & push.
// ---------------------------------------------------------------------------
//
// 1. TRAKT_USERNAME
//    Your Trakt username, e.g. for https://trakt.tv/users/sean it is "sean".
//
// 2. TRAKT_CLIENT_ID
//    Create a free API app at https://trakt.tv/oauth/applications
//    (any name; redirect URI: urn:ietf:wg:oauth:2.0:oob) and copy the
//    "Client ID". This is a read-only public key, safe to commit.
//
// Posters come straight from Trakt — no other API key needed.
//
// IMPORTANT: your Trakt watchlist must be set to public so visitors who are
// not logged in can see it. Set it under Trakt → Settings → Privacy.
// ---------------------------------------------------------------------------

window.CONFIG = {
  TRAKT_USERNAME: "dzeremi",
  TRAKT_CLIENT_ID: "bd4ee4d974c1421a548413339a9588316b1c41f5a4ad678c7d7fb46f95bd5a7b",

  // Optional: "owner/repo" used to show the latest commit hash + time in the
  // header. Leave empty to auto-detect from a *.github.io URL.
  GITHUB_REPO: "jwolosiuk/trakt-watchlist",

  // Optional: Supabase project, used for the favorites + device features.
  // Create a free project at https://supabase.com, apply supabase/migrations/
  // (auto-deploys if GitHub is connected, or paste it into the SQL editor), then
  // paste the project URL and the public "anon" key here (Project Settings →
  // API). Both are safe to expose publicly; access is enforced by the SQL
  // functions. Leave empty to disable favorites entirely.
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
};
