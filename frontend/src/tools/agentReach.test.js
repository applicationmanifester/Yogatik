import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  detectPlatform,
  searchPlatform,
  fetchPost,
  extractVideoInfo,
  agentReachTool,
  SUPPORTED_PLATFORMS,
} from './agentReach'

describe('Agent-Reach Multi-Platform Intelligence Suite', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('supports 13+ content, code, video, and social platforms', () => {
    expect(SUPPORTED_PLATFORMS.length).toBeGreaterThanOrEqual(13)
    const ids = SUPPORTED_PLATFORMS.map(p => p.id)
    expect(ids).toContain('twitter')
    expect(ids).toContain('reddit')
    expect(ids).toContain('youtube')
    expect(ids).toContain('github')
    expect(ids).toContain('hackernews')
    expect(ids).toContain('xiaohongshu')
    expect(ids).toContain('bilibili')
  })

  it('detects platform correctly from various URLs', () => {
    expect(detectPlatform('https://twitter.com/OpenAI/status/12345')).toBe('twitter')
    expect(detectPlatform('https://x.com/perplexity_ai')).toBe('twitter')
    expect(detectPlatform('https://www.reddit.com/r/MachineLearning/comments/xyz')).toBe('reddit')
    expect(detectPlatform('https://github.com/Panniantong/Agent-Reach')).toBe('github')
    expect(detectPlatform('https://news.ycombinator.com/item?id=45678')).toBe('hackernews')
    expect(detectPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube')
    expect(detectPlatform('https://example.com/page')).toBe('web')
  })

  it('searches platforms and returns structured results', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [
          { title: 'Show HN: AI Agents', objectID: '123', author: 'tester', points: 50, num_comments: 12, created_at: '2026-11-20' },
        ],
      }),
    })
    const result = await searchPlatform('hackernews', 'AI agents', 3)
    expect(result.platform).toBe('hackernews')
    expect(result.query).toBe('AI agents')
    expect(Array.isArray(result.results)).toBe(true)
    expect(result.results.length).toBeGreaterThan(0)
  })

  it('extracts YouTube video metadata and thumbnail', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        title: 'Rick Astley - Never Gonna Give You Up',
        author_name: 'Rick Astley',
        author_url: 'https://www.youtube.com/@RickAstleyYT',
        thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      }),
    })
    const video = await extractVideoInfo('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(video.success).toBe(true)
    expect(video.platform).toBe('youtube')
    expect(video.videoId).toBe('dQw4w9WgXcQ')
    expect(video.thumbnailUrl).toContain('dQw4w9WgXcQ')
  })

  it('agentReachTool executes platform search, post fetch, and platform listing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          children: [
            { data: { title: 'Deep Learning Update', subreddit: 'MachineLearning', author: 'researcher', score: 100, num_comments: 20, permalink: '/r/MachineLearning/comments/123', selftext: 'Details...' } },
          ],
        },
      }),
    })
    const listRes = await agentReachTool.execute({ action: 'list_platforms' })
    expect(listRes.success).toBe(true)
    expect(listRes.totalPlatforms).toBeGreaterThanOrEqual(13)

    const searchRes = await agentReachTool.execute({
      action: 'search_platform',
      platform: 'reddit',
      query: 'deep learning',
      limit: 2,
    })
    expect(searchRes.success).toBe(true)
    expect(searchRes.platform).toBe('reddit')

    const videoRes = await agentReachTool.execute({
      action: 'extract_video',
      url: 'https://youtu.be/dQw4w9WgXcQ',
    })
    expect(videoRes.success).toBe(true)
    expect(videoRes.videoId).toBe('dQw4w9WgXcQ')
  })
})
