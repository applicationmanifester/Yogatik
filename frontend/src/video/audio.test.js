import { describe, it, expect } from 'vitest'
import { mixPcm, applyEdgeFades, normalizeSpeechPcm, planNarration, captionCues, cueAt, synthesizeBed, synthesizeTransitionSfx, duckPcm } from './audio'
import { cleanForSpeech, estimateSpeechSeconds, splitSpeechChunks, synthesizeScene } from './speech'

const tone = (n, v = 0.5) => Float32Array.from({ length: n }, () => v)

describe('mixPcm', () => {
  it('lays each clip at its offset on a silent bed', () => {
    const out = mixPcm([{ pcm: tone(4), startSec: 1 }], 4, 3)
    expect(out.length).toBe(12)
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 0, 0])
    expect(Array.from(out.slice(4, 8))).toEqual([0.5, 0.5, 0.5, 0.5])
  })

  it('never writes past the end of the video', () => {
    const out = mixPcm([{ pcm: tone(100), startSec: 0.9 }], 10, 1)
    expect(out.length).toBe(10)
    expect(out.every(Number.isFinite)).toBe(true)
  })

  it('normalises only when overlapping clips would clip', () => {
    const quiet = mixPcm([{ pcm: tone(4, 0.4), startSec: 0 }], 4, 1)
    expect(quiet[0]).toBeCloseTo(0.4, 5)          // untouched
    const loud = mixPcm([
      { pcm: tone(4, 0.8), startSec: 0 },
      { pcm: tone(4, 0.8), startSec: 0 },
    ], 4, 1)
    expect(Math.max(...loud)).toBeCloseTo(1, 5)   // scaled down, not distorted
  })
})

describe('applyEdgeFades', () => {
  it('ramps both ends so clips do not click', () => {
    const pcm = applyEdgeFades(tone(100), 1000, 20)
    expect(pcm[0]).toBe(0)
    expect(pcm[pcm.length - 1]).toBe(0)
    expect(pcm[50]).toBeCloseTo(0.5, 5)
  })
})

describe('planNarration', () => {
  it('stretches a scene to fit a line that outruns it', () => {
    const { durations } = planNarration([{ seconds: 3, speechSec: 6 }], { lead: 0.35, tail: 0.45 })
    expect(durations[0]).toBeCloseTo(6.8, 5)
  })

  it('never shortens a scene the author sized deliberately', () => {
    const { durations } = planNarration([{ seconds: 10, speechSec: 2 }])
    expect(durations[0]).toBe(10)
  })

  it('leaves silent scenes and their timing alone', () => {
    const { durations, starts, totalSec } = planNarration([
      { seconds: 4, speechSec: 0 },
      { seconds: 2, speechSec: 3 },
    ])
    expect(durations[0]).toBe(4)
    expect(starts[0]).toBeNull()
    expect(starts[1]).toBeCloseTo(4.35, 5)   // after scene 1, plus lead-in
    expect(totalSec).toBeCloseTo(4 + 3.8, 5)
  })
})

describe('captions', () => {
  it('splits narration into cues that tile the scene', () => {
    const cues = captionCues('One two. Three four five!', 10)
    expect(cues).toHaveLength(2)
    expect(cues[0].start).toBe(0)
    expect(cues[cues.length - 1].end).toBeCloseTo(10, 5)
  })

  it('gives longer sentences more screen time', () => {
    const [short, long] = captionCues('Hi. A considerably longer sentence here.', 10)
    expect(long.end - long.start).toBeGreaterThan(short.end - short.start)
  })

  it('finds the cue on screen at a moment', () => {
    const cues = captionCues('One. Two.', 10)
    expect(cueAt(cues, 0).text).toBe('One.')
    expect(cueAt(cues, 9.9).text).toBe('Two.')
    expect(cueAt([], 1)).toBeNull()
  })
})

