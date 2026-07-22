/**
 * Warfare & real-world inspired strategies — local JS only.
 * Strategies: defend, raid, encircle, siege, breakthrough, ambush.
 */

import { MAP_H, MAP_W } from "./config.js";
import { createCreature } from "./creatures.js";
import { inBounds, walkable } from "./world.js";

export const STRATEGIES = {
  defend: {
    id: "defend",
    name: "Оборона",
    desc: "Держать стены и башни, не уходить далеко",
  },
  raid: {
    id: "raid",
    name: "Рейд",
    desc: "Удар по складам и фермам, избегать башен",
  },
  encircle: {
    id: "encircle",
    name: "Охват",
    desc: "Клещи: зайти с двух флангов",
  },
  siege: {
    id: "siege",
    name: "Осада",
    desc: "Ломать башни, стены и казармы",
  },
  breakthrough: {
    id: "breakthrough",
    name: "Прорыв",
    desc: "Сконцентрировать силу в слабой точке",
  },
  ambush: {
    id: "ambush",
    name: "Засада",
    desc: "Ждать у леса, затем внезапный удар",
  },
};

export function createWarState() {
  return {
    atWar: false,
    colonyStance: "defend",
    enemyStance: "raid",
    enemyName: "Орда",
    colonyName: "Поселение",
    battleLog: [],
    pressure: 0, // 0..1 how active war is
    nextRaidIn: 45,
    wave: 0,
  };
}

export function declareWar(game) {
  game.war.atWar = true;
  game.war.pressure = 0.4;
  game.war.nextRaidIn = 8;
  game.war.enemyStance = pickEnemyStrategy(game);
  pushLog(game, `Война с ${game.war.enemyName}! Стратегия врага: ${STRATEGIES[game.war.enemyStance].name}`);
  game.toast(`Объявлена война — ${STRATEGIES[game.war.enemyStance].name}`);
}

export function makePeace(game) {
  game.war.atWar = false;
  game.war.pressure = 0;
  // Remove enemy soldiers
  for (const c of game.creatures) {
    if (c.kind === "soldier" && c.faction === "horde") {
      c.dead = true;
      c.looted = true;
    }
  }
  pushLog(game, "Заключён мир");
  game.toast("Мир заключён");
}

export function setColonyStance(game, stance) {
  if (!STRATEGIES[stance]) return;
  game.war.colonyStance = stance;
  game.toast(`Доктрина: ${STRATEGIES[stance].name}`);
  pushLog(game, `Поселение приняло доктрину «${STRATEGIES[stance].name}»`);
}

export function spawnEnemyArmy(game, cx, cy, count = 5) {
  const spots = ringSpots(game, cx, cy, count + 4);
  let n = 0;
  for (const sp of spots) {
    if (n >= count) break;
    const s = createCreature("soldier", sp.x, sp.y, game.nextCreatureId++);
    s.faction = "horde";
    s.color = "#6b2d3c";
    s.strategyRole = n % 3 === 0 ? "flanker" : "line";
    game.creatures.push(s);
    n++;
  }
  game.war.atWar = true;
  game.war.wave += 1;
  game.war.enemyStance = pickEnemyStrategy(game);
  pushLog(game, `Волна ${game.war.wave}: ${n} воинов (${STRATEGIES[game.war.enemyStance].name})`);
  game.toast(`Враг: волна ${game.war.wave}`);
}

function ringSpots(game, cx, cy, need) {
  const out = [];
  for (let r = 0; r < 10 && out.length < need; r++) {
    for (let i = 0; i < 16 && out.length < need; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(ang) * (2 + r));
      const y = Math.round(cy + Math.sin(ang) * (2 + r));
      if (!inBounds(x, y)) continue;
      const t = game.world.terrain[y][x];
      if (t === "water" || t === "lava" || t === "mountain") continue;
      if (game.world.buildings[y][x]?.type === "wall") continue;
      out.push({ x, y });
    }
  }
  return out;
}

