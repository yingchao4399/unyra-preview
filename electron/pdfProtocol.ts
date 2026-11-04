import { ipcMain, protocol, shell } from 'electron'
import { PdfFileServer } from './pdfFileServer'

const server = new PdfFileServer()
const owners = new Set<number>()

export function registerPdfProtocol(): void {
  protocol.handle('unyra-pdf', request => server.handle(request))
}

export function registerPdfIpc(): void {
  ipcMain.handle('pdf:open', async (event, rawPath: unknown) => {
    const owner = event.sender.id
    if (!owners.has(owner)) {
      owners.add(owner)
      event.sender.once('destroyed', () => {
        server.closeOwner(owner)
        owners.delete(owner)
      })
    }
    const result = await server.open(rawPath, owner)
    if (event.sender.isDestroyed()) server.closeOwner(owner)
    return result
  })
  ipcMain.handle('pdf:close', (event, url: unknown) => server.close(url, event.sender.id))
  ipcMain.handle('pdf:openExternal', async (event, path: unknown) => {
    const result = await server.open(path, event.sender.id)
    if (!result.ok || typeof path !== 'string') return false
    server.close(result.url, event.sender.id)
    return (await shell.openPath(path)) === ''
  })
}
