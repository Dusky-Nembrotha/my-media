// Generates realistic sample exports in samples/ — used for testing the
// importers and for the "Load sample library" button in Settings.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const root = join(import.meta.dirname, '..', 'samples')
const write = (rel, body) => {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, body)
  console.log('wrote', rel, `(${body.length} bytes)`)
}
const csv = (headers, rows) => [headers.join(','), ...rows.map((r) => r.map((c) => {
  const s = c == null ? '' : String(c)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}).join(','))].join('\n') + '\n'

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const boxd = (t) => `https://boxd.it/${slug(t).replace(/-/g, '').slice(0, 8)}`
const d = (y, m, day) => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`

// ---------------------------------------------------------------- Letterboxd
const films = [
  ['Dune: Part Two', 2024, 4.5, d(2024, 3, 2), 'Denis Villeneuve', 'Sand and dread on an IMAX scale. Villeneuve shoots scale like weather.'],
  ['Arrival', 2016, 5, d(2024, 1, 14), 'Denis Villeneuve', 'Still the best film about grief disguised as a film about aliens.'],
  ['Past Lives', 2023, 4.5, d(2024, 2, 11), 'Celine Song', ''],
  ['Everything Everywhere All at Once', 2022, 4, d(2023, 11, 4), 'Daniel Kwan', ''],
  ['Parasite', 2019, 5, d(2023, 6, 18), 'Bong Joon-ho', 'The stairs do all the talking.'],
  ['The Zone of Interest', 2023, 4.5, d(2024, 2, 24), 'Jonathan Glazer', 'Sound design as moral indictment.'],
  ['Oppenheimer', 2023, 4, d(2023, 7, 23), 'Christopher Nolan', ''],
  ['Poor Things', 2023, 3.5, d(2024, 1, 20), 'Yorgos Lanthimos', ''],
  ['Aftersun', 2022, 4.5, d(2023, 3, 5), 'Charlotte Wells', 'Quietly devastating.'],
  ['Portrait of a Lady on Fire', 2019, 5, d(2023, 2, 12), 'Céline Sciamma', ''],
  ['Mad Max: Fury Road', 2015, 4.5, d(2023, 8, 9), 'George Miller', ''],
  ['Drive My Car', 2021, 4.5, d(2023, 4, 2), 'Ryusuke Hamaguchi', ''],
  ['The Social Network', 2010, 4.5, d(2023, 9, 30), 'David Fincher', ''],
  ['Whiplash', 2014, 4, d(2022, 12, 3), 'Damien Chazelle', ''],
  ['Blade Runner 2049', 2017, 5, d(2023, 10, 14), 'Denis Villeneuve', 'A sequel with no right to be this good.'],
  ['Anatomy of a Fall', 2023, 4.5, d(2024, 4, 6), 'Justine Triet', ''],
  ['Perfect Days', 2023, 4.5, d(2024, 5, 18), 'Wim Wenders', ''],
  ['Nope', 2022, 3.5, d(2022, 8, 20), 'Jordan Peele', ''],
  ['Tár', 2022, 4, d(2023, 1, 29), 'Todd Field', ''],
  ['La Haine', 1995, 4.5, d(2022, 7, 16), 'Mathieu Kassovitz', ''],
  ['In the Mood for Love', 2000, 5, d(2022, 5, 21), 'Wong Kar-wai', 'Every frame is a held breath.'],
  ['Children of Men', 2006, 4.5, d(2022, 10, 8), 'Alfonso Cuarón', ''],
  ['No Country for Old Men', 2007, 4.5, d(2022, 4, 2), 'Joel Coen', ''],
  ['Her', 2013, 4, d(2022, 2, 19), 'Spike Jonze', ''],
  ['Moonlight', 2016, 4.5, d(2021, 11, 27), 'Barry Jenkins', ''],
  ['Paddington 2', 2017, 4, d(2023, 12, 26), 'Paul King', 'Flawless. No notes.'],
  ['The Lighthouse', 2019, 3.5, d(2022, 1, 15), 'Robert Eggers', ''],
  ['Burning', 2018, 4.5, d(2021, 9, 11), 'Lee Chang-dong', ''],
  ['First Cow', 2019, 4, d(2021, 6, 5), 'Kelly Reichardt', ''],
  ['Memories of Murder', 2003, 4.5, d(2021, 3, 20), 'Bong Joon-ho', ''],
  ['Heat', 1995, 4.5, d(2021, 1, 9), 'Michael Mann', ''],
  ['Paris, Texas', 1984, 5, d(2020, 10, 17), 'Wim Wenders', ''],
  ['Chungking Express', 1994, 4, d(2020, 8, 22), 'Wong Kar-wai', ''],
  ['Stalker', 1979, 4.5, d(2020, 5, 30), 'Andrei Tarkovsky', ''],
  ['Spirited Away', 2001, 5, d(2020, 4, 11), 'Hayao Miyazaki', ''],
  ['The Grand Budapest Hotel', 2014, 4, d(2020, 2, 8), 'Wes Anderson', ''],
  ['Lost in Translation', 2003, 4, d(2019, 12, 14), 'Sofia Coppola', ''],
  ['Prisoners', 2013, 4, d(2019, 10, 26), 'Denis Villeneuve', ''],
  ['Sicario', 2015, 4, d(2019, 9, 7), 'Denis Villeneuve', ''],
  ['The Handmaiden', 2016, 4.5, d(2019, 7, 13), 'Park Chan-wook', ''],
]

write('letterboxd/diary.csv', csv(
  ['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Tags', 'Watched Date'],
  films.map(([t, y, r, date], i) => [date, t, y, boxd(t), r, i % 11 === 0 ? 'Yes' : '', i % 7 === 0 ? 'rewatch-pile' : '', date]),
))
write('letterboxd/ratings.csv', csv(
  ['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating'],
  films.map(([t, y, r, date]) => [date, t, y, boxd(t), r]),
))
write('letterboxd/reviews.csv', csv(
  ['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Review', 'Tags', 'Watched Date'],
  films.filter((f) => f[5]).map(([t, y, r, date, , review]) => [date, t, y, boxd(t), r, '', review, '', date]),
))
write('letterboxd/watchlist.csv', csv(
  ['Date', 'Name', 'Year', 'Letterboxd URI'],
  [
    ['2024-06-01', 'Hard Truths', 2024],
    ['2024-05-20', 'The Brutalist', 2024],
    ['2024-05-02', 'Flow', 2024],
    ['2024-04-11', 'All We Imagine as Light', 2024],
    ['2024-03-30', 'Close-Up', 1990],
    ['2024-02-02', 'A Separation', 2011],
    ['2024-01-07', 'Yi Yi', 2000],
    ['2023-12-19', 'Jeanne Dielman, 23 quai du Commerce, 1080 Bruxelles', 1975],
  ].map(([date, t, y], i) => [date, t, y, `https://boxd.it/w${i}`]),
))
write('letterboxd/lists/best-of-the-decade.csv', csv(
  ['Position', 'Name', 'Year', 'Letterboxd URI', 'Description'],
  [['1', 'Portrait of a Lady on Fire', 2019], ['2', 'Parasite', 2019], ['3', 'Burning', 2018],
   ['4', 'Moonlight', 2016], ['5', 'Arrival', 2016]].map(([p, t, y]) => [p, t, y, boxd(t), '']),
))

