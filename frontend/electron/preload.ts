import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { IpcContracts, IpcCommand } from './ipcTypes'
// The channel allowlist lives in ipcTypes.ts, SHARED with the main process —
// a local duplicate here could drift out of sync (a channel registered in
// main but missing here would throw "not allowed" in the preload).
import { IPC_COMMANDS } from './ipcTypes'

// ============================================================================
// Type-Safe IPC Channel Generation
// ============================================================================

const IPC_CHANNELS = IPC_COMMANDS

// ============================================================================
// Safe Event Bridge with AbortSignal Support
// ============================================================================

interface EventSubscription {
  abort(): void
}

function createEventBridge<T extends Record<string, string>>(
  eventMap: T
): { [K in keyof T]: (callback: (payload: any) => void) => EventSubscription } {
  const result = {} as any

  for (const [eventName, ipcChannel] of Object.entries(eventMap)) {
    result[eventName] = (callback: (payload: any) => void) => {
      const handler = (_event: IpcRendererEvent, payload: any) => callback(payload)
      ipcRenderer.on(ipcChannel, handler)
      return {
        abort: () => ipcRenderer.removeListener(ipcChannel, handler)
      }
    }
  }

  return result
}

// ============================================================================
// Type-Safe Invocation Wrapper
// ============================================================================

async function invoke<K extends IpcCommand>(
  channel: K,
  payload: IpcContracts[K]
): Promise<any> {
  // Validate channel is allowed
  if (!IPC_CHANNELS.includes(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`)
  }
  return ipcRenderer.invoke(channel, payload)
}

// ============================================================================
// Exposed API
// ============================================================================

const api = {
  // File System
  fs: {
    read: (path: string, maxBytes?: number, offset?: number, limit?: number) =>
      invoke('fs:read', { path, maxBytes, offset, limit }),
    write: (path: string, content: string, expectedHash?: string, keepEol?: boolean) =>
      invoke('fs:write', { path, content, expectedHash, keepEol }),
    edit: (path: string, edits: Array<{ oldText: string; newText: string }>, expectedHash?: string) =>
      invoke('fs:edit', { path, edits, expectedHash }),
    search: (pattern: string, root: string, include?: string[], exclude?: string[], maxResults?: number) =>
      invoke('fs:search', { pattern, root, include, exclude, maxResults }),
  },

  // Background Processes
  proc: {
    start: (chatId: string, command: string, cwd: string, env?: Record<string, string>) =>
      invoke('proc:start', { chatId, command, cwd, env }),
    read: (id: string, offset?: number) =>
      invoke('proc:read', { id, offset }),
    kill: (id: string, signal?: string) =>
      invoke('proc:kill', { id, signal }),
    list: (chatId?: string) =>
      invoke('proc:list', { chatId } as any),
    onOutput: createEventBridge({
      output: 'proc:output',
      exit: 'proc:exit',
    }),
  },

  // Browser Control
  browser: {
    create: (url: string, mode: 'panel' | 'window', bounds?: { x: number; y: number; width: number; height: number }) =>
      invoke('browser:create', { url, mode, bounds }),
    navigate: (sessionId: string, url: string) =>
      invoke('browser:navigate', { sessionId, url }),
    execute: (sessionId: string, script: string) =>
      invoke('browser:execute', { sessionId, script }),
    close: (sessionId: string) =>
      invoke('browser:close', { sessionId }),
    list: () =>
      invoke('browser:list', {} as any),
    back(sessionId:string){
      return invoke('browser:back',{sessionId})
    },
    forward(sessionId:string){
      return invoke('browser:forward',{sessionId})
    },
    refresh(sessionId:string){
      return invoke('browser:refresh',{sessionId})
    },
    stop(sessionId:string){
      return invoke('browser:stop',{sessionId})
    },
    newTab(sessionId:string,url?:string){
      return invoke('browser:new-tab',{sessionId,url})
    },
    closeTab(sessionId:string,tabId:string){
      return invoke('browser:close-tab',{sessionId,tabId})
    },
    switchTab(sessionId:string,tabId:string){
      return invoke('browser:switch-tab',{sessionId,tabId})
    },
    duplicateTab(sessionId:string,tabId:string){
      return invoke('browser:duplicate-tab',{sessionId,tabId})
    },
    setZoom(sessionId:string,zoomFactor:number){
      return invoke('browser:set-zoom',{sessionId,zoomFactor})
    },
    getTabs(sessionId:string){
      return invoke('browser:get-tabs',{sessionId})
    },
    getCookies(sessionId:string,url?:string){
      return invoke('browser:get-cookies',{sessionId,url})
    },
    setCookies(sessionId:string,cookies:Array<{name:string,value:string,domain?:string,path?:string,url?:string}>){
      return invoke('browser:set-cookies',{sessionId,cookies})
    },
    getStorage(sessionId:string,type:'local'|'session'){
      return invoke('browser:get-storage',{sessionId,type})
    },
    setStorage(sessionId:string,type:'local'|'session',key:string,value:string){
      return invoke('browser:set-storage',{sessionId,type,key,value})
    },
    cancelDownload(downloadId:string){
      return invoke('browser:cancel-download',{downloadId})
    },
    onConsole: createEventBridge({
      console: 'browser:console',
      navigation: 'browser:navigation',
      crash: 'browser:crash',
    }),
  },

  // Terminal
  terminal: {
    exec: (sessionId: string, command: string) =>
      invoke('terminal:exec', { sessionId, command }),
    resize: (sessionId: string, cols: number, rows: number) =>
      invoke('terminal:resize', { sessionId, cols, rows }),
    close: (sessionId: string) =>
      invoke('terminal:close', { sessionId }),
    list: () =>
      invoke('terminal:list', {} as any),
    onData: createEventBridge({
      data: 'terminal:data',
      exit: 'terminal:exit',
    }),
  },

  // Search
  search: {
    query: (q: string, engines?: string[], maxResults?: number) =>
      invoke('search:query', { q, engines, maxResults }),
  },

  // Chat
  chat: {
    send: (chatId: string, message: string, model?: string) =>
      invoke('chat:send', { chatId, message, model }),
    history: (chatId: string) =>
      invoke('chat:history', { chatId } as any),
  },

  // MCP
  mcp: {
    call: (serverId: string, method: string, params: unknown) =>
      invoke('mcp:call', { serverId, method, params }),
    list: () =>
      invoke('mcp:list', {} as any),
    stdio: {
      call: (serverId: string, method: string, params: unknown) =>
        invoke('mcp:stdio:call', { serverId, method, params }),
    },
  },

  // Clipboard
  clipboard: {
    read: () =>
      invoke('clipboard:read', {} as any),
    write: (text: string) =>
      invoke('clipboard:write', { text } as any),
    watch: (enabled: boolean) =>
      invoke('clipboard:watch', { enabled } as a) as any),
  },

  // Event subscriptions
  on: createEventBridge({
    'fs:change': 'fs:change',
    'proc:output': 'proc:output',
    'proc:exit': 'proc:exit',
    'terminal:data': 'terminal:data',
    'terminal:exit': 'terminal:exit',
  }),
}

contextBridge.exposeInMainWorld('api', api)
