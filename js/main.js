import { TOOL_HINTS } from "./config.js";
import { createGame, getTimeLabel } from "./game.js";
import { clothingLabel, moodLabel, schedulePhase, weatherStatus } from "./life.js";
import { POWER_TABS, WAR_GROUPS } from "./powers.js";
import {
  activeQuestSummary,
  attitudeLabel,
  personalAttitude,
  weaponInfo,
} from "./social.js";
import { STRATEGIES } from "./war.js";
import { countBuildings } from "./world.js";

const boot = document.getElementById("boot");
const shell = document.getElementById("game-shell");
const howto = document.getElementById("howto");
const canvas = document.getElementById("world");

const btnStart = document.getElementById("btn-start");
const btnHowto = document.getElementById("btn-howto");
const btnHowtoClose = document.getElementById("btn-howto-close");
const toolHint = document.getElementById("tool-hint");
const toasts = document.getElementById("toasts");
const godTools = document.getElementById("god-tools");
const warSubs = document.getElementById("war-subs");
const statusLine = document.getElementById("status-line");
const inspectEl = document.getElementById("inspect");
const inspectClose = document.getElementById("inspect-close");

const TOOL_LABELS = {
  select: "Выбор",
  hut: "Домик",
  farm: "Грядка",
  stockpile: "Склад",
  wall: "Стена",
  gate: "Ворота",
  tower: "Башня",
  barracks: "Казарма",
  train_soldier: "Солдат",
  stance_defend: "Оборона",
  stance_raid: "Рейд",
  stance_encircle: "Охват",
  stance_siege: "Осада",
  stance_breakthrough: "Прорыв",
  stance_ambush: "Засада",
  stance_blitzkrieg: "Блицкриг",
  stance_kessel: "Котёл",
  stance_depth_defense: "Эшелон",
  stance_barrage: "Артналёт",
  stance_partisans: "Партизаны",
  stance_attrition: "Измор",
  stance_elastic: "Эластичн.",
  stance_night_raid: "Ночь",
  stance_interdiction: "Блокада",
  stance_shock: "Штурм",
  declare_war: "Война",
  make_peace: "Мир",
  spawn_army: "Волна",
  chop: "Рубка",
  gather: "Ягоды",
  mine: "Камень",
  paint_grass: "Трава",
  paint_sand: "Песок",
  paint_dirt: "Земля",
  paint_water: "Вода",
  paint_snow: "Снег",
  paint_lava: "Лава",
  paint_mountain: "Горы",
  plant_tree: "Лес",
  plant_bush: "Кусты",
  plant_rock: "Камни",
  erase: "Стерка",
  spawn_human: "Человек",
  spawn_rabbit: "Кролик",
  spawn_wolf: "Волк",
  spawn_bandit: "Бандит",
  rain: "Дождь",
  bless: "Благо",
  lightning: "Молния",
  meteor: "Метеор",
  fire: "Огонь",
  bomb: "Бомба",
  tornado: "Торнадо",
  death: "Смерть",
};

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

inspectClose.addEventListener("click", () => {
  if (!api) return;
  api.game.selected = null;
  api.game.selectedBuilding = null;
  api.game.selectedCreature = null;
  updateInspect();
});

btnStart.addEventListener("click", () => {
  boot.classList.add("hidden");
  shell.classList.remove("hidden");
  api = createGame(canvas);
  api.setToastHandler(showToast);
  api.resize();
  api.start();
  wireGame();
  renderGodTools(api.game.powerTab);
  requestAnimationFrame(uiLoop);
});

function wireGame() {
  const { game } = api;

  window.addEventListener("resize", () => api.resize());

  document.querySelectorAll(".god-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".god-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      game.powerTab = btn.dataset.tab;
      warSubs.classList.toggle("hidden", game.powerTab !== "war");
      renderGodTools(game.powerTab);
    });
  });

  document.querySelectorAll(".war-sub").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".war-sub").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      game.warSub = btn.dataset.war;
      renderGodTools("war");
    });
  });

  document.querySelectorAll(".brush").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".brush").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      game.brushSize = Number(btn.dataset.brush);
    });
  });

  document.querySelectorAll(".speed").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".speed").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      game.speed = Number(btn.dataset.speed);
    });
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
    if (e.code === "Digit1") setBrush(0);
    if (e.code === "Digit2") setBrush(1);
    if (e.code === "Digit3") setBrush(2);
    if (e.code === "Escape") setTool("select");
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
      api.onPointerDown(e.clientX - rect.left, e.clientY - rect.top);
      updateInspect();
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
    api.onPointerUp();
  });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
    lastPan = null;
    api.onPointerUp();
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    game.renderer.cam.zoom *= dir > 0 ? 0.9 : 1.1;
    api.clampCam();
  }, { passive: false });
}

