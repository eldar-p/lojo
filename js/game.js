import {
  COSTS,
  DAY_LENGTH,
  MAP_H,
  MAP_W,
  RECRUIT_COST,
  TIME_LABELS,
} from "./config.js";
import { seedWildlife, updateCreatures } from "./creatures.js";
import { updateColonyPlan } from "./colony.js";
import { createWeather, updateWeather } from "./life.js";
import {
  applyPower,
  BRUSH_TOOLS,
  CLICK_POWERS,
  updateWorldForces,
} from "./powers.js";
import { createRenderer } from "./renderer.js";
import {
  beginSettlerThink,
  bindSettler,
  createSettler,
  updateSettler,
} from "./settlers.js";
import { createSocialState, updateGroups, updateQuests } from "./social.js";
import { buildingMaxHp, createWarState, MILITARY_BUILDINGS, updateWar } from "./war.js";
import {
  countBuildings,
  createWorld,
  findBuildSite,
  inBounds,
} from "./world.js";

const BUILD_TOOLS = new Set(["hut", "farm", "stockpile", ...MILITARY_BUILDINGS]);

export function createGame(canvas) {
  const world = createWorld();
  const renderer = createRenderer(canvas);
  const cx = (MAP_W / 2) | 0;
  const cy = (MAP_H / 2) | 0;

  const game = {
    world,
    renderer,
    settlers: [],
    creatures: [],
    jobs: [],
    fx: [],
    tornadoes: [],
    stock: { food: 18, wood: 20, stone: 4 },
    tool: "select",
    powerTab: "life",
    warSub: "build",
    brushSize: 1,
    war: createWarState(),
    weather: createWeather(),
    social: createSocialState(),
    speed: 1,
    time: DAY_LENGTH * 0.3,
    day: 1,
    dayPhase: 0.3,
    isNight: false,
    selected: null,
    selectedBuilding: null,
    selectedCreature: null,
    hoverTile: null,
    hoverValid: false,
    nextSettlerId: 1,
    nextCreatureId: 1,
    painting: false,
    toast(msg) {
      pushToast(msg);
    },
    keys: new Set(),
  };

  for (let i = 0; i < 3; i++) {
    const s = createSettler(cx - 1 + i, cy + 1, game.nextSettlerId++);
    s.faction = "colony";
    bindSettler(s, game);
    game.settlers.push(s);
  }

  placeBuilding(game, cx, cy, "stockpile", true);
  seedWildlife(game, 14);

  let last = performance.now();
  let running = false;
  let toastFn = () => {};

  function pushToast(msg) {
    toastFn(msg);
  }

  function setToastHandler(fn) {
    toastFn = fn;
    game.toast = (msg) => toastFn(msg);
  }

  function resize() {
    renderer.resize();
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function frame(now) {
    if (!running) return;
    const raw = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dt = raw * game.speed;

    const pan = 8 * raw / Math.max(0.4, renderer.cam.zoom);
    if (game.keys.has("KeyW") || game.keys.has("ArrowUp")) renderer.cam.y -= pan;
    if (game.keys.has("KeyS") || game.keys.has("ArrowDown")) renderer.cam.y += pan;
    if (game.keys.has("KeyA") || game.keys.has("ArrowLeft")) renderer.cam.x -= pan;
    if (game.keys.has("KeyD") || game.keys.has("ArrowRight")) renderer.cam.x += pan;
    clampCam();

    if (dt > 0) update(game, dt);
    renderer.draw(game, now / 1000);
    requestAnimationFrame(frame);
  }

  function clampCam() {
    renderer.cam.x = Math.max(2, Math.min(MAP_W - 2, renderer.cam.x));
    renderer.cam.y = Math.max(2, Math.min(MAP_H - 2, renderer.cam.y));
    renderer.cam.zoom = Math.max(0.55, Math.min(2.2, renderer.cam.zoom));
  }

  function screenToTile(sx, sy) {
    const w = renderer.screenToWorld(sx, sy);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  function onPointerMove(sx, sy) {
    const tile = screenToTile(sx, sy);
    game.hoverTile = tile;
    if (BUILD_TOOLS.has(game.tool)) {
      game.hoverValid = canAfford(game, game.tool) && findBuildSite(world, tile.x, tile.y);
    } else {
      game.hoverValid = inBounds(tile.x, tile.y);
    }

    if (game.painting && BRUSH_TOOLS.has(game.tool)) {
      applyPower(game, game.tool, tile.x, tile.y, { continuous: true });
    }
  }

  function onPointerDown(sx, sy) {
    const tile = screenToTile(sx, sy);
    if (!inBounds(tile.x, tile.y)) return;

    if (BRUSH_TOOLS.has(game.tool)) {
      game.painting = true;
      applyPower(game, game.tool, tile.x, tile.y);
      return;
    }

    if (CLICK_POWERS.has(game.tool)) {
      applyPower(game, game.tool, tile.x, tile.y);
      return;
    }

    if (game.tool === "select") {
      selectAt(game, tile.x, tile.y);
      return;
    }

    if (BUILD_TOOLS.has(game.tool)) {
      tryBuild(game, tile.x, tile.y, game.tool);
      return;
    }

    if (game.tool === "chop" || game.tool === "gather" || game.tool === "mine") {
      markResource(game, tile.x, tile.y, game.tool);
    }
  }

  function onPointerUp() {
    game.painting = false;
  }

  // backward compatible name used by main.js
  function onClick(sx, sy) {
    onPointerDown(sx, sy);
  }

  function recruit({ quiet = false } = {}) {
    const homes = countBuildings(world, "hut", true);
    const alive = game.settlers.filter((s) => s.state !== "die").length;
    if (alive >= homes + 3) {
      if (!quiet) game.toast("Нужно больше домов");
      return false;
    }
    if (game.stock.food < RECRUIT_COST.food) {
      if (!quiet) game.toast("Не хватает еды");
      return false;
    }
    game.stock.food -= RECRUIT_COST.food;
    const spot = findSpawn(game);
    const s = createSettler(spot.x, spot.y, game.nextSettlerId++);
    s.faction = "colony";
    bindSettler(s, game);
    game.settlers.push(s);
    game.toast(`${s.name} присоединился к поселению`);
    return true;
  }

  // Colony planner uses this for autonomous population growth
  game._recruit = () => recruit({ quiet: true });

  return {
    game,
    start,
    resize,
    setToastHandler,
    onPointerMove,
    onPointerDown,
    onPointerUp,
    onClick,
    recruit,
    clampCam,
    screenToTile,
  };
}

function update(game, dt) {
  game.time += dt;
  if (game.time >= DAY_LENGTH) {
    game.time -= DAY_LENGTH;
    game.day += 1;
    game.toast(`Наступил день ${game.day}`);
  }
  game.dayPhase = game.time / DAY_LENGTH;
  game.isNight = game.dayPhase < 0.18 || game.dayPhase > 0.82;

  updateWeather(game, dt);

  const rainBoost = game.weather?.kind === "rain" || game.weather?.kind === "storm" ? 1.45 : 1;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const b = game.world.buildings[y][x];
      if (b?.type === "farm" && b.done) {
        if ((b.growth ?? 0) < 1) {
          b.growth = Math.min(1, (b.growth ?? 0) + (dt / 28) * rainBoost);
        } else {
          const exists = game.jobs.some((j) => j.type === "harvest" && j.x === x && j.y === y);
          if (!exists) game.jobs.push({ type: "harvest", x, y, claimedBy: null });
        }
      }
    }
  }

  if (Math.random() < dt * 0.15) {
    const x = (Math.random() * MAP_W) | 0;
    const y = (Math.random() * MAP_H) | 0;
    const cell = game.world.resources[y][x];
    const t = game.world.terrain[y][x];
    if (!cell.kind && !game.world.buildings[y][x] && (t === "grass" || t === "dirt") && Math.random() < 0.35) {
      cell.kind = Math.random() < 0.55 ? "bush" : Math.random() < 0.5 ? "tree" : null;
      if (cell.kind) cell.amount = cell.kind === "tree" ? 3 : 2;
    }
  }

  updateColonyPlan(game, dt);
  updateQuests(game, dt);
  updateGroups(game, dt);

  beginSettlerThink(game);
  for (const s of game.settlers) {
    if (s.state !== "die") updateSettler(s, dt, game);
  }

  updateCreatures(game, dt);
  updateWar(game, dt);
  updateWorldForces(game, dt);
}

