'use strict';

/* ════════════════════════════════════════════════════════════════
   奶蛙桌宠 · 渲染层
   - 主进程管窗口位置/物理，这里只管"表情与动作"
   - 打开方式：Electron 窗口内 / 浏览器直接开 index.html（自动走 mock）
   ════════════════════════════════════════════════════════════════ */

const root = document.getElementById('stage');
const rig = document.getElementById('rig');
const squash = document.getElementById('squash');
const menu = document.getElementById('menu');
const cup = document.getElementById('cup');
const hearts = document.getElementById('hearts');

const api = window.petAPI || makeMockApi();

let baseMode = 'idle';   // idle | walk | drag | fall | sleep
let facing = 1;
let soundOn = true;
let wanderOn = true;
let actionMode = null;   // laugh | eat（临时覆盖）
let actionTimer = null;
let menuOpen = false;

// ── 状态 → class ───────────────────────────────────────────────
function render() {
  const eff = actionMode || baseMode;
  root.className = `state-${eff}`;
  rig.classList.toggle('face-left', facing < 0);
  cup.classList.toggle('show', eff === 'eat' && eatStage === 'cup');
  document.getElementById('barMood').style.width = `${stats.mood}%`;
  document.getElementById('barFull').style.width = `${stats.full}%`;
}

function setMode(m) {
  if (baseMode === m) return;
  baseMode = m;
  render();
}

function startAction(name, ms) {
  actionMode = name;
  render();
  clearTimeout(actionTimer);
  actionTimer = setTimeout(() => {
    actionMode = null;
    eatStage = null;
    render();
  }, ms);
}

// ── 眨眼 ───────────────────────────────────────────────────────
let blinkTimer = null;
function scheduleBlink() {
  clearTimeout(blinkTimer);
  blinkTimer = setTimeout(() => {
    if (!actionMode && baseMode !== 'sleep' && baseMode !== 'drag') {
      rig.classList.add('blink');
      setTimeout(() => rig.classList.remove('blink'), 130);
    }
    scheduleBlink();
  }, 2200 + Math.random() * 4200);
}

// ── 数值（心情 / 饱腹）────────────────────────────────────────
const stats = loadStats();
let eatStage = null;

function loadStats() {
  let s = { mood: 78, full: 62, t: Date.now() };
  try {
    const raw = localStorage.getItem('naiwa-stats');
    if (raw) s = { ...s, ...JSON.parse(raw) };
  } catch { /* 忽略 */ }
  // 离线期间缓慢衰减
  const mins = Math.max(0, (Date.now() - (s.t || Date.now())) / 60000);
  s.mood = clamp(s.mood - mins * 0.35, 0, 100);
  s.full = clamp(s.full - mins * 0.6, 0, 100);
  return s;
}

function saveStats() {
  stats.t = Date.now();
  try { localStorage.setItem('naiwa-stats', JSON.stringify(stats)); } catch { /* 忽略 */ }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

setInterval(() => {
  stats.mood = clamp(stats.mood - 0.4, 0, 100);
  stats.full = clamp(stats.full - 0.7, 0, 100);
  saveStats();
  render();
}, 30000);

// ── 音效 ───────────────────────────────────────────────────────
// 优先用 assets/sounds/laugh.* 里的真实笑声；找不到就用原本那段合成音。
let actx = null;
function audio() {
  if (!soundOn) return null;
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

/** 魔性笑声：一串快速下行的"哈"，锯齿波 + 带通共振腔 */
function synthLaugh() {
  const ctx = audio();
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  const n = 5 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * (0.115 + Math.random() * 0.02);
    const base = 168 - i * 5 + (Math.random() - 0.5) * 8;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base * 1.85, t);
    osc.frequency.exponentialRampToValueAtTime(base * 0.72, t + 0.1);

    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.setValueAtTime(760, t);
    formant.frequency.exponentialRampToValueAtTime(520, t + 0.11);
    formant.Q.value = 3.4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);

    osc.connect(formant).connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}

function sfxLaugh() {
  if (!soundOn) return;
  synthLaugh();
}

// ── 动作 ───────────────────────────────────────────────────────
function doLaugh() {
  // 有真笑声就按它的长度演，没有就演 2.4 秒
  startAction('laugh', 2400);
  sfxLaugh();
  stats.mood = clamp(stats.mood + 4, 0, 100);
  render();
}

function doFeed() {
  eatStage = 'cup';
  startAction('eat', 2300);
  render();
  sfxSlurp();
  setTimeout(() => { eatStage = null; render(); }, 900);
  setTimeout(() => {
    stats.full = clamp(stats.full + 26, 0, 100);
    stats.mood = clamp(stats.mood + 8, 0, 100);
    popHearts();
    render();
  }, 1500);
}

