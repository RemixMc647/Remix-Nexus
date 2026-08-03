const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
 mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'build/icons/icon-linux-512.png'),
    webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
    }
 });
 
 setTimeout(() => {
    mainWindow.loadURL('https://remix-nexus-tygt.onrender.com');
}, 1500);

mainWindow.on('closed', () => {
    mainWindow = null;
});
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
