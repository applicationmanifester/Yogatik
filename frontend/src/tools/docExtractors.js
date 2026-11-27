/**
 * Universal Client-Side Document & File Extractor
 *
 * Supports:
 * - PDF: Layout-aware digital text + per-page scanned/image OCR fallback
 * - Microsoft Word (.docx) & OpenDocument (.odt) & Rich Text (.rtf)
 * - Microsoft Excel (.xlsx, .xls, .xlsm, .xlsb, .ods): Markdown tables / CSV per sheet
 * - PowerPoint (.pptx, .odp): Paragraph-grouped slides, tables, and speaker notes
 * - E-books (.epub): Chapter text extraction via OPF spine
 * - Images (.png, .jpg, .jpeg, .webp, .bmp, .tiff, .gif, .svg): OCR + visual layout metadata
 * - Data & Config: CSV, TSV, JSON, JSONL, XML, YAML, TOML, INI, ENV, SQL
 * - Programming Languages & Markdown: MD, JS, TS, Python, Java, C, C++, C#, Go, Rust, etc.
 * - Universal Text Fallback: Any text-encoded file (checked via byte inspection for null characters)
 */

const CODE_OR_TEXT_EXTS = new Set([
  'txt', 'text', 'md', 'markdown', 'mdx', 'log', 'csv', 'tsv', 'json', 'jsonl', 'ndjson',
  'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'conf', 'cfg', 'properties', 'plist',
  'html', 'htm', 'xhtml', 'svg', 'css', 'scss', 'sass', 'less', 'vue', 'svelte',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'pyw', 'java', 'c', 'cpp', 'cc', 'cxx',
  'h', 'hpp', 'hh', 'cs', 'go', 'rs', 'php', 'rb', 'sh', 'bash', 'zsh', 'ps1',
  'bat', 'cmd', 'sql', 'r', 'swift', 'kt', 'kts', 'dart', 'scala', 'lua', 'pl', 'pm',
  'graphql', 'gql', 'proto', 'diff', 'patch', 'dockerfile', 'makefile',
  'srt', 'vtt', 'sub', 'rst', 'adoc', 'asciidoc', 'tex', 'latex', 'bib', 'eml'
])

const KNOWN_TEXT_BASENAMES = new Set([
  'dockerfile', 'makefile', 'gemfile', 'rakefile', 'procfile', 'license', 'licence',
  'readme', 'authors', 'contributors', 'changelog', 'install'
])

async function loadScript(urls, globalVar) {
  if (typeof window !== 'undefined' && window[globalVar]) return window[globalVar]
  if (typeof document === 'undefined') throw new Error(`Script loading requires DOM environment: ${globalVar}`)

  for (const url of urls) {
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script')
        s.src = url
        s.onload = resolve
        s.onerror = () => reject(new Error(`Failed to load ${url}`))
        document.head.appendChild(s)
      })
      if (window[globalVar]) return window[globalVar]
    } catch {
      // try next CDN fallback
    }
  }
  throw new Error(`Could not load ${globalVar} from CDN mirrors.`)
}

