'use strict';

const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// ── 几何常量（逻辑值，实际会乘 scale）───────────────────────────────
const BASE_W = 240;
const BASE_H = 312;
const TICK = 16;            // 主循环 ~60fps
const WALK_SPEED = 84;      // px/s
const GRAVITY = 2600;       // px/s^2
const GROUND_GAP = 4;       // 脚底距 workArea 底部
const DRAG_THRESHOLD = 4;   // 超过多少像素才算拖动

let win = null;
let cfg = { x: null, y: null, scale: 1, sound: true, wander: true };

let scale = 1;
let winW = BASE_W;
let winH = BASE_H;

let pos = { x: 0, y: 0 };
let mode = 'idle';          // idle | walk | drag | fall | sleep
let facing = 1;
let vy = 0;

let press = null;           // { sx, sy, ox, oy } 按下但还没开始拖
let dragging = null;        // { ox, oy }
let ignoring = false;
let menuOpen = false;
let wanderOn = true;
let sleepMode = false;

let laughUrl = null;
const LAUGH_EXTS = ['mp3', 'm4a', 'wav', 'ogg', 'aac'];

// 用户把 laugh.mp3 丢进 assets/sounds 就能替换掉合成音
function findLaugh() {
  for (const ext of LAUGH_EXTS) {
    const p = path.join(__dirname, 'assets', 'sounds', `laugh.${ext}`);
    try {
      if (fs.statSync(p).size > 1024) return 'file://' + encodeURI(p);
    } catch { /* 没有这个文件 */ }
  }
  return null;
}

let idleWait = 1400;
let walkTimer = 0;
let lastTick = 0;
let loop = null;

// ── 配置持久化 ──────────────────────────────────────────────────
const cfgPath = () => path.join(app.getPath('userData'), 'pet-settings.json');

function loadCfg() {
  try {
    Object.assign(cfg, JSON.parse(fs.readFileSync(cfgPath(), 'utf8')));
  } catch { /* 首次运行没有配置文件 */ }
  scale = cfg.scale || 1;
  wanderOn = cfg.wander !== false;
  winW = Math.round(BASE_W * scale);
  winH = Math.round(BASE_H * scale);
}

let saveTimer = null;
function saveCfg() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    cfg.scale = scale;
    cfg.sound = cfg.sound !== false;
    cfg.wander = wanderOn;
    cfg.x = Math.round(pos.x);
    cfg.y = Math.round(pos.y);
    try {
      fs.mkdirSync(path.dirname(cfgPath()), { recursive: true });
      fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2));
    } catch { /* 写盘失败不影响运行 */ }
  }, 400);
}

// ── 屏幕几何 ────────────────────────────────────────────────────
function displayOf() {
  return screen.getDisplayNearestPoint({ x: Math.round(pos.x + winW / 2), y: Math.round(pos.y + winH / 2) });
}
const workArea = () => displayOf().workArea;
const groundTop = () => workArea().y + workArea().height - winH - GROUND_GAP;

// 命中区域：一个包住身体的椭圆（占窗口的比例，随 scale 自动缩放）
function hitTest(p, k = 1) {
  const cx = pos.x + winW * 0.5;
  const cy = pos.y + winH * 0.56;
  const pad = (ignoring ? 1.0 : 1.06) * k;  // 已经在里面时放宽一点，避免边缘抖动
  const rx = winW * 0.34 * pad;
  const ry = winH * 0.42 * pad;
  const dx = (p.x - cx) / rx;
  const dy = (p.y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

// ── 状态广播 ────────────────────────────────────────────────────
function sync() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('pet:sync', {
    mode,
    facing,
    scale,
    sound: cfg.sound !== false,
    wander: wanderOn,
    sleeping: sleepMode,
    laugh: laughUrl
  });
}

function setMode(m) {
  if (mode === m) return;
  mode = m;
  sync();
}

function sendAction(type, payload = {}) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('pet:action', { type, ...payload });
}

// ── 行为 ────────────────────────────────────────────────────────
function startWalk() {
  pos.y = groundTop();
  facing = Math.random() < 0.5 ? 1 : -1;
  walkTimer = 1.2 + Math.random() * 2.6;
  setMode('walk');
}

