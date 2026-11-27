/**
 * Real Token Usage Tracker
 *
 * Extracts actual token usage from provider responses instead of character-based estimation.
 * Falls back to estimation when provider doesn't return usage metadata.
 *
 * Supports OpenAI, Anthropic, Gemini, Groq, OpenRouter, NVIDIA, DeepSeek, Mistral, Perplexity, Cohere, xAI, Cerebras, Ollama formats.
 */

import { estimateConversationTokens, estimateTokensFromText } from './tokenEstimator'

/**
 * Format token count for display
 * @param {number} num
 * @returns {string}
 */
export function formatTokenCount(num) {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
  return String(num)
}

/**
 * Extract token usage from a provider's streaming or non-streaming response.
 * @param {Object} data - Parsed response data
 * @param {string} provider - Provider ID
 * @returns {Object|null} { promptTokens, completionTokens, totalTokens } or null if unavailable
 */
export function extractUsageFromResponse(data, provider) {
  if (!data || typeof data !== 'object') return null

  // Standard OpenAI-compatible format (OpenAI, Groq, OpenRouter, NVIDIA, DeepSeek, Mistral, etc.)
  if (data.usage && typeof data.usage === 'object') {
    const { prompt_tokens, completion_tokens, total_tokens, input_tokens, output_tokens } = data.usage
    
    // Some providers use different field names
    const prompt = prompt_tokens ?? input_tokens ?? 0
    const completion = completion_tokens ?? output_tokens ?? 0
    const total = total_tokens ?? (prompt + completion)
    
    if (prompt > 0 || completion > 0 || total > 0) {
      return { promptTokens: prompt, completionTokens: completion, totalTokens: total }
    }
  }

  // Anthropic format
  if (provider === 'anthropic' || data.type === 'message') {
    if (data.usage) {
      return {
        promptTokens: data.usage.input_tokens || 0,
        completionTokens: data.usage.output_tokens || 0,
        totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
      }
    }
  }

  // Gemini format
  if (provider === 'gemini' || data.usageMetadata) {
    if (data.usageMetadata) {
      return {
        promptTokens: data.usageMetadata.promptTokenCount || 0,
        completionTokens: data.usageMetadata.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata.totalTokenCount || 0,
      }
    }
  }

  // Cohere format
  if (provider === 'cohere' && data.meta?.tokens) {
    return {
      promptTokens: data.meta.tokens.input_tokens || 0,
      completionTokens: data.meta.tokens.output_tokens || 0,
      totalTokens: (data.meta.tokens.input_tokens || 0) + (data.meta.tokens.output_tokens || 0),
    }
  }

  // Perplexity format
  if (provider === 'perplexity' && data.usage) {
    return {
      promptTokens: data.usage.prompt_tokens || 0,
      completionTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0,
    }
  }

  // xAI/Grok format
  if (provider === 'xai' && data.usage) {
    return {
      promptTokens: data.usage.prompt_tokens || 0,
      completionTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0,
    }
  }

  // Cerebras format
  if (provider === 'cerebras' && data.usage) {
    return {
      promptTokens: data.usage.prompt_tokens || 0,
      completionTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0,
    }
  }

  // Ollama format (top-level prompt_eval_count / eval_count OR nested under usage)
  if (
    provider === 'ollama' ||
    typeof data.prompt_eval_count === 'number' ||
    typeof data.eval_count === 'number'
  ) {
    const src = data.usage && typeof data.usage === 'object' ? data.usage : data
    const prompt = src.prompt_eval_count || 0
    const completion = src.eval_count || 0
    if (prompt > 0 || completion > 0) {
      return {
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: prompt + completion,
      }
    }
  }

  return null
}

/**
 * Extract token usage from streaming response chunks.
 * Accumulates usage from the final chunk that contains usage metadata.
 * @param {Object} chunk - Parsed streaming chunk
 * @param {string} provider - Provider ID
 * @returns {Object|null} { promptTokens, completionTokens, totalTokens } or null if not in this chunk
 */
export function extractUsageFromStreamChunk(chunk, provider) {
  if (!chunk || typeof chunk !== 'object') return null

  // Anthropic streaming: message_start carries input_tokens on chunk.message.usage
  if (chunk.type === 'message_start' && chunk.message?.usage) {
    return extractUsageFromResponse({ usage: chunk.message.usage }, 'anthropic')
  }

  // Anthropic streaming: message_delta / message_stop / content_block_stop carry usage
  if (
    (chunk.type === 'message_delta' || chunk.type === 'message_stop' || chunk.type === 'content_block_stop') &&
    chunk.usage
  ) {
    return extractUsageFromResponse({ usage: chunk.usage }, 'anthropic')
  }

  // OpenAI-compatible streaming: usage in final chunk
  if (chunk.usage) {
    return extractUsageFromResponse(chunk, provider)
  }

  // Gemini streaming: usageMetadata in final chunk
  if (chunk.usageMetadata) {
    return extractUsageFromResponse(chunk, 'gemini')
  }

  return null
}

