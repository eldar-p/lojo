import { TOOL_HINTS } from "./config.js";
import { canRecruit, createGame, getTimeLabel } from "./game.js";

const boot = document.getElementById("boot");
const shell = document.getElementById("game-shell");
const howto = document.getElementById("howto");
const canvas = document.getElementById("world");

const btnStart = document.getElementById("btn-start");
const btnHowto = document.getElementById("btn-howto");
const btnHowtoClose = document.getElementById("btn-howto-close");
const btnRecruit = document.getElementById("btn-recruit");
const toolHint = document.getElementById("tool-hint");
const toasts = document.getElementById("toasts");

const el = {
  food: document.getElementById("res-food"),
  wood: document.getElementById("res-wood"),
  stone: document.getElementById("res-stone"),
  people: document.getElementById("res-people"),
  day: document.getElementById("day-label"),
  time: document.getElementById("time-label"),
  fill: document.getElementById("day-fill"),
  title: document.getElementById("inspect-title"),
  body: document.getElementById("inspect-body"),
  bars: document.getElementById("inspect-bars"),
};

let api = null;
let dragging = false;
let lastPan = null;
let uiTimer = 0;

btnHowto.addEventListener("click", () => howto.classList.remove("hidden"));
btnHowtoClose.addEventListener("click", () => howto.classList.add("hidden"));
howto.addEventListener("click", (e) => {
  if (e.target === howto) howto.classList.add("hidden");
});

btnStart.addEventListener("click", () => {
  boot.classList.add("hidden");
  shell.classList.remove("hidden");
  api = createGame(canvas);
  api.setToastHandler(showToast);
  api.resize();
  api.start();
  wireGame();
  requestAnimationFrame(uiLoop);
});

function wireGame() {
  const { game } = api;

  window.addEventListener("resize", () => api.resize());

  document.querySelectorAll(".tool").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tool").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      game.tool = btn.dataset.tool;
      toolHint.textContent = TOOL_HINTS[game.tool] || "";
    });
  });

  document.querySelectorAll(".speed").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".speed").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      game.speed = Number(btn.dataset.speed);
    });
  });

  btnRecruit.addEventListener("click", () => {
    api.recruit();
    refreshRecruit();
  });

  window.addEventListener("keydown", (e) => {
    game.keys.add(e.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === "Space") {
      const speeds = [0, 1, 2, 3];
      const idx = speeds.indexOf(game.speed);
      const next = speeds[(idx + 1) % speeds.length];
      game.speed = next;
      document.querySelectorAll(".speed").forEach((b) => {
        b.classList.toggle("active", Number(b.dataset.speed) === next);
      });
    }
    if (e.code === "Escape") {
      game.tool = "select";
      document.querySelectorAll(".tool").forEach((b) => {
        b.classList.toggle("active", b.dataset.tool === "select");
      });
      toolHint.textContent = TOOL_HINTS.select;
    }
  });

  window.addEventListener("keyup", (e) => game.keys.delete(e.code));

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 2 || e.button === 1 || e.altKey) {
      dragging = true;
      lastPan = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 0) {
      const rect = canvas.getBoundingClientRect();
      api.onClick(e.clientX - rect.left, e.clientY - rect.top);
      updateInspect();
      refreshRecruit();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    api.onPointerMove(sx, sy);

    if (dragging && lastPan) {
      const dx = e.clientX - lastPan.x;
      const dy = e.clientY - lastPan.y;
      lastPan = { x: e.clientX, y: e.clientY };
      const zoom = game.renderer.cam.zoom;
      game.renderer.cam.x -= dx / (28 * zoom);
      game.renderer.cam.y -= dy / (28 * zoom);
      api.clampCam();
    }
  });

  canvas.addEventListener("pointerup", () => {
    dragging = false;
    lastPan = null;
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    game.renderer.cam.zoom *= dir > 0 ? 0.9 : 1.1;
    api.clampCam();
  }, { passive: false });
}

function uiLoop(now) {
  if (!api) return;
  if (now - uiTimer > 100) {
    uiTimer = now;
    syncHud();
    updateInspect();
    refreshRecruit();
  }
  requestAnimationFrame(uiLoop);
}

function syncHud() {
  const { game } = api;
  el.food.textContent = Math.floor(game.stock.food);
  el.wood.textContent = Math.floor(game.stock.wood);
  el.stone.textContent = Math.floor(game.stock.stone);
  el.people.textContent = game.settlers.filter((s) => s.state !== "die").length;
  el.day.textContent = `День ${game.day}`;
  el.time.textContent = getTimeLabel(game.dayPhase);
  el.fill.style.width = `${(game.dayPhase * 100).toFixed(1)}%`;
}

function updateInspect() {
  const { game } = api;
  if (game.selected && game.selected.state !== "die") {
    const s = game.selected;
    el.title.textContent = s.name;
    el.body.textContent = `Сейчас: ${s.thought}`;
    el.bars.classList.remove("hidden");
    el.bars.innerHTML = `
      <div class="bar-row"><span>Голод</span><div class="bar bar--hunger"><i style="width:${s.hunger.toFixed(0)}%"></i></div></div>
      <div class="bar-row"><span>Силы</span><div class="bar bar--energy"><i style="width:${s.energy.toFixed(0)}%"></i></div></div>
    `;
    return;
  }

  if (game.selectedBuilding) {
    const b = game.selectedBuilding;
    if (b.type === "resource") {
      const names = { tree: "Дерево", bush: "Ягодный куст", rock: "Камень" };
      el.title.textContent = names[b.kind] || "Ресурс";
      el.body.textContent = `Запас: ${b.amount}. Отметь инструментом, чтобы поселенцы добыли.`;
      el.bars.classList.add("hidden");
      el.bars.innerHTML = "";
      return;
    }
    const names = { hut: "Домик", farm: "Грядка", stockpile: "Склад" };
    el.title.textContent = names[b.type] || "Здание";
    if (!b.done) {
      el.body.textContent = "Строится…";
      el.bars.classList.remove("hidden");
      el.bars.innerHTML = `
        <div class="bar-row"><span>Прогресс</span><div class="bar bar--progress"><i style="width:${(b.progress * 100).toFixed(0)}%"></i></div></div>
      `;
    } else if (b.type === "farm") {
      el.body.textContent = (b.growth ?? 0) >= 1 ? "Урожай готов к сбору" : "Растёт урожай";
      el.bars.classList.remove("hidden");
      el.bars.innerHTML = `
        <div class="bar-row"><span>Рост</span><div class="bar bar--progress"><i style="width:${((b.growth ?? 0) * 100).toFixed(0)}%"></i></div></div>
      `;
    } else if (b.type === "hut") {
      el.body.textContent = "Укрытие: поселенцы спят здесь ночью.";
      el.bars.classList.add("hidden");
    } else {
      el.body.textContent = "Общий склад поселения.";
      el.bars.classList.add("hidden");
    }
    return;
  }

  el.title.textContent = "Поселение";
  el.body.textContent = "Кликни по человеку или зданию, чтобы узнать детали.";
  el.bars.classList.add("hidden");
  el.bars.innerHTML = "";
}

function refreshRecruit() {
  if (!api) return;
  btnRecruit.disabled = !canRecruit(api.game);
}

function showToast(msg) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = msg;
  toasts.appendChild(node);
  setTimeout(() => node.remove(), 2800);
}
