/*
 * Fetch the goodbooks-10k ratings dataset.
 *
 * Six million ratings of the ten thousand most-read books on Goodreads, from
 * 53,000 readers, published by Zygmunt Zając under CC BY-SA 4.0. It is what
 * lets book suggestions come from people who read what you read, rather than
 * from an Open Library subject search — which, sorted by rating, is mostly a
 * list of Harry Potter.
 *
 * Four files are kept: ratings.csv (who rated what), books.csv (titles,
 * authors and ISBNs, which is how the model joins onto your library), and
 * tags.csv with book_tags.csv (the shelves readers filed each book under,
 * which stand in for genres).
 *
 *   node scripts/fetch-goodbooks.js
 */
import { createWriteStream, existsSync, mkdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import https from 'node:https'
import { DATA_DIR } from '../server/lib/db.js'

const RELEASE = 'https://github.com/zygmuntz/goodbooks-10k/releases/download/v1.0'
const outDir = join(DATA_DIR, 'goodbooks')
mkdirSync(outDir, { recursive: true })

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const req = https.get(url, { headers: { 'User-Agent': 'Shelved/0.1' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        file.close()
        return download(res.headers.location, dest).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`GitHub returned ${res.statusCode}`))
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    })
    req.on('error', (err) => { file.close(); reject(err) })
  })
}

console.log(`\n  goodbooks-10k → ${outDir}\n`)

for (const name of ['ratings', 'books', 'tags', 'book_tags']) {
  const csv = join(outDir, `${name}.csv`)
  if (existsSync(csv) && statSync(csv).size > 1024) {
    console.log(`  ${name}.csv already here (${(statSync(csv).size / 1048576).toFixed(1)} MB) — delete it to fetch again`)
    continue
  }
  const zip = join(outDir, `${name}.zip`)
  console.log(`  downloading ${name}.zip…`)
  await download(`${RELEASE}/${name}.zip`, zip)
  execFileSync('unzip', ['-o', '-j', zip, `${name}.csv`, '-d', outDir], { stdio: 'pipe' })
  rmSync(zip, { force: true })
  console.log(`  ${name}.csv: ${(statSync(csv).size / 1048576).toFixed(1)} MB`)
}

console.log('\n  Next: node scripts/build-cf-model.js --source goodbooks\n')
