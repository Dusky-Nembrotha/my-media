# Data model

Two tables carry the weight; everything else hangs off them.

### `works` — the thing itself
One row per film, show, book, album... Identified by `(type, title, year)` plus any
external ids it picked up (`tmdb_id`, `imdb_id`, `isbn`, `asin`, `mbid`, …).
Metadata (artwork, genres, creators, overview) is filled in by the enrichment queue
and merged, never clobbered, so a thin CSV import cannot erase good data.

### `entries` — your relationship with it
One row per *occasion*: a viewing, a read, a season of a show, a year of plays.
Carries `rating` (0.5–5 in halves), `consumed_on`, `status`, `is_repeat`, `review`,
`tags`, `progress`, `source` and an `external_key`.

`external_key` is what makes imports idempotent: `letterboxd:diary:<slug>:<date>`.
Re-importing updates in place. Summary rows (a ratings export, an IMDb rating) carry
`merge: true`, meaning "fold into the existing entry for this work rather than
creating a second one".

### The rest
- `recs` — the "to check out" inbox: imported watchlists, engine picks you saved, and
  anything a person recommended (with who and why).
- `lists` / `list_items` — named collections, imported or your own.
- `import_runs` — what was imported, when, and what it did.
- `http_cache` — durable cache of every provider response.
- `rec_cache` / `rec_blocks` — engine output and the things you said no to.

### Rating scale
Everything is normalised to 0.5–5 in half steps on the way in: IMDb's /10 is halved,
Goodreads' 1–5 is kept, Letterboxd's half stars pass straight through. The engine
works in deviations from *your* mean, so a generous rater and a harsh one get equally
useful recommendations.