// ------------------------------------------------------------------ Goodreads
const books = [
  ['Piranesi', 'Clarke, Susanna', 'Susanna Clarke', '9781526622426', 5, d(2023, 4, 2), 2020, 'read', 272, 'Hardcover', 'A house that is a world. Read it in two sittings.'],
  ['Project Hail Mary', 'Weir, Andy', 'Andy Weir', '9780593135204', 4, d(2023, 1, 15), 2021, 'read', 476, 'Hardcover', ''],
  ['Klara and the Sun', 'Ishiguro, Kazuo', 'Kazuo Ishiguro', '9780571364879', 4, d(2022, 8, 19), 2021, 'read', 320, 'Paperback', ''],
  ['The Three-Body Problem', 'Liu, Cixin', 'Cixin Liu', '9780765377067', 4, d(2022, 3, 7), 2008, 'read', 400, 'Paperback', ''],
  ['Normal People', 'Rooney, Sally', 'Sally Rooney', '9780571334650', 4, d(2021, 7, 24), 2018, 'read', 266, 'Paperback', ''],
  ['A Little Life', 'Yanagihara, Hanya', 'Hanya Yanagihara', '9781447294832', 5, d(2021, 2, 11), 2015, 'read', 720, 'Paperback', 'Wrecked me for a fortnight.'],
  ['Station Eleven', 'Mandel, Emily St. John', 'Emily St. John Mandel', '9781447268970', 4.5, d(2020, 5, 6), 2014, 'read', 352, 'Paperback', ''],
  ['The Overstory', 'Powers, Richard', 'Richard Powers', '9781784708245', 4, d(2020, 9, 30), 2018, 'read', 502, 'Paperback', ''],
  ['Circe', 'Miller, Madeline', 'Madeline Miller', '9781408890042', 4, d(2021, 4, 18), 2018, 'read', 352, 'Paperback', ''],
  ['Shuggie Bain', 'Stuart, Douglas', 'Douglas Stuart', '9781529019278', 4.5, d(2022, 1, 29), 2020, 'read', 430, 'Paperback', ''],
  ['The Remains of the Day', 'Ishiguro, Kazuo', 'Kazuo Ishiguro', '9780571258246', 5, d(2019, 11, 12), 1989, 'read', 258, 'Paperback', ''],
  ['Never Let Me Go', 'Ishiguro, Kazuo', 'Kazuo Ishiguro', '9780571258093', 5, d(2019, 6, 3), 2005, 'read', 282, 'Paperback', ''],
  ['Exhalation', 'Chiang, Ted', 'Ted Chiang', '9781529014471', 4.5, d(2023, 8, 14), 2019, 'read', 350, 'Paperback', 'Chiang writes thought experiments with a pulse.'],
  ['The Secret History', 'Tartt, Donna', 'Donna Tartt', '9780140167771', 4.5, d(2020, 1, 21), 1992, 'read', 629, 'Paperback', ''],
  ['Tomorrow, and Tomorrow, and Tomorrow', 'Zevin, Gabrielle', 'Gabrielle Zevin', '9781784744588', 4, d(2023, 6, 25), 2022, 'read', 416, 'Hardcover', ''],
  ['Demon Copperhead', 'Kingsolver, Barbara', 'Barbara Kingsolver', '9780571376483', 4.5, d(2023, 11, 8), 2022, 'read', 560, 'Hardcover', ''],
  ['Babel', 'Kuang, R. F.', 'R. F. Kuang', '9780008501815', 3.5, d(2024, 2, 3), 2022, 'read', 560, 'Hardcover', ''],
  ['The Road', 'McCarthy, Cormac', 'Cormac McCarthy', '9780330468466', 4.5, d(2019, 3, 17), 2006, 'read', 307, 'Paperback', ''],
  ['Cloud Atlas', 'Mitchell, David', 'David Mitchell', '9780340822784', 4, d(2018, 10, 9), 2004, 'read', 529, 'Paperback', ''],
  ['Pachinko', 'Lee, Min Jin', 'Min Jin Lee', '9781784161880', 4.5, d(2022, 11, 20), 2017, 'read', 490, 'Paperback', ''],
  ['Orbital', 'Harvey, Samantha', 'Samantha Harvey', '9781787333314', 0, '', 2023, 'currently-reading', 136, 'Hardcover', ''],
  ['Lonesome Dove', 'McMurtry, Larry', 'Larry McMurtry', '9780330351270', 0, '', 1985, 'to-read', 960, 'Paperback', 'Recommended by three different people now.'],
  ['The Dispossessed', 'Le Guin, Ursula K.', 'Ursula K. Le Guin', '9781857988826', 0, '', 1974, 'to-read', 341, 'Paperback', ''],
  ['The Bee Sting', 'Murray, Paul', 'Paul Murray', '9780241353714', 0, '', 2023, 'to-read', 656, 'Hardcover', ''],
  ['2666', 'Bolaño, Roberto', 'Roberto Bolaño', '9780330447423', 0, '', 2004, 'to-read', 898, 'Paperback', ''],
]
write('goodreads_library_export.csv', csv(
  ['Book Id', 'Title', 'Author', 'Author l-f', 'Additional Authors', 'ISBN', 'ISBN13', 'My Rating',
   'Average Rating', 'Publisher', 'Binding', 'Number of Pages', 'Year Published', 'Original Publication Year',
   'Date Read', 'Date Added', 'Bookshelves', 'Bookshelves with positions', 'Exclusive Shelf', 'My Review',
   'Spoiler', 'Private Notes', 'Read Count', 'Owned Copies'],
  books.map(([t, lf, name, isbn13, rating, read, year, shelf, pages, binding, review], i) => [
    700000 + i, t, name, lf, '', '', `="${isbn13}"`, rating || '', (3.8 + (i % 9) / 10).toFixed(2),
    'Faber & Faber', binding, pages, year, year, read || '', d(2018 + (i % 6), 1 + (i % 12), 1 + (i % 27)),
    shelf === 'read' ? (i % 4 === 0 ? 'favourites' : '') : shelf, '', shelf, review, '', '',
    shelf === 'read' ? (i % 9 === 0 ? 2 : 1) : 0, 1,
  ]),
))

