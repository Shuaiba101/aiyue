const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("iyueDesktop", {
  platform: process.platform,
  version: process.versions.electron
});
