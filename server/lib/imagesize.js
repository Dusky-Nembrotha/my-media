/**
 * Reads an image's dimensions from its first few kilobytes, so artwork can be
 * judged on quality without downloading the whole file.
 */

function pngSize(buf) {
  if (buf.length < 24) return null
  if (buf.readUInt32BE(0) !== 0x89504e47) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function gifSize(buf) {
  if (buf.length < 10 || buf.toString('ascii', 0, 3) !== 'GIF') return null
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
}

function webpSize(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null
  const type = buf.toString('ascii', 12, 16)
  if (type === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
  if (type === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  if (type === 'VP8L') {
    const b = buf.readUInt32LE(21)
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
  }
  return null
}

function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue }
    const marker = buf[i + 1]
    // SOF0–SOF15, excluding the markers that are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return null
}

export function dimensionsFrom(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  return pngSize(buf) || gifSize(buf) || webpSize(buf) || jpegSize(buf)
}

/**
 * Fetch just enough of an image to measure it. JPEG frame headers can sit a
 * little way in, so we take 64KB and give up rather than download the lot.
 */
export async function measureImage(url, { timeout = 8000 } = {}) {
  if (!url) return null
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-65535', 'User-Agent': 'Shelved/0.1' },
      signal: AbortSignal.timeout(timeout),
    })
    if (!res.ok && res.status !== 206) return { url, ok: false, status: res.status }
    const buf = Buffer.from(await res.arrayBuffer())
    const size = dimensionsFrom(buf)
    const total = Number(res.headers.get('content-range')?.split('/')?.[1] || res.headers.get('content-length') || 0)
    return { url, ok: true, bytes: total || buf.length, ...(size || {}) }
  } catch {
    return { url, ok: false }
  }
}

/*
 * The hero poster renders about 206px wide, which wants ~420px on a
 * high-density screen before it starts to look upscaled.
 */
export const MIN_POSTER_WIDTH = 420

export function qualityOf(measured) {
  if (!measured?.ok || !measured.width) return 'unknown'
  if (measured.width < 200) return 'poor'
  if (measured.width < MIN_POSTER_WIDTH) return 'low'
  if (measured.width < 700) return 'fine'
  return 'good'
}
