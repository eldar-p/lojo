/**
 * Autonomous colony planner — settlers decide what to build and gather.
 * No player micromanagement required.
 */

import { COSTS, MAP_H, MAP_W } from "./config.js";
import { buildingMaxHp, trainSoldier } from "./war.js";
import { countBuildings, findBuildSite, inBounds } from "./world.js";

export function updateColonyPlan(game, dt) {
  game._planCd = (game._planCd || 0) - dt;
  if (game._planCd > 0) return;
  game._planCd = 1.8 + Math.random() * 0.6;

  const alive = game.settlers.filter((s) => s.state !== "die");
  if (!alive.length) return;

  const homes = countBuildings(game.world, "hut", true);
  const farms = countBuildings(game.world, "farm", true);
  const stocks = countBuildings(game.world, "stockpile", true);
  const walls = countBuildings(game.world, "wall", true);
  const towers = countBuildings(game.world, "tower", true);
  const barracks = countBuildings(game.world, "barracks", true);
  const pending = game.jobs.filter((j) => j.type === "build").length;

  const cx = (MAP_W / 2) | 0;
  const cy = (MAP_H / 2) | 0;
  const threats = game.creatures.filter((c) => !c.dead && (c.faction === "horde" || c.kind === "soldier" || c.kind === "wolf" || c.kind === "bandit")).length;
  const atWar = game.war?.atWar || threats >= 3;

  // Cap simultaneous blueprints so they finish what they start
  if (pending >= 3) {
    ensureResourceJobs(game);
    return;
  }

  // 1) Housing
  if (alive.length >= homes + 1 && canAfford(game, "hut")) {
    if (queueNear(game, "hut", cx, cy, 2, 8)) return;
  }

  // 2) Food infrastructure
  if (game.stock.food < 14 && farms < Math.max(2, Math.ceil(alive.length / 2)) && canAfford(game, "farm")) {
    if (queueNear(game, "farm", cx, cy, 3, 10)) return;
  }

  // 3) Stockpile
  if (stocks < 1 && canAfford(game, "stockpile")) {
    if (queueNear(game, "stockpile", cx, cy, 0, 4)) return;
  }

  // 4) Defense when threatened / at war
  if (atWar || threats >= 2) {
    if (barracks < 1 && canAfford(game, "barracks")) {
      if (queueNear(game, "barracks", cx, cy, 3, 9)) return;
    }
    if (towers < 2 && canAfford(game, "tower")) {
      if (queueNear(game, "tower", cx, cy, 4, 10)) return;
    }
    if (walls < 12 && canAfford(game, "wall")) {
      if (queueWallRing(game, cx, cy, 5 + ((walls / 4) | 0))) return;
    }
    if (walls >= 4 && countBuildings(game.world, "gate", true) < 1 && canAfford(game, "gate")) {
      if (queueNear(game, "gate", cx + 5, cy, 0, 3) || queueNear(game, "gate", cx, cy + 5, 0, 3)) return;
    }
    // Auto-train soldiers
    const soldiers = alive.filter((s) => s.military).length;
    if (barracks >= 1 && soldiers < Math.min(alive.length - 1, 2 + (threats / 2) | 0)) {
      if (game.stock.food >= 12 && game.stock.wood >= 4) {
        trainSoldier(game);
      }
    }
  }

  // 5) Extra farms when rich in wood
  if (game.stock.wood > 20 && farms < alive.length && canAfford(game, "farm")) {
    if (queueNear(game, "farm", cx, cy, 4, 12)) return;
  }

  // 6) Grow population when safe & fed
  if (!atWar && game.stock.food >= 24 && alive.length < homes + 3 && alive.length < 12) {
    autoRecruit(game);
  }

  ensureResourceJobs(game);
}

function ensureResourceJobs(game) {
  const openChop = game.jobs.filter((j) => j.type === "chop" && !j.claimedBy).length;
  const openGather = game.jobs.filter((j) => j.type === "gather" && !j.claimedBy).length;
  const openMine = game.jobs.filter((j) => j.type === "mine" && !j.claimedBy).length;

  if (game.stock.wood < 16 && openChop < 2) markNearest(game, "tree", "chop");
  if (game.stock.food < 12 && openGather < 2) markNearest(game, "bush", "gather");
  if (game.stock.stone < 8 && openMine < 1) markNearest(game, "rock", "mine");
}

function markNearest(game, kind, jobType) {
  const cx = MAP_W / 2;
  const cy = MAP_H / 2;
  let best = null;
  let bestD = Infinity;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const cell = game.world.resources[y][x];
      if (!cell.kind || cell.kind !== kind || cell.amount <= 0 || cell.reserved) continue;
      if (game.jobs.some((j) => j.x === x && j.y === y && j.type === jobType)) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d < bestD && d < 22) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  if (!best) return;
  game.jobs.push({ type: jobType, x: best.x, y: best.y, claimedBy: null, auto: true });
}

function canAfford(game, type) {
  const cost = COSTS[type];
  if (!cost) return true;
  // Keep a small reserve so they don't starve the stock dry on walls
  const reserve = type === "wall" || type === "gate" ? { wood: 4, stone: 2, food: 0 } : { wood: 2, stone: 0, food: 6 };
  return Object.entries(cost).every(([k, v]) => (game.stock[k] || 0) >= v + (reserve[k] || 0));
}

function queueNear(game, type, cx, cy, minR, maxR) {
  for (let r = minR; r <= maxR; r++) {
    for (let tries = 0; tries < 12; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const x = Math.round(cx + Math.cos(ang) * r);
      const y = Math.round(cy + Math.sin(ang) * (r * 0.85));
      if (tryQueueBuild(game, type, x, y)) return true;
    }
  }
  // grid scan fallback
  for (let y = cy - maxR; y <= cy + maxR; y++) {
    for (let x = cx - maxR; x <= cx + maxR; x++) {
      if (tryQueueBuild(game, type, x, y)) return true;
    }
  }
  return false;
}

function queueWallRing(game, cx, cy, radius) {
  const spots = [];
  for (let i = 0; i < 24; i++) {
    const ang = (i / 24) * Math.PI * 2;
    spots.push({
      x: Math.round(cx + Math.cos(ang) * radius),
      y: Math.round(cy + Math.sin(ang) * radius),
    });
  }
  for (const s of spots) {
    if (tryQueueBuild(game, "wall", s.x, s.y)) return true;
  }
  return false;
}

function tryQueueBuild(game, type, x, y) {
  if (!inBounds(x, y)) return false;
  if (!findBuildSite(game.world, x, y)) return false;
  if (game.jobs.some((j) => j.type === "build" && j.x === x && j.y === y)) return false;
  if (!canAfford(game, type)) return false;

  const cost = COSTS[type];
  for (const [k, v] of Object.entries(cost)) game.stock[k] -= v;

  game.world.buildings[y][x] = {
    id: game.world.nextBuildingId++,
    type,
    x,
    y,
    progress: 0,
    done: false,
    growth: type === "farm" ? 0 : undefined,
    hp: buildingMaxHp(type),
    cool: 0,
  };
  game.jobs.push({ type: "build", building: type, x, y, claimedBy: null, auto: true });
  return true;
}

function autoRecruit(game) {
  const homes = countBuildings(game.world, "hut", true);
  const alive = game.settlers.filter((s) => s.state !== "die").length;
  if (alive >= homes + 3) return;
  if (game.stock.food < 20) return;
  // Use game.recruit if available
  if (typeof game._recruit === "function") {
    game._recruit();
  }
}
