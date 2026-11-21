// Yogatik Browser Control Service
import { BrowserWindow, webContents } from 'electron'
import type { BrowserTab, DownloadRecord } from './BrowserTypes'

const tabRegistry = new Map<number, BrowserTab>()
const windowTabs = new Map<number, string[]>()
const activeTabPerWindow = new Map<number, string>()
const downloadRegistry = new Map<string, DownloadRecord>()
let tabSeq = 0

function nextTabId(): string { return `tab_${++tabSeq}_${Date.now()}` }

// ── URL validation ──
export function validateUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') throw new Error('URL must be non-empty')
  const trimmed = rawUrl.trim()
  try { new URL(trimmed) } catch { if (!/^(about|yogatik|file):/i.test(trimmed)) throw new Error('Invalid URL') }
  return trimmed
}

// ── Navigation ──
export function goBack(id: number): boolean {
  const wc = webContents.fromId(id)
  if (!wc || wc.isDestroyed() || !wc.canGoBack()) return false
  wc.goBack()
  return true
}
export function goForward(id: number): boolean {
  const wc = webContents.fromId(id)
  if (!wc || wc.isDestroyed() || !wc.canGoForward()) return false
  wc.goForward()
  return true
}
export function refresh(id: number): void { const wc = webContents.fromId(id); if (wc && !wc.isDestroyed()) wc.reload() }
export function stop(id: number): void { const wc = webContents.fromId(id); if (wc && !wc.isDestroyed()) wc.stop() }

// ── Tab management ──
export function newTab(winId: number, url?: string): BrowserTab {
  const win = BrowserWindow.fromId(winId)
  if (!win) throw new Error(`Window ${winId} not found`)
  const tab: BrowserTab = { id: nextTabId(), webContentsId: 0, windowId: winId, url: validateUrl(url || 'about:blank'), title: '', isActive: true, isPinned: false, createdAt: Date.now(), lastAccessed: Date.now(), zoomLevel: 1, historyIndex: 0, historyLength: 1 }
  tabRegistry.set(0, tab as any)
  const ids = windowTabs.get(winId) || []
  ids.push(tab.id)
  windowTabs.set(winId, ids)
  activeTabPerWindow.set(winId, tab.id)
  return tab
}
export function duplicateTab(tabId: string): BrowserTab | null {
  const tab = getTab(tabId)
  if (!tab) return null
  return newTab(tab.windowId, tab.url)
export function closeTab(tabId: string): boolean {
  const tab = Array.from(tabRegistry.values()).find(t => t.id === tabId)
  if (!tab) return false
  const wc = webContents.fromId(tab.webContentsId)
  if (wc && !wc.isDestroyed()) { const windowTabsList = windowTabs.get(tab.windowId) || []; if (windowTabsList.length <= 1) { const win = BrowserWindow.fromId(tab.windowId); if (win && !win.isDestroyed()) win.close() } wc.destroy() }
  tabRegistry.delete(tab.webContentsId)
  const remaining = windowTabs.get(tab.windowId)?.filter(id => id !== tabId) || []
  windowTabs.set(tab.windowId, remaining)
  if (activeTabPerWindow.get(tab.windowId) === tabId && remaining.length > 0) {
    const nextTabId2 = remaining[remaining.length - 1]
    const nextTab = Array.from(tabRegistry.values()).find(t => t.id === nextTabId2)
    if (nextTab) { activeTabPerWindow.set(tab.windowId, nextTabId2); nextTab.isActive = true; const nextWc = webContents.fromId(nextTab.webContentsId); if (nextWc && !nextWc.isDestroyed()) nextWc.focus() }
  }
  return true
export function switchTab(windowId: number, tabId: string): boolean {
  const tabs = windowTabs.get(windowId) || []
  if (!tabs.includes(tabId)) return false
  const tab = Array.from(tabRegistry.values()).find(t => t.id === tabId)
  if (!tab) return false
  for (const tid of tabs) { const t = Array.from(tabRegistry.values()).find(t => t.id === tid); if (t) t.isActive = false }
  tab.isActive = true
  activeTabPerWindow.set(windowId, tabId)
  const wc = webContents.fromId(tab.webContentsId)
  if (wc && !wc.isDestroyed()) wc.focus()
  return true
export function listTabs(windowId?: number): BrowserTab[] {
  if (windowId !== undefined) { const ids = windowTabs.get(windowId) || []; return ids.map(id => Array.from(tabRegistry.values()).find(t => t.id === id)).filter(Boolean) as BrowserTab[] }
  return Array.from(tabRegistry.values())
export function getTab(tabId: string): BrowserTab | undefined {
  return Array.from(tabRegistry.values()).find(t => t.id === tabId)
export function getActiveTab(windowId: number): BrowserTab | undefined {
  const activeTabId = activeTabPerWindow.get(windowId)
  if (!activeTabId) return undefined
  return getTab(activeTabId)
export function attachTab(tabId: string, webContentsId: number, winId: number): void {
  const existing = Array.from(tabRegistry.values()).find(t => t.id === tabId)
  if (existing) { existing.webContentsId = webContentsId; existing.windowId = winId; tabRegistry.set(webContentsId, existing as any); tabRegistry.delete(0 as any); return }
  const tab: BrowserTab = { id: tabId, webContentsId, windowId: winId, url: 'about:blank', title: '', isActive: true, isPinned: false, createdAt: Date.now(), lastActiveAt: Date.now(), zoomLevel: 1, historyIndex: 0, historyLength: 1 }
  tabRegistry.set(webContentsId, tab as any)
export function registerDownload(download: DownloadRecord): void { downloadRegistry.set(download.id, download) }
export function listDownloads(sessionKey?: string): DownloadRecord[] {
  const all = Array.from(downloadRegistry.values())
  if (!sessionKey) return all
  return all.filter(d => d.sessionKey === sessionKey)
export function cancelDownload(downloadId: string): boolean {
  const dl = downloadRegistry.get(downloadId)
  if (!dl) return false
  dl.state = 'cancelled'
  dl.endTime = Date.now()
  return true
export function getDownload(downloadId: string): DownloadRecord | undefined {
  return downloadRegistry.get(downloadId)