function stopWalk() {
  setMode('idle');
  idleWait = 2200 + Math.random() * 5200;
}

function keepInDisplay() {
  const a = workArea();
  pos.x = Math.max(a.x - winW * 0.2, Math.min(pos.x, a.x + a.width - winW * 0.8));
}

// ── 主循环 ──────────────────────────────────────────────────────
function tick() {
  if (!win || win.isDestroyed()) return;

  const now = Date.now();
  const dt = Math.min(0.05, (now - lastTick) / 1000) || 0.016;
  lastTick = now;
  const p = screen.getCursorScreenPoint();

  // 1. 透明区域穿透 / 命中时接管鼠标
  //    菜单开着的时候整个窗口都接管，否则菜单按钮那块会被判成"空白区"直接穿透下去
  if (menuOpen) {
    if (ignoring) {
      win.setIgnoreMouseEvents(false);
      ignoring = false;
    }
  } else if (!dragging) {
    const inside = hitTest(p);
    if (inside && ignoring) {
      win.setIgnoreMouseEvents(false);
      ignoring = false;
    } else if (!inside && !ignoring) {
      win.setIgnoreMouseEvents(true);
      ignoring = true;
    }
  }

  // 2. 菜单开着时，光标真正离开窗口才关（留 12px 余量，别抖一下就没了）
  if (menuOpen) {
    const m = 12;
    const inside =
      p.x >= pos.x - m && p.x <= pos.x + winW + m && p.y >= pos.y - m && p.y <= pos.y + winH + m;
    if (!inside) closeMenu();
  }

  // 3. 按下 → 拖动的判定（用全局光标，比 renderer 的 mousemove 可靠）
  if (press) {
    const moved = Math.hypot(p.x - press.sx, p.y - press.sy);
    if (moved > DRAG_THRESHOLD) {
      dragging = { ox: press.ox, oy: press.oy };
      press = null;
      if (ignoring) { win.setIgnoreMouseEvents(false); ignoring = false; }
      setMode('drag');
    }
  }

  // 4. 物理
  if (dragging) {
    pos.x = p.x - dragging.ox;
    pos.y = p.y - dragging.oy;
    keepInDisplay();
  } else if (mode === 'fall') {
    vy += GRAVITY * dt;
    pos.y += vy * dt;
    const g = groundTop();
    if (pos.y >= g) {
      const impact = vy;
      pos.y = g;
      vy = 0;
      setMode('idle');
      idleWait = 2600 + Math.random() * 3000;
      sendAction('land', { impact: Math.min(1, impact / 1800) });
    }
  } else if (mode === 'walk') {
    // 光标一靠近就站住，否则它在走的时候你永远点不中
    if (hitTest(p, 1.55)) {
      stopWalk();
    } else {
      pos.x += facing * WALK_SPEED * scale * dt;
      const a = workArea();
      const left = a.x + 2;
      const right = a.x + a.width - winW - 2;
      if (pos.x <= left) { pos.x = left; facing = 1; sync(); }
      if (pos.x >= right) { pos.x = right; facing = -1; sync(); }
      walkTimer -= dt;
      if (walkTimer <= 0) stopWalk();
    }
  } else if (mode === 'idle' && !sleepMode && !menuOpen) {
    idleWait -= dt * 1000;
    if (idleWait <= 0) {
      if (wanderOn) startWalk();
      else idleWait = 4000;
    }
  }

  // 5. 落位
  const nx = Math.round(pos.x);
  const ny = Math.round(pos.y);
  const b = win.getBounds();
  if (b.x !== nx || b.y !== ny) win.setPosition(nx, ny);
}

// ── 菜单 ────────────────────────────────────────────────────────
function openMenu() {
  menuOpen = true;
  const found = findLaugh();
  if (found !== laughUrl) { laughUrl = found; sync(); }
  press = null;
  dragging = null;
  if (mode === 'walk') stopWalk();   // 开菜单时先站住，别一边走一边把菜单带走
  if (ignoring) { win.setIgnoreMouseEvents(false); ignoring = false; }
}

