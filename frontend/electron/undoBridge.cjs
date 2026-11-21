// Yogatik Undo Bridge
// Bridges journalCore + permissions + diff preview for undo functionality.
exports.registerUndoIPC = function(ipcMain, journalInstance) {
  ipcMain.handle('journal:record', async function(_e, p) {
    try {
      var entry = journalInstance.record({
        chatId: p && p.chatId ? p.chatId : '',
        op: p && p.op ? p.op : '',
        target: p && p.target ? p.target : '',
        note: p && p.note ? p.note : ''
      })
      return { ok: true, entry: entry }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })
  ipcMain.handle('journal:revert', async function(_e, p) {
    try {
      var entryId = p && p.entryId ? p.entryId : ''
      var result = journalInstance.revert(entryId)
      return { ok: true, result: result }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })
  ipcMain.handle('journal:list', async function(_e, p) {
    try {
      var limit = p && p.limit ? p.limit : 50
      var index = journalInstance.readIndex ? journalInstance.readIndex() : []
      var entries = index.slice(0, limit)
      return { ok: true, entries: entries }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })
  ipcMain.handle('journal:status', async function() {
    try {
      var index = journalInstance.readIndex ? journalInstance.readIndex() : []
      return { ok: true, entryCount: index.length }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })
}

exports.createJournalStore = function(storeDir) {
  var journalCore = require('./journalCore.cjs')
  return journalCore.createJournal({ storeDir: storeDir })
}