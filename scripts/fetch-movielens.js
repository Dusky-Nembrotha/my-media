/*
 * Fetch the MovieLens ratings dataset.
 *
 * This is what lets the suggestions work from what people with similar taste
 * actually rated highly, rather than from a generic "films like this one"
 * list. GroupLens (University of Minnesota) publish it for exactly this sort
 * of use; it is not scraped from anywhere.
 *
 * Only two files are kept: ratings.csv (who rated what, and how highly) and
 * links.csv (which maps their film ids to TMDB ids, so it joins onto your
 * library). The rest of the archive is discarded.
 *
 *   node scripts/fetch-movielens.js                 # download ml-32m
 *   node scripts/fetch-movielens.js --set ml-25m
 *   node scripts/fetch-movielens.js --zip /path/to/ml-32m.zip   # already have it
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, rmSync, openSync, readSync, closeSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import https from 'node:https'
import { DATA_DIR } from '../server/lib/db.js'

const here = dirname(fileURLToPath(import.meta.url))
const CA = readFileSync(join(here, '..', 'server', 'lib', 'grouplens-ca.pem'))

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : null
}

const set = arg('--set') || 'ml-32m'
const localZip = arg('--zip')
const outDir = join(DATA_DIR, 'movielens')
mkdirSync(outDir, { recursive: true })

const zipPath = localZip || join(outDir, `${set}.zip`)

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    let seen = 0
    let total = 0
    let lastShown = 0

    const req = https.get(url, { ca: CA, headers: { 'User-Agent': 'Shelved/0.1' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        file.close()
        return download(res.headers.location, dest).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`GroupLens returned ${res.statusCode}`))
      }
      total = Number(res.headers['content-length'] || 0)
      res.on('data', (chunk) => {
        seen += chunk.length
        const mb = Math.floor(seen / (1024 * 1024))
        if (mb >= lastShown + 10) {
          lastShown = mb
          process.stdout.write(`\r  downloaded ${mb} MB${total ? ` of ${Math.round(total / 1048576)}` : ''}   `)
        }
      })
      res.pipe(file)
      file.on('finish', () => { file.close(); process.stdout.write('\n'); resolve() })
    })
    req.on('error', (err) => { file.close(); reject(err) })
  })
}

console.log(`\n  MovieLens ${set} → ${outDir}\n`)

if (localZip) {
  if (!existsSync(localZip)) {
    console.error(`  No such file: ${localZip}\n`)
    process.exit(1)
  }
  console.log(`  using the archive you supplied (${Math.round(statSync(localZip).size / 1048576)} MB)`)
} else if (existsSync(zipPath) && statSync(zipPath).size > 1024 * 1024) {
  console.log(`  already downloaded (${Math.round(statSync(zipPath).size / 1048576)} MB) — delete it to fetch again`)
} else {
  await download(`https://files.grouplens.org/datasets/movielens/${set}.zip`, zipPath)
}

// The archive holds a dozen files; only two are any use here.
console.log('  extracting ratings.csv and links.csv…')
for (const name of ['ratings.csv', 'links.csv']) {
  execFileSync('unzip', ['-o', '-j', zipPath, `*/${name}`, '-d', outDir], { stdio: 'pipe' })
}

for (const name of ['ratings.csv', 'links.csv']) {
  const p = join(outDir, name)
  if (!existsSync(p)) {
    console.error(`\n  ${name} is missing from the archive — is that really a MovieLens set?\n`)
    process.exit(1)
  }
  // Read only the first line: ratings.csv is far too big to hold as a string.
  const fd = openSync(p, 'r')
  const buf = Buffer.alloc(200)
  const read = readSync(fd, buf, 0, 200, 0)
  closeSync(fd)
  const head = buf.subarray(0, read).toString('utf8').split('\n')[0]
  console.log(`  ${name}: ${(statSync(p).size / 1048576).toFixed(0)} MB, columns: ${head}`)
}

if (!localZip) {
  rmSync(zipPath, { force: true })
  console.log('  removed the archive; the two CSVs are what matter')
}

console.log('\n  Next: node scripts/build-cf-model.js\n')