// -------------------------------------------------------------------- Audible
const audiobooks = [
  ['Sapiens: A Brief History of Humankind', 'Yuval Noah Harari', 'Derek Perkins', '15 hrs and 17 mins', 5, 'Yes', d(2023, 2, 20), 'B0BZNK9DLF'],
  ['Educated', 'Tara Westover', 'Julia Whelan', '12 hrs and 10 mins', 5, 'Yes', d(2022, 6, 11), 'B078Y5F1BX'],
  ['Project Hail Mary', 'Andy Weir', 'Ray Porter', '16 hrs and 10 mins', 5, 'Yes', d(2023, 1, 8), 'B08GB58KD5'],
  ['Dune', 'Frank Herbert', 'Scott Brick, Orlagh Cassidy', '21 hrs and 2 mins', 4, 'Yes', d(2021, 9, 14), 'B002V1OF70'],
  ['Atomic Habits', 'James Clear', 'James Clear', '5 hrs and 35 mins', 3, 'Yes', d(2022, 1, 30), 'B07RFSSYBH'],
  ['Lessons in Chemistry', 'Bonnie Garmus', 'Miranda Raison', '11 hrs and 55 mins', 4, 'Yes', d(2023, 7, 2), 'B09BNJGT3Z'],
  ['Wolf Hall', 'Hilary Mantel', 'Dan Stevens', '24 hrs and 7 mins', 4.5, 'Yes', d(2024, 3, 16), 'B0043RSGJ6'],
  ['Born a Crime', 'Trevor Noah', 'Trevor Noah', '8 hrs and 44 mins', 4.5, 'Yes', d(2022, 11, 5), 'B01IW9W3K0'],
  ['The Thursday Murder Club', 'Richard Osman', 'Lesley Manville', '12 hrs and 23 mins', 3.5, 'Yes', d(2023, 10, 21), 'B0863KPDMZ'],
  ['Piranesi', 'Susanna Clarke', 'Chiwetel Ejiofor', '6 hrs and 55 mins', 5, 'Yes', d(2024, 1, 11), 'B0892N7JDG'],
  ['The Anthropocene Reviewed', 'John Green', 'John Green', '9 hrs and 46 mins', 0, 'No', '', 'B08TL1XJ5R'],
  ['Cloud Cuckoo Land', 'Anthony Doerr', 'Marin Ireland', '14 hrs and 51 mins', 0, 'No', '', 'B092HJGZ8K'],
]
write('Audible.Library.csv', csv(
  ['Title', 'Author', 'Narrator', 'Length', 'My Rating', 'Is Finished', 'Date Finished', 'ASIN',
   'Percent Complete', 'Date Added', 'Publisher', 'Category'],
  audiobooks.map(([t, a, n, len, rating, finished, finishedDate, asin], i) => [
    t, a, n, len, rating || '', finished, finishedDate, asin,
    finished === 'Yes' ? 100 : i % 2 ? 34 : 0, d(2021 + (i % 4), 1 + (i % 12), 2 + (i % 26)),
    'Penguin Audio', i % 3 ? 'Nonfiction > History' : 'Fiction > Literary',
  ]),
))

