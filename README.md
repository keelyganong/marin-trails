# Marin Trails

A hiking/running map for Marin County: difficulty-based trail coloring, hover
popups + a click-through detail sidebar, live AI trail insights, NWS weather,
ALERTCalifornia fire-camera markers, a difficulty filter, and a tool to trace
and save your own routes (with real elevation gain).

This started as a single-file prototype built in a sandboxed chat
environment. It's now a plain static site — no build step, no framework —
split into real files so it's easy to read, edit, and deploy.

## Running it locally

No dev server or build tool is required — it's plain HTML/CSS/JS loaded via
regular `<script>` tags. But **open it through a local HTTP server, not by
double-clicking the file**: browsers block `fetch()` (and in some cases
module/script loading) from a bare `file://` page, which breaks weather,
insights, and elevation lookups.

Any static file server works. For example, with Ruby (ships with macOS):

```bash
ruby -run -e httpd -- . --port=4173
```

Then open http://localhost:4173. If you have Python or Node installed,
`python3 -m http.server 4173` or `npx serve` work identically.

## Project structure

```
index.html              Page shell — markup + <script> tags, no logic
css/styles.css           All styling

data/
  trails.js               Final trail data the app loads (generated — see below)
  trails-metadata.json     Hand-edit this: names, blurbs, difficulty, addresses
  trail-sources.json       Hand-edit this: which OSM ways/relations feed each trail
  trails-geometry.json     Intermediate build output (gitignored)
  cameras.js               ALERTCalifornia camera locations
  fallback-insights.js     Static trail write-ups used if the live AI call fails

js/                      One file per concern — utils, map-init, popup,
                          trails (rendering + filtering), cameras, weather,
                          insights, elevation, sidebar, drawing (trace-a-route),
                          storage (sync + local cache), sync (sync-code UI),
                          main (bootstrap)

api/                     Two small Vercel serverless functions (Node) — see
                          "Backend: AI insights + cross-device sync" below
package.json             Just the one dependency (@upstash/redis) api/ needs

scripts/                 Perl — the data build pipeline (see below)
.cache/                  Raw OSM API response cache (gitignored, regenerable)
```

Load order matters since these are plain scripts (no bundler): `index.html`
lists them in dependency order. Everything attaches to `window`-level
globals rather than using ES modules, specifically so the page still works
opened directly — no bundler, no module CORS restrictions.

## Trail geometry: real OpenStreetMap data

The original prototype's trail lines were hand-placed approximate waypoints
— a sandbox limitation (it could only reach `api.anthropic.com` and
`api.weather.gov`, not the Overpass API). That's fixed: every trail's line
is now real geometry pulled from OpenStreetMap via the Overpass API.

The pipeline is three Perl scripts (no Node/Python dependency — this
machine didn't have those set up, so the pipeline was built directly on
`curl`/`jq`/Perl, all pre-installed on macOS):

1. **`scripts/fetch-osm-extract.pl`** — one broad Overpass query for every
   named path/footway/track/bridleway/steps way across the Mt. Tamalpais /
   Muir Woods / Marin watershed area, cached to `.cache/osm-raw-ways.json`.
   Rerun this if OSM coverage may have changed.

2. **`scripts/build-trail-geometry.pl`** — for each trail listed in
   `data/trail-sources.json`, selects the matching OSM ways (by name, or by
   an explicit way-id list for loops with no single OSM name — see Phoenix
   Lake below) and stitches them into one continuous line by greedily
   chaining whichever remaining segment has an endpoint closest to the
   current path's end. Real gaps in OSM's tagging (an untagged connector, a
   road crossing) get bridged with a straight segment and logged; a gap that
   turns out to be a separate, disconnected same-named trail elsewhere gets
   rejected instead of splicing on. Writes `data/trails-geometry.json`.