/** Extract text from PDF (digital layer + per-page scanned OCR fallback) */
export async function extractPdf(file, options = {}) {
  const { pdfExtractTool } = await import('./pdfExtract')
  const url = URL.createObjectURL(file)
  try {
    const res = await pdfExtractTool.execute({
      url,
      maxPages: options.maxPages ?? 100,
      startPage: options.startPage ?? 1,
      endPage: options.endPage,
      ocrFallback: options.ocrFallback ?? true,
    })
    if (!res?.text?.trim()) {
      throw new Error(res?.error || 'No extractable text or OCR content found in this PDF.')
    }
    return res.text.trim()
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function getJsZip() {
  try {
    const mod = await import('jszip')
    return mod.default || mod
  } catch {
    return loadScript([
      'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
      'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
      'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js'
    ], 'JSZip')
  }
}

async function getXlsx() {
  try {
    const mod = await import('xlsx')
    return mod.default || mod
  } catch {
    return loadScript([
      'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
      'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
      'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js'
    ], 'XLSX')
  }
}

function parseXml(xmlText) {
  if (typeof DOMParser !== 'undefined') {
    return new DOMParser().parseFromString(xmlText, 'text/xml')
  }
  throw new Error('XML parser (DOMParser) is unavailable in this environment.')
}

function extractParagraphText(p) {
  const texts = p.getElementsByTagName('w:t')
  let line = ''
  for (let j = 0; j < texts.length; j++) {
    line += texts[j].textContent || ''
  }
  return line.trim()
}

function headingPrefixFor(p) {
  const styles = p.getElementsByTagName('w:pStyle')
  if (styles.length) {
    const val = styles[0].getAttribute('w:val') || styles[0].getAttribute('val') || ''
    const m = val.match(/^Heading([1-6])$/i)
    if (m) return `${'#'.repeat(Number(m[1]))} `
    if (/^Title$/i.test(val)) return '# '
    if (/^Subtitle$/i.test(val)) return '## '
  }
  const numPr = p.getElementsByTagName('w:numPr')
  if (numPr.length) return '- '
  return ''
}

function extractTableMarkdown(tbl) {
  const rows = []
  const trs = tbl.getElementsByTagName('w:tr')
  for (let r = 0; r < trs.length; r++) {
    const tcs = trs[r].getElementsByTagName('w:tc')
    const cells = []
    for (let c = 0; c < tcs.length; c++) {
      const ps = tcs[c].getElementsByTagName('w:p')
      const parts = []
      for (let k = 0; k < ps.length; k++) {
        const t = extractParagraphText(ps[k])
        if (t) parts.push(t)
      }
      cells.push(parts.join(' ').replace(/\|/g, '\\|'))
    }
    if (cells.some(Boolean)) rows.push(cells)
  }
  if (!rows.length) return ''
  const cols = Math.max(...rows.map(r => r.length))
  const pad = (r) => {
    const out = r.slice()
    while (out.length < cols) out.push('')
    return `| ${out.join(' | ')} |`
  }
  const sep = `| ${Array(cols).fill('---').join(' | ')} |`
  return [pad(rows[0]), sep, ...rows.slice(1).map(pad)].join('\n')
}

/** Extract structured text, headings, and tables from a Word (.docx) ArrayBuffer */
export async function extractDocxFromBuffer(arrayBuffer) {
  const JSZip = await getJsZip()
  const zip = await JSZip.loadAsync(arrayBuffer)
  const docXml = zip.file('word/document.xml')
  if (!docXml) throw new Error('Invalid Word document: word/document.xml not found')

  const doc = parseXml(await docXml.async('text'))
  const body = doc.getElementsByTagName('w:body')[0] || doc.documentElement
  const blocks = []

  const children = body?.childNodes || []
  for (let i = 0; i < children.length; i++) {
    const node = children[i]
    const name = node.nodeName || node.tagName || ''
    if (name === 'w:p') {
      const text = extractParagraphText(node)
      if (text) blocks.push(`${headingPrefixFor(node)}${text}`)
    } else if (name === 'w:tbl') {
      const mdTable = extractTableMarkdown(node)
      if (mdTable) blocks.push(mdTable)
    }
  }

  // Fallback if document.xml used a non-standard body wrapper
  if (!blocks.length) {
    const paragraphs = doc.getElementsByTagName('w:p')
    for (let i = 0; i < paragraphs.length; i++) {
      const text = extractParagraphText(paragraphs[i])
      if (text) blocks.push(`${headingPrefixFor(paragraphs[i])}${text}`)
    }
  }

  const resultParts = [blocks.join('\n\n')]

  // Optional headers, footers, footnotes, and comments
  const extraFiles = [
    ...Object.keys(zip.files).filter(n => /^word\/header\d*\.xml$/i.test(n)).sort(),
    ...Object.keys(zip.files).filter(n => /^word\/footer\d*\.xml$/i.test(n)).sort(),
  ]
  const extraNotes = []
  for (const ef of extraFiles) {
    try {
      const eDoc = parseXml(await zip.file(ef).async('text'))
      const ps = eDoc.getElementsByTagName('w:p')
      const lines = []
      for (let i = 0; i < ps.length; i++) {
        const t = extractParagraphText(ps[i])
        if (t) lines.push(t)
      }
      if (lines.length) {
        const tag = ef.includes('header') ? 'Header' : 'Footer'
        extraNotes.push(`[${tag}] ${lines.join(' | ')}`)
      }
    } catch { /* ignore malformed header/footer */ }
  }

  for (const [notePath, label] of [['word/footnotes.xml', 'Footnotes'], ['word/comments.xml', 'Comments']]) {
    if (zip.file(notePath)) {
      try {
        const nDoc = parseXml(await zip.file(notePath).async('text'))
        const ps = nDoc.getElementsByTagName('w:p')
        const lines = []
        for (let i = 0; i < ps.length; i++) {
          const t = extractParagraphText(ps[i])
          if (t) lines.push(`- ${t}`)
        }
        if (lines.length) extraNotes.push(`### ${label}\n${lines.join('\n')}`)
      } catch { /* ignore */ }
    }
  }

  if (extraNotes.length) resultParts.push(extraNotes.join('\n\n'))

  const result = resultParts.filter(Boolean).join('\n\n')
  if (!result.trim()) {
    throw new Error('Word document contains no readable text.')
  }
  return result
}

/** Extract text from Word (.docx) files */
export async function extractDocx(file) {
  return extractDocxFromBuffer(await readBlobAsArrayBuffer(file))
}

function aoaToMarkdownTable(rows) {
  if (!rows.length) return ''
  const cols = Math.max(...rows.map(r => r.length), 1)
  const norm = (r) => {
    const out = []
    for (let c = 0; c < cols; c++) {
      const val = r[c] == null ? '' : String(r[c]).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
      out.push(val)
    }
    return `| ${out.join(' | ')} |`
  }
  const sep = `| ${Array(cols).fill('---').join(' | ')} |`
  return [norm(rows[0]), sep, ...rows.slice(1).map(norm)].join('\n')
}

/** Extract structured tables/data from an Excel (.xlsx, .xls, .xlsm, .xlsb, .ods) ArrayBuffer */
export async function extractXlsxFromBuffer(arrayBuffer, options = {}) {
  const XLSX = await getXlsx()
  const data = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer)
  const workbook = XLSX.read(data, { type: 'array' })
  const maxRows = Math.max(10, Number(options.maxRows) || 500)
  const targetSheet = options.sheetName ? String(options.sheetName).toLowerCase() : null
  const sections = []

  const sheetNames = targetSheet
    ? workbook.SheetNames.filter(n => n.toLowerCase() === targetSheet || n.toLowerCase().includes(targetSheet))
    : workbook.SheetNames

  if (workbook.SheetNames.length > 1 && !targetSheet) {
    sections.push(`[Workbook: ${workbook.SheetNames.length} sheets — ${workbook.SheetNames.join(', ')}]`)
  }

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    const nonEmpty = aoa.filter(row => Array.isArray(row) && row.some(cell => String(cell ?? '').trim() !== ''))
    if (!nonEmpty.length) continue

    const totalRows = nonEmpty.length
    const maxCols = Math.max(...nonEmpty.map(r => r.length), 1)
    const sliced = nonEmpty.slice(0, maxRows)
    const truncatedNote = totalRows > maxRows ? `\n\n[Truncated: showing ${maxRows} of ${totalRows} non-empty rows]` : ''

    // Render Markdown table when requested (`format: 'markdown'`); default to CSV for compatibility
    if (options.format === 'markdown' && sliced.length <= 200 && maxCols <= 20) {
      sections.push(`=== Sheet: ${sheetName} (${totalRows} rows × ${maxCols} cols) ===\n${aoaToMarkdownTable(sliced)}${truncatedNote}`)
    } else {
      const csv = XLSX.utils.sheet_to_csv(sheet)
      const csvLines = csv.trim().split('\n')
      const outCsv = csvLines.slice(0, maxRows).join('\n')
      sections.push(`=== Sheet: ${sheetName} (${totalRows} rows) ===\n${outCsv}${truncatedNote}`)
    }
  }

  const result = sections.join('\n\n')
  if (!result.trim()) {
    throw new Error('Spreadsheet appears to be empty.')
  }
  return result
}