// ----------------------------------------------------------------------- IMDb
write('imdb_ratings.csv', csv(
  ['Const', 'Your Rating', 'Date Rated', 'Title', 'Original Title', 'URL', 'Title Type', 'IMDb Rating',
   'Runtime (mins)', 'Year', 'Genres', 'Num Votes', 'Release Date', 'Directors'],
  [
    ['tt15398776', 9, d(2023, 7, 24), 'Oppenheimer', 'movie', 8.3, 180, 2023, 'Biography, Drama, History', 780000, 'Christopher Nolan'],
    ['tt0816692', 9, d(2022, 4, 2), 'Interstellar', 'movie', 8.7, 169, 2014, 'Adventure, Drama, Sci-Fi', 2100000, 'Christopher Nolan'],
    ['tt0468569', 10, d(2021, 5, 15), 'The Dark Knight', 'movie', 9.0, 152, 2008, 'Action, Crime, Drama', 2900000, 'Christopher Nolan'],
    ['tt1375666', 8, d(2021, 3, 9), 'Inception', 'movie', 8.8, 148, 2010, 'Action, Adventure, Sci-Fi', 2500000, 'Christopher Nolan'],
    ['tt11280740', 10, d(2024, 4, 1), 'Severance', 'tvSeries', 8.7, 55, 2022, 'Drama, Mystery, Sci-Fi', 240000, 'Ben Stiller'],
    ['tt7366338', 10, d(2020, 6, 12), 'Chernobyl', 'tvMiniSeries', 9.3, 330, 2019, 'Drama, History, Thriller', 890000, 'Johan Renck'],
  ].map(([c, r, date, t, type, imdbR, run, y, g, votes, dir]) => [
    c, r, date, t, t, `https://www.imdb.com/title/${c}/`, type, imdbR, run, y, g, votes, `${y}-01-01`, dir,
  ]),
))

