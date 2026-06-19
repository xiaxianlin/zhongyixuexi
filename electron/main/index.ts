import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import { prepareDatabase, getDb, closeDb } from '../db'
import { registerAllIpc } from '../ipc'
import { runIntegrationCheck } from './integration-check'
import { seedBuiltinContent } from '../services/builtin-content'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1400,
    minHeight: 900,
    show: false,
    autoHideMenuBar: true,
    title: '中医经典学习',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  // DB init (migration + seed) is wrapped so a failure shows a clear error
  // dialog and exits cleanly, instead of crashing as an unhandled rejection.
  let schemaVersion: number
  let seeded: ReturnType<typeof seedBuiltinContent>
  try {
    schemaVersion = prepareDatabase()
    seeded = seedBuiltinContent()
  } catch (e) {
    console.error('[db] init failed:', e)
    void dialog.showErrorBox(
      '数据库初始化失败',
      `应用无法准备数据库：\n\n${(e as Error).message ?? e}\n\n请重试；如持续失败可备份数据后联系开发者。`,
    )
    app.quit()
    return
  }

  if (process.env.ZYXX_INTEGRATION === '1') {
    runIntegrationCheck()
      .then(() => app.quit())
      .catch((e) => {
        console.error(e)
        app.quit()
      })
    return
  }

  const db = getDb()
  const foreignKeys = db.pragma('foreign_keys', { simple: true })
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[]
  console.log(
    `[db] ready · schema v${schemaVersion} · builtin=${seeded.inserted ? 'inserted' : 'present'}(${seeded.bookIds.length}) · foreign_keys=${foreignKeys} · tables=${tables.map((t) => t.name).join(',')}`,
  )

  registerAllIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  closeDb()
})
