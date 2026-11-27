// pdf.js via CDN with layout-aware text reconstruction, page ranges, metadata/outline,
// and per-page automatic OCR fallback for scanned/hybrid documents.
let _pdfjs = null

const PDFJS_CDNS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs',
  'https://unpkg.com/pdfjs-dist@4.4.168/build/pdf.min.mjs',
]

async function loadPdfJs() {
  if (_pdfjs) return _pdfjs
  let lastErr = null
  for (const cdn of PDFJS_CDNS) {
    try {
      const mod = await import(/* @vite-ignore */ cdn)
      if (mod?.GlobalWorkerOptions) {
        mod.GlobalWorkerOptions.workerSrc = cdn.replace('pdf.min.mjs', 'pdf.worker.min.mjs')
      }
      _pdfjs = mod
      return mod
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('Failed to load PDF engine (pdf.js)')
}

/**
 * Reconstruct readable lines and paragraphs from pdf.js textContent items using
 * baseline Y and X coordinates, preserving line breaks, paragraph gaps, and tabular columns.
 */
export function reconstructPageText(items = []) {
  if (!Array.isArray(items) || !items.length) return ''

  const positioned = []
  for (const item of items) {
    const str = item?.str ?? ''
    if (!str && !item?.hasEOL) continue
    const tr = Array.isArray(item?.transform) ? item.transform : [1, 0, 0, 1, 0, 0]
    const x = Number(tr[4]) || 0
    const y = Number(tr[5]) || 0
    const height = Math.abs(Number(tr[3]) || Number(item?.height) || 10) || 10
    const width = Math.abs(Number(item?.width) || 0)
    positioned.push({ str, x, y, height, width, hasEOL: !!item?.hasEOL })
  }

  if (!positioned.length) return ''

  // Group items into visual lines by Y proximity (within ~45% of font height)
  const lines = []
  let currentLine = null

  for (const it of positioned) {
    if (!it.str.trim() && !it.hasEOL) continue
    if (!currentLine) {
      currentLine = { y: it.y, height: it.height, items: [it] }
      lines.push(currentLine)
    } else {
      const yTol = Math.max(3, Math.min(currentLine.height, it.height) * 0.45)
      if (Math.abs(it.y - currentLine.y) <= yTol) {
        currentLine.items.push(it)
      } else {
        currentLine = { y: it.y, height: it.height, items: [it] }
        lines.push(currentLine)
      }
    }
    if (it.hasEOL && currentLine.items.length) {
      currentLine = null
    }
  }

  const out = []
  let prevY = null
  let prevHeight = 10

  for (const line of lines) {
    // Sort items left-to-right within the same visual line
    line.items.sort((a, b) => a.x - b.x)

    let lineText = ''
    let prevEndX = null
    for (const it of line.items) {
      const text = it.str
      if (!text) continue
      if (prevEndX !== null) {
        const gap = it.x - prevEndX
        const spaceWidth = Math.max(2, it.height * 0.28)
        if (gap > it.height * 1.8) {
          // Wide horizontal gap -> likely tabular column or multi-column separator
          lineText += '\t'
        } else if (gap > spaceWidth && !lineText.endsWith(' ') && !text.startsWith(' ')) {
          lineText += ' '
        }
      }
      lineText += text
      prevEndX = it.x + (it.width || text.length * it.height * 0.45)
    }

    const trimmed = lineText.replace(/[ \t]+$/g, '').trimStart()
    if (!trimmed) continue

    // Insert a blank line when vertical gap indicates a paragraph break
    if (prevY !== null) {
      const dy = Math.abs(prevY - line.y)
      const lineStep = Math.max(prevHeight, line.height, 10)
      if (dy > lineStep * 1.65 && out.length && out[out.length - 1] !== '') {
        out.push('')
      }
    }
    out.push(trimmed)
    prevY = line.y
    prevHeight = line.height
  }

  return out.join('\n').trim()
}

function flattenOutline(items = [], depth = 0) {
  const out = []
  for (const item of items || []) {
    if (item?.title) {
      out.push(`${'  '.repeat(depth)}- ${item.title.trim()}`)
    }
    if (Array.isArray(item?.items) && item.items.length && depth < 3) {
      out.push(...flattenOutline(item.items, depth + 1))
    }
    if (out.length >= 60) break
  }
  return out
}

export const pdfExtractTool = {
  schema: {
    description:
      'Extract layout-aware text, metadata, and table-of-contents outline from a PDF file. ' +
      'Supports page ranges (startPage/endPage) and automatically falls back to per-page OCR on scanned/image pages.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL or data URL of the PDF' },
        startPage: { type: 'number', description: '1-based start page (default 1)' },
        endPage: { type: 'number', description: '1-based end page (optional; defaults to startPage + maxPages - 1)' },
        maxPages: { type: 'number', description: 'Maximum pages to inspect when endPage is omitted (default 25)' },
        ocrFallback: { type: 'boolean', description: 'Run OCR on rendered canvas for scanned/image pages with sparse text (default true)' },
        includeMetadata: { type: 'boolean', description: 'Include PDF title/author/outline header when available (default true)' },
      },
      required: ['url'],
    },
  },
  async execute({ url, startPage = 1, endPage, maxPages = 25, ocrFallback = true, includeMetadata = true } = {}) {
    if (!url) {
      return { success: false, tool: 'pdf_extract', error: 'PDF url or data URL is required' }
    }

    try {
      const pdfjsLib = await loadPdfJs()
      const loadingTask = pdfjsLib.getDocument(url)
      const doc = await loadingTask.promise

      const totalPages = doc.numPages || 1
      const fromPage = Math.max(1, Math.min(totalPages, Number(startPage) || 1))
      const requestedEnd = endPage != null ? Number(endPage) : fromPage + Math.max(1, Number(maxPages) || 25) - 1
      const toPage = Math.max(fromPage, Math.min(totalPages, requestedEnd))

      let headerMeta = ''
      let metadataObj = null
      if (includeMetadata) {
        try {
          const meta = await doc.getMetadata().catch(() => null)
          const info = meta?.info || {}
          metadataObj = {
            title: info.Title || undefined,
            author: info.Author || undefined,
            subject: info.Subject || undefined,
          }
          const metaParts = []
          if (info.Title) metaParts.push(`Title: ${info.Title}`)
          if (info.Author) metaParts.push(`Author: ${info.Author}`)
          if (info.Subject) metaParts.push(`Subject: ${info.Subject}`)
          if (metaParts.length) headerMeta += `[PDF Metadata] ${metaParts.join(' | ')}\n`
        } catch { /* ignore metadata errors */ }

        try {
          const outline = await doc.getOutline().catch(() => null)
          const flat = flattenOutline(outline)
          if (flat.length && fromPage === 1) {
            headerMeta += `[PDF Outline]\n${flat.join('\n')}\n`
          }
        } catch { /* ignore outline errors */ }
      }

      const pageTexts = new Map()
      const sparsePages = []

      // 1. First pass: extract layout-aware digital text layer per page
      for (let i = fromPage; i <= toPage; i++) {
        try {
          const page = await doc.getPage(i)
          const content = await page.getTextContent()
          const pageStr = reconstructPageText(content.items || [])
          if (pageStr.length >= 25) {
            pageTexts.set(i, { text: pageStr, method: 'digital' })
          } else {
            if (pageStr) pageTexts.set(i, { text: pageStr, method: 'sparse' })
            sparsePages.push(i)
          }
        } catch (pageErr) {
          console.warn(`[pdf_extract] Error reading text on page ${i}:`, pageErr)
          sparsePages.push(i)
        }
      }

      // 2. Second pass: Per-page OCR fallback for scanned pages or hybrid PDFs
      let ocrUsedCount = 0
      if (ocrFallback && sparsePages.length > 0 && typeof document !== 'undefined') {
        try {
          const { ocrTool } = await import('./ocr')
          const maxOcrPages = Math.min(sparsePages.length, 10)

          for (let idx = 0; idx < maxOcrPages; idx++) {
            const pageNum = sparsePages[idx]
            try {
              const page = await doc.getPage(pageNum)
              const viewport = page.getViewport({ scale: 1.75 })
              const canvas = document.createElement('canvas')
              canvas.width = Math.round(viewport.width)
              canvas.height = Math.round(viewport.height)
              const ctx = canvas.getContext('2d', { willReadFrequently: true })

              if (ctx) {
                await page.render({ canvasContext: ctx, viewport }).promise
                const dataUrl = canvas.toDataURL('image/png')
                const ocrRes = await ocrTool.execute({ image_url: dataUrl })
                if (ocrRes?.text?.trim()) {
                  pageTexts.set(pageNum, { text: ocrRes.text.trim(), method: 'ocr' })
                  ocrUsedCount++
                }
              }

              canvas.width = 0
              canvas.height = 0
            } catch (pageOcrErr) {
              console.warn(`[pdf_extract] Canvas OCR failed on page ${pageNum}:`, pageOcrErr)
            }
          }
        } catch (ocrModuleErr) {
          console.warn('[pdf_extract] OCR fallback module error:', ocrModuleErr)
        }
      }

      const sections = []
      let digitalCount = 0
      for (let i = fromPage; i <= toPage; i++) {
        const entry = pageTexts.get(i)
        if (!entry?.text) continue
        if (entry.method === 'digital') digitalCount++
        const label = totalPages > 1
          ? (entry.method === 'ocr' ? `[Page ${i} (OCR)]` : `[Page ${i}]`)
          : ''
        sections.push(label ? `${label}\n${entry.text}` : entry.text)
      }

      const bodyText = sections.join('\n\n').trim()
      const combined = [headerMeta.trim(), bodyText].filter(Boolean).join('\n\n').trim()

      if (!bodyText) {
        return {
          success: false,
          tool: 'pdf_extract',
          error: 'No extractable text or legible scanned content found in this PDF.',
          pages: totalPages,
          startPage: fromPage,
          endPage: toPage,
        }
      }

      const method = ocrUsedCount > 0 && digitalCount > 0
        ? 'hybrid_digital_and_ocr'
        : (ocrUsedCount > 0 ? 'ocr_rendered_pages' : (bodyText.length < 50 ? 'sparse_text' : 'digital_text_layer'))

      const truncated = toPage < totalPages || fromPage > 1
      return {
        success: true,
        tool: 'pdf_extract',
        text: combined,
        pages: totalPages,
        startPage: fromPage,
        endPage: toPage,
        extractedPages: sections.length,
        truncated,
        ...(toPage < totalPages ? {
          note: `Extracted pages ${fromPage}-${toPage} of ${totalPages}. Call pdf_extract or doc_read with startPage: ${toPage + 1} to read more.`,
        } : {}),
        ...(metadataObj && (metadataObj.title || metadataObj.author) ? { metadata: metadataObj } : {}),
        method,
      }
    } catch (err) {
      return {
        success: false,
        tool: 'pdf_extract',
        error: err?.message || 'Failed to process PDF',
      }
    }
  },
}
