/**
 * Workspace Office & PDF document reading and in-place editing tools.
 * Works on .docx, .xlsx/.xls, .pptx, and .pdf files inside the chat's granted workspace.
 */

import { isDesktop, invoke, ok, fail } from './localFs'
import { extractDocxFromBuffer, extractXlsxFromBuffer, extractPptxFromBuffer } from './docExtractors'

function base64ToUint8Array(b64) {
  if (typeof globalThis.Buffer !== 'undefined') {
    return new Uint8Array(globalThis.Buffer.from(b64, 'base64'))
  }
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function uint8ArrayToBase64(bytes) {
  if (typeof globalThis.Buffer !== 'undefined') {
    return globalThis.Buffer.from(bytes).toString('base64')
  }
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function xmlEscape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function replaceAllXmlText(xml, replacements) {
  let out = xml
  let count = 0
  for (const [from, to] of Object.entries(replacements)) {
    if (!from) continue
    const escapedFrom = xmlEscape(from)
    const escapedTo = xmlEscape(to)
    if (out.includes(escapedFrom)) {
      const parts = out.split(escapedFrom)
      count += parts.length - 1
      out = parts.join(escapedTo)
    } else if (out.includes(from)) {
      const parts = out.split(from)
      count += parts.length - 1
      out = parts.join(escapedTo)
    }
  }
  return { xml: out, count }
}

export async function editDocxBuffer(arrayBuffer, { operation, replacements, old_text, new_text, heading, paragraphs = [] } = {}) {
  const JSZip = (await import('jszip')).default || (await import('jszip'))
  const zip = await JSZip.loadAsync(arrayBuffer)
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('Invalid .docx file: word/document.xml not found')

  let changes = 0
  if (operation === 'replace_text') {
    const map = replacements && typeof replacements === 'object'
      ? replacements
      : (old_text ? { [old_text]: new_text ?? '' } : {})
    if (!Object.keys(map).length) throw new Error('replacements (or old_text/new_text) is required for replace_text')

    const targets = Object.keys(zip.files).filter(n => /^word\/(document|header\d*|footer\d*)\.xml$/i.test(n))
    for (const target of targets) {
      const xml = await zip.file(target).async('text')
      const res = replaceAllXmlText(xml, map)
      if (res.count > 0) {
        zip.file(target, res.xml)
        changes += res.count
      }
    }
  } else if (operation === 'append_section') {
    let xml = await docFile.async('text')
    const parts = []
    if (heading) {
      parts.push(`<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(heading)}</w:t></w:r></w:p>`)
    }
    const list = Array.isArray(paragraphs) ? paragraphs : [String(paragraphs || '')]
    for (const text of list) {
      if (String(text).trim()) {
        parts.push(`<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`)
      }
    }
    if (!parts.length) throw new Error('heading or paragraphs is required for append_section')
    const insertXml = parts.join('')
    if (xml.includes('<w:sectPr')) {
      xml = xml.replace(/<w:sectPr\b/, `${insertXml}<w:sectPr`)
    } else if (xml.includes('</w:body>')) {
      xml = xml.replace('</w:body>', `${insertXml}</w:body>`)
    } else {
      throw new Error('Could not locate <w:body> in word/document.xml')
    }
    zip.file('word/document.xml', xml)
    changes = parts.length
  } else {
    throw new Error(`Unsupported .docx operation: ${operation}. Use "replace_text" or "append_section".`)
  }

  const out = await zip.generateAsync({ type: 'uint8array' })
  return { bytes: out, changes }
}

export async function editXlsxBuffer(arrayBuffer, { operation, sheet_name, cells, rows, columns } = {}) {
  const XLSX = (await import('xlsx')).default || (await import('xlsx'))
  const data = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer)
  const wb = XLSX.read(data, { type: 'array' })
  const targetSheetName = sheet_name || wb.SheetNames[0]
  let changes = 0

  if (operation === 'update_cells') {
    const ws = wb.Sheets[targetSheetName]
    if (!ws) throw new Error(`Sheet "${targetSheetName}" not found. Available: ${wb.SheetNames.join(', ')}`)
    if (!cells || typeof cells !== 'object') throw new Error('cells object (e.g. {"A1": "Total", "B2": 100}) is required')
    for (const [addr, val] of Object.entries(cells)) {
      XLSX.utils.sheet_add_aoa(ws, [[val]], { origin: addr })
      changes++
    }
  } else if (operation === 'append_rows') {
    const ws = wb.Sheets[targetSheetName]
    if (!ws) throw new Error(`Sheet "${targetSheetName}" not found. Available: ${wb.SheetNames.join(', ')}`)
    if (!Array.isArray(rows) || !rows.length) throw new Error('rows array is required for append_rows')
    XLSX.utils.sheet_add_aoa(ws, rows, { origin: -1 })
    changes = rows.length
  } else if (operation === 'add_sheet') {
    const name = String(sheet_name || `Sheet${wb.SheetNames.length + 1}`).slice(0, 31)
    if (wb.Sheets[name]) throw new Error(`Sheet "${name}" already exists`)
    const aoa = [
      ...(Array.isArray(columns) && columns.length ? [columns] : []),
      ...(Array.isArray(rows) ? rows : []),
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa.length ? aoa : [['Empty']])
    XLSX.utils.book_append_sheet(wb, ws, name)
    changes = Math.max(1, aoa.length)
  } else {
    throw new Error(`Unsupported .xlsx operation: ${operation}. Use "update_cells", "append_rows", or "add_sheet".`)
  }

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return { bytes: new Uint8Array(out), changes }
}

export async function editPptxBuffer(arrayBuffer, { operation, replacements, old_text, new_text } = {}) {
  const JSZip = (await import('jszip')).default || (await import('jszip'))
  const zip = await JSZip.loadAsync(arrayBuffer)
  if (operation !== 'replace_text') {
    throw new Error(`Unsupported .pptx operation: ${operation}. Use "replace_text".`)
  }
  const map = replacements && typeof replacements === 'object'
    ? replacements
    : (old_text ? { [old_text]: new_text ?? '' } : {})
  if (!Object.keys(map).length) throw new Error('replacements (or old_text/new_text) is required for replace_text')

  let changes = 0
  const targets = Object.keys(zip.files).filter(n => /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/i.test(n))
  for (const target of targets) {
    const xml = await zip.file(target).async('text')
    const res = replaceAllXmlText(xml, map)
    if (res.count > 0) {
      zip.file(target, res.xml)
      changes += res.count
    }
  }
  const out = await zip.generateAsync({ type: 'uint8array' })
  return { bytes: out, changes }
}

export async function editPdfBuffer(arrayBuffer, { operation, pages = [], text = '', opacity = 0.2 } = {}) {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import('pdf-lib')
  const pdf = await PDFDocument.load(arrayBuffer)
  const total = pdf.getPageCount()
  let changes = 0

  if (operation === 'delete_pages') {
    const sorted = [...new Set((pages || []).map(Number).filter(n => n >= 1 && n <= total))].sort((a, b) => b - a)
    if (!sorted.length) throw new Error(`No valid 1-based page numbers provided (document has ${total} pages)`)
    if (sorted.length >= total) throw new Error('Cannot delete all pages from a PDF')
    for (const p of sorted) {
      pdf.removePage(p - 1)
      changes++
    }
  } else if (operation === 'extract_pages') {
    const keep = [...new Set((pages || []).map(Number).filter(n => n >= 1 && n <= total))].map(n => n - 1)
    if (!keep.length) throw new Error(`No valid 1-based page numbers provided (document has ${total} pages)`)
    const outPdf = await PDFDocument.create()
    const copied = await outPdf.copyPages(pdf, keep)
    for (const page of copied) outPdf.addPage(page)
    return { bytes: await outPdf.save(), changes: copied.length }
  } else if (operation === 'add_watermark') {
    if (!String(text || '').trim()) throw new Error('text is required for add_watermark')
    const font = await pdf.embedFont(StandardFonts.HelveticaBold)
    for (const page of pdf.getPages()) {
      const { width, height } = page.getSize()
      page.drawText(String(text), {
        x: width * 0.2,
        y: height * 0.45,
        size: Math.min(48, Math.max(18, width / 12)),
        font,
        color: rgb(0.5, 0.5, 0.5),
        opacity: Math.min(1, Math.max(0.05, Number(opacity) || 0.2)),
        rotate: degrees(35),
      })
      changes++
    }
  } else {
    throw new Error(`Unsupported .pdf operation: ${operation}. Use "delete_pages", "extract_pages", or "add_watermark".`)
  }

  return { bytes: await pdf.save(), changes }
}

export const docReadTool = {
  schema: {
    description:
      'Read and extract structured text, tables, or slides from binary Office/PDF files (.docx, .xlsx, .xls, .pptx, .pdf) ' +
      'in the workspace folder. Use this instead of fs_read for binary documents. Desktop app only.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the .docx, .xlsx, .xls, .pptx, or .pdf file in the workspace.' },
      },
      required: ['path'],
    },
  },
  async execute(args = {}, opts = {}) {
    if (!isDesktop()) return { success: false, error: 'doc_read requires the Yogatik desktop app.' }
    const filePath = args.path
    if (!filePath) return fail('path is required')
    try {
      const res = await invoke('fs_read', { path: filePath, encoding: 'base64', maxBytes: 50_000_000 }, opts?.ctx)
      const bytes = base64ToUint8Array(res.base64)
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const lower = String(filePath).toLowerCase()
      let content = ''
      if (lower.endsWith('.docx')) {
        content = await extractDocxFromBuffer(buf)
      } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        content = await extractXlsxFromBuffer(buf)
      } else if (lower.endsWith('.pptx')) {
        content = await extractPptxFromBuffer(buf)
      } else if (lower.endsWith('.pdf')) {
        const { pdfExtractTool } = await import('./pdfExtract')
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        try {
          const pdfRes = await pdfExtractTool.execute({ url })
          content = pdfRes?.text || ''
        } finally {
          URL.revokeObjectURL(url)
        }
      } else {
        return fail(`Unsupported extension for doc_read: ${filePath}. Use fs_read for text/code files.`)
      }
      return ok({ tool: 'doc_read', path: res.path || filePath, hash: res.hash, bytes: res.bytes, content })
    } catch (e) {
      return fail(e)
    }
  },
}