// ---------------------------------------------------------------------- Trakt
const shows = [
  ['Severance', 2022, 'tt11280740', 10, [[1, 9], [2, 10]]],
  ['The Bear', 2022, 'tt14452776', 9, [[1, 8], [2, 10], [3, 10]]],
  ['Succession', 2018, 'tt7660850', 10, [[1, 10], [2, 10], [3, 9], [4, 10]]],
  ['Better Call Saul', 2015, 'tt3032476', 10, [[6, 13]]],
  ['Chernobyl', 2019, 'tt7366338', 10, [[1, 5]]],
  ['The Leftovers', 2014, 'tt2699128', 9, [[3, 8]]],
  ['Fleabag', 2016, 'tt5687612', 9, [[2, 6]]],
  ['Dark', 2017, 'tt5753856', 8, [[1, 10], [2, 8]]],
  ['Andor', 2022, 'tt9253284', 9, [[1, 12]]],
  ['Shōgun', 2024, 'tt2788316', 9, [[1, 10]]],
  ['Slow Horses', 2022, 'tt5057054', 8, [[1, 6], [2, 6]]],
  ['I May Destroy You', 2020, 'tt9174558', 9, [[1, 12]]],
  ['Atlanta', 2016, 'tt4288182', 8, [[1, 10]]],
  ['The Wire', 2002, 'tt0306414', 10, [[4, 13]]],
]
write('trakt_watched_shows.json', JSON.stringify(shows.map(([title, year, imdb, rating, seasons], i) => ({
  plays: seasons.reduce((a, [, eps]) => a + eps, 0),
  last_watched_at: `${d(2023 + (i % 2), 1 + (i % 12), 3 + (i % 24))}T21:40:00.000Z`,
  rating,
  show: { title, year, ids: { trakt: 1000 + i, slug: slug(title), imdb, tmdb: 90000 + i } },
  seasons: seasons.map(([number, eps]) => ({
    number,
    episodes: Array.from({ length: eps }, (_, e) => ({
      number: e + 1,
      plays: 1,
      last_watched_at: `${d(2023 + (i % 2), 1 + (i % 12), 1 + ((e * 2) % 27))}T21:40:00.000Z`,
    })),
  })),
})), null, 1))

