import { describe, it, expect } from 'vitest'
import {
  triadRank,
  extractEntityTriples,
  queryKnowledgeGraph,
  formatKnowledgeGraphPrompt,
  consolidateMemories,
  selectForPrompt,
} from './memory4'

describe('Memory4 Enhanced Cognitive Architecture', () => {
  it('ranks memories using the multi-factor Triad function', () => {
    const items = [
      { id: 1, store: 'semantic', text: 'User works with React and TypeScript', importance: 0.9, refCount: 4, at: Date.now() },
      { id: 2, store: 'episodic', text: 'Had pizza for dinner', importance: 0.2, refCount: 0, at: Date.now() - 60 * 24 * 60 * 60 * 1000 },
    ]

    const ranked = triadRank(items, 'React TypeScript')
    expect(ranked[0].it.id).toBe(1)
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('extracts structured entity relation triples from text', () => {
    const text = 'The user prefers TypeScript over JavaScript. The project runs on Vite.'
    const triples = extractEntityTriples(text)

    expect(triples.length).toBeGreaterThanOrEqual(2)
    const userPref = triples.find(t => t.subject === 'User' && t.predicate === 'prefers')
    expect(userPref).toBeDefined()
    expect(userPref.object.toLowerCase()).toContain('typescript')
  })

  it('queries knowledge graph triples deterministically', () => {
    const triples = [
      { subject: 'User', predicate: 'prefers', object: 'Tailwind CSS' },
      { subject: 'Project', predicate: 'uses', object: 'Electron' },
    ]

    const hits = queryKnowledgeGraph(triples, 'tailwind')
    expect(hits.length).toBe(1)
    expect(hits[0].subject).toBe('User')
  })

  it('formats knowledge graph triples into system prompt markdown', () => {
    const triples = [
      { subject: 'User', predicate: 'prefers', object: 'Tailwind' },
    ]
    const prompt = formatKnowledgeGraphPrompt(triples)
    expect(prompt).toContain('STRUCTURED ENTITY KNOWLEDGE GRAPH')
    expect(prompt).toContain('(User) --[prefers]--> (Tailwind)')
  })

  it('consolidates duplicate memories and prunes decayed items', () => {
    const now = Date.now()
    const memories = [
      { id: 1, store: 'semantic', text: 'User prefers dark theme in editor', importance: 0.8, at: now - 1000 },
      { id: 2, store: 'semantic', text: 'User prefers dark theme in editor', importance: 0.9, at: now },
      { id: 3, store: 'episodic', text: 'Read trivial comment online', importance: 0.1, at: now - 90 * 24 * 60 * 60 * 1000, refCount: 0 },
    ]

    const res = consolidateMemories(memories, { now })
    expect(res.consolidatedCount).toBe(1)
    expect(res.prunedCount).toBe(1)
    expect(res.active.length).toBe(1)
    expect(res.active[0].importance).toBe(0.9)
  })

  it('selects relevant memories with store caps', () => {
    const items = [
      { id: 1, store: 'semantic', text: 'User prefers dark theme', importance: 0.8, at: Date.now() },
      { id: 2, store: 'procedural', text: 'Format code with Prettier', importance: 0.7, at: Date.now() },
    ]

    const selected = selectForPrompt(items, 'dark theme')
    expect(selected.length).toBeGreaterThan(0)
    expect(selected[0].store).toBe('semantic')
  })
})
