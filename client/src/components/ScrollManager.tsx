import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * Where a page should be scrolled to when you arrive at it.
 *
 * Opening a book was landing you halfway down it, on "more like this",
 * because nothing reset the scroll position between pages — you simply kept
 * whatever offset the library grid had.
 *
 * Going somewhere new starts at the top. Going *back* returns you to where
 * you were, which is the behaviour that matters when you are working down a
 * long list: open the fourth film, press back, and the fourth film is still
 * under your thumb.
 */
export function ScrollManager() {
  const { key, pathname } = useLocation()
  const navigationType = useNavigationType()
  const offsets = useRef(new Map<string, number>())
  const current = useRef(key)

  // Remember where this page is as it is scrolled, so going back can return.
  useEffect(() => {
    current.current = key
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        offsets.current.set(current.current, window.scrollY)
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [key])

  useEffect(() => {
    if (navigationType === 'POP') {
      const saved = offsets.current.get(key)
      if (saved != null) {
        /*
         * The list may still be loading, so the page can be too short to
         * scroll that far yet. Try now, then again once more has rendered.
         */
        const restore = () => window.scrollTo(0, saved)
        restore()
        const t1 = requestAnimationFrame(restore)
        const t2 = setTimeout(restore, 120)
        return () => { cancelAnimationFrame(t1); clearTimeout(t2) }
      }
    }
    window.scrollTo(0, 0)
  }, [key, pathname, navigationType])

  return null
}