function canAfford(game, type) {
  const cost = COSTS[type];
  if (!cost) return true;
  return Object.entries(cost).every(([k, v]) => game.stock[k] >= v);
}

function tryBuild(game, x, y, type) {
  if (!findBuildSite(game.world, x, y)) {
    game.toast("Здесь нельзя строить");
    return;
  }
  if (!canAfford(game, type)) {
    game.toast("Не хватает ресурсов");
    return;
  }
  const cost = COSTS[type];
  for (const [k, v] of Object.entries(cost)) game.stock[k] -= v;
  placeBuilding(game, x, y, type, false);
  game.jobs.push({ type: "build", building: type, x, y, claimedBy: null });
  const names = {
    hut: "домик", farm: "огород", stockpile: "склад",
    wall: "стена", gate: "ворота", tower: "башня", barracks: "казарма",
  };
  game.toast(`Стройка: ${names[type] || type}`);
}

function placeBuilding(game, x, y, type, done) {
  const b = {
    id: game.world.nextBuildingId++,
    type,
    x,
    y,
    progress: done ? 1 : 0,
    done: !!done,
    growth: type === "farm" ? (done ? 0.4 : 0) : undefined,
    hp: buildingMaxHp(type),
    cool: 0,
  };
  game.world.buildings[y][x] = b;
  return b;
}

