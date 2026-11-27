import { describe, it, expect, vi } from 'vitest'
import { pdfExtractTool, reconstructPageText } from './pdfExtract'

describe('pdfExtractTool', () => {
  it('has a valid tool schema with url, startPage, endPage, maxPages, and ocrFallback parameters', () => {
    expect(pdfExtractTool.schema).toBeDefined()
    expect(pdfExtractTool.schema.description).toContain('Extract')
    expect(pdfExtractTool.schema.parameters.required).toContain('url')
    expect(pdfExtractTool.schema.parameters.properties.ocrFallback).toBeDefined()
    expect(pdfExtractTool.schema.parameters.properties.startPage).toBeDefined()
    expect(pdfExtractTool.schema.parameters.properties.endPage).toBeDefined()
  })

  it('reconstructs lines, paragraphs, and tabular columns from positioned pdf.js text items', () => {
    const items = [
      { str: 'Quarterly', transform: [1, 0, 0, 12, 50, 700], width: 55, height: 12 },
      { str: 'Report', transform: [1, 0, 0, 12, 110, 700], width: 40, height: 12 },
      { str: 'ColA', transform: [1, 0, 0, 10, 50, 660], width: 25, height: 10 },
      { str: 'ColB', transform: [1, 0, 0, 10, 200, 660], width: 25, height: 10 },
      { str: '100', transform: [1, 0, 0, 10, 50, 646], width: 20, height: 10 },
      { str: '200', transform: [1, 0, 0, 10, 200, 646], width: 20, height: 10 },
    ]
    const out = reconstructPageText(items)
    expect(out).toBe('Quarterly Report\n\nColA\tColB\n100\t200')
  })

  it('fails gracefully when no url is provided', async () => {
    const res = await pdfExtractTool.execute({})
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/required/i)
  })

  it('handles invalid or unreachable PDF URLs without throwing unhandled exceptions', async () => {
    const res = await pdfExtractTool.execute({ url: 'blob:invalid-dummy-url' })
    expect(res.success).toBe(false)
    expect(res.error).toBeDefined()
  })
})
