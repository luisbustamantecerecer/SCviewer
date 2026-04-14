const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const DEFAULT_URL = "https://stripchat.com";
const CSS_PATH = path.join(__dirname, "tweaks.css");

// Register once — handles objX updates coming from the wheel/swipe listener in the renderer
ipcMain.on("update-objx", (event, val) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.__objX = Math.min(100, Math.max(0, Number(val)));
});

function readTweaksCSS() {
  try {
    return fs.readFileSync(CSS_PATH, "utf8");
  } catch {
    return "";
  }
}

function statePath() {
  return path.join(app.getPath("userData"), "state.json");
}

function loadState() {
  try {
    const p = statePath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function saveState() {
  try {
    const windows = BrowserWindow.getAllWindows().map((w) => ({
      url: w.webContents.getURL() || DEFAULT_URL,
      bounds: w.getBounds(),
      zoom: w.__zoomOn ?? true,
      objX: w.__objX ?? 50,
      uiHidden: w.__uiHidden ?? false,
    }));

    const s = { windows };
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
  } catch {
    // intentionally silent
  }
}

// Injected into each page to handle horizontal wheel/swipe → pan
const WHEEL_SCRIPT = `
  (function () {
    if (window.__scv_wheel) return;
    window.__scv_wheel = true;

    let objX = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--OBJX") || "50"
    );

    window.addEventListener("wheel", function (e) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // horizontal only
      e.preventDefault();

      objX = Math.min(100, Math.max(0, objX + e.deltaX * 0.1));
      document.documentElement.style.setProperty("--OBJX", objX + "%");
      if (window.electronAPI) window.electronAPI.updateObjX(objX);
    }, { passive: false });
  })();
`;

function createWindow(opts = {}) {
  const w = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#000000",
    frame: false,
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (opts.bounds && typeof opts.bounds === "object") {
    try {
      w.setBounds(opts.bounds);
    } catch {}
  }

  w.__zoomOn   = typeof opts.zoom      === "boolean" ? opts.zoom      : true;
  w.__objX     = typeof opts.objX      === "number"  ? opts.objX      : 50;
  w.__uiHidden = typeof opts.uiHidden  === "boolean" ? opts.uiHidden  : false;

  w.loadURL(opts.url || DEFAULT_URL);

  async function injectTweaksAndState() {
    const css = readTweaksCSS();
    if (css.trim()) {
      try { await w.webContents.insertCSS(css); } catch {}
    }

    try {
      await w.webContents.executeJavaScript(
        `document.documentElement.classList.toggle('__MAX_ZOOM__', ${w.__zoomOn});`, true
      );
    } catch {}

    try {
      await w.webContents.executeJavaScript(
        `document.documentElement.style.setProperty('--OBJX', '${w.__objX}%');`, true
      );
    } catch {}

    try {
      await w.webContents.executeJavaScript(
        `document.documentElement.classList.toggle('__HIDE_UI__', ${w.__uiHidden});`, true
      );
    } catch {}

    try {
      await w.webContents.executeJavaScript(WHEEL_SCRIPT, true);
    } catch {}
  }

  w.webContents.on("did-finish-load",      injectTweaksAndState);
  w.webContents.on("did-navigate-in-page", injectTweaksAndState);
  w.webContents.on("did-navigate",         injectTweaksAndState);

  const step = 5;

  function setObjX() {
    w.webContents.executeJavaScript(
      `document.documentElement.style.setProperty('--OBJX', '${w.__objX}%');`, true
    ).catch(() => {});
  }

  function setZoom() {
    w.webContents.executeJavaScript(
      `document.documentElement.classList.toggle('__MAX_ZOOM__', ${w.__zoomOn});`, true
    ).catch(() => {});
  }

  function setUIVisibility() {
    w.webContents.executeJavaScript(
      `document.documentElement.classList.toggle('__HIDE_UI__', ${w.__uiHidden});`, true
    ).catch(() => {});
  }

  w.webContents.on("before-input-event", (event, input) => {
    // Quit
    if (input.key === "Escape") {
      event.preventDefault();
      app.quit();
      return;
    }

    // Back: ⌘[
    if (input.type === "keyDown" && input.meta && input.code === "BracketLeft") {
      if (w.webContents.canGoBack()) {
        event.preventDefault();
        w.webContents.goBack();
      }
      return;
    }

    // Forward: ⌘]
    if (input.type === "keyDown" && input.meta && input.code === "BracketRight") {
      if (w.webContents.canGoForward()) {
        event.preventDefault();
        w.webContents.goForward();
      }
      return;
    }

    // New window: ⌘N
    if (input.type === "keyDown" && input.meta && input.code === "KeyN") {
      event.preventDefault();
      createWindow();
      return;
    }

    // Zoom toggle: ⌘Z
    if (input.type === "keyDown" && input.meta && input.code === "KeyZ") {
      event.preventDefault();
      w.__zoomOn = !w.__zoomOn;
      setZoom();
      return;
    }

    // UI toggle: ⌘U
    if (input.type === "keyDown" && input.meta && input.code === "KeyU") {
      event.preventDefault();
      w.__uiHidden = !w.__uiHidden;
      setUIVisibility();
      return;
    }

    // Arrow left/right → pan (zoom must be active)
    if (input.key === "ArrowLeft" || input.key === "ArrowRight") {
      event.preventDefault();
      if (!w.__zoomOn) return;

      if (input.key === "ArrowLeft")  w.__objX = Math.max(0,   w.__objX - step);
      if (input.key === "ArrowRight") w.__objX = Math.min(100, w.__objX + step);
      setObjX();
      return;
    }
  });

  w.on("close", () => saveState());

  return w;
}

app.whenReady().then(() => {
  const s = loadState();
  if (s && Array.isArray(s.windows) && s.windows.length > 0) {
    for (const ws of s.windows) createWindow(ws);
  } else {
    createWindow();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