export function pickEnemyStrategy(game) {
  const enemies = game.creatures.filter((c) => !c.dead && c.kind === "soldier" && c.faction === "horde").length;
  const defenders = game.settlers.filter((s) => s.state !== "die" && (s.military || s.brain?.role === "guard")).length;
  const towers = countBuildings(game, "tower");
  const walls = countBuildings(game, "wall");
  const ratio = enemies / Math.max(1, defenders + towers);

  if (towers + walls > 8 && ratio < 1.2) return "siege";
  if (ratio >= 1.8) return "breakthrough";
  if (ratio >= 1.2) return Math.random() < 0.5 ? "encircle" : "raid";
  if (defenders > enemies) return Math.random() < 0.5 ? "ambush" : "raid";
  return "raid";
}

function countBuildings(game, type) {
  let n = 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const b = game.world.buildings[y][x];
      if (b?.done && b.type === type) n++;
    }
  }
  return n;
}

export function updateWar(game, dt) {
  if (!game.war) return;

  // Towers shoot
  updateTowers(game, dt);

  // Auto waves while at war
  if (game.war.atWar) {
    game.war.nextRaidIn -= dt;
    if (game.war.nextRaidIn <= 0) {
      game.war.nextRaidIn = 50 + Math.random() * 25;
      game.war.enemyStance = pickEnemyStrategy(game);
      const edge = randomMapEdge();
      spawnEnemyArmy(game, edge.x, edge.y, 3 + Math.min(6, game.war.wave + 1));
    }
  }

  // Drive enemy soldiers with strategy
  const enemies = game.creatures.filter((c) => !c.dead && c.kind === "soldier" && c.faction === "horde");
  if (!enemies.length) return;

  const stance = game.war.enemyStance || "raid";
  const objectives = gatherObjectives(game);
  assignStrategyOrders(game, enemies, stance, objectives);

  for (const e of enemies) {
    executeSoldier(e, game, dt);
  }

  // Colony military follow stance lightly via brain pressure flag
  game.war.pressure = Math.min(1, enemies.length / 10);
}

function randomMapEdge() {
  const side = (Math.random() * 4) | 0;
  if (side === 0) return { x: 2 + ((Math.random() * 8) | 0), y: 2 + ((Math.random() * (MAP_H - 4)) | 0) };
  if (side === 1) return { x: MAP_W - 3 - ((Math.random() * 8) | 0), y: 2 + ((Math.random() * (MAP_H - 4)) | 0) };
  if (side === 2) return { x: 2 + ((Math.random() * (MAP_W - 4)) | 0), y: 2 + ((Math.random() * 8) | 0) };
  return { x: 2 + ((Math.random() * (MAP_W - 4)) | 0), y: MAP_H - 3 - ((Math.random() * 8) | 0) };
}

function gatherObjectives(game) {
  const stock = [];
  const farms = [];
  const towers = [];
  const walls = [];
  const barracks = [];
  const gates = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const b = game.world.buildings[y][x];
      if (!b?.done) continue;
      if (b.type === "stockpile") stock.push(b);
      else if (b.type === "farm") farms.push(b);
      else if (b.type === "tower") towers.push(b);
      else if (b.type === "wall") walls.push(b);
      else if (b.type === "barracks") barracks.push(b);
      else if (b.type === "gate") gates.push(b);
    }
  }
  const settlers = game.settlers.filter((s) => s.state !== "die" && s.faction !== "horde");
  return { stock, farms, towers, walls, barracks, gates, settlers };
}

