const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');

let mainWindow;

// ---- SINGLE INSTANCE LOCK ----
// Without this, every extra launch (double-clicking the exe again, the
// installer auto-launching it, etc.) spawns a brand new window instead of
// focusing the existing one. That's what was causing multiple "Remix Nexus"
// entries in Task Manager and windows stacking/hiding behind each other.
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to open a second instance — focus the existing window instead.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      icon: path.join(__dirname, 'build/icons/icon-linux-512.png'),
      show: false, // don't show until content is actually ready
      webPreferences: {
        // The window shows your live website, so it must NOT get Node.js powers
        // (otherwise any script on a page could read files / run programs on the user's PC).
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    // Show the window only once it's ready — avoids the blank white
    // flash and avoids showing a window before there's anything in it.
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });

    // If the page fails to load (backend cold-starting, network issue,
    // wrong URL, etc.) tell the user instead of silently showing nothing.
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // Ignore ads/embeds that fail to load and cancelled navigations (-3) — only the page itself matters.
      if (!isMainFrame || errorCode === -3) return;
      console.error('Failed to load app:', errorCode, errorDescription);
      dialog.showErrorBox(
        'Remix Nexus — Connection Error',
        `Couldn't reach the server.\n\n${errorDescription} (code ${errorCode})\n\nCheck your internet connection or try again in a moment — the server may be waking up.`
      );
      mainWindow.show(); // show anyway so the user isn't stuck on nothing
    });

    // Links to other websites (YouTube, GitHub…) open in the normal browser, not inside the app.
    const SITE = 'https://remix-nexus-tygt.onrender.com';
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith(SITE)) return { action: 'allow' };
      shell.openExternal(url);
      return { action: 'deny' };
    });

    mainWindow.loadURL(SITE);

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    // macOS-style behavior: if the app is activated (e.g. dock icon click)
    // and there's no window, create one.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
