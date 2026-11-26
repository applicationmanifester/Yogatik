/**
 * Universal Client-Side Document & File Extractor
 *
 * Supports:
 * - PDF: Digital text + Scanned/Image PDFs via high-DPI canvas & auto-OCR
 * - Microsoft Word (.docx): XML text & paragraph parsing via JSZip
 * - Microsoft Excel (.xlsx, .xls): CSV table generation per sheet via SheetJS
 * - Images (.png, .jpg, .jpeg, .webp, .bmp, .tiff): OCR text extraction via Tesseract.js
 * - Data & Config: CSV, TSV, JSON, JSONL, XML, YAML, TOML, INI, ENV, SQL
 * - Programming Languages: JS, TS, Python, Java, C, C++, C#, Go, Rust, PHP, Ruby, Bash, PowerShell, etc.
 * - Universal Text Fallback: Any text-encoded file (checked via byte inspection for null characters)
 */

const CODE_OR_TEXT_EXTS = new Set([
  'txt', 'text', 'md', 'markdown', 'log', 'rtf', 'csv', 'tsv', 'json', 'jsonl', 'ndjson',
  'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'conf', 'cfg', 'properties', 'plist',
  'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'vue', 'svelte',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'pyw', 'java', 'c', 'cpp', 'cc', 'cxx',
  'h', 'hpp', 'hh', 'cs', 'go', 'rs', 'php', 'rb', 'sh', 'bash', 'zsh', 'ps1',
  'bat', 'cmd', 'sql', 'r', 'swift', 'kt', 'kts', 'dart', 'scala', 'lua', 'pl', 'pm',
  'graphql', 'gql', 'proto', 'diff', 'patch', 'dockerfile', 'makefile',
  'srt', 'vtt', 'sub', 'rst', 'adoc', 'asciidoc', 'tex', 'latex', 'bib'
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

/** Extract text from PDF (digital layer + scanned OCR fallback) */
export async function extractPdf(file) {
  const { pdfExtractTool } = await import('./pdfExtract')
  const url = URL.createObjectURL(file)
  try {
    const res = await pdfExtractTool.execute({ url })
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
  if (!styles.length) return ''
  const val = styles[0].getAttribute('w:val') || styles[0].getAttribute('val') || ''
  const m = val.match(/^Heading([1-6])$/i)
  return m ? `${'#'.repeat(Number(m[1]))} ` : ''
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

  const result = blocks.join('\n\n')
  if (!result.trim()) {
    throw new Error('Word document contains no readable text.')
  }
  return result
}

/** Extract text from Word (.docx) files */
export async function extractDocx(file) {
  return extractDocxFromBuffer(await readBlobAsArrayBuffer(file))
}

/** Extract structured tables/data from an Excel (.xlsx, .xls) ArrayBuffer */
export async function extractXlsxFromBuffer(arrayBuffer) {
  const XLSX = await getXlsx()
  const data = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer)
  const workbook = XLSX.read(data, { type: 'array' })
  const sections = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(sheet)
    if (csv && csv.trim()) {
      const rowCount = csv.trim().split('\n').length
      sections.push(`=== Sheet: ${sheetName} (${rowCount} rows) ===\n${csv.trim()}`)
    }
  }

  const result = sections.join('\n\n')
  if (!result.trim()) {
    throw new Error('Spreadsheet appears to be empty.')
  }
  return result
}

/** Extract structured tables/data from Excel (.xlsx, .xls) */
export async function extractXlsx(file) {
  return extractXlsxFromBuffer(await readBlobAsArrayBuffer(file))
}

/** Extract slides and speaker notes from a PowerPoint (.pptx) ArrayBuffer */
export async function extractPptxFromBuffer(arrayBuffer) {
  const JSZip = await getJsZip()
  const zip = await JSZip.loadAsync(arrayBuffer)
  const slideNames = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]))

  if (!slideNames.length) {
    throw new Error('Invalid PowerPoint file: no slides found in ppt/slides/.')
  }

  const slidesOut = []
  for (const slidePath of slideNames) {
    const slideNum = slidePath.match(/(\d+)\.xml$/)[1]
    const xml = await zip.file(slidePath).async('text')
    const doc = parseXml(xml)
    const texts = doc.getElementsByTagName('a:t').length
      ? doc.getElementsByTagName('a:t')
      : doc.getElementsByTagNameNS('*', 't')
    const lines = []
    for (let i = 0; i < texts.length; i++) {
      const t = (texts[i].textContent || '').trim()
      if (t) lines.push(t)
    }
    const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`
    let notesText = ''
    if (zip.file(notesPath)) {
      const nDoc = parseXml(await zip.file(notesPath).async('text'))
      const nTexts = nDoc.getElementsByTagName('a:t').length
        ? nDoc.getElementsByTagName('a:t')
        : nDoc.getElementsByTagNameNS('*', 't')
      const nLines = []
      for (let i = 0; i < nTexts.length; i++) {
        const t = (nTexts[i].textContent || '').trim()
        if (t && t !== slideNum) nLines.push(t)
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
export async function extractPptx(file) {
  return extractPptxFromBuffer(await readBlobAsArrayBuffer(file))
}

/** Extract text and layout signals from images via OCR */
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

  // 2. Word document (.docx)
  if (name.endsWith('.docx') || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractDocx(file)
  }

  // 3. Excel spreadsheet (.xlsx, .xls)
  if (name.endsWith('.xlsx') || name.endsWith('.xls') ||
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mime === 'application/vnd.ms-excel') {
    return extractXlsx(file)
  }

  // 3b. PowerPoint presentation (.pptx)
  if (name.endsWith('.pptx') ||
      mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return extractPptx(file)
  }

  // 4. Image file (PNG, JPG, WEBP, BMP, TIFF) via OCR
  if (/\.(png|jpe?g|webp|bmp|tiff?)$/i.test(name) || mime.startsWith('image/')) {
    return extractImage(file)
  }

  // 5. Text, Markdown, Data, Config, Code, Scripts
  if (await isLikelyTextFile(file)) {
    return readBlobAsText(file)
  }

  throw new Error(`Unsupported file type: ${mime || name}. Supported: PDF (digital & scan), DOCX, XLSX/XLS, Images (PNG/JPG/WEBP with OCR), CSV/TSV, JSON, Markdown, and all Code/Config files.`)
}