/**
 * TokenUsageAccumulator - accumulates token usage across a conversation.
 * Tracks both real usage from providers and estimated usage for messages without provider data.
 */
export class TokenUsageAccumulator {
  constructor() {
    this.realUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    this.estimatedUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    this.hasRealUsage = false
  }

  /** Add real usage from a provider response */
  addRealUsage(usage) {
    if (!usage) return
    this.realUsage.promptTokens += usage.promptTokens || 0
    this.realUsage.completionTokens += usage.completionTokens || 0
    this.realUsage.totalTokens += usage.totalTokens || 0
    this.hasRealUsage = true
  }

  /** Add estimated usage (fallback when provider doesn't return usage) */
  addEstimatedUsage(usage) {
    if (!usage) return
    this.estimatedUsage.promptTokens += usage.promptTokens || 0
    this.estimatedUsage.completionTokens += usage.completionTokens || 0
    this.estimatedUsage.totalTokens += usage.totalTokens || 0
  }

  /** Get total usage (real if available, otherwise estimated) */
  getTotalUsage() {
    if (this.hasRealUsage && this.realUsage.totalTokens > 0) {
      return { ...this.realUsage, source: 'real' }
    }
    return { ...this.estimatedUsage, source: 'estimated' }
  }

  /** Get real usage only */
  getRealUsage() {
    return { ...this.realUsage }
  }

  /** Get estimated usage only */
  getEstimatedUsage() {
    return { ...this.estimatedUsage }
  }

  /** Check if we have real usage data */
  hasRealData() {
    return this.hasRealUsage && this.realUsage.totalTokens > 0
  }

  /** Reset accumulator */
  reset() {
    this.realUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    this.estimatedUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    this.hasRealUsage = false
  }

  /** Get usage breakdown for display */
  getBreakdown() {
    const usage = this.getTotalUsage()
    return {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      source: usage.source,
      hasRealData: this.hasRealData(),
    }
  }
}

/**
 * Create a token usage tracker for a conversation.
 * Integrates with the streaming chat to capture real usage.
 * @param {Function} onUsageUpdate - Callback when usage is updated
 * @returns {Object} Tracker with methods to process streaming chunks and responses
 */
export function createTokenUsageTracker(onUsageUpdate = null) {
  const accumulator = new TokenUsageAccumulator()

  return {
    accumulator,
    
    /** Process a streaming chunk for usage data */
    processChunk(chunk, provider) {
      const usage = extractUsageFromStreamChunk(chunk, provider)
      if (usage) {
        accumulator.addRealUsage(usage)
        if (onUsageUpdate) onUsageUpdate(accumulator.getBreakdown())
      }
      return usage
    },

    /** Process a complete response for usage data */
    processResponse(data, provider) {
      const usage = extractUsageFromResponse(data, provider)
      if (usage) {
        accumulator.addRealUsage(usage)
        if (onUsageUpdate) onUsageUpdate(accumulator.getBreakdown())
      }
      return usage
    },

    /** Add estimated usage for a message (fallback) */
    addEstimate(usage) {
      accumulator.addEstimatedUsage(usage)
      if (onUsageUpdate) onUsageUpdate(accumulator.getBreakdown())
    },

    /** Get current usage breakdown */
    getUsage() {
      return accumulator.getBreakdown()
    },

    /** Reset tracker */
    reset() {
      accumulator.reset()
      if (onUsageUpdate) onUsageUpdate(accumulator.getBreakdown())
    },
  }
}

/**
 * Estimate token usage for a message when real usage is unavailable.
 * Uses the unified token estimator.
 * @param {Object} message - Message object
 * @param {boolean} isAssistant - Whether this is an assistant message
 * @returns {Object} { promptTokens, completionTokens, totalTokens }
 */
export function estimateMessageUsage(message, isAssistant = false) {
  if (!message) return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  const content = message.content || message.text || ''
  const text = typeof content === 'string' ? content : Array.isArray(content) 
    ? content.filter(p => p?.type === 'text').map(p => p.text || '').join(' ') 
    : ''

  const tokens = estimateTokensFromText(text)

  if (isAssistant) {
    return { promptTokens: 0, completionTokens: tokens, totalTokens: tokens }
  } else {
    return { promptTokens: tokens, completionTokens: 0, totalTokens: tokens }
  }
}

/** Format compact input/output token summary, e.g. "1.2k in · 450 out". */
export function formatInputOutputSummary({ promptTokens = 0, completionTokens = 0 } = {}) {
  return `${formatTokenCount(Math.max(0, promptTokens))} in · ${formatTokenCount(Math.max(0, completionTokens))} out`
}

// Default export
const tokenTracker = {
  extractUsageFromResponse,
  extractUsageFromStreamChunk,
  TokenUsageAccumulator,
  createTokenUsageTracker,
  estimateMessageUsage,
  formatTokenCount,
  formatInputOutputSummary,
}

export default tokenTracker
