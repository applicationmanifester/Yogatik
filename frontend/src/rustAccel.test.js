import { describe, it, expect, afterEach } from 'vitest'
import {
  isRustAccelAvailable,
  estimateTokensFast,
  routeQueryFast,
  topKSimilarityFast,
  analyzeAudioFast,
} from './rustAccel'

describe('rustAccel bridge (with JS fallback)', () => {
  afterEach(() => {
    delete window.__YOGATIK_RUST__
  })

  it('falls back cleanly to JS when Electron Rust bridge is absent', async () => {
    expect(isRustAccelAvailable()).toBe(false)
    const tok = await estimateTokensFast('hello world')
    expect(tok.engine).toBe('js')
    expect(tok.tokens).toBeGreaterThan(0)

    const route = await routeQueryFast('refactor this rust function', false)
    expect(route).toEqual({ intent: 'code', engine: 'js' })

    const top = await topKSimilarityFast([1, 0], [[0, 1], [0.9, 0.1]], 1)
    expect(top.indices).toEqual([1])
    expect(top.engine).toBe('js')

    const audio = await analyzeAudioFast(new Float32Array([0.2, -0.2, 0.2, -0.2]), 16000)
    expect(audio.speechActive).toBe(true)
    expect(audio.engine).toBe('js')
  })

  it('uses native Rust bridge when window.__YOGATIK_RUST__ is exposed', async () => {
    window.__YOGATIK_RUST__ = {
      tokens: async () => ({ tokens: 42, chars: 150, cjkChars: 5 }),
      route: async () => ({ intent: 'visual' }),
      topk: async () => ({ indices: [2, 0], scores: [0.99, 0.42] }),
      audio: async () => ({ rms: 0.2, zcr: 0.05, pitchHz: 180, snrDb: 28, speechActive: true, emotion: 'neutral', confidence: 0.8 }),
    }
    expect(isRustAccelAvailable()).toBe(true)

    const tok = await estimateTokensFast('anything')
    expect(tok).toEqual({ tokens: 42, chars: 150, cjkChars: 5, engine: 'rust' })

    const route = await routeQueryFast('what is this', true)
    expect(route).toEqual({ intent: 'visual', engine: 'rust' })

    const top = await topKSimilarityFast([1, 0], [[0, 1], [0.5, 0.5], [1, 0]], 2)
    expect(top).toEqual({ indices: [2, 0], scores: [0.99, 0.42], engine: 'rust' })

    const audio = await analyzeAudioFast([0.1, 0.2], 16000)
    expect(audio.engine).toBe('rust')
    expect(audio.pitchHz).toBe(180)
  })
})
