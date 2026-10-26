# Shelved

### ▶ Open the app

> **Not deployed yet.** Follow [**DEPLOY.md**](DEPLOY.md) to put it on a public URL,
> then this line becomes the link. Running it on your own machine instead?
> [Start here](#running-it) — it is three commands.

<!-- Once deployed, replace the block above with:
### ▶ [Open the app](https://shelved.fly.dev)
-->

**[Deploy guide](DEPLOY.md)** · **[Data model](docs/DATA-MODEL.md)** ·
**[What it does](#what-it-does)** · **[Connections](#connect)** · **[Imports](#import)**

---

A self-hosted log of everything you watch, read and listen to — films, TV, books,
audiobooks, music, podcasts and games — with imports from the services you already
use and a recommendation engine built from your own ratings.

Runs on your own machine or your own hosting, stores everything in one SQLite file,
and sends nothing anywhere except the metadata lookups needed to fetch artwork.
Behind a password the moment it is reachable from outside your network.

---

## Running it

Locally on your own machine, or [deployed to a public URL](DEPLOY.md).


```bash
npm install --no-bin-links     # --no-bin-links is required: this drive is exFAT, which has no symlinks
npm run build                  # builds the browser app into dist/
npm start                      # http://localhost:4123
```

Open it on your phone or laptop at `http://<this-machine>:4123`.

For development with hot reloading:

```bash
npm run dev                    # API on :4123, UI on :5173 with live reload
```

Requires Node 22.5+ (uses the built-in `node:sqlite`, so there is nothing to compile).

### Signing in

On your own network the app is open, as a local tool should be. The moment it is
reachable from outside, a password is required:

- Open it from your own network and you will be asked to choose one, **or**
- set `SHELVED_PASSWORD` before first boot (how a hosted deployment should do it).

A deployment with no password set refuses to let anyone choose one over the public
internet — otherwise whoever found the address first would own it. Sessions are
signed cookies lasting 60 days; changing the password signs every device out.

### First run

The app starts empty. Either:

- **Import** — drag your exports onto the Import page, or
- **Load a sample library** — the button on the Import page fills the app with ~130
  realistic entries so you can see how everything behaves before committing your own data.

To clear the sample data afterwards: Settings → Start again.

---

## What it does

### Log
Every title is a **work**; every time you watch/read/listen to it is an **entry**.
That split means rewatches, rereads and per-season TV all live on one page without
duplicating the title, and your rating history is visible rather than overwritten.

Rate in half stars, add a date (or mark it unknown), write a review, flag it as a
repeat, mark progress for things you are part-way through.

### Connect
The **Connections** page lists every service, grouped by media type, with its exact
setup steps. Four of them sync live:

| Service | Media | How it connects | What you get |
|---|---|---|---|
| **Trakt** | Film, TV | OAuth device code — no callback URL to register, you just type a code on trakt.tv | Full watch history, ratings and watchlist |
| **Last.fm** | Music | API key + username, no OAuth at all | Your whole scrobble history, grouped into albums |
| **Spotify** | Music, podcasts | OAuth with a loopback redirect (paste-the-URL fallback for phones) | The last 50 plays plus saved albums |
| **Steam** | Games | Web API key + SteamID | Every game with playtime; unplayed ones can go on your list |

Syncs run through the same pipeline as file imports, so they are idempotent —
sync as often as you like and nothing duplicates. Secrets are stored locally and
never sent to the browser; the UI only ever sees the last four characters.

The rest have no usable public API, and the page says so plainly with the export
steps instead: Letterboxd (API still in closed beta), Goodreads (API shut down in
2020), Audible, IMDb, Netflix, JustWatch and StoryGraph.

### Import
Drop in a file or a whole ZIP. The format is detected, you get a preview of exactly
what will happen, and then it is applied. **Re-importing the same export is safe** —
entries are matched on a stable key, so nothing is duplicated.

| Service | What to export | Notes |
|---|---|---|
| **Letterboxd** | Settings → Data → Export your data | Drop the whole ZIP: diary, ratings, watched, watchlist, likes, reviews and lists are all read |
| **Goodreads** | My Books → Import and export → Export Library | Shelves become status; `to-read` becomes recommendations |
| **The StoryGraph** | Manage Account → Export StoryGraph Data | Moods, pace and content warnings are kept as tags |
| **Audible** | Amazon → Account → Request Your Data → Audible | Audible has no export button; the data request emails you `Audible.Library.csv`. Any CSV with Title / Author / Narrator also works |
| **IMDb** | Your Ratings → Export | `/10` ratings are converted to stars; a rating merges into an existing log entry rather than creating a second one |
| **Trakt** | VIP → Settings → Export (or any trakt-exporter output) | Episodes are rolled up into one entry per season |
| **Spotify** | Privacy Settings → Download your data | Plays are grouped into albums and podcast shows, not thousands of single tracks. Saved albums become recommendations |
| **Last.fm** | lastfm.ghan.nl or benjaminbenben.com/lastfm-to-csv | Scrobbles grouped into albums |
| **Netflix** | Account → Profile → Viewing activity → Download all | Episodes grouped per season; Netflix provides no ratings |
| **JustWatch** | Profile → Settings → Export your data | Watchlist → recommendations, Seen list → log entries |
| **Any CSV** | — | Columns are guessed and you can correct the mapping |

Cross-source duplicates are merged: one title watched on one day is one entry,
whether Letterboxd, Netflix and IMDb all reported it or only one did.

### Recommend
Two different things, deliberately kept apart:

- **For you** — the taste engine. It measures how far above *your own average* you
  rate each genre, director, author, artist, decade and keyword, weights recent
  ratings more heavily, shrinks thin evidence towards neutral, then goes looking for
  things you have not logged. Every pick states its reason ("More from Bong Joon Ho —
  you gave Parasite ★★★★★"). Results are diversified so one director cannot take over
  the page, and "not for me" is remembered.
- **To check out** — the human inbox. When someone tells you to watch something, put
  it here with their name and the reason. Imported watchlists land here too. Logging
  something automatically closes its recommendation.

Music is handled differently from film: albums usually arrive unrated, so heavy
rotation is read as the preference signal instead of stars.

### See
Stats page: rating distribution, activity over time, a year-of-logging heatmap, top
genres and people, release decades, and where each entry came from. Every chart has a
"show the numbers" table view.

---

## Metadata and artwork

Everything works with **no API keys at all**:

| Media | Source |
|---|---|
| Books | Open Library (covers, subjects, authors, ratings) |
| Audiobooks | Apple (iTunes Search) + Open Library |
| Music | Apple + MusicBrainz / Cover Art Archive |
| Podcasts | Apple |
| TV | TVmaze |
| Films, games | Wikipedia (poster art) + Wikidata (director, genre, runtime, IMDb/TMDB ids) |

Lookups are cached in the database and run one at a time so the free services stay
happy. A big import fills in metadata in the background while you use the app.

**Optional: a TMDB key.** Free and instant from themoviedb.org → Settings → API.
Paste it into Settings and film/TV metadata improves considerably (proper genres,
cast, keywords) and recommendations gain TMDB's "people also liked" signal. Adding a
key re-fetches film and TV metadata automatically.

If a title matches the wrong thing, the refresh button on its page re-matches it from
scratch.

---

## Layout

```
server/
  index.js            Express app; serves the API and the built client
  lib/                db + schema, settings, CSV parser, HTTP cache, shared helpers
  providers/          tmdb · tvmaze · wikipedia · wikidata · openlibrary · itunes · musicbrainz
  importers/          one module per service + the shared detect/parse/apply pipeline
  connections/        live services: trakt · lastfm · spotify · steam, plus the registry
  routes/             library · recs · stats · imports · connections · misc
  recommend.js        taste profile, candidate generation, scoring, diversification
  enrich.js           background metadata queue
client/src/
  pages/              Home · Section · Work · Diary · Recommended · Inbox · Lists · Stats · Import · Connections · Settings
  components/         Shell · Poster · Row · Modal · LogDialog · Palette · Charts · Stars · Icon
  styles/             tokens · base · app · pages
data/shelved.db       everything you have logged
samples/              demo exports, also used by "Load a sample library"
scripts/              sample generator, importer tests, smoke test
```

### Checks

```bash
bash scripts/smoke.sh             # 22 end-to-end API checks against a running server
node scripts/test-importers.js    # detection + parsing for every sample export
node scripts/test-connections.js  # sync mappers, with the network stubbed
node node_modules/typescript/bin/tsc --noEmit
```

---

## Keyboard

`⌘K` or `/` opens search — your library first, then everything else, plus jump-to-page
actions. `Esc` closes any dialog.

---

## Known rough edges

- Without a TMDB key, film recommendations lean on "more by directors you rate
  highly", which is strong but narrower than genre/keyword matching.
- Open Library subjects are noisy, so occasionally an odd "genre" appears on a book.
- MusicBrainz genre-tag candidates are hit and miss; the artist-based music picks are
  much better than the tag-based ones.
- The four live connectors are built and their request/response handling is tested
  against stubbed services, but the OAuth handshakes have not been run end to end
  against real accounts — that needs your own developer credentials. The error paths
  (bad key, declined, expired code, 401 → reconnect) are all handled.
- Spotify's API only exposes the last 50 plays, so it tops up rather than backfills.
  Pair it with a one-off data-download import for the full history.