function toolsForTab(tab) {
  if (tab !== "war") return POWER_TABS[tab]?.tools || [];
  const group = api?.game?.warSub || "build";
  return WAR_GROUPS[group] || WAR_GROUPS.build;
}

function renderGodTools(tab) {
  const { game } = api;
  const tools = toolsForTab(tab);
  warSubs.classList.toggle("hidden", tab !== "war");
  godTools.innerHTML = "";
  for (const tool of tools) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "god-tool" + (game.tool === tool ? " active" : "");
    btn.dataset.tool = tool;
    btn.innerHTML = `<span class="god-swatch god-swatch--${tool}"></span><span>${TOOL_LABELS[tool] || tool}</span>`;
    btn.title = TOOL_HINTS[tool] || tool;
    btn.addEventListener("click", () => setTool(tool));
    godTools.appendChild(btn);
  }
  if (!tools.includes(game.tool)) {
    setTool(tools[0] || "select");
  } else {
    toolHint.textContent = TOOL_HINTS[game.tool] || "";
  }
}

function setTool(tool) {
  if (!api) return;
  api.game.tool = tool;
  toolHint.textContent = TOOL_HINTS[tool] || "";
  godTools.querySelectorAll(".god-tool").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === tool);
  });
}

function setBrush(size) {
  if (!api) return;
  api.game.brushSize = size;
  document.querySelectorAll(".brush").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.brush) === size);
  });
}

