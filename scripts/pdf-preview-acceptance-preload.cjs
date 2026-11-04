const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('mojiNative', {
  pdf: { open: path => ipcRenderer.invoke('pdf:open', path), close: url => ipcRenderer.invoke('pdf:close', url), openExternal: path => ipcRenderer.invoke('pdf:openExternal', path) },
  local: { readMedia: path => ipcRenderer.invoke('local:readMedia', path) },
  plugins: { list: () => ipcRenderer.invoke('plugins:list'), toggles: () => ipcRenderer.invoke('plugins:toggles') },
  ocr: {
    modelStatus: () => ipcRenderer.invoke('ocr:modelStatus'),
    getCache: async key => { const result = await ipcRenderer.invoke('ocr:getCache', key); if (result) ipcRenderer.send('pdf-test:cache-hit', key); return result },
    setCache: (key, data) => ipcRenderer.invoke('ocr:setCache', key, data),
    recognize: req => { ipcRenderer.send('pdf-test:ocr-call', req.page); return ipcRenderer.invoke('ocr:recognize', req) },
  },
})
