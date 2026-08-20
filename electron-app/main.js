const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 760,
    minHeight: 480,
    title: "MDノート",
    backgroundColor: "#1e1f22",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });

  // No menu bar (File/Edit/View...) — keeps the clean, single-purpose
  // "app" look instead of looking like a browser or generic Electron shell.
  Menu.setApplicationMenu(null);

  win.loadFile(path.join(__dirname, "app", "index.html"));

  // Any attempt to open an external link (e.g. a markdown link in the
  // preview) opens in the user's normal default browser instead of
  // inside this app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
