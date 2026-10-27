#!/usr/bin/env bash
#
# Exercise every route the app depends on, against a throwaway database.
# Never touches the live library.
#
#   scripts/smoke-test.sh
set -u
PORT=${1:-4399}
BASE="http://127.0.0.1:$PORT/api"
JAR=/tmp/testbed-$PORT.cookies
pass=0; fail=0; failed=()

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s — %s\n' "$1" "$2"; fail=$((fail+1)); failed+=("$1"); }

# check <name> <curl args...> ; expects HTTP 200 and valid JSON
check() {
  local name=$1; shift
  local body code
  body=$(curl -s -m 45 -b "$JAR" -w $'\n%{http_code}' "$@" 2>/dev/null)
  code=$(printf '%s' "$body" | tail -1)
  body=$(printf '%s' "$body" | sed '$d')
  if [ "$code" != "200" ]; then bad "$name" "HTTP $code"; return 1; fi
  if ! printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{JSON.parse(s)})' 2>/dev/null; then
    bad "$name" "not JSON"; return 1
  fi
  printf '%s' "$body" > /tmp/smoke-last.json
  ok "$name"
}

echo
echo "  Starting an isolated server on $PORT…"
./scripts/testbed.sh start "$PORT" > /dev/null || { echo "  could not start"; exit 1; }

echo
echo "  Authentication"
check "auth status"            "$BASE/auth/status"

echo
echo "  Library"
check "sections"               "$BASE/sections"
check "works (all)"            "$BASE/works"
check "works (films)"          "$BASE/works?type=film"
check "works sorted asc"       "$BASE/works?type=film&sort=rating&dir=asc"
check "works by format"        "$BASE/works?type=book&format=audiobook"
check "facets"                 "$BASE/facets?type=film"
check "settings"               "$BASE/settings"
check "connections"            "$BASE/connections"
check "import sources"         "$BASE/import/sources"
check "import runs"            "$BASE/import/runs"
check "stats"                  "$BASE/stats"
check "profile"                "$BASE/profile"
check "recs list"              "$BASE/recs?status=open"
check "diary/activity"         "$BASE/activity"

echo
echo "  Adding things"
check "log a film"             -X POST "$BASE/log" -H 'Content-Type: application/json' \
  -d '{"work":{"type":"film","title":"Heat","year":1995,"tmdb_id":"949"},"rating":5,"consumed_on":"2026-02-01"}'
check "log a book (audio)"     -X POST "$BASE/log" -H 'Content-Type: application/json' \
  -d '{"work":{"type":"book","title":"Project Hail Mary","year":2021},"rating":4.5,"format":"audiobook"}'
check "add a recommendation"   -X POST "$BASE/recs" -H 'Content-Type: application/json' \
  -d '{"type":"film","title":"Sicario","year":2015,"enrichNow":false}'

echo
echo "  A single title"
check "work detail"            "$BASE/works/1"
check "ratings strip"          "$BASE/works/1/ratings"
check "where to watch"         "$BASE/works/1/watch"
check "series / franchise"     "$BASE/works/1/series"
check "artwork candidates"     "$BASE/works/1/artwork"
check "unsaved artwork"        "$BASE/artwork/candidates?type=book&title=Dune&creator=Frank+Herbert"

echo
echo "  Search"
check "search (scoped)"        "$BASE/search?q=dune&type=book"
check "search (everything)"    "$BASE/search?q=dune"
check "search (big)"           "$BASE/search?q=Brandon+Sanderson&type=book&limit=40"
check "creator, no lookup"     "$BASE/creator?name=Frank+Herbert&type=book"

echo
echo "  Discovery"
check "suggestions (film)"     "$BASE/recommendations?type=film&limit=6"
check "suggestions (book)"     "$BASE/recommendations?type=book&limit=6"
check "suggestions, more"      "$BASE/recommendations?type=film&limit=30"
check "hot (film)"             "$BASE/hot?type=film&limit=5"
check "hot (book)"             "$BASE/hot?type=book&limit=5"
check "hot (games, empty)"     "$BASE/hot?type=game&limit=5"

echo
echo "  Importing"
cat > /tmp/smoke-netflix.csv <<'CSV'
Title,Date
"Blade Runner 2049","12/03/2024"
"Outlast: Episode 1","13/03/2024"
"Outlast: Episode 2","13/03/2024"
"Outlast: Episode 3","14/03/2024"
CSV
check "analyse an upload"      -X POST "$BASE/import/analyse" -F "files=@/tmp/smoke-netflix.csv"
TOKEN=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/smoke-last.json","utf8")).token)' 2>/dev/null)
DETECTED=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/smoke-last.json","utf8")).detected)' 2>/dev/null)
if [ "$DETECTED" = "netflix" ]; then ok "detected as Netflix"; else bad "detected as Netflix" "got $DETECTED"; fi
check "run the import"         -X POST "$BASE/import/apply" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"source\":\"netflix\"}"

# The four Netflix rows are one film and one three-episode show, not four films.
SHOWS=$(curl -s -m 20 -b "$JAR" "$BASE/works?type=tv" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).total)})' 2>/dev/null)
if [ "$SHOWS" = "1" ]; then ok "episodes grouped into one show"; else bad "episodes grouped into one show" "got $SHOWS shows"; fi

echo
echo "  Editing and removing"
check "edit an entry"          -X PATCH "$BASE/entries/1" -H 'Content-Type: application/json' -d '{"rating":4}'
check "undo preview"           "$BASE/import/runs/1/undo"
check "undo the import"        -X DELETE "$BASE/import/runs/1"
check "batch delete"           -X POST "$BASE/works/delete" -H 'Content-Type: application/json' -d '{"ids":[9999]}'

echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -gt 0 ]; then printf '  failing: %s\n' "${failed[*]}"; fi
./scripts/testbed.sh stop "$PORT" > /dev/null
echo
[ "$fail" -eq 0 ]