function assignStrategyOrders(game, enemies, stance, obj) {
  const center = colonyCenter(obj);
  const half = Math.ceil(enemies.length / 2);

  enemies.forEach((e, i) => {
    if (e.order && e.order.ttl > 0) return;

    if (stance === "defend") {
      // Hold near their spawn / map edge — rare for invaders; treat as cautious raid
      e.order = orderToward(weakSettler(obj) || center, "attack_unit", 3);
    } else if (stance === "raid") {
      const target = obj.stock[0] || obj.farms[0] || weakSettler(obj) || center;
      e.order = orderToward(target, target?.type ? "raid_building" : "attack_unit", 4);
      // Avoid towers: if near tower, path offset
      e.avoidTowers = true;
    } else if (stance === "encircle") {
      const flank = i < half ? -1 : 1;
      const tx = center.x + flank * (6 + (i % 3));
      const ty = center.y + (i % 2 === 0 ? -3 : 3);
      e.order = { type: "flank", x: tx, y: ty, then: "attack_unit", ttl: 5 };
      e.flankPhase = "approach";
    } else if (stance === "siege") {
      const target = obj.towers[0] || obj.barracks[0] || obj.walls[0] || obj.gates[0] || center;
      e.order = orderToward(target, "siege_building", 5);
    } else if (stance === "breakthrough") {
      const weak = weakestPoint(obj, center);
      e.order = orderToward(weak, "breakthrough", 4);
    } else if (stance === "ambush") {
      if (e.ambushReady) {
        e.order = orderToward(weakSettler(obj) || center, "attack_unit", 3);
      } else {
        const forest = nearestForest(game, e.x, e.y) || { x: e.x, y: e.y };
        e.order = { type: "ambush_wait", x: forest.x, y: forest.y, ttl: 6 };
      }
    }
  });

  // Ambush trigger: if any settler near waiting ambushers
  if (stance === "ambush") {
    for (const e of enemies) {
      if (e.order?.type !== "ambush_wait") continue;
      for (const s of obj.settlers) {
        if (Math.hypot(s.x - e.x, s.y - e.y) < 5) {
          e.ambushReady = true;
          e.order = orderToward(s, "attack_unit", 3);
          pushLog(game, "Засада!");
          break;
        }
      }
    }
  }
}

function orderToward(target, type, ttl) {
  if (!target) return { type: "hold", x: 0, y: 0, ttl: 1 };
  const x = target.x ?? target.tx ?? 0;
  const y = target.y ?? target.ty ?? 0;
  return { type, x, y, target, ttl };
}

function weakSettler(obj) {
  let best = null;
  let score = Infinity;
  for (const s of obj.settlers) {
    const sc = s.energy + (s.military ? 40 : 0) + (s.brain?.role === "guard" ? 30 : 0);
    if (sc < score) {
      score = sc;
      best = s;
    }
  }
  return best;
}

function colonyCenter(obj) {
  if (obj.stock[0]) return { x: obj.stock[0].x, y: obj.stock[0].y };
  if (obj.settlers.length) {
    let x = 0;
    let y = 0;
    for (const s of obj.settlers) {
      x += s.x;
      y += s.y;
    }
    return { x: x / obj.settlers.length, y: y / obj.settlers.length };
  }
  return { x: MAP_W / 2, y: MAP_H / 2 };
}

function weakestPoint(obj, center) {
  // Prefer gates, then wall segments farthest from towers
  if (obj.gates.length) return obj.gates[0];
  let best = null;
  let bestScore = -Infinity;
  for (const w of obj.walls) {
    let towerDist = 99;
    for (const t of obj.towers) {
      towerDist = Math.min(towerDist, Math.hypot(t.x - w.x, t.y - w.y));
    }
    const score = towerDist - Math.hypot(w.x - center.x, w.y - center.y) * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = w;
    }
  }
  return best || center;
}

function nearestForest(game, x, y) {
  let best = null;
  let bestD = 12;
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (game.world.resources[ty][tx].kind !== "tree") continue;
      const d = Math.hypot(tx - x, ty - y);
      if (d < bestD) {
        bestD = d;
        best = { x: tx, y: ty };
      }
    }
  }
  return best;
}