function markResource(game, x, y, tool) {
  const cell = game.world.resources[y][x];
  const need =
    tool === "chop" ? "tree" :
    tool === "gather" ? "bush" : "rock";
  if (!cell || cell.kind !== need || cell.amount <= 0) {
    game.toast(tool === "chop" ? "Тут нет дерева" : tool === "gather" ? "Тут нет ягод" : "Тут нет камня");
    return;
  }
  const jobType = tool === "chop" ? "chop" : tool === "gather" ? "gather" : "mine";
  if (game.jobs.some((j) => j.x === x && j.y === y && j.type === jobType)) {
    game.toast("Уже отмечено");
    return;
  }
  cell.reserved = false;
  game.jobs.push({ type: jobType, x, y, claimedBy: null });
  game.toast("Задание добавлено");
}

function selectAt(game, tx, ty) {
  let best = null;
  let bestD = 0.55;
  for (const s of game.settlers) {
    if (s.state === "die") continue;
    const d = Math.hypot(s.x - (tx + 0.5), s.y - (ty + 0.5));
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (best) {
    game.selected = best;
    game.selectedBuilding = null;
    game.selectedCreature = null;
    return;
  }

  let creature = null;
  let cDist = 0.7;
  for (const c of game.creatures) {
    if (c.dead) continue;
    const d = Math.hypot(c.x - (tx + 0.5), c.y - (ty + 0.5));
    if (d < cDist) {
      cDist = d;
      creature = c;
    }
  }
  if (creature) {
    game.selectedCreature = creature;
    game.selected = null;
    game.selectedBuilding = null;
    return;
  }

  const b = game.world.buildings[ty]?.[tx];
  if (b) {
    game.selectedBuilding = b;
    game.selected = null;
    game.selectedCreature = null;
    return;
  }
  const cell = game.world.resources[ty]?.[tx];
  game.selected = null;
  game.selectedCreature = null;
  // Only open inspect for real things — bare tiles stay quiet
  game.selectedBuilding = cell?.kind
    ? { type: "resource", kind: cell.kind, amount: cell.amount, x: tx, y: ty }
    : null;
}

function findSpawn(game) {
  const cx = (MAP_W / 2) | 0;
  const cy = (MAP_H / 2) | 0;
  for (let r = 0; r < 10; r++) {
    for (let i = 0; i < 20; i++) {
      const x = cx + (((Math.random() * 2 - 1) * (r + 1)) | 0);
      const y = cy + (((Math.random() * 2 - 1) * (r + 1)) | 0);
      if (!inBounds(x, y)) continue;
      if (game.world.terrain[y][x] === "water") continue;
      if (game.world.buildings[y][x]) continue;
      return { x, y };
    }
  }
  return { x: cx, y: cy + 2 };
}

export function getTimeLabel(phase) {
  let label = TIME_LABELS[0][1];
  for (const [p, name] of TIME_LABELS) {
    if (phase >= p) label = name;
  }
  return label;
}

export function canRecruit(game) {
  const homes = countBuildings(game.world, "hut", true);
  const alive = game.settlers.filter((s) => s.state !== "die").length;
  return game.stock.food >= RECRUIT_COST.food && alive < homes + 3;
}