/** Extract structured tables/data from Excel (.xlsx, .xls, .xlsm, .xlsb, .ods) */
export async function extractXlsx(file, options = {}) {
  return extractXlsxFromBuffer(await readBlobAsArrayBuffer(file), options)
}

function extractPptxTableMarkdown(tbl) {
  const rows = []
  const trs = tbl.getElementsByTagName('a:tr')
  for (let r = 0; r < trs.length; r++) {
    const tcs = trs[r].getElementsByTagName('a:tc')
    const cells = []
    for (let c = 0; c < tcs.length; c++) {
      const ts = tcs[c].getElementsByTagName('a:t')
      const parts = []
      for (let k = 0; k < ts.length; k++) {
        const txt = (ts[k].textContent || '').trim()
        if (txt) parts.push(txt)
      }
      cells.push(parts.join(' ').replace(/\|/g, '\\|'))
    }
    if (cells.some(Boolean)) rows.push(cells)
  }
  return aoaToMarkdownTable(rows)
}

/** Extract slides, tables, and speaker notes from a PowerPoint (.pptx) ArrayBuffer */
export async function extractPptxFromBuffer(arrayBuffer, options = {}) {
  const JSZip = await getJsZip()
  const zip = await JSZip.loadAsync(arrayBuffer)
  const slideNames = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]))

  if (!slideNames.length) {
    throw new Error('Invalid PowerPoint file: no slides found in ppt/slides/.')
  }

  const startSlide = Math.max(1, Number(options.startSlide) || 1)
  const endSlide = options.endSlide != null ? Math.min(slideNames.length, Number(options.endSlide)) : slideNames.length

  const slidesOut = []
  if (slideNames.length > 1 && (startSlide > 1 || endSlide < slideNames.length)) {
    slidesOut.push(`[Presentation: showing slides ${startSlide}-${endSlide} of ${slideNames.length}]`)
  }

  for (const slidePath of slideNames) {
    const slideNum = Number(slidePath.match(/(\d+)\.xml$/)[1])
    if (slideNum < startSlide || slideNum > endSlide) continue

    const xml = await zip.file(slidePath).async('text')
    const doc = parseXml(xml)

    // Group text runs by paragraph (<a:p>) so sentences aren't fragmented across lines
    const lines = []
    const paragraphs = doc.getElementsByTagName('a:p')
    if (paragraphs.length) {
      for (let i = 0; i < paragraphs.length; i++) {
        const ts = paragraphs[i].getElementsByTagName('a:t')
        let pText = ''
        for (let j = 0; j < ts.length; j++) {
          pText += ts[j].textContent || ''
        }
        const trimmed = pText.trim()
        if (trimmed) lines.push(trimmed)
      }
    } else {
      const texts = doc.getElementsByTagNameNS('*', 't')
      for (let i = 0; i < texts.length; i++) {
        const t = (texts[i].textContent || '').trim()
        if (t) lines.push(t)
      }
    }

    // Extract any tables on the slide
    const tables = doc.getElementsByTagName('a:tbl')
    for (let t = 0; t < tables.length; t++) {
      const md = extractPptxTableMarkdown(tables[t])
      if (md) lines.push('', md)
    }

    const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`
    let notesText = ''
    if (zip.file(notesPath)) {
      const nDoc = parseXml(await zip.file(notesPath).async('text'))
      const nParagraphs = nDoc.getElementsByTagName('a:p')
      const nLines = []
      for (let i = 0; i < nParagraphs.length; i++) {
        const ts = nParagraphs[i].getElementsByTagName('a:t')
        let pText = ''
        for (let j = 0; j < ts.length; j++) pText += ts[j].textContent || ''
        const trimmed = pText.trim()
        if (trimmed && trimmed !== String(slideNum)) nLines.push(trimmed)
      }
      if (nLines.length) notesText = `\n\n> Notes: ${nLines.join(' ')}`
    }
    slidesOut.push(`## Slide ${slideNum}\n${lines.join('\n')}${notesText}`.trim())
  }

  const result = slidesOut.join('\n\n')
  if (!result.trim()) throw new Error('PowerPoint presentation contains no readable text.')
  return result
}

