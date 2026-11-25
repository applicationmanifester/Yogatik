import { describe, it, expect } from 'vitest'
import { seeTool, setPendingImage, getPendingImage, setVisionContext } from './see'

describe('seeTool multi-chat isolation', () => {
  it('isolates pendingImage per conversationId so concurrent chats do not steal or clear each other', async () => {
    setPendingImage('data:image/png;base64,CHAT_A', 'chat-a')
    setPendingImage('data:image/png;base64,CHAT_B', 'chat-b')

    expect(getPendingImage('chat-a')).toBe('data:image/png;base64,CHAT_A')
    expect(getPendingImage('chat-b')).toBe('data:image/png;base64,CHAT_B')

    setVisionContext({ modelCanSee: true, allowLocal: true }, 'chat-a')
    setVisionContext({ modelCanSee: false, allowLocal: false }, 'chat-b')

    const resA = await seeTool.execute({ question: 'what is this' }, { ctx: { conversationId: 'chat-a' } })
    expect(resA.success).toBe(true)
    expect(resA.via).toBe('model')
    expect(resA.image).toBe('data:image/png;base64,CHAT_A')

    // Chat B's pending image and vision context (modelCanSee: false, allowLocal: false) must be untouched
    expect(getPendingImage('chat-b')).toBe('data:image/png;base64,CHAT_B')
    const resB = await seeTool.execute({ question: 'what is this' }, { ctx: { conversationId: 'chat-b' } })
    expect(resB.success).toBe(false)
    expect(resB.image).toBe('data:image/png;base64,CHAT_B')
    expect(resB.error).toMatch(/No vision available/i)
  })
})
