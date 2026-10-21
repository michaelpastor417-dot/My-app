// ClipForge desktop app: a window around the web app's production build.
// The page runs sandboxed with no Node.js access; files are served through a
// private app:// origin so projects saved in IndexedDB keep a stable home.
const { app, BrowserWindow, net, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist');
const ORIGIN = 'app://clipforge';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

// Must happen before the app is ready: lets app:// behave like a normal secure website
// (fetch, ES-module workers, IndexedDB, the Cache API used by the speech model).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

async function serve(request) {
  const { pathname } = new URL(request.url);
  const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.normalize(path.join(DIST, relative));
  // Never serve anything outside the app's own files.
  if (!file.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 });
  try {
    const body = await fs.readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    return new Response(body, { headers: { 'content-type': type } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'ClipForge',
    backgroundColor: '#0f0f12',
    icon: path.join(DIST, 'icons', 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Web links open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) event.preventDefault();
  });
  void win.loadURL(`${ORIGIN}/`);
  return win;
}

app.whenReady().then(() => {
  protocol.handle('app', serve);
  // The only permission ClipForge needs is the microphone, for voiceovers.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'media'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
