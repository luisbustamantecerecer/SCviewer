const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const DEFAULT_URL = "https://stripchat.com";
const CSS_PATH = path.join(__dirname, "tweaks.css");

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
    }));

    const s = { windows };
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
  } catch {
    // intentionally silent
  }
}

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
    },
  });

  // Restore bounds if provided
  if (opts.bounds && typeof opts.bounds === "object") {
    try {
      w.setBounds(opts.bounds);
    } catch {}
  }

  // Per-window state (defaults)
  w.__zoomOn = typeof opts.zoom === "boolean" ? opts.zoom : true; // default zoom ON
  w.__objX = typeof opts.objX === "number" ? opts.objX : 50;

  const urlToLoad = opts.url || DEFAULT_URL;
  w.loadURL(urlToLoad);

  async function injectTweaksAndState() {
    const css = readTweaksCSS();
    if (css.trim()) {
      try {
        await w.webContents.insertCSS(css);
      } catch {}
    }

    // Enforce zoom (default ON, or restored value)
    try {
      await w.webContents.executeJavaScript(
        `document.documentElement.classList.toggle('__MAX_ZOOM__', ${w.__zoomOn ? "true" : "false"});`,
        true
      );
    } catch {}

    // Restore OBJX (horizontal crop position)
    try {
      await w.webContents.executeJavaScript(
        `document.documentElement.style.setProperty('--OBJX', '${w.__objX}%');`,
        true
      );
    } catch {}
  }

  // Inject on initial load + SPA-ish navigations
  w.webContents.on("did-finish-load", injectTweaksAndState);
  w.webContents.on("did-navigate-in-page", injectTweaksAndState);
  w.webContents.on("did-navigate", injectTweaksAndState);

  const step = 5; // percent per keypress

  function setObjX() {
    const js = `document.documentElement.style.setProperty('--OBJX', '${w.__objX}%');`;
    w.webContents.executeJavaScript(js, true).catch(() => {});
  }

  function setZoom() {
    const js = `document.documentElement.classList.toggle('__MAX_ZOOM__', ${w.__zoomOn ? "true" : "false"});`;
    w.webContents.executeJavaScript(js, true).catch(() => {});
  }

  w.webContents.on("before-input-event", (event, input) => {
    // Quit everything
    if (input.key === "Escape") {
      event.preventDefault();
      app.quit();
      return;
    }

    // Hold Space to enable drag mode (so you can drag even on video)
    if (input.code === "Space") {
      event.preventDefault();
      const on = input.type === "keyDown";
      const js = `document.documentElement.classList.toggle("__DRAGMODE__", ${on ? "true" : "false"});`;
      w.webContents.executeJavaScript(js, true).catch(() => {});
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

    // New Window: ⌘N
    if (input.type === "keyDown" && input.meta && input.code === "KeyN") {
      event.preventDefault();
      createWindow(); // shared session by default
      return;
    }

    // Zoom toggle: ⌘Z
    if (input.type === "keyDown" && input.meta && input.code === "KeyZ") {
      event.preventDefault();
      w.__zoomOn = !w.__zoomOn;
      setZoom();
      return;
    }

    // Nudge left/right only when zoom is active
    if (input.key === "ArrowLeft" || input.key === "ArrowRight") {
      event.preventDefault();
      if (!w.__zoomOn) return;

      if (input.key === "ArrowLeft") w.__objX = Math.max(0, w.__objX - step);
      if (input.key === "ArrowRight") w.__objX = Math.min(100, w.__objX + step);
      setObjX();
      return;
    }
  });

  // Save state BEFORE windows are destroyed (so getAllWindows() still includes them)
  w.on("close", () => {
    saveState();
  });

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