function uiLoop(now) {
  if (!api) return;
  if (now - uiTimer > 120) {
    uiTimer = now;
    syncHud();
    updateInspect();
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
  statusLine.textContent = colonyStatus(game);
}

function colonyStatus(game) {
  const alive = game.settlers.filter((s) => s.state !== "die");
  const builds = game.jobs.filter((j) => j.type === "build").length;
  const chatting = alive.filter((s) => s.state === "chat").length;
  const sleeping = alive.filter((s) => s.state === "sleep").length;
  const soldiers = alive.filter((s) => s.military).length;
  const enemyN = game.creatures.filter((c) => !c.dead && c.kind === "soldier").length;
  const homes = countBuildings(game.world, "hut", true);
  const phase = schedulePhase(game.dayPhase);
  const weather = weatherStatus(game);
  const st = STRATEGIES[game.war?.colonyStance]?.name;

  const quest = activeQuestSummary(game);
  const rep = attitudeLabel(game.social?.playerRep ?? 0);
  if (quest) {
    return `Поручение · ${quest} · ${rep}`;
  }
  if (game.war?.atWar || enemyN) {
    return `${weather} · война · «${st || "—"}» · солдаты ${soldiers} / орда ${enemyN}`;
  }
  if (game.weather?.kind === "rain" || game.weather?.kind === "storm") {
    return `${weather} · ${phase.label} · прячутся · ${rep}`;
  }
  if (sleeping >= Math.max(1, (alive.length / 2) | 0)) {
    return `${weather} · ${phase.label} · спят ${sleeping}`;
  }
  if (chatting > 0) {
    const rumor = game.social?.rumors?.slice(-1)[0];
    return rumor
      ? `${phase.label} · слух: ${rumor.text}`
      : `${weather} · ${phase.label} · общаются ${chatting}`;
  }
  if (builds > 0) {
    return `${weather} · ${phase.label} · работают · ${rep}`;
  }
  return `${weather} · ${phase.label} · ${alive.length} чел. · ${rep}`;
}

function hasSelection(game) {
  return !!(game.selected && game.selected.state !== "die")
    || !!(game.selectedCreature && !game.selectedCreature.dead)
    || !!game.selectedBuilding;
}

function updateInspect() {
  const { game } = api;
  if (!hasSelection(game)) {
    inspectEl.classList.add("hidden");
    return;
  }
  inspectEl.classList.remove("hidden");

  if (game.selected && game.selected.state !== "die") {
    const s = game.selected;
    const role = s.brain?.roleName || "Житель";
    const phase = schedulePhase(api.game.dayPhase);
    const mood = moodLabel(s.life?.mood ?? 0.5);
    const cloth = clothingLabel(s.life?.clothing || "plain");
    const att = personalAttitude(s);
    const wpn = weaponInfo(s);
    const mem = (s.life?.memories || []).slice(-1)[0];
    const memLine = mem ? ` · помнит: ${mem.note}` : "";
    el.title.textContent = `${s.name} · ${role}`;
    el.body.textContent = `${s.thought} · ${phase.label} · ${mood} · ${att} · ${wpn.name}${memLine}`;
    el.bars.classList.remove("hidden");
    const moodPct = ((s.life?.mood ?? 0.5) * 100).toFixed(0);
    const fearPct = ((s.life?.fear ?? 0) * 100).toFixed(0);
    const trustPct = ((((s.life?.playerRep ?? 0) + 1) / 2) * 100).toFixed(0);
    const socialPct = ((s.life?.socialNeed ?? 0) * 100).toFixed(0);
    el.bars.innerHTML = `
      <div class="bar-row"><span>Голод</span><div class="bar bar--hunger"><i style="width:${s.hunger.toFixed(0)}%"></i></div></div>
      <div class="bar-row"><span>Силы</span><div class="bar bar--energy"><i style="width:${s.energy.toFixed(0)}%"></i></div></div>
      <div class="bar-row"><span>Настрой</span><div class="bar bar--progress"><i style="width:${moodPct}%"></i></div></div>
      <div class="bar-row"><span>Страх</span><div class="bar bar--hunger"><i style="width:${fearPct}%"></i></div></div>
      <div class="bar-row"><span>К богам</span><div class="bar bar--energy"><i style="width:${trustPct}%"></i></div></div>
      <div class="bar-row"><span>Общение</span><div class="bar bar--progress"><i style="width:${socialPct}%"></i></div></div>
    `;
    return;
  }

  if (game.selectedCreature && !game.selectedCreature.dead) {
    const c = game.selectedCreature;
    const names = { rabbit: "Кролик", wolf: "Волк", bandit: "Бандит", soldier: "Воин Орды" };
    el.title.textContent = names[c.kind] || c.kind;
    el.body.textContent = c.kind === "soldier"
      ? `Стратегия: ${STRATEGIES[api.game.war?.enemyStance]?.name || "бой"} · приказ: ${c.order?.type || "—"}`
      : c.hostile ? "Опасен для поселенцев" : "Можно добыть на еду";
    el.bars.classList.remove("hidden");
    el.bars.innerHTML = `
      <div class="bar-row"><span>HP</span><div class="bar bar--energy"><i style="width:${((c.hp / c.maxHp) * 100).toFixed(0)}%"></i></div></div>
    `;
    return;
  }

  if (game.selectedBuilding) {
    const b = game.selectedBuilding;
    if (b.type === "resource") {
      const names = { tree: "Дерево", bush: "Ягодный куст", rock: "Камень" };
      el.title.textContent = names[b.kind] || "Ресурс";
      el.body.textContent = `Запас: ${b.amount}`;
      el.bars.classList.add("hidden");
      return;
    }
    if (b.type === "tile") {
      const names = {
        grass: "Трава", dirt: "Земля", sand: "Песок", water: "Вода",
        snow: "Снег", lava: "Лава", mountain: "Горы",
      };
      el.title.textContent = names[b.terrain] || "Клетка";
      el.body.textContent = "Люди сами решают, что строить рядом.";
      el.bars.classList.add("hidden");
      return;
    }
    const names = {
      hut: "Домик", farm: "Грядка", stockpile: "Склад",
      wall: "Стена", gate: "Ворота", tower: "Башня", barracks: "Казарма",
    };
    el.title.textContent = names[b.type] || "Здание";
    if (!b.done) {
      el.body.textContent = "Строится поселенцами…";
      el.bars.classList.remove("hidden");
      el.bars.innerHTML = `
        <div class="bar-row"><span>Прогресс</span><div class="bar bar--progress"><i style="width:${(b.progress * 100).toFixed(0)}%"></i></div></div>
      `;
    } else if (b.type === "farm") {
      el.body.textContent = (b.growth ?? 0) >= 1 ? "Урожай готов" : "Растёт";
      el.bars.classList.remove("hidden");
      el.bars.innerHTML = `
        <div class="bar-row"><span>Рост</span><div class="bar bar--progress"><i style="width:${((b.growth ?? 0) * 100).toFixed(0)}%"></i></div></div>
      `;
    } else if (b.type === "tower") {
      el.body.textContent = "Стреляет по воинам Орды в радиусе.";
      el.bars.classList.add("hidden");
    } else if (b.type === "wall" || b.type === "gate") {
      el.body.textContent = b.type === "gate" ? "Проход в стене." : "Блокирует путь.";
      el.bars.classList.remove("hidden");
      const max = b.type === "wall" ? 80 : 100;
      el.bars.innerHTML = `
        <div class="bar-row"><span>Прочность</span><div class="bar bar--hunger"><i style="width:${((b.hp / max) * 100).toFixed(0)}%"></i></div></div>
      `;
    } else if (b.type === "barracks") {
      el.body.textContent = "Колония сама готовит солдат при угрозе.";
      el.bars.classList.add("hidden");
    } else {
      el.body.textContent = b.type === "hut" ? "Укрытие на ночь" : "Общий склад";
      el.bars.classList.add("hidden");
    }
  }
}

function showToast(msg) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = msg;
  toasts.appendChild(node);
  setTimeout(() => node.remove(), 2800);
}
