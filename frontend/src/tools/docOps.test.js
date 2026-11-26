import { describe, it, expect } from 'vitest'
import { generateRealDocx, generateRealXlsx } from './docGenerator'
import { extractDocxFromBuffer, extractXlsxFromBuffer, extractPptxFromBuffer } from './docExtractors'
import { editDocxBuffer, editXlsxBuffer, editPptxBuffer, editPdfBuffer } from './docOps'

function b64ToBuf(b64) {
  const bytes = Buffer.from(b64, 'base64')
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

describe('Real OOXML creation, structured retrieval, and in-place editing', () => {
  it('creates a real .docx ZIP, extracts headings/tables, and edits in-place', async () => {
    const created = await generateRealDocx({
      title: 'Architecture Spec',
      content: '# Overview\nHello {{client}}\n\n| Service | Port |\n|---|---|\n| API | 8080 |',
    })
    expect(created.success).toBe(true)
    expect(created.filename).toBe('architecture_spec.docx')

    const buf = b64ToBuf(created.base64)
    const extracted = await extractDocxFromBuffer(buf)
    expect(extracted).toContain('# Overview')
    expect(extracted).toContain('Hello {{client}}')
    expect(extracted).toContain('| Service | Port |')
    expect(extracted).toContain('| API | 8080 |')

    const replaced = await editDocxBuffer(buf, {
      operation: 'replace_text',
      replacements: { '{{client}}': 'Acme Corp' },
    })
    expect(replaced.changes).toBe(1)

    const appended = await editDocxBuffer(replaced.bytes.buffer, {
      operation: 'append_section',
      heading: 'Next Steps',
      paragraphs: ['Deploy to staging.'],
    })
    const finalDoc = await extractDocxFromBuffer(appended.bytes.buffer)
    expect(finalDoc).toContain('Hello Acme Corp')
    expect(finalDoc).toContain('## Next Steps')
    expect(finalDoc).toContain('Deploy to staging.')
  })

  it('creates a real .xlsx workbook, extracts sheets, and edits cells/rows/sheets', async () => {
    const created = await generateRealXlsx({
      title: 'Budget',
      columns: ['Item', 'Cost'],
      rows: [['Hosting', 100]],
    })
    expect(created.success).toBe(true)
    const buf = b64ToBuf(created.base64)
    const extracted = await extractXlsxFromBuffer(buf)
    expect(extracted).toContain('=== Sheet: Budget')
    expect(extracted).toContain('Hosting,100')

    const updated = await editXlsxBuffer(buf, {
      operation: 'update_cells',
      cells: { B2: 250 },
    })
    const appended = await editXlsxBuffer(updated.bytes.buffer, {
      operation: 'append_rows',
      rows: [['Domain', 15]],
    })
    const withSheet = await editXlsxBuffer(appended.bytes.buffer, {
      operation: 'add_sheet',
      sheet_name: 'Summary',
      columns: ['Total'],
      rows: [[265]],
    })

    const finalText = await extractXlsxFromBuffer(withSheet.bytes.buffer)
    expect(finalText).toContain('Hosting,250')
    expect(finalText).toContain('Domain,15')
    expect(finalText).toContain('=== Sheet: Summary')
    expect(finalText).toContain('265')
  })

  it('extracts and edits .pptx slides and speaker notes', async () => {
    const JSZip = (await import('jszip')).default || (await import('jszip'))
    const zip = new JSZip()
    zip.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello {{product}}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>')
    zip.file('ppt/notesSlides/notesSlide1.xml', '<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Speaker note</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>')
    const buf = await zip.generateAsync({ type: 'arraybuffer' })

    const text = await extractPptxFromBuffer(buf)
    expect(text).toContain('## Slide 1')
    expect(text).toContain('Hello {{product}}')
    expect(text).toContain('> Notes: Speaker note')

    const edited = await editPptxBuffer(buf, {
      operation: 'replace_text',
      old_text: '{{product}}',
      new_text: 'Yogatik',
    })
    expect(edited.changes).toBe(1)
    const after = await extractPptxFromBuffer(edited.bytes.buffer)
    expect(after).toContain('Hello Yogatik')
  })

  it('edits PDFs in-place (watermark, extract_pages, delete_pages)', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const pdf = await PDFDocument.create()
    pdf.addPage()
    pdf.addPage()
    pdf.addPage()
    const bytes = await pdf.save()

    const watermarked = await editPdfBuffer(bytes.buffer, {
      operation: 'add_watermark',
      text: 'CONFIDENTIAL',
      opacity: 0.25,
    })
    expect(watermarked.changes).toBe(3)

    const deleted = await editPdfBuffer(watermarked.bytes.buffer, {
      operation: 'delete_pages',
      pages: [2],
    })
    const loadedAfterDelete = await PDFDocument.load(deleted.bytes)
    expect(loadedAfterDelete.getPageCount()).toBe(2)

    const extracted = await editPdfBuffer(deleted.bytes.buffer, {
      operation: 'extract_pages',
      pages: [1],
    })
    const loadedAfterExtract = await PDFDocument.load(extracted.bytes)
    expect(loadedAfterExtract.getPageCount()).toBe(1)
  })
})