/** Extract slides and notes from PowerPoint (.pptx) files */
export async function extractPptx(file, options = {}) {
  return extractPptxFromBuffer(await readBlobAsArrayBuffer(file), options)
}

/** Extract plain text from Rich Text Format (.rtf) */
export function extractRtfText(rtf = '') {
  if (!rtf || typeof rtf !== 'string') return ''
  let text = rtf
    .replace(/\{\\\*\\[^}]*\}/g, '') // remove destination groups like {\*\generator ...}
    .replace(/\\(fonttbl|colortbl|stylesheet|info|pict|object)[^}]*\}/g, '')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, code) => {
      const n = Number(code)
      return String.fromCharCode(n < 0 ? n + 65536 : n)
    })
    .replace(/\\(par|line)\b[ \t]?/g, '\n')
    .replace(/\\tab\b[ \t]?/g, '\t')
    .replace(/\\[a-zA-Z]+-?\d*[ \t]?/g, '')
    .replace(/[{}]/g, '')
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

/** Extract text from OpenDocument Text (.odt) or Presentation (.odp) ArrayBuffer */
export async function extractOpenDocFromBuffer(arrayBuffer) {
  const JSZip = await getJsZip()
  const zip = await JSZip.loadAsync(arrayBuffer)
  const contentFile = zip.file('content.xml')
  if (!contentFile) throw new Error('Invalid OpenDocument file: content.xml not found')
  const doc = parseXml(await contentFile.async('text'))
  const blocks = []
  const nodes = doc.getElementsByTagName('*')
  for (let i = 0; i < nodes.length; i++) {
    const tag = nodes[i].localName || nodes[i].nodeName || ''
    if (tag === 'h' || tag === 'p') {
      const txt = (nodes[i].textContent || '').trim()
      if (!txt) continue
      if (tag === 'h') {
        const level = Math.min(6, Math.max(1, Number(nodes[i].getAttribute('text:outline-level')) || 1))
        blocks.push(`${'#'.repeat(level)} ${txt}`)
      } else {
        blocks.push(txt)
      }
    }
  }
  const result = blocks.join('\n\n').trim()
  if (!result) throw new Error('OpenDocument file contains no readable text.')
  return result
}

