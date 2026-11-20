const { app, BrowserWindow, dialog, shell } = require('electron');
const dotenv = require('dotenv');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let mainWindow;
let shutdown;
let isQuitting = false;

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function assertLocalPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', error => reject(new Error('JPTI cannot start because local port ' + port + ' is already in use. Close the other service or change its port.')));
    probe.listen(port, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve()));
  });
}

async function waitForApi() {
  const url = 'http://127.0.0.1:8787/api/health';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
      if (response.ok) {
        const health = await response.json();
        if (health.desktopInstanceId === process.env.JPTI_DESKTOP_INSTANCE_ID) return;
      }
    } catch {}
    await delay(300);
  }
  throw new Error('The local JPTI API did not become ready on port 8787. Check whether another JPTI instance is running.');
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1024, minHeight: 700,
    backgroundColor: '#080d18',
    title: 'JPTI — Jopearl Trading Intelligence',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  await mainWindow.loadURL('http://127.0.0.1:8787/');
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.jopearl.jpti');
  try {
    const root = app.getAppPath();
    await assertLocalPortAvailable(8787);
    process.env.JPTI_DESKTOP_INSTANCE_ID = randomUUID();
    dotenv.config({ path: path.join(app.getPath('userData'), '.env'), override: false });
    process.env.JPTI_API_HOST = '127.0.0.1';
    process.env.JPTI_ALLOW_LOCAL_PRIVATE_ACCESS = 'true';
    process.env.JPTI_REQUIRE_EDGE_SECRET = 'false';
    process.env.JPTI_API_PORT = '8787';
    process.env.PORT = '8787';
    process.env.JPTI_STORAGE_BACKEND = 'file';
    process.env.JPTI_DATA_DIR = path.join(app.getPath('userData'), 'data');
    process.env.JPTI_WEB_DIST = path.join(root, 'dist');
    process.env.JPTI_TBOTS_PUBLIC_DIR = path.join(root, 'integrations', 't-bots', 'public');
    process.env.JPTI_SERVE_WEB = 'true';
    process.env.JPTI_TRADING_MODE = 'paper';
    process.env.JPTI_ENABLE_LIVE_TRADING = 'false';
    const api = await import(pathToFileURL(path.join(root, 'api/server.js')).href);
    shutdown = api.shutdownJptiServer;
    await waitForApi();
    await createWindow();
  } catch (error) {
    dialog.showErrorBox('JPTI could not start', error.message);
    app.quit();
  }
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  if (isQuitting || !shutdown) return;
  event.preventDefault();
  isQuitting = true;
  Promise.resolve(shutdown()).finally(() => app.exit(0));
});