function executeSoldier(e, game, dt) {
  const order = e.order;
  if (!order) return;
  order.ttl -= dt;

  // Combat vs settlers / colony soldiers
  const foe = nearestFoe(game, e);
  if (foe && Math.hypot(foe.x - e.x, foe.y - e.y) < 1.1) {
    melee(e, foe, game);
    return;
  }

  let tx = order.x;
  let ty = order.y;

  if (order.type === "flank" && e.flankPhase === "approach") {
    if (Math.hypot(e.x - tx, e.y - ty) < 1.5) {
      e.flankPhase = "strike";
      const c = colonyCenter(gatherObjectives(game));
      tx = c.x;
      ty = c.y;
      order.x = tx;
      order.y = ty;
      order.type = "attack_unit";
    }
  }

  if (order.type === "ambush_wait") {
    // Hold / micro move
    if (Math.hypot(e.x - tx, e.y - ty) > 1.2) moveSoldier(e, game, tx, ty, dt, e.speed * 0.7);
    return;
  }

  // Siege: attack building when close
  if ((order.type === "siege_building" || order.type === "raid_building" || order.type === "breakthrough") && order.target) {
    const b = order.target;
    const d = Math.hypot(b.x + 0.5 - e.x, b.y + 0.5 - e.y);
    if (d < 1.4) {
      damageBuilding(game, b, 12 * dt * (order.type === "siege_building" ? 1.4 : 1));
      e.cooldown = 0.2;
      return;
    }
  }

  // Chase nearby foe during attack orders
  if (foe && ["attack_unit", "breakthrough", "flank"].includes(order.type)) {
    const d = Math.hypot(foe.x - e.x, foe.y - e.y);
    if (d < 7) {
      tx = foe.x;
      ty = foe.y;
    }
  }

  // Avoid towers when raiding
  if (e.avoidTowers) {
    const tower = nearestTower(game, e.x, e.y, 5);
    if (tower) {
      const ang = Math.atan2(e.y - (tower.y + 0.5), e.x - (tower.x + 0.5));
      tx = e.x + Math.cos(ang) * 3 + (tx - e.x) * 0.3;
      ty = e.y + Math.sin(ang) * 3 + (ty - e.y) * 0.3;
    }
  }

  moveSoldier(e, game, tx, ty, dt, e.speed);
}

