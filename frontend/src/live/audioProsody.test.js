import { describe, it, expect } from 'vitest'
import { analyzeVoiceProsody, summarizeVoiceEmotion } from './audioProsody'
import { classifyLiveQuery } from './reflexEngine'

describe('analyzeVoiceProsody', () => {
  it('detects silence as inactive calm', () => {
    const res = analyzeVoiceProsody(new Float32Array(512), 16000)
    expect(res.speechActive).toBe(false)
    expect(res.emotion).toBe('calm')
  })

  it('estimates fundamental pitch F0 for active speech tone', () => {
    const sr = 16000
    const buf = new Float32Array(1024)
    for (let i = 0; i < buf.length; i++) {
      buf[i] = 0.2 * Math.sin((2 * Math.PI * 200 * i) / sr)
    }
    const res = analyzeVoiceProsody(buf, sr)
    expect(res.speechActive).toBe(true)
    expect(Math.abs(res.pitchHz - 200)).toBeLessThan(10)
  })

  it('summarizes emotion history', () => {
    const summary = summarizeVoiceEmotion([
      { emotion: 'curious', confidence: 0.7 },
      { emotion: 'curious', confidence: 0.8 },
      { emotion: 'calm', confidence: 0.6 },
    ])
    expect(summary.emotion).toBe('curious')
  })
})

describe('classifyLiveQuery', () => {
  it('routes simple chat without heavy tools or deep_research', () => {
    const r = classifyLiveQuery('explain closures in javascript', { hasVisualSource: false })
    expect(r.intent).toBe('chat')
    expect(r.toolsEnabled).toBe(false)
    expect(r.allowDeepResearch).toBe(false)
  })

  it('routes news queries to fast search without deep_research', () => {
    const r = classifyLiveQuery('what are the latest news headlines today', { hasVisualSource: false })
    expect(r.intent).toBe('search')
    expect(r.toolsEnabled).toBe(true)
    expect(r.allowDeepResearch).toBe(false)
  })

  it('routes explicit deep research and visual queries appropriately', () => {
    expect(classifyLiveQuery('do deep research on fusion energy').allowDeepResearch).toBe(true)
    expect(classifyLiveQuery('what am I holding', { hasVisualSource: true }).intent).toBe('visual')
  })
})
