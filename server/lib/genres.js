/*
 * Genre lists that are worth reading.
 *
 * Shared by the library shelves, the chart and the suggestions, so a genre is
 * named the same way wherever it is offered.
 */
import { uselessSubject } from '../recommend.js'

/*
 * Fold a shelf's genres down to the ones worth offering.
 *
 * Open Library files one fantasy novel under "Fantasy", "Fantasy fiction",
 * "Epic Fantasy", "Fiction, fantasy, general" and "Fiction, fantasy, epic",
 * which is five entries in a dropdown for one idea and left no room for the
 * rest. Where every word of a shorter label appears in a longer one they are
 * the same shelf, and the short name is the one people would think to pick.
 *
 * Folding only the labels is enough: filtering already matches genres by
 * substring, so choosing "Fantasy" still finds everything filed under the
 * longer names.
 */
/*
 * Words that describe the shelf rather than anything on it. Open Library
 * files plenty of these as subjects, and "Books" is not a genre of book.
 */
const NOT_A_GENRE = /^(books?|literature|fiction|non-?fiction|general|miscellaneous|anthologies|collections?|readers?|texts?|series)$/i

/*
 * Genres whose names contain another genre and mean something else entirely.
 *
 * "Fantasy fiction" is fantasy, so folding it in is right. "Science fiction"
 * is not science, and folding it in filed Abhorsen under the same heading as
 * a book about beavers. Structurally the two look identical — a genre plus
 * the word fiction — so no rule separates them and they have to be named.
 */
const COMPOUND = new Set([
  'science fiction', 'historical fiction', 'crime fiction', 'literary fiction',
  'speculative fiction', 'detective fiction', 'war fiction', 'graphic novel',
])

const words = (g) => String(g).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const tidy = (g) => String(g).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function foldGenres(counts, titles = new Set()) {
  const entries = [...counts.entries()]
    .filter(([g]) => !uselessSubject(g))
    /*
     * Junk whole, and junk in parts: Open Library writes "Fiction / General",
     * which is two shelf words with a slash between them and says no more
     * than either alone.
     */
    .filter(([g]) => !NOT_A_GENRE.test(String(g).trim()))
    .filter(([g]) => !words(g).every((w) => NOT_A_GENRE.test(w)))
    /*
     * A series is not a genre. Open Library files Dune's sequels under the
     * subject "Dune", which then sat in the genre list between Fantasy and
     * Science fiction as though it were one.
     */
    .filter(([g]) => !titles.has(String(g).trim().toLowerCase()))
    .sort((a, b) => words(a[0]).length - words(b[0]).length || a[0].length - b[0].length)

  const kept = []
  for (const [label, count] of entries) {
    const mine = words(label)
    const protectedName = COMPOUND.has(tidy(label))
    // A compound genre stands on its own, and nothing folds into it either.
    const into = protectedName
      ? kept.find((k) => tidy(k.label) === tidy(label))
      : kept.find((k) => !k.protectedName && k.words.every((w) => mine.includes(w)))
    if (into) into.count += count
    else kept.push({ label, words: mine, count, protectedName })
  }
  return kept.sort((a, b) => b.count - a.count)
}

/**
 * The genres present in a set of things, folded and counted.
 *
 * `titles` is what the caller already owns or is showing, so a series name
 * filed as a subject can be recognised for what it is.
 */
export function genreFacets(items, titles = new Set()) {
  const counts = new Map()
  for (const it of items || []) {
    for (const g of it?.genres || []) {
      if (!g) continue
      counts.set(g, (counts.get(g) || 0) + 1)
    }
  }
  /*
   * Counted by the same rule that filters, so the number means what it says.
   * Folding alone gave "Science fiction (11)" on a choice that then returned
   * sixteen, because the filter matches by substring and the fold did not.
   */
  const list = []
  for (const { label } of foldGenres(counts, titles)) {
    const count = (items || []).filter((it) => matchesGenre(it, label)).length
    if (count) list.push({ name: label, count })
  }
  return list.sort((a, b) => b.count - a.count)
}

/** Does a thing belong under the genre someone picked? */
export function matchesGenre(item, genre) {
  if (!genre) return true
  const want = String(genre).toLowerCase()
  return (item?.genres || []).some((g) => String(g).toLowerCase().includes(want))
}

export { foldGenres }
