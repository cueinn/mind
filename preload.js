const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // File system
  openFolderDialog: () => ipcRenderer.invoke('dialog-open-folder'),
  readDir: (p) => ipcRenderer.invoke('fs-read-dir', p),
  readFile: (p) => ipcRenderer.invoke('fs-read-file', p),
  writeFile: (p, content) => ipcRenderer.invoke('fs-write-file', p, content),
  createFile: (folder, name) => ipcRenderer.invoke('fs-create-file', folder, name),

  // Path helpers
  basename: (p, ext) => ipcRenderer.invoke('path-basename', p, ext),
  join: (...parts) => ipcRenderer.invoke('path-join', ...parts),

  // Menu events
  onMenuAction: (cb) => {
    ipcRenderer.on('menu-action', (_e, action) => cb(action));
  },
});
