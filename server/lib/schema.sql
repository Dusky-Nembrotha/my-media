-- Shelved :: schema
-- One row per *work* (a film, a show, a book, an album...), many rows per
-- *entry* (each time you consumed it). Everything else hangs off those two.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Who the per-user rows belong to. One row today; the column exists so that
-- adding more people later is a filter change, not a data migration.
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  name        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO users (id, name) VALUES (1, 'me');

CREATE TABLE IF NOT EXISTS works (
  id              INTEGER PRIMARY KEY,
  type            TEXT NOT NULL,              -- film|tv|book|audiobook|album|track|podcast|game
  title           TEXT NOT NULL,
  sort_title      TEXT,
  original_title  TEXT,
  year            INTEGER,
  release_date    TEXT,
  creators        TEXT NOT NULL DEFAULT '[]', -- JSON [{role,name}]
  genres          TEXT NOT NULL DEFAULT '[]', -- JSON [string]
  overview        TEXT,
  runtime         INTEGER,                    -- minutes (films, albums, audiobooks)
  pages           INTEGER,
  seasons         INTEGER,
  episodes        INTEGER,
  language        TEXT,
  poster_url      TEXT,
  backdrop_url    TEXT,
  tmdb_id         TEXT,
  imdb_id         TEXT,
  isbn            TEXT,
  olid            TEXT,
  asin            TEXT,
  spotify_id      TEXT,
  mbid            TEXT,
  itunes_id       TEXT,
  external_rating REAL,                       -- 0-10 from the source provider
  popularity      REAL,
  metadata        TEXT NOT NULL DEFAULT '{}', -- JSON grab-bag (keywords, cast, narrator...)
  enriched_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS works_type_idx  ON works(type);
CREATE INDEX IF NOT EXISTS works_title_idx ON works(sort_title);
CREATE UNIQUE INDEX IF NOT EXISTS works_match_idx
  ON works(type, lower(title), ifnull(year, 0));
CREATE UNIQUE INDEX IF NOT EXISTS works_tmdb_idx ON works(type, tmdb_id) WHERE tmdb_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS works_imdb_idx ON works(type, imdb_id) WHERE imdb_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS entries (
  id            INTEGER PRIMARY KEY,
  work_id       INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'completed', -- completed|in_progress|abandoned|planned
  rating        REAL,                              -- 0.5 .. 5 in half steps
  liked         INTEGER NOT NULL DEFAULT 0,
  consumed_on   TEXT,                              -- YYYY-MM-DD (null = date unknown)
  is_repeat     INTEGER NOT NULL DEFAULT 0,        -- rewatch / reread / relisten
  season        INTEGER,
  episode       INTEGER,
  progress      TEXT,                              -- free text: "S03E04", "p.218", "62%"
  review        TEXT,
  notes         TEXT,
  tags          TEXT NOT NULL DEFAULT '[]',        -- JSON [string]
  source        TEXT NOT NULL DEFAULT 'manual',    -- manual|letterboxd|goodreads|...
  external_key  TEXT,                              -- idempotency key for imports
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS entries_work_idx ON entries(work_id);
CREATE INDEX IF NOT EXISTS entries_date_idx ON entries(consumed_on DESC);
CREATE INDEX IF NOT EXISTS entries_rating_idx ON entries(rating);
CREATE UNIQUE INDEX IF NOT EXISTS entries_external_idx ON entries(external_key) WHERE external_key IS NOT NULL;

-- Things people told you to check out, plus your own "someday" queue.
CREATE TABLE IF NOT EXISTS recs (
  id             INTEGER PRIMARY KEY,
  work_id        INTEGER REFERENCES works(id) ON DELETE SET NULL,
  user_id       INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
  type           TEXT,
  title          TEXT NOT NULL,
  year           INTEGER,
  creators       TEXT,
  poster_url     TEXT,
  recommender    TEXT,            -- who / where it came from
  source_url     TEXT,
  note           TEXT,
  priority       INTEGER NOT NULL DEFAULT 1,   -- 0 low, 1 normal, 2 high
  status         TEXT NOT NULL DEFAULT 'open', -- open|done|dismissed
  origin         TEXT NOT NULL DEFAULT 'manual', -- manual|engine|import
  engine_reason  TEXT,
  engine_score   REAL,
  external_key   TEXT UNIQUE,
  added_at       TEXT NOT NULL DEFAULT (datetime('now')),
  acted_at       TEXT
);

CREATE INDEX IF NOT EXISTS recs_status_idx ON recs(status, priority DESC, added_at DESC);

CREATE TABLE IF NOT EXISTS lists (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  ranked      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS list_items (
  list_id  INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  work_id  INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  note     TEXT,
  PRIMARY KEY (list_id, work_id)
);

CREATE TABLE IF NOT EXISTS import_runs (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
  source      TEXT NOT NULL,
  filename    TEXT,
  status      TEXT NOT NULL DEFAULT 'running', -- running|done|failed
  works_added INTEGER NOT NULL DEFAULT 0,
  entries_added INTEGER NOT NULL DEFAULT 0,
  entries_skipped INTEGER NOT NULL DEFAULT 0,
  recs_added  INTEGER NOT NULL DEFAULT 0,
  message     TEXT,
  detail      TEXT NOT NULL DEFAULT '{}',
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Durable HTTP cache so we are kind to the free metadata APIs.
CREATE TABLE IF NOT EXISTS http_cache (
  key        TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Cached output of the recommendation engine (recomputed on demand).
CREATE TABLE IF NOT EXISTS rec_cache (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Candidates the engine has learned you do not want to see again.
CREATE TABLE IF NOT EXISTS rec_blocks (
  fingerprint TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Live service connections (OAuth tokens, API keys, sync state).
CREATE TABLE IF NOT EXISTS connections (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),            -- trakt | lastfm | spotify | steam ...
  status        TEXT NOT NULL DEFAULT 'disconnected', -- disconnected|pending|connected|error
  config        TEXT NOT NULL DEFAULT '{}',  -- JSON: the ids/keys you pasted in
  tokens        TEXT NOT NULL DEFAULT '{}',  -- JSON: access/refresh tokens + expiry
  account       TEXT,                        -- the username we are connected as
  pending       TEXT NOT NULL DEFAULT '{}',  -- JSON: in-flight device/auth state
  last_sync_at  TEXT,
  last_result   TEXT NOT NULL DEFAULT '{}',  -- JSON summary of the last sync
  message       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
