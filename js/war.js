/**
 * Warfare strategies — classical + WWII-inspired, local JS only.
 */

import { MAP_H, MAP_W } from "./config.js";
import { createCreature } from "./creatures.js";
import { inBounds, walkable } from "./world.js";

export const STRATEGIES = {
  // Classic
  defend: {
    id: "defend",
    name: "Оборона",
    era: "classic",
    desc: "Держать стены и башни, не уходить далеко",
  },
  raid: {
    id: "raid",
    name: "Рейд",
    era: "classic",
    desc: "Удар по складам и фермам, избегать башен",
  },
  encircle: {
    id: "encircle",
    name: "Охват",
    era: "classic",
    desc: "Клещи: зайти с двух флангов",
  },
  siege: {
    id: "siege",
    name: "Осада",
    era: "classic",
    desc: "Ломать башни, стены и казармы",
  },
  breakthrough: {
    id: "breakthrough",
    name: "Прорыв",
    era: "classic",
    desc: "Сконцентрировать силу в слабой точке",
  },
  ambush: {
    id: "ambush",
    name: "Засада",
    era: "classic",
    desc: "Ждать у леса, затем внезапный удар",
  },
  // WWII
  blitzkrieg: {
    id: "blitzkrieg",
    name: "Блицкриг",
    era: "ww2",
    desc: "Молниеносный удар: скорость, узкий клин в центр",
  },
  kessel: {
    id: "kessel",
    name: "Котёл",
    era: "ww2",
    desc: "Двойной охват и сжатие кольца (как у Сталинграда)",
  },
  depth_defense: {
    id: "depth_defense",
    name: "Эшелон",
    era: "ww2",
    desc: "Оборона в глубину: несколько линий отхода",
  },
  barrage: {
    id: "barrage",
    name: "Артналёт",
    era: "ww2",
    desc: "Сначала «обстрел» укреплений, потом штурм",
  },
  partisans: {
    id: "partisans",
    name: "Партизаны",
    era: "ww2",
    desc: "Удар из леса и отход — партизанская война",
  },
  attrition: {
    id: "attrition",
    name: "Измор",
    era: "ww2",
    desc: "Война на истощение: бить людей, не здания",
  },
  elastic: {
    id: "elastic",
    name: "Эластичная",
    era: "ww2",
    desc: "Ложный отход, затем контрудар",
  },
  night_raid: {
    id: "night_raid",
    name: "Ночной удар",
    era: "ww2",
    desc: "Атака ночью на склады и спящих",
  },
  interdiction: {
    id: "interdiction",
    name: "Блокада",
    era: "ww2",
    desc: "Резать снабжение: жечь фермы и подходы",
  },
  shock: {
    id: "shock",
    name: "Штурмовики",
    era: "ww2",
    desc: "Шоковые группы: яростный штурм слабого места",
  },
};

export const WW2_STANCES = [
  "blitzkrieg", "kessel", "depth_defense", "barrage", "partisans",
  "attrition", "elastic", "night_raid", "interdiction", "shock",
];

