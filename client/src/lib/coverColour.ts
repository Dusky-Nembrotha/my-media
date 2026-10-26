/**
 * Pulls a couple of representative colours out of a cover image so the page
 * behind it can take its cue from the artwork.
 *
 * Works because artwork is served from our own origin — a cross-origin image
 * would taint the canvas and make getImageData throw.
 */
export interface CoverColours { base: string; accent: string }

const cache = new Map<string, CoverColours>()

export async function coverColours(src: string): Promise<CoverColours | null> {
  if (!src) return null
  const hit = cache.get(src)
  if (hit) return hit

  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = src
    await img.decode()

    const size = 32                       // plenty for an average
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, size, size)
    const { data } = ctx.getImageData(0, 0, size, size)

    let r = 0, g = 0, b = 0, n = 0
    let bestR = 0, bestG = 0, bestB = 0, bestScore = -1

    for (let i = 0; i < data.length; i += 4) {
      const [pr, pg, pb, pa] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
      if (pa < 128) continue
      r += pr; g += pg; b += pb; n++

      // Favour a colour with some life in it for the accent: saturated, and
      // neither nearly black nor nearly white.
      const max = Math.max(pr, pg, pb)
      const min = Math.min(pr, pg, pb)
      const sat = max === 0 ? 0 : (max - min) / max
      const lum = (max + min) / 2
      const score = sat * 255 - Math.abs(lum - 128) * 0.9
      if (score > bestScore) { bestScore = score; bestR = pr; bestG = pg; bestB = pb }
    }
    if (!n) return null

    const result: CoverColours = {
      base: `${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)}`,
      accent: `${bestR}, ${bestG}, ${bestB}`,
    }
    cache.set(src, result)
    return result
  } catch {
    return null
  }
}