function nearestFoe(game, e) {
  let best = null;
  let bestD = 8;
  for (const s of game.settlers) {
    if (s.state === "die") continue;
    const d = Math.hypot(s.x - e.x, s.y - e.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function nearestTower(game, x, y, maxD) {
  let best = null;
  let bestD = maxD;
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const b = game.world.buildings[ty][tx];
      if (!b?.done || b.type !== "tower") continue;
      const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
  }
  return best;
}

function melee(a, b, game) {
  if (a.cooldown > 0) return;
  a.cooldown = 0.85;
  const flankBonus = alliesBeside(game, a, b) >= 2 ? 1.35 : 1;
  const dmg = a.damage * flankBonus;
  if (b.kind) {
    b.hp -= dmg;
    if (b.hp <= 0) b.dead = true;
  } else {
    b.energy = Math.max(0, b.energy - dmg);
    b.thought = "в бою с ордой";
    b.path = [];
    if (b.brain) b.brain.commit = 0;
    if (b.energy < 8) {
      b.state = "die";
      b.thought = "пал в бою";
      pushLog(game, `${b.name} пал в бою`);
    }
  }
  game.fx.push({ kind: "spark", x: b.x, y: b.y, life: 0.25, max: 0.25, seed: Math.random() * 100 });
}

function alliesBeside(game, self, target) {
  let n = 0;
  for (const c of game.creatures) {
    if (c.dead || c === self || c.faction !== self.faction) continue;
    if (Math.hypot(c.x - target.x, c.y - target.y) < 2.2) n++;
  }
  return n;
}

function damageBuilding(game, b, amount) {
  b.hp = (b.hp ?? buildingMaxHp(b.type)) - amount;
  if (b.hp <= 0) {
    game.world.buildings[b.y][b.x] = null;
    pushLog(game, `Разрушено: ${buildingName(b.type)}`);
    game.toast(`Враг разрушил ${buildingName(b.type)}`);
  }
}

export function buildingMaxHp(type) {
  return {
    wall: 80,
    gate: 100,
    tower: 120,
    barracks: 140,
    hut: 60,
    farm: 40,
    stockpile: 90,
  }[type] || 50;
}

function buildingName(type) {
  return {
    wall: "стену",
    gate: "ворота",
    tower: "башню",
    barracks: "казарму",
    hut: "домик",
    farm: "ферму",
    stockpile: "склад",
  }[type] || "здание";
}

function moveSoldier(e, game, tx, ty, dt, speed) {
  e.cooldown = Math.max(0, e.cooldown - dt);
  const dx = tx - e.x;
  const dy = ty - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = e.x + (dx / dist) * speed * dt;
  const ny = e.y + (dy / dist) * speed * dt;
  const tileX = Math.floor(nx);
  const tileY = Math.floor(ny);
  if (!inBounds(tileX, tileY)) return;
  const b = game.world.buildings[tileY][tileX];
  if (b?.done && b.type === "wall") {
    // Attack wall instead
    damageBuilding(game, b, 18 * dt);
    return;
  }
  const t = game.world.terrain[tileY][tileX];
  if (t === "water" || t === "lava" || t === "mountain") return;
  if (b?.done && b.type !== "gate" && b.type !== "farm" && !walkable(game.world, tileX, tileY)) return;
  e.x = nx;
  e.y = ny;
}

function updateTowers(game, dt) {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const b = game.world.buildings[y][x];
      if (!b?.done || b.type !== "tower") continue;
      b.cool = (b.cool || 0) - dt;
      if (b.cool > 0) continue;
      let target = null;
      let bestD = 6.5;
      for (const c of game.creatures) {
        if (c.dead || c.faction !== "horde") continue;
        const d = Math.hypot(c.x - (x + 0.5), c.y - (y + 0.5));
        if (d < bestD) {
          bestD = d;
          target = c;
        }
      }
      if (target) {
        b.cool = 1.1;
        target.hp -= 16;
        game.fx.push({ kind: "spark", x: target.x, y: target.y, life: 0.3, max: 0.3, seed: Math.random() * 50 });
        if (target.hp <= 0) {
          target.dead = true;
          pushLog(game, "Башня сразила врага");
        }
      }
    }
  }
}

function pushLog(game, msg) {
  game.war.battleLog.push({ t: game.day + game.dayPhase, msg });
  if (game.war.battleLog.length > 40) game.war.battleLog.shift();
}

export function trainSoldier(game) {
  const barracks = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const b = game.world.buildings[y][x];
      if (b?.done && b.type === "barracks") barracks.push(b);
    }
  }
  if (!barracks.length) {
    game.toast("Нужна казарма");
    return false;
  }
  if (game.stock.food < 12 || game.stock.wood < 4) {
    game.toast("Нужно 12 еды и 4 дерева");
    return false;
  }
  const civilian = game.settlers.find((s) => s.state !== "die" && !s.military);
  if (!civilian) {
    game.toast("Нет свободных жителей");
    return false;
  }
  game.stock.food -= 12;
  game.stock.wood -= 4;
  civilian.military = true;
  civilian.brain.role = "guard";
  civilian.brain.roleName = "Солдат";
  civilian.brain.traits.bravery = Math.min(1, civilian.brain.traits.bravery + 0.25);
  civilian.thought = "прошёл муштру";
  game.toast(`${civilian.name} стал солдатом`);
  pushLog(game, `${civilian.name} записан в войско`);
  return true;
}

export const MILITARY_BUILDINGS = ["wall", "gate", "tower", "barracks"];
