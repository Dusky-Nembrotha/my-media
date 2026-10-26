/**
 * Small, dependency-free RFC4180-ish CSV parser.
 * Handles quoted fields, embedded commas/newlines, escaped quotes, BOM,
 * and CRLF. Also sniffs the delimiter (comma, semicolon or tab).
 */

export function sniffDelimiter(text) {
  const line = text.slice(0, 5000).split(/\r?\n/)[0] || ''
  const counts = { ',': 0, ';': 0, '\t': 0 }
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && ch in counts) counts[ch]++
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ','
}

export function parseCsv(input, delimiter) {
  let text = String(input)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const d = delimiter || sniffDelimiter(text)

  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === d) { row.push(field); field = ''; i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += ch; i++
  }
  row.push(field)
  rows.push(row)

  // drop trailing blank line(s)
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop()
  return rows
}

/** Parse to array of objects keyed by header, plus the raw header list. */
export function parseCsvObjects(input, delimiter) {
  const rows = parseCsv(input, delimiter)
  if (!rows.length) return { headers: [], rows: [] }
  const headers = rows[0].map((h) => h.trim())
  const out = []
  for (let r = 1; r < rows.length; r++) {
    const obj = {}
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = (rows[r][c] ?? '').trim()
    out.push(obj)
  }
  return { headers, rows: out }
}

export function toCsv(headers, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return [headers.map(esc).join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n')
}

/**
 * Case/space/punctuation-insensitive column lookup.
 * pick(row, ['my rating', 'rating']) finds "My Rating", "rating10", "Rating ".
 */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

export function columnIndex(headers) {
  const map = new Map()
  for (const h of headers) {
    const k = norm(h)
    if (!map.has(k)) map.set(k, h)
  }
  return map
}

export function pick(row, names, index) {
  const map = index || columnIndex(Object.keys(row))
  for (const name of names) {
    const key = map.get(norm(name))
    if (key != null) {
      const v = row[key]
      if (v != null && String(v).trim() !== '') return String(v).trim()
    }
  }
  return ''
}

export function hasColumns(headers, names) {
  const map = columnIndex(headers)
  return names.every((n) => map.has(norm(n)))
}

export function hasAnyColumn(headers, names) {
  const map = columnIndex(headers)
  return names.some((n) => map.has(norm(n)))
}
