import { describe, it, expect } from 'vitest'
import {
  chunkText,
  scoreBM25,
  generateDenseVector,
  cosineSimilarity,
  reciprocalRankFusion,
  heuristicRerank,
  generateHydeExpansions,
  hierarchicalChunkText,
  enrichChunksWithContext,
  evaluateRetrievalConfidence,
  haystackRagTool,
} from './haystackRag'

describe('Haystack & LlamaIndex Hybrid RAG Pipeline', () => {
  const sampleDoc = `
JavaScript is a high-level programming language that conforms to the ECMAScript specification.
It has first-class functions and dynamic typing.

Python is an interpreted, high-level, general-purpose programming language.
Python's design philosophy emphasizes code readability with its notable use of significant indentation.

Rust is a multi-paradigm, general-purpose programming language that emphasizes performance, type safety, and concurrency.
Rust enforces memory safety without requiring a garbage collector.
`

  it('chunks documents recursively with metadata attribution', () => {
    const chunks = chunkText(sampleDoc, { chunkSize: 120, metadata: { source: 'languages.txt' } })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].id).toBe('chunk_0')
    expect(chunks[0].metadata.source).toBe('languages.txt')
  })

  it('calculates BM25 keyword relevance scores', () => {
    const chunks = [
      { id: 'c1', text: 'Rust provides memory safety without a garbage collector.' },
      { id: 'c2', text: 'Python uses dynamic typing and indentation.' },
    ]

    const scores = scoreBM25('memory safety', chunks)
    expect(scores[0]).toBeGreaterThan(scores[1])
  })

  it('generates dense vectors and computes cosine similarity', () => {
    const v1 = generateDenseVector('Rust systems programming')
    const v2 = generateDenseVector('Rust systems programming')
    const v3 = generateDenseVector('Cooking Italian pizza recipes')

    const simHigh = cosineSimilarity(v1, v2)
    const simLow = cosineSimilarity(v1, v3)

    expect(simHigh).toBeCloseTo(1.0, 4)
    expect(simHigh).toBeGreaterThan(simLow)
  })

  it('merges rankings using Reciprocal Rank Fusion (RRF)', () => {
    const sparse = [
      { id: 'c1', text: 'match' },
      { id: 'c2', text: 'other' },
    ]
    const dense = [
      { id: 'c2', text: 'other' },
      { id: 'c1', text: 'match' },
    ]

    const fused = reciprocalRankFusion(sparse, dense)
    expect(fused.length).toBe(2)
    expect(fused[0].rrfScore).toBeDefined()
  })

  it('generates HyDE hypothetical query expansions', () => {
    const expansions = generateHydeExpansions('how to scale PostgreSQL')
    expect(expansions.length).toBe(2)
    expect(expansions[0]).toContain('how to scale PostgreSQL')
  })

  it('executes full hybrid search via haystackRagTool.execute', async () => {
    const res = await haystackRagTool.execute({
      action: 'hybrid_search',
      query: 'memory safety garbage collector',
      documentText: sampleDoc,
      topK: 2,
    })

    expect(res.results.length).toBe(2)
    expect(res.results[0].text.toLowerCase()).toContain('rust')
    expect(res.results[0].rerankScore).toBeGreaterThan(0)
  })

  it('performs hierarchical parent-child chunking preserving parentText', () => {
    const res = hierarchicalChunkText(sampleDoc, { parentSize: 200, childSize: 80 })
    expect(res.parents.length).toBeGreaterThan(0)
    expect(res.children.length).toBeGreaterThan(res.parents.length)
    expect(res.children[0].parentId).toBe(res.parents[0].id)
    expect(res.children[0].parentText).toBe(res.parents[0].text)
  })

  it('enriches chunks with document title and section headers', () => {
    const chunks = [{ id: 'c1', text: 'Vite is a build tool' }]
    const enriched = enrichChunksWithContext(chunks, { documentTitle: 'Vite Guide', section: 'Overview' })
    expect(enriched[0].text).toContain('[Document: Vite Guide]')
    expect(enriched[0].text).toContain('[Section: Overview]')
    expect(enriched[0].enriched).toBe(true)
  })

  it('evaluates Corrective RAG (CRAG) retrieval confidence', () => {
    const confidentPassages = [
      { id: '1', text: 'PostgreSQL connection pooling with PgBouncer', rerankScore: 0.9 },
    ]
    const highConf = evaluateRetrievalConfidence('PostgreSQL connection pooling', confidentPassages)
    expect(highConf.confident).toBe(true)
    expect(highConf.status).toBe('confident')
    expect(highConf.action).toBe('synthesize')

    const irrelevantPassages = [
      { id: '2', text: 'Baking sourdough bread at home', rerankScore: 0.05 },
    ]
    const lowConf = evaluateRetrievalConfidence('PostgreSQL connection pooling', irrelevantPassages)
    expect(lowConf.confident).toBe(false)
    expect(lowConf.status).toBe('irrelevant')
    expect(lowConf.action).toBe('web_search_fallback')
  })
})
