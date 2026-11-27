import { describe, it, expect } from 'vitest'
import { isLikelyTextFile, extractFileText, extractRtfText, extractXlsxFromBuffer } from './docExtractors'

describe('docExtractors: file classification and text extraction', () => {
  it('recognizes code and configuration files as text', async () => {
    const pyFile = new File(['def hello():\n    return "world"'], 'script.py', { type: 'text/x-python' })
    const sqlFile = new File(['SELECT * FROM users WHERE id = 1;'], 'query.sql', { type: '' })
    const jsonFile = new File(['{"name":"test"}'], 'data.json', { type: 'application/json' })
    const envFile = new File(['API_KEY=secret\nPORT=3000'], '.env.production', { type: '' })
    const rustFile = new File(['fn main() { println!("hi"); }'], 'main.rs', { type: '' })

    expect(await isLikelyTextFile(pyFile)).toBe(true)
    expect(await isLikelyTextFile(sqlFile)).toBe(true)
    expect(await isLikelyTextFile(jsonFile)).toBe(true)
    expect(await isLikelyTextFile(envFile)).toBe(true)
    expect(await isLikelyTextFile(rustFile)).toBe(true)
  })

  it('correctly extracts plain text and code content', async () => {
    const codeContent = 'export const add = (a, b) => a + b;'
    const tsFile = new File([codeContent], 'math.ts', { type: 'text/typescript' })
    const res = await extractFileText(tsFile)
    expect(res).toBe(codeContent)
  })

  it('recognizes universal text files via byte inspection', async () => {
    // Custom unknown extension with plain text
    const customText = new File(['custom config text format'], 'config.customext', { type: '' })
    expect(await isLikelyTextFile(customText)).toBe(true)
    const extracted = await extractFileText(customText)
    expect(extracted).toBe('custom config text format')
  })

  it('rejects binary files with null characters safely', async () => {
    // Binary file containing null bytes (e.g. executable/binary header)
    const binaryData = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x01, 0x00])
    const binFile = new File([binaryData], 'program.bin', { type: 'application/octet-stream' })

    expect(await isLikelyTextFile(binFile)).toBe(false)
    await expect(extractFileText(binFile)).rejects.toThrow(/Unsupported file type/)
  })

  it('correctly reads text files with UTF-16LE BOM', async () => {
    // BOM 0xFF 0xFE followed by 'H' (0x48 0x00) and 'i' (0x69 0x00)
    const utf16Bytes = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00])
    const utf16File = new File([utf16Bytes], 'export.txt', { type: 'text/plain' })

    expect(await isLikelyTextFile(utf16File)).toBe(true)
    const text = await extractFileText(utf16File)
    expect(text).toBe('Hi')
  })

  it('recognizes subtitle and ndjson files', async () => {
    const srt = new File(['1\n00:00:01,000 --> 00:00:04,000\nHello'], 'captions.srt', { type: '' })
    const ndjson = new File(['{"id":1}\n{"id":2}'], 'stream.ndjson', { type: '' })
    expect(await isLikelyTextFile(srt)).toBe(true)
    expect(await isLikelyTextFile(ndjson)).toBe(true)
  })

  it('extracts clean plain text from RTF files without raw control codes', async () => {
    const rtf = String.raw`{\rtf1\ansi{\fonttbl\f0 Arial;}Hello \b World\b0\par Second line}`
    expect(extractRtfText(rtf)).toBe('Hello World\nSecond line')
    const rtfFile = new File([rtf], 'notes.rtf', { type: 'application/rtf' })
    expect(await extractFileText(rtfFile)).toBe('Hello World\nSecond line')
  })

  it('formats Excel sheets as Markdown tables and supports sheet filtering', async () => {
    const XLSX = (await import('xlsx')).default || (await import('xlsx'))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Item', 'Qty'], ['Pen', 5]]), 'Inventory')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Month', 'Rev'], ['Jan', 100]]), 'Sales')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })

    const all = await extractXlsxFromBuffer(buf, { format: 'markdown' })
    expect(all).toContain('Workbook: 2 sheets')
    expect(all).toContain('| Item | Qty |')
    expect(all).toContain('| Pen | 5 |')

    const filtered = await extractXlsxFromBuffer(buf, { sheetName: 'Sales' })
    expect(filtered).toContain('=== Sheet: Sales')
    expect(filtered).toContain('Jan,100')
    expect(filtered).not.toContain('Inventory')
  })
})
