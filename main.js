const { app, BrowserWindow, globalShortcut, shell } = require("electron");
const path = require("path");

let win = null;

function createWindow() {
  win = new BrowserWindow({
    title: "i阅",
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  win.setMenuBarVisibility(false);

  const appUrl = process.env.IYUE_APP_URL || "https://ireading.top/read";
  if (process.env.IYUE_USE_LOCAL === "1") {
    win.loadFile(path.join(__dirname, "i阅-选择版本.html"));
  } else {
    win.loadURL(appUrl);
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();

  globalShortcut.register("CommandOrControl+Shift+F", () => {
    if (!win) return;
    win.setFullScreen(!win.isFullScreen());
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