function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  if (win && !win.isDestroyed()) win.webContents.send('pet:menu-close');
  sync();
}

// ── 窗口 ────────────────────────────────────────────────────────
function createWindow() {
  const a = screen.getPrimaryDisplay().workArea;

  if (typeof cfg.x === 'number' && typeof cfg.y === 'number') {
    pos = { x: cfg.x, y: cfg.y };
  } else {
    pos = { x: Math.round(a.x + a.width / 2 - winW / 2), y: a.y + a.height - winH - GROUND_GAP };
  }

  win = new BrowserWindow({
    width: winW,
    height: winH,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,          // 点击不抢当前 App 焦点
    acceptFirstMouse: true,    // 未激活时第一次点击也生效
    roundedCorners: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false   // 被遮挡时也不掉帧
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    win.showInactive();            // 不抢焦点地显示
    win.setAlwaysOnTop(true, 'screen-saver');
    try {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    } catch { /* 某些 macOS 版本不支持 */ }
    win.setIgnoreMouseEvents(true);
    ignoring = true;
    lastTick = Date.now();
    loop = setInterval(tick, TICK);
  });

  win.on('closed', () => {
    clearInterval(loop);
    win = null;
  });
}

// ── IPC ─────────────────────────────────────────────────────────
ipcMain.handle('pet:ready', () => ({
  mode,
  facing,
  scale,
  sound: cfg.sound !== false,
  wander: wanderOn,
  sleeping: sleepMode,
  laugh: laughUrl
}));

ipcMain.on('pet:press', (_e, p) => {
  if (menuOpen) return;
  press = { sx: p.sx, sy: p.sy, ox: p.sx - pos.x, oy: p.sy - pos.y };
});

ipcMain.handle('pet:release', () => {
  press = null;
  if (dragging) {
    dragging = null;
    vy = 0;
    setMode('fall');
    return { tapped: false };
  }
  return { tapped: true };
});

ipcMain.on('pet:menu', (_e, open) => {
  if (open) openMenu();
  else closeMenu();
});

ipcMain.on('pet:cmd', (_e, { type, value }) => {
  switch (type) {
    case 'laugh':
      closeMenu();
      sendAction('laugh');
      break;
    case 'feed':
      closeMenu();
      sendAction('feed');
      break;
    case 'sleep':
      closeMenu();
      sleepMode = !sleepMode;
      press = null;
      dragging = null;
      if (sleepMode) {
        pos.y = groundTop();
        setMode('sleep');
      } else {
        setMode('idle');
        idleWait = 1200;
      }
      break;
    case 'wander':
      wanderOn = !wanderOn;
      if (!wanderOn && mode === 'walk') stopWalk();
      sync();
      saveCfg();
      break;
    case 'sound':
      cfg.sound = cfg.sound === false;
      sync();
      saveCfg();
      break;
    case 'scale': {
      const s = Number(value) || 1;
      const oldH = winH;
      const b = win.getBounds();
      scale = s;
      winW = Math.round(BASE_W * s);
      winH = Math.round(BASE_H * s);
      pos.x = Math.round(b.x + (b.width - winW) / 2);
      pos.y = Math.round(b.y + oldH - winH);
      if (mode === 'idle' || mode === 'sleep' || mode === 'walk') pos.y = groundTop();
      // resizable:false 的窗口在 macOS 上会吞掉 setBounds 的尺寸变化，临时放开
      win.setResizable(true);
      win.setBounds({ x: Math.round(pos.x), y: Math.round(pos.y), width: winW, height: winH });
      win.setResizable(false);
      sync();
      saveCfg();
      break;
    }
    case 'opensounds':
      closeMenu();
      shell.openPath(path.join(__dirname, 'assets', 'sounds'));
      break;
    case 'quit':
      app.quit();
      break;
    default:
      break;
  }
});

// ── 生命周期 ────────────────────────────────────────────────────
app.whenReady().then(() => {
  loadCfg();
  laughUrl = findLaugh();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