/** Extract chapters from an EPUB (.epub) ArrayBuffer */
export async function extractEpubFromBuffer(arrayBuffer) {
  const JSZip = await getJsZip()
  const zip = await JSZip.loadAsync(arrayBuffer)
  const htmlFiles = Object.keys(zip.files)
    .filter(n => /\.(x?html?|htm)$/i.test(n) && !/nav|toc/i.test(n.split('/').pop()))
    .sort()
  if (!htmlFiles.length) throw new Error('EPUB archive contains no readable HTML chapters.')
  const chapters = []
  for (const path of htmlFiles.slice(0, 60)) {
    const raw = await zip.file(path).async('text')
    const cleaned = raw
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (cleaned) chapters.push(cleaned)
  }
  const result = chapters.join('\n\n---\n\n').trim()
  if (!result) throw new Error('EPUB contains no readable text.')
  return result
}

/** Extract text and layout signals from images via OCR (with graceful metadata fallback) */
export async function extractImage(file) {
  const { ocrTool } = await import('./ocr')
  const url = URL.createObjectURL(file)
  try {
    const res = await ocrTool.execute({ image_url: url })
    if (res?.text?.trim()) {
      let output = res.text.trim()
      if (res.structure) {
        output = `[Visual Layout: ${res.structure}]\n\n${output}`
      }
      return output
    }
    if (res?.low_confidence_text?.trim()) {
      return `[Low-confidence OCR text detected]:\n${res.low_confidence_text.trim()}`
    }
    if (res?.structure) {
      return `[Image: ${file.name || 'image'} | Visual Layout: ${res.structure}]\nNo legible text detected via OCR.`
    }
    throw new Error(res?.error || 'No readable text found in this image via OCR.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Safe reader for text content across modern browsers, Electron, and test environments with BOM support */
export async function readBlobAsText(blob) {
  try {
    const buffer = await readBlobAsArrayBuffer(blob)
    const bytes = new Uint8Array(buffer)
    // UTF-8 BOM
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3))
    }
    // UTF-16LE BOM
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2))
    }
    // UTF-16BE BOM
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2))
    }
    // Standard UTF-8
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    if (typeof blob.text === 'function') {
      try { return await blob.text() } catch {}
    }
    if (typeof FileReader !== 'undefined') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error || new Error('Failed to read file as text'))
        reader.readAsText(blob)
      })
    }
    throw new Error('No mechanism available to read file as text.')
  }
}

/** Safe reader for ArrayBuffer across modern browsers, Electron, and test environments */
export async function readBlobAsArrayBuffer(blob) {
  if (typeof blob.arrayBuffer === 'function') {
    try {
      return await blob.arrayBuffer()
    } catch { /* fallback to FileReader */ }
  }
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error || new Error('Failed to read file as array buffer'))
      reader.readAsArrayBuffer(blob)
    })
  }
  throw new Error('No mechanism available to read file as array buffer.')
}