describe('speech text preparation', () => {
  it('strips what only makes sense on a page', () => {
    expect(cleanForSpeech('See **this** [link](https://x.com) and `code`')).toBe('See this link and code')
    expect(cleanForSpeech('```js\nconst a = 1\n```\nDone')).toBe('Done')
  })

  it('estimates duration from word count', () => {
    expect(estimateSpeechSeconds('')).toBe(0)
    const ten = estimateSpeechSeconds('one two three four five six seven eight nine ten')
    expect(ten).toBeGreaterThan(3)
    expect(ten).toBeLessThan(5)
    expect(estimateSpeechSeconds('one two three', 1.5)).toBeLessThan(estimateSpeechSeconds('one two three', 1))
  })
})

describe('procedural soundtrack & ducking', () => {
  it('synthesizes ambient and march beds of exact duration', () => {
    const amb = synthesizeBed(2, 1000, { style: 'ambient' })
    const mar = synthesizeBed(2, 1000, { style: 'march' })
    expect(amb.length).toBe(2000)
    expect(mar.length).toBe(2000)
    expect(amb.every(Number.isFinite)).toBe(true)
    expect(mar.some(v => Math.abs(v) > 0.01)).toBe(true)
  })

  it('synthesizes finite transition sfx with faded edges', () => {
    const sfx = synthesizeTransitionSfx(1000, { durationSec: 0.2 })
    expect(sfx.length).toBe(200)
    expect(sfx[0]).toBeCloseTo(0, 6)
    expect(sfx[sfx.length - 1]).toBeCloseTo(0, 6)
    expect(sfx.some(v => Math.abs(v) > 0.01)).toBe(true)
  })

  it('ducks background bed during speech windows and restores outside', () => {
    const bed = tone(3000, 0.4)
    const ducked = duckPcm(bed, [{ startSec: 1.0, endSec: 2.0 }], 1000, { duckGain: 0.25, fadeSec: 0.1 })
    expect(ducked[500]).toBeCloseTo(0.4, 5)
    expect(ducked[1500]).toBeCloseTo(0.1, 5)
    expect(ducked[2500]).toBeCloseTo(0.4, 5)
  })

  it('synthesizes upbeat bed of exact duration', () => {
    const up = synthesizeBed(2, 1000, { style: 'upbeat' })
    expect(up.length).toBe(2000)
    expect(up.every(Number.isFinite)).toBe(true)
    expect(up.some(v => Math.abs(v) > 0.01)).toBe(true)
  })
})

describe('speech chunking, scene synthesis & loudness normalization', () => {
  it('splits long narration at sentence and clause boundaries', () => {
    const longText = 'First sentence is short. ' + 'A very long clause that keeps going, '.repeat(8) + 'end.'
    const chunks = splitSpeechChunks(longText, 120)
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.every(c => c.text.length <= 120)).toBe(true)
    expect(chunks[chunks.length - 1].pauseAfterSec).toBe(0)
  })

  it('stitches scene narration with exact measured subtitle cues', async () => {
    const mockSynth = async (text) => ({
      pcm: new Float32Array(2400).fill(0.2), // 0.1s at 24kHz
      sampleRate: 24000,
    })
    const res = await synthesizeScene('Hello world. Second sentence!', { _synthFn: mockSynth })
    expect(res.cues).toHaveLength(2)
    expect(res.cues[0]).toMatchObject({ text: 'Hello world.', start: 0 })
    expect(res.cues[0].end).toBeCloseTo(0.1, 3)
    expect(res.cues[1].start).toBeGreaterThan(res.cues[0].end) // includes pause
    expect(res.seconds).toBeGreaterThan(0.3)
  })

  it('normalizes quiet speech up and soft-limits peaks below 1.0', () => {
    const quiet = Float32Array.from({ length: 1000 }, (_, i) => (i % 2 === 0 ? 0.04 : -0.04))
    const norm = normalizeSpeechPcm(quiet, { targetRms: 0.18 })
    expect(Math.abs(norm[0])).toBeGreaterThan(0.1)

    const hot = Float32Array.from({ length: 1000 }, () => 0.9)
    const limited = normalizeSpeechPcm(hot, { targetRms: 0.5, maxGain: 3, ceiling: 0.9 })
    expect(Math.max(...limited)).toBeLessThan(1.0)
  })
})
