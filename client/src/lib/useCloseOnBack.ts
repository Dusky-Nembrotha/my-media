import { useEffect, useRef } from 'react'

/**
 * Make the back gesture close an overlay instead of leaving the page.
 *
 * On a phone, back is how you dismiss things. Without this, opening search and
 * pressing back throws away whatever you were looking at.
 *
 * The approach is to push a history entry when the overlay opens, so there is
 * something for back to pop, and to pop it again if the overlay is closed any
 * other way — leaving the stack as it was found.
 *
 * The subtlety is that `history.back()` is asynchronous. One overlay closing
 * to open another — tapping Add in the search results — would queue a back(),
 * then the new dialog would mount and push its own entry, and the queued
 * back() would land on the *new* dialog and shut it instantly. So each entry
 * is tagged, and the tidy-up only happens if the entry being removed is still
 * our own by the time it runs.
 */
let nextId = 1

export function useCloseOnBack(open: boolean, close: () => void) {
  // Kept in a ref so a new closure each render does not re-run the effect and
  // push a second history entry.
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (!open) return

    const id = nextId++
    let poppedByBack = false
    window.history.pushState({ ...window.history.state, shelvedOverlay: id }, '')

    const onPop = () => {
      poppedByBack = true
      closeRef.current()
    }
    window.addEventListener('popstate', onPop)

    return () => {
      window.removeEventListener('popstate', onPop)
      if (poppedByBack) return

      /*
       * Deferred, and checked again when it runs: by then another overlay may
       * have opened on top of ours, in which case the entry at the top is
       * theirs and going back would close it rather than tidying up after us.
       * Something that closed by navigating has likewise replaced the state,
       * and going back there would undo the navigation.
       */
      setTimeout(() => {
        if (window.history.state?.shelvedOverlay === id) window.history.back()
      }, 0)
    }
  }, [open])
}
