const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  updateObjX: (val) => ipcRenderer.send("update-objx", val),
});
