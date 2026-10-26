#!/bin/bash
# End-to-end smoke test against a running server.
set -u
B=http://localhost:4123/api
j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);console.log(eval(process.argv[1]))}catch(e){console.log('PARSE FAIL:',d.slice(0,160))}})" "$1"; }
pass() { printf "  \033[32mok\033[0m   %s\n" "$1"; }
fail() { printf "  \033[31mFAIL\033[0m %s\n" "$1"; }
check() { if [ "$2" = "$3" ]; then pass "$1 ($2)"; else fail "$1 — got '$2', want '$3'"; fi }

echo "== log a brand new title"
NEW=$(curl -s -X POST $B/log -H 'Content-Type: application/json' \
  -d '{"work":{"type":"film","title":"Smoke Test Film","year":1999},"rating":4,"consumed_on":"2026-10-01","review":"testing"}')
WID=$(echo "$NEW" | j 'o.work.id')
check "work created" "$(echo "$NEW" | j 'o.work.title')" "Smoke Test Film"
check "rating saved" "$(echo "$NEW" | j 'o.work.entries[0].rating')" "4"
EID=$(echo "$NEW" | j 'o.work.entries[0].id')

echo "== re-rate the entry"
R=$(curl -s -X PATCH $B/entries/$EID -H 'Content-Type: application/json' -d '{"rating":4.5,"liked":true}')
check "rating updated" "$(echo "$R" | j 'o.entries[0].rating')" "4.5"
check "liked" "$(echo "$R" | j 'o.entries[0].liked')" "true"

echo "== log the same work again (a rewatch)"
curl -s -X POST $B/log -H 'Content-Type: application/json' \
  -d "{\"work_id\":$WID,\"rating\":5,\"consumed_on\":\"2026-10-20\",\"is_repeat\":true}" > /dev/null
check "two entries" "$(curl -s $B/works/$WID | j 'o.work.entries.length')" "2"

echo "== recommendations inbox"
REC=$(curl -s -X POST $B/recs -H 'Content-Type: application/json' \
  -d '{"title":"Smoke Test Book","type":"book","recommender":"a colleague","note":"says it is great","priority":2,"enrichNow":false}')
RID=$(echo "$REC" | j 'o.id')
check "rec created" "$(echo "$REC" | j 'o.recommender')" "a colleague"
check "rec is open" "$(curl -s "$B/recs?status=open" | j 'o.recs.some(r=>r.id==='"$RID"')')" "true"
curl -s -X PATCH $B/recs/$RID -H 'Content-Type: application/json' -d '{"status":"dismissed"}' > /dev/null
check "rec dismissed" "$(curl -s "$B/recs?status=dismissed" | j 'o.recs.some(r=>r.id==='"$RID"')')" "true"
curl -s -X DELETE $B/recs/$RID > /dev/null

echo "== logging something answers its recommendation"
REC2=$(curl -s -X POST $B/recs -H 'Content-Type: application/json' \
  -d '{"title":"Smoke Test Film","type":"film","year":1999,"enrichNow":false}')
R2=$(echo "$REC2" | j 'o.id')
curl -s -X POST $B/log -H 'Content-Type: application/json' -d "{\"work_id\":$WID,\"rating\":3}" > /dev/null
check "rec auto-closed" "$(curl -s "$B/recs?status=all" | j 'o.recs.find(r=>r.id==='"$R2"').status')" "done"

echo "== lists"
L=$(curl -s -X POST $B/lists -H 'Content-Type: application/json' -d '{"name":"Smoke List","description":"temp"}')
SLUG=$(echo "$L" | j 'o.slug')
curl -s -X POST $B/lists/$SLUG/items -H 'Content-Type: application/json' -d "{\"work_id\":$WID}" > /dev/null
check "list has the work" "$(curl -s $B/lists/$SLUG | j 'o.items.length')" "1"
curl -s -X DELETE $B/lists/$SLUG > /dev/null

echo "== import: analyse then apply a Goodreads export"
AN=$(curl -s -X POST $B/import/analyse -F "files=@samples/goodreads_library_export.csv")
check "detected source" "$(echo "$AN" | j 'o.detected')" "goodreads"
TOKEN=$(echo "$AN" | j 'o.token')
AP=$(curl -s -X POST $B/import/apply -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"source\":\"goodreads\",\"options\":{\"enrich\":false}}")
check "re-import adds nothing" "$(echo "$AP" | j 'o.summary.entriesAdded')" "0"
check "re-import skips the lot" "$(echo "$AP" | j 'o.summary.entriesSkipped > 20')" "true"

echo "== import: a ZIP of the Letterboxd export"
rm -f /tmp/lb.zip && (cd samples && zip -qr /tmp/lb.zip letterboxd)
AN2=$(curl -s -X POST $B/import/analyse -F "files=@/tmp/lb.zip")
check "zip detected" "$(echo "$AN2" | j 'o.detected')" "letterboxd"
check "zip members read" "$(echo "$AN2" | j 'o.files.length')" "5"

echo "== search"
check "local search finds it" "$(curl -s "$B/search?q=smoke&remote=0" | j 'o.local.length > 0')" "true"
check "provider search works" "$(curl -s "$B/search?q=piranesi&type=book" | j 'o.local.length + o.remote.length > 0')" "true"

echo "== export"
check "json export" "$(curl -s "$B/export?format=json" | j 'o.entries.length > 100')" "true"
check "csv export" "$(curl -s "$B/export?format=csv" | head -1 | grep -c title)" "1"

echo "== stats + profile"
check "stats totals" "$(curl -s $B/stats | j 'o.totals.entries > 100')" "true"
check "profile built" "$(curl -s $B/profile | j 'o.genres.length > 3')" "true"

echo "== tidy up"
curl -s -X DELETE $B/works/$WID > /dev/null
check "work removed" "$(curl -s $B/works/$WID | j 'o.error ? "gone" : "still here"')" "gone"