function doPoke() {
  const svg = document.getElementById('svg');
  svg.classList.remove('hop');
  void svg.offsetWidth;
  svg.classList.add('hop');
  setTimeout(() => svg.classList.remove('hop'), 700);
  sfxPoke();
  stats.mood = clamp(stats.mood + 2, 0, 100);
  popHearts();
  render();
}

function doLand(strength) {
  squash.classList.remove('landing');
  void squash.offsetWidth;
  squash.classList.add('landing');
  setTimeout(() => squash.classList.remove('landing'), 400);
  sfxLand(strength);
}

function popHearts() {
  hearts.classList.remove('pop');
  void hearts.offsetWidth;
  hearts.classList.add('pop');
  setTimeout(() => hearts.classList.remove('pop'), 1300);
}

// ── 指针交互 ───────────────────────────────────────────────────
let pressed = false;

window.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#menu')) return;   // 菜单内部的点击交给菜单自己处理
  if (e.button === 2) {
    e.preventDefault();
    toggleMenu(!menuOpen);
    return;
  }
  if (e.button !== 0) return;
  if (menuOpen) { toggleMenu(false); return; }
  pressed = true;
  api.press({ sx: e.screenX, sy: e.screenY });
  audio(); // 首次交互解锁音频
});

window.addEventListener('pointerup', async (e) => {
  if (e.button !== 0 || !pressed) return;
  pressed = false;
  const res = await api.release();
  if (res.tapped && baseMode !== 'sleep') doPoke();
});

window.addEventListener('contextmenu', (e) => e.preventDefault());

// ── 菜单 ───────────────────────────────────────────────────────
function toggleMenu(open) {
  menuOpen = open;
  menu.classList.toggle('hidden', !open);
  api.menu(open);
  renderMenuState();
}

function renderMenuState() {
  const btnWander = menu.querySelector('[data-cmd="wander"]');
  const btnSound = menu.querySelector('[data-cmd="sound"]');
  const btnSleep = menu.querySelector('[data-cmd="sleep"]');
  btnWander.classList.toggle('on', wanderOn);
  btnWander.textContent = wanderOn ? '自己走走' : '站好别动';
  btnSound.classList.toggle('on', soundOn);
  btnSound.textContent = soundOn ? '声音：开' : '声音：关';
  btnSleep.classList.toggle('on', baseMode === 'sleep');
  btnSleep.textContent = baseMode === 'sleep' ? '叫醒' : '去睡觉';
  menu.querySelectorAll('.sizes button').forEach((b) => {
    b.classList.toggle('on', Math.abs(Number(b.dataset.value) - currentScale) < 0.01);
  });
}

let currentScale = 1;

menu.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const { cmd, value } = btn.dataset;
  switch (cmd) {
    case 'laugh': doLaugh(); toggleMenu(false); break;
    case 'feed': doFeed(); toggleMenu(false); break;
    case 'sleep':
      toggleMenu(false);
      api.cmd('sleep');
      break;
    case 'wander':
      wanderOn = !wanderOn;
      api.cmd('wander');
      renderMenuState();
      break;
    case 'sound':
      soundOn = !soundOn;
      api.cmd('sound');
      renderMenuState();
      break;
    case 'scale':
      currentScale = Number(value);
      api.cmd('scale', currentScale);
      renderMenuState();
      break;
    case 'quit':
      api.cmd('quit');
      break;
    default: break;
  }
});

// ── 主进程同步 ─────────────────────────────────────────────────
api.onSync((d) => {
  baseMode = d.mode;
  facing = d.facing;
  soundOn = d.sound;
  wanderOn = d.wander;
  if (Math.abs((d.scale || 1) - currentScale) > 0.01) currentScale = d.scale;
  render();
  renderMenuState();
});

api.onAction(({ type, impact }) => {
  if (type === 'laugh') doLaugh();
  else if (type === 'feed') doFeed();
  else if (type === 'land') doLand(impact ?? 0.5);
});

// 主进程判定光标离开窗口 → 收菜单
api.onMenuClose(() => {
  if (!menuOpen) return;
  menuOpen = false;
  menu.classList.add('hidden');
});

// ── 启动 ───────────────────────────────────────────────────────
(async function boot() {
  const init = await api.ready();
  baseMode = init.mode || 'idle';
  facing = init.facing || 1;
  soundOn = init.sound !== false;
  wanderOn = init.wander !== false;
  currentScale = init.scale || 1;
  render();
  renderMenuState();
  scheduleBlink();
})();

// ── 浏览器预览用的假 API（Electron 里不会走到）───────────────────
function makeMockApi() {
  const noop = () => {};
  return {
    ready: async () => ({ mode: 'idle', facing: 1, scale: 1, sound: true, wander: true, sleeping: false }),
    press: noop,
    release: async () => ({ tapped: true }),
    menu: noop,
    cmd: noop,
    onSync: noop,
    onAction: noop,
    onMenuClose: noop
  };
}