export function createWarState() {
  return {
    atWar: false,
    colonyStance: "defend",
    enemyStance: "raid",
    enemyName: "Орда",
    colonyName: "Поселение",
    battleLog: [],
    pressure: 0,
    nextRaidIn: 45,
    wave: 0,
    barrageTimer: 0,
    elasticPhase: "hold", // hold | fall | strike
    kesselTight: 0,
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
  const farms = countBuildings(game, "farm");
  const ratio = enemies / Math.max(1, defenders + towers * 0.8);
  const night = game.isNight;
  const roll = Math.random();

  // Prefer WWII doctrines mixed with classic
  if (night && roll < 0.45) return "night_raid";
  if (towers + walls > 10 && ratio < 1.3) return roll < 0.5 ? "barrage" : "siege";
  if (ratio >= 2.0) return roll < 0.55 ? "blitzkrieg" : "shock";
  if (ratio >= 1.5) return roll < 0.4 ? "kessel" : roll < 0.7 ? "encircle" : "breakthrough";
  if (farms >= 3 && roll < 0.35) return "interdiction";
  if (defenders > enemies) {
    if (roll < 0.3) return "partisans";
    if (roll < 0.55) return "ambush";
    if (roll < 0.75) return "elastic";
    return "attrition";
  }
  if (walls > 6 && ratio < 1) return "depth_defense";
  return roll < 0.5 ? "raid" : "attrition";
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

  // Global stance timers
  if (stance === "barrage") {
    game.war.barrageTimer = (game.war.barrageTimer || 0) + dt;
    if (game.war.barrageTimer < 6) {
      runBarrageSoftening(game, dt, objectives);
    }
  } else {
    game.war.barrageTimer = 0;
  }

  if (stance === "elastic") {
    updateElasticPhase(game, enemies, objectives);
  }

  if (stance === "kessel") {
    game.war.kesselTight = Math.min(8, (game.war.kesselTight || 0) + dt * 0.15);
  } else {
    game.war.kesselTight = 0;
  }

  assignStrategyOrders(game, enemies, stance, objectives);

  for (const e of enemies) {
    // WWII speed modifiers
    if (stance === "blitzkrieg" || stance === "shock") e._spdMul = 1.35;
    else if (stance === "partisans") e._spdMul = 1.15;
    else if (stance === "attrition") e._spdMul = 0.85;
    else e._spdMul = 1;

    executeSoldier(e, game, dt);
  }

  game.war.pressure = Math.min(1, enemies.length / 10);
}

function runBarrageSoftening(game, dt, obj) {
  // "Artillery": chip fortifications before infantry closes
  const targets = [...obj.towers, ...obj.walls, ...obj.gates, ...obj.barracks];
  if (!targets.length) return;
  if (Math.random() > dt * 4) return;
  const b = targets[(Math.random() * targets.length) | 0];
  damageBuilding(game, b, 8 + Math.random() * 10);
  game.fx.push({
    kind: "bomb",
    x: b.x + 0.5,
    y: b.y + 0.5,
    life: 0.35,
    max: 0.35,
    seed: Math.random() * 100,
  });
}

function updateElasticPhase(game, enemies, obj) {
  const center = colonyCenter(obj);
  let near = 0;
  for (const e of enemies) {
    if (Math.hypot(e.x - center.x, e.y - center.y) < 8) near++;
  }
  const phase = game.war.elasticPhase || "hold";
  if (phase === "hold" && near >= Math.max(2, enemies.length * 0.4)) {
    game.war.elasticPhase = "fall";
    pushLog(game, "Эластичная оборона: отход");
  } else if (phase === "fall") {
    // After falling back, strike
    const far = enemies.filter((e) => Math.hypot(e.x - center.x, e.y - center.y) > 10).length;
    if (far >= enemies.length * 0.5) {
      game.war.elasticPhase = "strike";
      pushLog(game, "Эластичная оборона: контрудар!");
    }
  } else if (phase === "strike") {
    // Reset after pressure drops
    if (near < 1) game.war.elasticPhase = "hold";
  }
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
  const third = Math.ceil(enemies.length / 3);
  const tight = game.war.kesselTight || 0;

  enemies.forEach((e, i) => {
    if (e.order && e.order.ttl > 0) return;
    e.avoidTowers = false;
    e.hitAndRun = false;

    if (stance === "defend" || stance === "depth_defense") {
      // Depth: hold staggered rings around edge of colony pressure
      const ring = stance === "depth_defense" ? 10 - (i % 3) * 2.5 : 8;
      const ang = (i / Math.max(1, enemies.length)) * Math.PI * 2;
      e.order = {
        type: "hold_line",
        x: center.x + Math.cos(ang) * ring,
        y: center.y + Math.sin(ang) * ring,
        ttl: 3.5,
      };
    } else if (stance === "raid") {
      const target = obj.stock[0] || obj.farms[0] || weakSettler(obj) || center;
      e.order = orderToward(target, target?.type ? "raid_building" : "attack_unit", 4);
      e.avoidTowers = true;
    } else if (stance === "encircle") {
      const flank = i < half ? -1 : 1;
      const tx = center.x + flank * (6 + (i % 3));
      const ty = center.y + (i % 2 === 0 ? -3 : 3);
      e.order = { type: "flank", x: tx, y: ty, then: "attack_unit", ttl: 5 };
      e.flankPhase = "approach";
    } else if (stance === "kessel") {
      // Double pincer that tightens over time
      const wing = i < half ? -1 : 1;
      const radius = Math.max(2.5, 9 - tight);
      const slot = (i % half) / Math.max(1, half);
      const ang = wing < 0
        ? -Math.PI * 0.2 - slot * Math.PI * 0.8
        : Math.PI * 0.2 + slot * Math.PI * 0.8;
      e.order = {
        type: "kessel",
        x: center.x + Math.cos(ang) * radius * wing,
        y: center.y + Math.sin(ang) * radius,
        ttl: 2.5,
      };
      e.flankPhase = radius < 4 ? "squeeze" : "approach";
    } else if (stance === "siege") {
      const target = obj.towers[0] || obj.barracks[0] || obj.walls[0] || obj.gates[0] || center;
      e.order = orderToward(target, "siege_building", 5);
    } else if (stance === "breakthrough" || stance === "shock") {
      const weak = weakestPoint(obj, center);
      e.order = orderToward(weak, stance === "shock" ? "shock_assault" : "breakthrough", 4);
    } else if (stance === "blitzkrieg") {
      // Narrow spearhead: most go to center/stock; few screen flanks
      if (i < third) {
        const flank = i % 2 === 0 ? -1 : 1;
        e.order = {
          type: "flank",
          x: center.x + flank * 5,
          y: center.y,
          ttl: 3,
        };
        e.flankPhase = "approach";
      } else {
        const tip = obj.stock[0] || obj.barracks[0] || center;
        e.order = orderToward(tip, "blitz", 3.5);
      }
    } else if (stance === "barrage") {
      if ((game.war.barrageTimer || 0) < 6) {
        // Wait outside while "shells" fall
        const ang = (i / enemies.length) * Math.PI * 2;
        e.order = {
          type: "hold_line",
          x: center.x + Math.cos(ang) * 11,
          y: center.y + Math.sin(ang) * 11,
          ttl: 1.2,
        };
      } else {
        const weak = weakestPoint(obj, center);
        e.order = orderToward(weak, "shock_assault", 4);
      }
    } else if (stance === "partisans") {
      if (e.ambushReady && e.partisanStrike) {
        e.order = orderToward(obj.farms[i % Math.max(1, obj.farms.length)] || weakSettler(obj) || center, "raid_building", 2.5);
        e.hitAndRun = true;
      } else {
        const forest = nearestForest(game, e.x, e.y) || { x: e.x, y: e.y };
        e.order = { type: "ambush_wait", x: forest.x, y: forest.y, ttl: 4 };
        e.partisanStrike = false;
      }
    } else if (stance === "attrition") {
      const target = weakSettler(obj) || obj.settlers[i % Math.max(1, obj.settlers.length)] || center;
      e.order = orderToward(target, "attack_unit", 3.5);
    } else if (stance === "elastic") {
      const phase = game.war.elasticPhase || "hold";
      if (phase === "fall") {
        const edge = { x: e.x < center.x ? 4 : MAP_W - 5, y: e.y < center.y ? 4 : MAP_H - 5 };
        e.order = { type: "fall_back", x: edge.x, y: edge.y, ttl: 2.5 };
      } else if (phase === "strike") {
        e.order = orderToward(weakSettler(obj) || center, "shock_assault", 3);
      } else {
        const ang = (i / enemies.length) * Math.PI * 2;
        e.order = {
          type: "hold_line",
          x: center.x + Math.cos(ang) * 7,
          y: center.y + Math.sin(ang) * 7,
          ttl: 2,
        };
      }
    } else if (stance === "night_raid") {
      const target = game.isNight
        ? (obj.stock[0] || sleepingSettler(obj) || weakSettler(obj) || center)
        : (nearestForest(game, e.x, e.y) || { x: e.x, y: e.y });
      e.order = game.isNight
        ? orderToward(target, target?.type ? "raid_building" : "attack_unit", 3)
        : { type: "ambush_wait", x: target.x, y: target.y, ttl: 3 };
      if (game.isNight) e._spdMul = 1.25;
    } else if (stance === "interdiction") {
      // Burn farms / linger on approaches
      const farm = obj.farms[i % Math.max(1, obj.farms.length)];
      if (farm) {
        e.order = orderToward(farm, "scorch_farm", 4);
      } else {
        e.order = orderToward(obj.stock[0] || center, "raid_building", 4);
      }
      e.avoidTowers = true;
    } else if (stance === "ambush") {
      if (e.ambushReady) {
        e.order = orderToward(weakSettler(obj) || center, "attack_unit", 3);
      } else {
        const forest = nearestForest(game, e.x, e.y) || { x: e.x, y: e.y };
        e.order = { type: "ambush_wait", x: forest.x, y: forest.y, ttl: 6 };
      }
    }
  });

  // Ambush / partisan triggers
  if (stance === "ambush" || stance === "partisans") {
    for (const e of enemies) {
      if (e.order?.type !== "ambush_wait") continue;
      for (const s of obj.settlers) {
        const range = stance === "partisans" ? 6.5 : 5;
        if (Math.hypot(s.x - e.x, s.y - e.y) < range) {
          e.ambushReady = true;
          e.partisanStrike = stance === "partisans";
          e.order = orderToward(s, "attack_unit", 3);
          pushLog(game, stance === "partisans" ? "Партизанский удар!" : "Засада!");
          break;
        }
      }
    }
  }
}

function sleepingSettler(obj) {
  return obj.settlers.find((s) => s.state === "sleep") || null;
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
  const spd = e.speed * (e._spdMul || 1);

  // Combat vs settlers
  const foe = nearestFoe(game, e);
  const aggressive = ["attack_unit", "breakthrough", "flank", "blitz", "shock_assault", "kessel"].includes(order.type);
  if (foe && Math.hypot(foe.x - e.x, foe.y - e.y) < 1.1) {
    const dmgMul = order.type === "shock_assault" ? 1.35 : order.type === "blitz" ? 1.2 : 1;
    melee(e, foe, game, dmgMul);
    // Partisan hit-and-run: after a hit, fall back to forest
    if (e.hitAndRun) {
      const forest = nearestForest(game, e.x, e.y);
      if (forest) {
        e.order = { type: "fall_back", x: forest.x, y: forest.y, ttl: 3 };
        e.ambushReady = false;
        e.partisanStrike = false;
        e.hitAndRun = false;
      }
    }
    return;
  }

  let tx = order.x;
  let ty = order.y;

  if ((order.type === "flank" || order.type === "kessel") && e.flankPhase === "approach") {
    if (Math.hypot(e.x - tx, e.y - ty) < 1.5) {
      e.flankPhase = order.type === "kessel" ? "squeeze" : "strike";
      const c = colonyCenter(gatherObjectives(game));
      tx = c.x;
      ty = c.y;
      order.x = tx;
      order.y = ty;
      if (order.type !== "kessel") order.type = "attack_unit";
    }
  }

  if (order.type === "kessel" && e.flankPhase === "squeeze") {
    const c = colonyCenter(gatherObjectives(game));
    tx = c.x;
    ty = c.y;
  }

  if (order.type === "ambush_wait" || order.type === "hold_line") {
    if (Math.hypot(e.x - tx, e.y - ty) > 1.2) moveSoldier(e, game, tx, ty, dt, spd * 0.75);
    // Hold_line still fights if enemy walks into them
    if (order.type === "hold_line" && foe && Math.hypot(foe.x - e.x, foe.y - e.y) < 2.2) {
      moveSoldier(e, game, foe.x, foe.y, dt, spd);
    }
    return;
  }

  if (order.type === "fall_back") {
    moveSoldier(e, game, tx, ty, dt, spd * 1.2);
    return;
  }

  // Building assault / scorched earth
  const buildOrders = ["siege_building", "raid_building", "breakthrough", "shock_assault", "blitz", "scorch_farm"];
  if (buildOrders.includes(order.type) && order.target) {
    const b = order.target;
    const d = Math.hypot(b.x + 0.5 - e.x, b.y + 0.5 - e.y);
    if (d < 1.4) {
      let mul = 1;
      if (order.type === "siege_building") mul = 1.4;
      if (order.type === "shock_assault") mul = 1.55;
      if (order.type === "blitz") mul = 1.3;
      if (order.type === "scorch_farm") mul = 1.8;
      damageBuilding(game, b, 12 * dt * mul);
      // Scorch: also ignite tile
      if (order.type === "scorch_farm" && game.world.fire?.[b.y]) {
        game.world.fire[b.y][b.x] = Math.max(game.world.fire[b.y][b.x], 0.85);
      }
      e.cooldown = 0.2;
      return;
    }
  }

  if (foe && aggressive) {
    const d = Math.hypot(foe.x - e.x, foe.y - e.y);
    const chaseR = order.type === "blitz" || order.type === "shock_assault" ? 9 : 7;
    if (d < chaseR) {
      tx = foe.x;
      ty = foe.y;
    }
  }

  if (e.avoidTowers) {
    const tower = nearestTower(game, e.x, e.y, 5);
    if (tower) {
      const ang = Math.atan2(e.y - (tower.y + 0.5), e.x - (tower.x + 0.5));
      tx = e.x + Math.cos(ang) * 3 + (tx - e.x) * 0.3;
      ty = e.y + Math.sin(ang) * 3 + (ty - e.y) * 0.3;
    }
  }

  moveSoldier(e, game, tx, ty, dt, spd);
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

function melee(a, b, game, dmgMul = 1) {
  if (a.cooldown > 0) return;
  a.cooldown = 0.85;
  const flankBonus = alliesBeside(game, a, b) >= 2 ? 1.35 : 1;
  const dmg = a.damage * flankBonus * dmgMul;
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