// -------------------------------------------------------------------- Spotify
const albums = [
  ['Wolf Alice', 'Blue Weekend', 11], ['Radiohead', 'In Rainbows', 10], ['Fontaines D.C.', 'Romance', 11],
  ['Big Thief', 'Dragon New Warm Mountain I Believe In You', 20], ['Little Simz', 'Sometimes I Might Be Introvert', 19],
  ['Nick Drake', 'Pink Moon', 11], ['Beach House', 'Once Twice Melody', 18], ['SAULT', 'Untitled (Rise)', 14],
  ['Kendrick Lamar', 'To Pimp a Butterfly', 16], ['Jessica Pratt', 'Here in the Pitch', 9],
  ['Khruangbin', 'A LA SALA', 12], ['Arooj Aftab', 'Vulture Prince', 8], ['Bon Iver', 'For Emma, Forever Ago', 9],
  ['Caroline Polachek', 'Desire, I Want to Turn Into You', 12], ['Black Country, New Road', 'Ants From Up There', 10],
  ['The National', 'First Two Pages of Frankenstein', 11], ['Tirzah', 'Colourgrade', 10],
  ['Floating Points', 'Cascade', 10], ['Four Tet', 'Three', 9], ['Mdou Moctar', 'Funeral for Justice', 9],
]
const history = []
let day = new Date('2024-01-03T19:00:00Z')
for (const [artist, album, tracks] of albums) {
  const listens = 2 + (album.length % 4)
  for (let l = 0; l < listens; l++) {
    for (let t = 1; t <= tracks; t++) {
      if ((t + l) % 5 === 0) continue
      day = new Date(day.getTime() + 3.6e6 + t * 1000)
      history.push({
        ts: day.toISOString(),
        platform: 'Linux', ms_played: 180000 + ((t * 7919) % 120000), conn_country: 'GB',
        master_metadata_track_name: `${album} — Track ${t}`,
        master_metadata_album_artist_name: artist,
        master_metadata_album_album_name: album,
        spotify_track_uri: `spotify:track:${slug(artist).slice(0, 6)}${t}${l}`,
        reason_start: 'trackdone', reason_end: 'trackdone', shuffle: false, skipped: false, offline: false,
      })
    }
  }
}
for (const [showName, episodes] of [['The Rest Is History', 14], ['Blindboy Podcast', 9], ['99% Invisible', 11]]) {
  for (let e = 1; e <= episodes; e++) {
    day = new Date(day.getTime() + 8.6e6)
    history.push({
      ts: day.toISOString(), platform: 'iOS', ms_played: 2_700_000, conn_country: 'GB',
      master_metadata_track_name: null, master_metadata_album_artist_name: null, master_metadata_album_album_name: null,
      episode_name: `${showName} ep.${e}`, episode_show_name: showName,
      spotify_episode_uri: `spotify:episode:${slug(showName)}${e}`,
    })
  }
}
write('spotify/Streaming_History_Audio_2024_1.json', JSON.stringify(history))
write('spotify/YourLibrary.json', JSON.stringify({
  tracks: [], artists: [],
  albums: [
    { artist: 'Nala Sinephro', album: 'Endlessness', uri: 'spotify:album:aaa111' },
    { artist: 'MJ Lenderman', album: 'Manning Fireworks', uri: 'spotify:album:bbb222' },
    { artist: 'Tyler, The Creator', album: 'CHROMAKOPIA', uri: 'spotify:album:ccc333' },
  ],
  shows: [{ name: 'Song Exploder', publisher: 'Hrishikesh Hirway' }],
}, null, 1))

// -------------------------------------------------------------------- Netflix
write('NetflixViewingHistory.csv', csv(['Title', 'Date'], [
  ['Slow Horses: Season 2: Negotiating with Tigers', '15/03/2024'],
  ['Slow Horses: Season 2: From Upshott with Love', '14/03/2024'],
  ['Bodies: Limited Series: Episode 1', '02/11/2023'],
  ['Bodies: Limited Series: Episode 2', '03/11/2023'],
  ['The Diplomat: Season 1: The Dogcatcher', '21/04/2023'],
  ['Glass Onion: A Knives Out Mystery', '27/12/2022'],
  ['The Social Network', '30/09/2023'],
]))

console.log('\nSamples ready.')