3. **`scripts/merge-trail-data.pl`** — combines that geometry with the
   hand-curated `data/trails-metadata.json` (names, blurbs, difficulty,
   addresses — the things Overpass doesn't know) into `data/trails.js`, the
   file the app actually loads. Also computes each trail's real distance
   from the geometry (doubling it for out-and-back trails like Tennessee
   Valley, closing the loop for Phoenix Lake / Muir Woods Main).

To rebuild everything after editing `data/trail-sources.json` or
`data/trails-metadata.json`:

```bash
perl scripts/fetch-osm-extract.pl      # only needed if OSM data may have changed
perl scripts/build-trail-geometry.pl
perl scripts/merge-trail-data.pl
```

**Known data quality note:** Phoenix Lake Loop has no single OSM-tagged
trail name for its lake-perimeter path — it's assembled from every
named/unnamed way within 50m of the lake shoreline (see the `wayIds` mode
in `trail-sources.json`), and one stretch of the loop (the north side, near
the dam/park entrance) isn't covered by any nearby-tagged way in OSM, so
that segment is a straight bridge rather than a true trace. Distance still
comes out close to the commonly cited 2.7mi. If you have or can record a
GPX trace of that segment, it'd be worth hand-splicing in.

The same trade-off applies to a few of the later additions: **Bon Tempe
Loop** is built the same way as Phoenix Lake (a curated `wayIds` list from
an Overpass `around` query on the shoreline) and has a couple of similar
small bridged gaps. **Yolanda Trail to Hidden Meadow Loop** has one longer
bridge (~0.65mi) — the two trails' real-world junction is apparently
mid-way along one of the ways rather than at either way's endpoint, and the
stitching in `build-trail-geometry.pl` only ever joins ways at their
endpoints, not at interior points — so it bridges between the two nearest
endpoints instead. Detecting mid-way junctions would need a real graph
join, not just nearest-endpoint chaining; noted here as a follow-up rather
than solved.

## Drag-to-trace: snapping custom routes to the real trail network

Tracing a custom route used to mean tapping a handful of points and getting
straight lines between them — accurate at each tap, but choppy everywhere
else. Now you can **drag** along a trail and the traced line snaps to and
follows its real shape, the same way route-builder tools like Strava's or
CalTopo's work.

- **`data/trail-network.js`** — every trail-type way (footway/path/track/
  bridleway/steps, named or not — ~5,400 ways) in the Marin/Mt Tam area,
  simplified from OpenStreetMap and shipped as a flat array of `[lat,lon]`
  polylines. Built by `scripts/fetch-network-extract.pl` (the Overpass
  query — broader than `fetch-osm-extract.pl`'s cache, which only pulls
  *named* ways for the 8 curated trails) piped through
  `scripts/build-trail-network.pl` (strips tags, thins near-collinear
  points with a Douglas-Peucker pass — 60% fewer points, same shape).
  Deliberately excludes roads: an unfiltered query over this bbox returned
  14,149 ways, and 5,521 of them were `service` roads (driveways,
  parking-lot lanes) — bulk a hiking app doesn't need.

- **`js/snap-trace.js`** — given a map position, finds the nearest point on
  that network (a cheap bounding-box prefilter narrows ~5,400 ways down to
  the handful actually nearby before doing precise pixel-distance checks on
  their segments).

- **`js/drawing.js`** — drives the actual drag interaction. A drag only
  becomes a trace if it *starts* within snapping distance of the network;
  otherwise it's left alone so the map's own drag-to-pan handles it — so
  you're never stuck unable to reposition the map, you just need to start
  the next drag from empty space (or zoom with scroll, which always works).
  While tracing, each mousemove is densely resampled in pixel space (every
  ~6px) and each sub-point snapped to the network independently, rather
  than trying to track continuity within a single OSM way — real trails
  are typically split across a dozen-plus separate way segments, and the
  earlier per-way approach jumped crudely at every one of those boundaries.
  Independent snapping just hugs whatever's nearest at each fine step,
  which tracks the real trail shape regardless of how it's fragmented
  underneath. If a new snapped point lands far from the last drawn one, it
  might be a backward correction rather than forward progress — the recent
  points in the current gesture are checked for a close match and unwound
  to, rather than adding a doubled-back spike. A plain tap (no real
  movement) still places a single point, snapped if near a trail. Undo
  removes the whole last drag stroke or tap at once, not one point at a
  time — a single stroke can add many points.

To rebuild the network after OSM coverage changes:

```bash
perl scripts/fetch-network-extract.pl
perl scripts/build-trail-network.pl
```

## Elevation gain

Built-in trail elevation figures are still the commonly cited public
numbers (kept in `data/trails-metadata.json`), not yet computed from terrain
data — a reasonable next step using the same approach below.

**Custom traced routes**, which had no elevation source at all in the
original prototype ("Not measured" was the honest label), now get real
elevation gain (`js/elevation.js`): the traced path is resampled to a point
roughly every 25m, each point's elevation is looked up via the free
[Open-Elevation](https://open-elevation.com/) API, and gain is the sum of
positive elevation deltas between consecutive samples. If the lookup fails,
it still honestly falls back to "Not measured" rather than guessing.

## Backend: AI insights + cross-device sync

Three things need more than a static file host: live trail insights, the
per-route location label lookup, and syncing custom routes across your own
devices. All three need a server holding a secret (an API key; a database
credential), which a static site can't do. This app is deployed on
**Vercel**, which serves the static files *and* runs small serverless
functions from `api/` (shared Anthropic-calling logic factored into
`lib/anthropic.js`):

- **`api/insights.js`** — generates a trail's live **recent conditions**
  and **community sentiment** (closures, season, crowding, what hikers are
  saying lately), cached per trail in Redis for 24 hours. **History is
  deliberately not part of this call** — it doesn't change, so it's static
  content from `data/fallback-insights.js` instead, rendered instantly with
  no network request at all (`js/insights.js` `renderHistory`). With only 8
  built-in trails and a 24-hour cache, this bounds real Anthropic calls to
  at most 8 per day *total*, regardless of how many people are viewing the
  map — cost doesn't scale with traffic. The sidebar shows an "Updated X
  ago" timestamp and category tags (closure / seasonal / crowd / conditions
  / wildlife) on whatever the model actually found — empty categories are
  simply omitted rather than padded. Custom (`isCustom`) trails skip this
  call entirely (no public info exists for a route only you've drawn) and
  show `GENERIC_FALLBACK_INSIGHTS` throughout. Requires Redis (see setup
  below); without it, returns 503 and the sidebar falls back to the static
  `recentNotes`/`communitySentiment` text in `data/fallback-insights.js`.

- **`api/anthropic.js`** — a thin, uncached proxy for the one remaining
  one-off Anthropic call: the custom-route location label lookup
  (`fetchRouteLocationLabel`), which doesn't benefit from caching since
  every traced route has a unique lat/lon. All of this exists because the
  browser can't call `api.anthropic.com` directly — confirmed while testing
  this rebuild:
  ```
  Access to fetch at 'https://api.anthropic.com/v1/messages' from origin
  'http://localhost:4173' has been blocked by CORS policy
  ```
  Anthropic doesn't send CORS headers for browser origins, by design — that
  would mean shipping an API key to every visitor. Both `api/anthropic.js`
  and `api/insights.js` hold the key server-side (`lib/anthropic.js`, which
  pins the model and caps `max_tokens`); `api/anthropic.js` additionally
  rate-limits per IP (30/hour) since — unlike `/api/insights` — it isn't
  bounded by a cache.

- **`api/trails.js`** — stores custom traced trails so they follow you
  across your own devices, keyed by a private "sync code" (`js/storage.js`,
  `js/sync.js`). Not a real account system: on first save, the app generates
  a random 10-character code and shows it once (the "Sync" button, top
  right); entering that same code on another device pulls the same trails.
  Anyone with the code can read/overwrite that data — same trust model as a
  house key, so treat it like one. Trails still aren't visible to *other*
  people, only synced across devices you personally link with the same
  code. Storage is Upstash Redis (see setup below); if it isn't configured
  yet, this endpoint returns a clear 503 and the app falls back to
  `localStorage`-only (works, just single-device).

NWS weather (`js/weather.js`) has no such issue — `api.weather.gov` does
support browser CORS directly, confirmed working during testing.

### Deploying / setting this up on Vercel

1. **Import the repo.** [vercel.com/new](https://vercel.com/new) → import
   this GitHub repo. No build settings needed — it's detected as a static
   project with serverless functions in `api/`.

2. **Add the Anthropic key.** Project Settings → Environment Variables →
   add `ANTHROPIC_API_KEY` with your key. Redeploy after adding it (env var
   changes need a redeploy to take effect).

3. **Add Redis** — used by both trail sync (`api/trails.js`) and the
   insights cache (`api/insights.js`; without it, insights just fall back
   to static content rather than calling Anthropic uncached). Project →
   Storage tab → Browse Marketplace → "Upstash for Redis" (this replaced
   the old "Vercel KV" product in December 2024 — search for Upstash if
   you don't see KV listed) → create a database and connect it to this
   project. Vercel auto-injects the `KV_REST_API_URL`/`KV_REST_API_TOKEN`
   (or `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`) env vars this
   code reads via `Redis.fromEnv()` — no manual copying needed.

4. **Redeploy** once both are set. That's it — every future `git push` to
   `main` auto-deploys.

If you'd rather skip the backend entirely, everything except live AI
insights and cross-device sync still works as a plain static site on any
static host (GitHub Pages, Netlify, Cloudflare Pages, S3+CloudFront) — just
serve `index.html`, `css/`, `js/`, and `data/` (skip `api/`, `scripts/`,
`package.json`, and `.cache/`, which are backend/build-time only).