export const docEditTool = {
  schema: {
    description:
      'Edit binary Office/PDF files (.docx, .xlsx, .xls, .pptx, .pdf) in-place in the workspace without losing formatting or other sheets. ' +
      'Operations: .xlsx ("update_cells", "append_rows", "add_sheet"), .docx ("replace_text", "append_section"), ' +
      '.pptx ("replace_text"), .pdf ("delete_pages", "extract_pages", "add_watermark"). Desktop app only.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the workspace .docx, .xlsx, .xls, .pptx, or .pdf file.' },
        operation: {
          type: 'string',
          enum: ['update_cells', 'append_rows', 'add_sheet', 'replace_text', 'append_section', 'delete_pages', 'extract_pages', 'add_watermark'],
          description: 'Edit operation to apply.',
        },
        sheet_name: { type: 'string', description: 'For .xlsx: target sheet name (defaults to first sheet).' },
        cells: { type: 'object', description: 'For .xlsx update_cells: map of A1 cell addresses to values.' },
        rows: { type: 'array', description: 'For .xlsx append_rows/add_sheet: array of row arrays.' },
        columns: { type: 'array', description: 'For .xlsx add_sheet: header column names.' },
        replacements: { type: 'object', description: 'For .docx/.pptx replace_text: map of old -> new strings.' },
        old_text: { type: 'string', description: 'For .docx/.pptx replace_text: single string to replace.' },
        new_text: { type: 'string', description: 'For .docx/.pptx replace_text: replacement string.' },
        heading: { type: 'string', description: 'For .docx append_section: section heading.' },
        paragraphs: { type: 'array', description: 'For .docx append_section: list of paragraphs to append.' },
        pages: { type: 'array', description: 'For .pdf delete_pages/extract_pages: 1-based page numbers.' },
        text: { type: 'string', description: 'For .pdf add_watermark: watermark text.' },
        opacity: { type: 'number', description: 'For .pdf add_watermark: opacity (0.05-1.0).' },
        expected_hash: { type: 'string', description: 'Optional hash from doc_read for optimistic concurrency.' },
      },
      required: ['path', 'operation'],
    },
  },
  async execute(args = {}, opts = {}) {
    if (!isDesktop()) return { success: false, error: 'doc_edit requires the Yogatik desktop app.' }
    const { path: filePath, expected_hash } = args
    if (!filePath || !args.operation) return fail('path and operation are required')
    try {
      const readRes = await invoke('fs_read', { path: filePath, encoding: 'base64', maxBytes: 50_000_000 }, opts?.ctx)
      const bytes = base64ToUint8Array(readRes.base64)
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const lower = String(filePath).toLowerCase()

      let edited
      if (lower.endsWith('.docx')) edited = await editDocxBuffer(buf, args)
      else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) edited = await editXlsxBuffer(buf, args)
      else if (lower.endsWith('.pptx')) edited = await editPptxBuffer(buf, args)
      else if (lower.endsWith('.pdf')) edited = await editPdfBuffer(buf, args)
      else return fail(`Unsupported extension for doc_edit: ${filePath}`)

      const writeRes = await invoke('fs_write', {
        path: filePath,
        content: uint8ArrayToBase64(edited.bytes),
        encoding: 'base64',
        expectedHash: expected_hash || readRes.hash || null,
        backup: true,
      }, opts?.ctx)

      return ok({
        tool: 'doc_edit',
        path: writeRes.path || filePath,
        operation: args.operation,
        changes: edited.changes,
        bytes: writeRes.bytes,
        hash: writeRes.hash,
      })
    } catch (e) {
      return fail(e)
    }
  },
}