/** Check if file is text/code via type, extension, or byte inspection */
export async function isLikelyTextFile(file) {
  if (!file) return false
  if (file.type && (file.type.startsWith('text/') || file.type.includes('json') || file.type.includes('xml') || file.type.includes('yaml'))) {
    return true
  }

  const name = (file.name || '').toLowerCase()
  const base = name.split('/').pop().split('\\').pop()
  if (KNOWN_TEXT_BASENAMES.has(base) || base.startsWith('.env') || base.startsWith('.git') || base.startsWith('.docker')) {
    return true
  }

  const ext = name.includes('.') ? name.split('.').pop() : ''
  if (CODE_OR_TEXT_EXTS.has(ext)) {
    return true
  }

  // Universal fallback: check first 4KB for null bytes, accounting for UTF-16 BOM
  try {
    const slice = typeof file.slice === 'function' ? file.slice(0, 4096) : file
    const buf = await readBlobAsArrayBuffer(slice)
    const bytes = new Uint8Array(buf)
    if (bytes.length === 0) return true
    // Detect UTF-16 BOM
    if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
      return true
    }
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) return false // null byte indicates binary file
    }
    return true
  } catch {
    return false
  }
}

/**
 * Universal text extraction entrypoint for any file uploaded or dropped.
 * Automatically routes to PDF, Word, Excel, Image OCR, or text/code parser.
 */
export async function extractFileText(file) {
  if (!file) throw new Error('No file provided for extraction.')

  const name = (file.name || '').toLowerCase()
  const mime = file.type || ''

  // 1. PDF
  if (name.endsWith('.pdf') || mime === 'application/pdf') {
    return extractPdf(file)
  }

  // 2. Word document (.docx), OpenDocument (.odt), Rich Text (.rtf)
  if (name.endsWith('.docx') || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractDocx(file)
  }
  if (name.endsWith('.odt') || mime === 'application/vnd.oasis.opendocument.text') {
    return extractOpenDocFromBuffer(await readBlobAsArrayBuffer(file))
  }
  if (name.endsWith('.rtf') || mime === 'application/rtf' || mime === 'text/rtf') {
    return extractRtfText(await readBlobAsText(file))
  }

  // 3. Excel & OpenDocument spreadsheets (.xlsx, .xls, .xlsm, .xlsb, .ods)
  if (/\.(xlsx|xls|xlsm|xlsb|ods)$/i.test(name) ||
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mime === 'application/vnd.ms-excel' ||
      mime === 'application/vnd.oasis.opendocument.spreadsheet') {
    return extractXlsx(file)
  }

  // 3b. PowerPoint & OpenDocument presentations (.pptx, .odp)
  if (name.endsWith('.pptx') ||
      mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return extractPptx(file)
  }
  if (name.endsWith('.odp') || mime === 'application/vnd.oasis.opendocument.presentation') {
    return extractOpenDocFromBuffer(await readBlobAsArrayBuffer(file))
  }

  // 3c. E-book (.epub)
  if (name.endsWith('.epub') || mime === 'application/epub+zip') {
    return extractEpubFromBuffer(await readBlobAsArrayBuffer(file))
  }

  // 4. SVG vector images (XML text) & Raster images (PNG, JPG, JPEG, WEBP, BMP, TIFF, GIF) via OCR
  if (name.endsWith('.svg') || mime === 'image/svg+xml') {
    return readBlobAsText(file)
  }
  if (/\.(png|jpe?g|webp|bmp|tiff?|gif)$/i.test(name) || mime.startsWith('image/')) {
    return extractImage(file)
  }

  // 5. Text, Markdown, Data, Config, Code, Scripts
  if (await isLikelyTextFile(file)) {
    return readBlobAsText(file)
  }

  throw new Error(`Unsupported file type: ${mime || name}. Supported: PDF (digital & scan), DOCX/ODT/RTF, XLSX/XLS/XLSM/ODS, PPTX/ODP, EPUB, Images (PNG/JPG/JPEG/WEBP/SVG with OCR), CSV/TSV, JSON, Markdown, and all Code/Config files.`)
}
