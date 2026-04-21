const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#141414',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Abrir pasta…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu-action', 'open-folder'),
        },
        {
          label: 'Novo arquivo',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('menu-action', 'new-file'),
        },
        { type: 'separator' },
        {
          label: 'Salvar',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu-action', 'save'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
      ],
    },
    {
      label: 'Visualizar',
      submenu: [
        {
          label: 'Alternar barra lateral',
          accelerator: 'CmdOrCtrl+\\',
          click: () => mainWindow.webContents.send('menu-action', 'toggle-sidebar'),
        },
        { type: 'separator' },
        { role: 'reload', label: 'Recarregar' },
        { role: 'toggleDevTools', label: 'Dev Tools' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC handlers
ipcMain.handle('dialog-open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Abrir pasta de notas',
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('fs-read-dir', async (_e, folderPath) => {
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    return entries
      .map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: path.join(folderPath, e.name),
      }))
      .filter(e => e.isDirectory || e.name.endsWith('.md'))
      .filter(e => !e.name.startsWith('.'));
  } catch {
    return [];
  }
});

ipcMain.handle('fs-read-file', async (_e, filePath) => {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
});

ipcMain.handle('fs-write-file', async (_e, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('fs-create-file', async (_e, folderPath, name) => {
  const fileName = name.endsWith('.md') ? name : `${name}.md`;
  const filePath = path.join(folderPath, fileName);
  try {
    await fs.writeFile(filePath, '', 'utf-8');
    return filePath;
  } catch {
    return null;
  }
});

ipcMain.handle('path-basename', (_e, p, ext) => path.basename(p, ext));
ipcMain.handle('path-join', (_e, ...parts) => path.join(...parts));

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
