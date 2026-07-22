import {
  alliesNearby,
  decideGoal,
  fleePoint,
  nearestThreat,
  rollPersonality,
  roleLabel,
  senseWorld,
} from "./brain.js";
import { BUILD_TIME, YIELD } from "./config.js";
import {
  findPath,
  inBounds,
  nearestBuilding,
  nearestResource,
  walkable,
} from "./world.js";

const NAMES = [
  "Лёня", "Мира", "Олег", "Яна", "Тимур", "Соня", "Игорь", "Ника",
  "Рома", "Ася", "Глеб", "Поля", "Марк", "Лиза", "Федя", "Кира",
  "Саша", "Тоня", "Ваня", "Даша", "Женя", "Лера", "Костя", "Уля",
];

let nameIdx = 0;

export function createSettler(x, y, id) {
  const name = NAMES[nameIdx % NAMES.length];
  nameIdx++;
  const personality = rollPersonality(id);
  return {
    id,
    name,
    x: x + 0.5,
    y: y + 0.5,
    hue: (id * 47) % 360,
    hunger: 75 + Math.random() * 20,
    energy: 70 + Math.random() * 25,
    job: null,
    path: [],
    workTimer: 0,
    attackTimer: 0,
    state: "idle",
    bob: Math.random() * Math.PI * 2,
    thought: "осматривается",
    brain: {
      ...personality,
      goal: null,
      commit: 0,
      thinkCd: Math.random() * 0.4,
      targetId: null,
      roleName: roleLabel(personality.role),
    },
  };
}

export function bindSettler(s, game) {
  s._game = game;
}

/** Shared sense rebuilt once per tick for all settlers */
export function beginSettlerThink(game) {
  game._sense = senseWorld(game);
}

export function updateSettler(s, dt, game) {
  s.bob += dt * 6;
  s.hunger = Math.max(0, s.hunger - dt * 1.35);
  s.energy = Math.max(0, s.energy - dt * (game.isNight ? 2.2 : 0.55));
  s.attackTimer = Math.max(0, s.attackTimer - dt);
  s.brain.commit = Math.max(0, s.brain.commit - dt);
  s.brain.thinkCd -= dt;

  if (s.hunger <= 0) {
    s.state = "die";
    s.thought = "не выдержал голода";
    releaseJob(s, game);
    s.path = [];
    return;
  }
  if (s.state === "die") return;

  const sense = game._sense || senseWorld(game);

  // Interrupt dangerous situations even mid-walk (not mid-eat finishing bite)
  if (s.state !== "eat" && s.state !== "sleep") {
    const hereFire = tileFire(game, s.x, s.y);
    if (hereFire > 0.35) {
      enactFleeFire(s, game);
      // fall through to walk
    }
  }

  if (s.state === "walk") {
    // Replan if threat closes in while walking to non-urgent job
    if (s.brain.thinkCd <= 0 && s.brain.goal && !["flee", "flee_fire", "fight", "eat", "sleep"].includes(s.brain.goal.type)) {
      s.brain.thinkCd = 0.45;
      const threat = nearestThreat(sense, s.x, s.y, 4.2);
      if (threat && s.brain.traits.bravery < 0.7) {
        think(s, game, sense);
      }
    }
    const speed = moveSpeed(s);
    advancePath(s, dt, speed);
    if (!s.path.length) onArrived(s, game);
    return;
  }

  if (s.state === "work") {
    doWork(s, dt, game);
    return;
  }

  if (s.state === "fight") {
    doFight(s, dt, game, sense);
    return;
  }

  if (s.state === "eat") {
    s.workTimer -= dt;
    s.hunger = Math.min(100, s.hunger + dt * 28);
    s.thought = "ест";
    if (s.workTimer <= 0 || s.hunger >= 92) {
      s.state = "idle";
      s.thought = "сыт";
      s.brain.commit = 0;
    }
    return;
  }

  if (s.state === "sleep") {
    const indoors = s.thought.includes("домик");
    s.energy = Math.min(100, s.energy + dt * (indoors ? 20 : 10));
    s.hunger = Math.max(0, s.hunger - dt * 0.35);
    // Wake if attacked
    const threat = nearestThreat(sense, s.x, s.y, 3.5);
    if (threat && s.brain.traits.bravery > 0.4) {
      s.state = "idle";
      s.job = null;
      s.thought = "проснулся от шума";
      s.brain.commit = 0;
      return;
    }
    if (!game.isNight && s.energy > 85) {
      s.state = "idle";
      s.thought = "проснулся";
      s.job = null;
      s.brain.commit = 0;
    }
    return;
  }

  // Idle / decide
  if (s.brain.thinkCd <= 0 || !s.brain.goal || s.brain.commit <= 0) {
    think(s, game, sense);
  }
}

function think(s, game, sense) {
  s.brain.thinkCd = 0.35 + Math.random() * 0.25;
  const goal = decideGoal(s, game, sense);
  s.brain.goal = goal;
  s.brain.commit = 1.2 + s.brain.traits.diligence;
  s.thought = goal.thought;
  executeGoal(s, game, sense, goal);
}

function executeGoal(s, game, sense, goal) {
  switch (goal.type) {
    case "eat":
      tryEat(s, game);
      break;
    case "sleep":
      trySleep(s, game);
      break;
    case "flee":
      enactFlee(s, game, sense, goal.payload?.fromId);
      break;
    case "flee_fire":
      enactFleeFire(s, game);
      break;
    case "fight":
      startFight(s, game, goal.payload?.targetId);
      break;
    case "job":
      if (goal.payload?.job) {
        goal.payload.job.claimedBy = s.id;
        assignJob(s, goal.payload.job, game);
      }
      break;
    case "forage":
      startAutoResource(s, game, "bush", "gather", true);
      break;
    case "chop_auto":
      startAutoResource(s, game, "tree", "chop", false);
      break;
    case "mine_auto":
      startAutoResource(s, game, "rock", "mine", false);
      break;
    case "hunt":
      startHunt(s, game, sense);
      break;
    case "loot":
      startLoot(s, game, sense);
      break;
    case "patrol":
      startPatrol(s, game);
      break;
    case "hold_wall":
      holdWall(s, game);
      break;
    case "flank_move":
      flankMove(s, game, sense);
      break;
    case "ambush_pos":
      ambushPos(s, game);
      break;
    case "idle_near":
    default:
      softWander(s, game, sense);
      break;
  }
}

function holdWall(s, game) {
  // Stand near wall/gate/tower
  let best = null;
  let bestD = Infinity;
  for (let y = 0; y < game.world.terrain.length; y++) {
    for (let x = 0; x < game.world.terrain[0].length; x++) {
      const b = game.world.buildings[y][x];
      if (!b?.done) continue;
      if (b.type !== "wall" && b.type !== "gate" && b.type !== "tower") continue;
      const spot = adjacentSpot(game.world, x, y, s.x, s.y);
      if (!spot) continue;
      const d = Math.hypot(spot.x - s.x, spot.y - s.y);
      if (d < bestD) {
        bestD = d;
        best = spot;
      }
    }
  }
  if (best) {
    s.job = { type: "wander", x: best.x, y: best.y, claimedBy: s.id, auto: true };
    goToTile(s, game, best.x, best.y);
    s.thought = "держит оборону";
  } else {
    startPatrol(s, game);
  }
}

function flankMove(s, game, sense) {
  const threat = nearestThreat(sense, s.x, s.y, 14);
  if (!threat) {
    startPatrol(s, game);
    return;
  }
  const ang = Math.atan2(threat.unit.y - s.y, threat.unit.x - s.x) + (s.id % 2 === 0 ? 1.2 : -1.2);
  const tx = Math.round(threat.unit.x + Math.cos(ang) * 3);
  const ty = Math.round(threat.unit.y + Math.sin(ang) * 3);
  if (walkable(game.world, tx, ty)) {
    s.job = { type: "wander", x: tx, y: ty, claimedBy: s.id, auto: true };
    goToTile(s, game, tx, ty);
    s.thought = "заходит с фланга";
  } else {
    startFight(s, game, threat.unit.id);
  }
}

function ambushPos(s, game) {
  let best = null;
  let bestD = 10;
  for (let y = 0; y < game.world.terrain.length; y++) {
    for (let x = 0; x < game.world.terrain[0].length; x++) {
      if (game.world.resources[y][x].kind !== "tree") continue;
      const spot = adjacentSpot(game.world, x, y, s.x, s.y);
      if (!spot) continue;
      const d = Math.hypot(spot.x - s.x, spot.y - s.y);
      if (d < bestD) {
        bestD = d;
        best = spot;
      }
    }
  }
  if (best) {
    s.job = { type: "wander", x: best.x, y: best.y, claimedBy: s.id, auto: true };
    goToTile(s, game, best.x, best.y);
    s.thought = "в засаде";
  }
}

function moveSpeed(s) {
  let spd = 2.55;
  if (s.brain.goal?.type === "flee" || s.brain.goal?.type === "flee_fire") spd = 3.4;
  if (s.brain.goal?.type === "fight") spd = 2.9;
  if (s.energy < 25) spd *= 0.85;
  if (s.brain.role === "hunter" || s.brain.role === "guard") spd *= 1.06;
  return spd;
}

function tileFire(game, x, y) {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (!inBounds(tx, ty)) return 0;
  return game.world.fire[ty][tx] || 0;
}

function tryEat(s, game) {
  if (game.stock.food > 0) {
    game.stock.food -= 1;
    releaseJob(s, game);
    s.state = "eat";
    s.workTimer = 1.6;
    s.thought = "берёт еду со склада";
    return;
  }
  startAutoResource(s, game, "bush", "gather", true);
  if (s.state === "idle") s.thought = "нет еды!";
}

function trySleep(s, game) {
  const hut = nearestBuilding(game.world, s.x, s.y, "hut", true);
  if (hut) {
    const spot = adjacentSpot(game.world, hut.x, hut.y, s.x, s.y);
    if (spot) {
      const job = { type: "sleep", x: hut.x, y: hut.y, claimedBy: s.id };
      assignJob(s, job, game);
      s.thought = "идёт спать";
      return;
    }
  }
  releaseJob(s, game);
  s.state = "sleep";
  s.thought = "спит под открытым небом";
}

function enactFlee(s, game, sense, fromId) {
  releaseJob(s, game);
  const threat = sense.threats.find((t) => t.id === fromId) || nearestThreat(sense, s.x, s.y, 9)?.unit;
  if (!threat) {
    softWander(s, game, sense);
    return;
  }
  // Prefer fleeing toward allies
  const allies = alliesNearby(sense, s.x, s.y, 10).filter((a) => a.id !== s.id);
  let dest = fleePoint(game.world, s.x, s.y, threat.x, threat.y);
  if (allies.length) {
    const a = allies[0];
    const candid = fleePoint(game.world, a.x, a.y, threat.x, threat.y);
    if (candid) dest = candid;
  }
  if (dest) {
    s.job = { type: "wander", x: dest.x, y: dest.y, claimedBy: s.id, auto: true };
    goToTile(s, game, dest.x, dest.y);
    s.thought = "убегает";
  }
}

function enactFleeFire(s, game) {
  releaseJob(s, game);
  const dest = fleePoint(game.world, s.x, s.y, s.x, s.y);
  // Pick coolest nearby tile
  let best = dest;
  let bestFire = 99;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = Math.floor(s.x) + dx;
      const y = Math.floor(s.y) + dy;
      if (!walkable(game.world, x, y)) continue;
      const f = game.world.fire[y][x];
      if (f < bestFire) {
        bestFire = f;
        best = { x, y };
      }
    }
  }
  if (best) {
    s.brain.goal = { type: "flee_fire", thought: "горит!" };
    s.job = { type: "wander", x: best.x, y: best.y, claimedBy: s.id, auto: true };
    goToTile(s, game, best.x, best.y);
    s.thought = "горит!";
  }
}

function startFight(s, game, targetId) {
  releaseJob(s, game);
  s.brain.targetId = targetId;
  s.state = "fight";
  s.thought = "в бою";
}

function doFight(s, dt, game, sense) {
  let target = game.creatures.find((c) => c.id === s.brain.targetId && !c.dead);
  if (!target) {
    const t = nearestThreat(sense, s.x, s.y, 6);
    target = t?.unit || null;
  }
  if (!target) {
    s.state = "idle";
    s.brain.commit = 0;
    s.thought = "угроза ушла";
    return;
  }

  const dist = Math.hypot(target.x - s.x, target.y - s.y);
  if (dist > 1.0) {
    // Steer toward target with short path refreshes
    s.brain.thinkCd -= dt;
    if (!s.path.length || s.brain.thinkCd <= 0) {
      s.brain.thinkCd = 0.35;
      goToTile(s, game, Math.floor(target.x), Math.floor(target.y));
    }
    if (s.state === "walk") {
      advancePath(s, dt, moveSpeed(s));
      s.state = "fight";
    } else {
      // Direct step if path failed
      const dx = target.x - s.x;
      const dy = target.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = s.x + (dx / d) * 2.8 * dt;
      const ny = s.y + (dy / d) * 2.8 * dt;
      if (walkable(game.world, Math.floor(nx), Math.floor(ny))) {
        s.x = nx;
        s.y = ny;
      }
    }
    s.thought = target.kind === "bandit" ? "догоняет бандита" : "догоняет волка";
    return;
  }

  if (s.attackTimer <= 0) {
    s.attackTimer = 0.7;
    const dmg = 14 + s.brain.traits.bravery * 12 + (s.brain.role === "guard" ? 8 : 0) + (s.brain.role === "hunter" ? 6 : 0);
    target.hp -= dmg;
    s.energy = Math.max(0, s.energy - 4);
    s.thought = "бьёт";
    game.fx.push({ kind: "spark", x: target.x, y: target.y, life: 0.25, max: 0.25, seed: Math.random() * 100 });
    if (target.hp <= 0) {
      target.dead = true;
      game.toast(`${s.name} победил${nameEnding(s.name)} ${target.kind === "bandit" ? "бандита" : "волка"}`);
      if (target.kind === "wolf" || target.kind === "bandit") {
        game.stock.food += target.kind === "wolf" ? 3 : 2;
      }
      s.state = "idle";
      s.brain.commit = 0;
      s.thought = "победа";
    }
  }
}

function startHunt(s, game, sense) {
  let best = null;
  let bestScore = -Infinity;
  for (const p of sense.prey) {
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d > 14) continue;
    const score = 20 - d + (s.brain.role === "hunter" ? 10 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best) {
    startAutoResource(s, game, "bush", "gather", false);
    return;
  }
  s.brain.targetId = best.id;
  s.job = { type: "hunt", x: Math.floor(best.x), y: Math.floor(best.y), claimedBy: s.id, auto: true, preyId: best.id };
  goToTile(s, game, Math.floor(best.x), Math.floor(best.y));
  s.thought = "охотится на кролика";
}

function startLoot(s, game, sense) {
  let best = null;
  let bestD = Infinity;
  for (const c of sense.corpses) {
    const d = Math.hypot(c.x - s.x, c.y - s.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (!best) {
    softWander(s, game, sense);
    return;
  }
  s.job = { type: "loot", x: Math.floor(best.x), y: Math.floor(best.y), claimedBy: s.id, auto: true, corpseId: best.id };
  goToTile(s, game, Math.floor(best.x), Math.floor(best.y));
  s.thought = "идёт к добыче";
}

function startPatrol(s, game) {
  const stock = nearestBuilding(game.world, s.x, s.y, "stockpile", true);
  const baseX = stock ? stock.x : (MAP_MID().x);
  const baseY = stock ? stock.y : (MAP_MID().y);
  const ang = Math.random() * Math.PI * 2;
  const tx = Math.round(baseX + Math.cos(ang) * (3 + Math.random() * 4));
  const ty = Math.round(baseY + Math.sin(ang) * (3 + Math.random() * 4));
  if (walkable(game.world, tx, ty)) {
    s.job = { type: "wander", x: tx, y: ty, claimedBy: s.id, auto: true };
    goToTile(s, game, tx, ty);
    s.thought = "патрулирует";
  }
}

function MAP_MID() {
  return { x: 36, y: 26 };
}

function softWander(s, game, sense) {
  // Prefer staying near allies / camp
  const allies = alliesNearby(sense, s.x, s.y, 12).filter((a) => a.id !== s.id);
  let ox = 0;
  let oy = 0;
  if (allies.length) {
    for (const a of allies) {
      ox += a.x;
      oy += a.y;
    }
    ox /= allies.length;
    oy /= allies.length;
  } else {
    const m = MAP_MID();
    ox = m.x;
    oy = m.y;
  }
  const tx = Math.round(ox + (Math.random() - 0.5) * 5);
  const ty = Math.round(oy + (Math.random() - 0.5) * 5);
  if (walkable(game.world, tx, ty) && Math.random() < 0.4) {
    s.job = { type: "wander", x: tx, y: ty, claimedBy: s.id, auto: true };
    goToTile(s, game, tx, ty);
    s.thought = "рядом с своими";
  } else {
    s.thought = "осматривается";
  }
}

function startAutoResource(s, game, kind, jobType, autoEat) {
  const spot = nearestResource(game.world, s.x, s.y, kind);
  if (!spot) return;
  // Skip if on fire
  if ((game.world.fire[spot.y][spot.x] || 0) > 0.3) return;
  game.world.resources[spot.y][spot.x].reserved = true;
  const job = { type: jobType, x: spot.x, y: spot.y, claimedBy: s.id, auto: true, autoEat };
  game.jobs.push(job);
  assignJob(s, job, game);
}

function adjacentSpot(world, tx, ty, fromX, fromY) {
  const opts = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = tx + dx;
      const y = ty + dy;
      if (walkable(world, x, y)) {
        opts.push({ x, y, d: Math.hypot(x + 0.5 - fromX, y + 0.5 - fromY) });
      }
    }
  }
  opts.sort((a, b) => a.d - b.d);
  return opts[0] || null;
}

function assignJob(s, job, game) {
  s.job = job;
  let tx = job.x;
  let ty = job.y;
  if (job.type === "build" || job.type === "sleep") {
    const spot = adjacentSpot(game.world, job.x, job.y, s.x, s.y);
    if (spot) {
      tx = spot.x;
      ty = spot.y;
    }
  }
  goToTile(s, game, tx, ty);
}

function labelBuilding(type) {
  return {
    hut: "домик",
    farm: "грядку",
    stockpile: "склад",
    wall: "стену",
    gate: "ворота",
    tower: "башню",
    barracks: "казарму",
  }[type] || "здание";
}

function goToTile(s, game, tx, ty) {
  const path = findPath(game.world, Math.floor(s.x), Math.floor(s.y), tx | 0, ty | 0);
  if (!path) {
    s.thought = "не может пройти";
    releaseJob(s, game);
    s.state = "idle";
    s.brain.commit = 0;
    return;
  }
  s.path = path;
  s.state = "walk";
  if (!path.length) onArrived(s, game);
}

function advancePath(s, dt, speed) {
  if (!s.path.length) return;
  const target = s.path[0];
  const tx = target.x + 0.5;
  const ty = target.y + 0.5;
  // Skip into fire tiles if possible
  if ((s._game?.world.fire[target.y]?.[target.x] || 0) > 0.55 && s.brain.goal?.type !== "flee_fire") {
    // repath around
    s.path = [];
    s.brain.commit = 0;
    return;
  }
  const dx = tx - s.x;
  const dy = ty - s.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const step = speed * dt;
  if (dist <= step) {
    s.x = tx;
    s.y = ty;
    s.path.shift();
  } else {
    s.x += (dx / dist) * step;
    s.y += (dy / dist) * step;
  }
}

function onArrived(s, game) {
  const job = s.job;
  if (!job || job.type === "wander") {
    s.state = "idle";
    s.job = null;
    if (s.brain.goal?.type === "patrol") s.thought = "всё тихо";
    else s.thought = "осматривается";
    return;
  }
  if (job.type === "sleep") {
    s.state = "sleep";
    s.thought = "спит в домике";
    return;
  }
  if (job.type === "hunt") {
    finishHunt(s, game, job);
    return;
  }
  if (job.type === "loot") {
    finishLoot(s, game, job);
    return;
  }
  s.state = "work";
  s.workTimer =
    job.type === "build" ? (BUILD_TIME[job.building] || 6) :
    job.type === "chop" ? 3.2 :
    job.type === "mine" ? 3.6 :
    job.type === "harvest" ? 2.2 : 2.4;
}

function finishHunt(s, game, job) {
  const prey = game.creatures.find((c) => c.id === job.preyId && !c.dead);
  if (prey && Math.hypot(prey.x - s.x, prey.y - s.y) < 1.4) {
    prey.hp -= 25 + s.brain.traits.bravery * 20;
    if (prey.hp <= 0) {
      prey.dead = true;
      game.stock.food += prey.food || 4;
      prey.looted = true;
      game.toast(`${s.name} добыл${nameEnding(s.name)} кролика`);
      s.state = "eat";
      s.workTimer = 1.2;
      s.thought = "жарит добычу";
      if (game.stock.food > 0) {
        game.stock.food -= 1;
        s.hunger = Math.min(100, s.hunger + 20);
      }
    } else {
      // Chase again
      s.job = { ...job, x: Math.floor(prey.x), y: Math.floor(prey.y) };
      goToTile(s, game, Math.floor(prey.x), Math.floor(prey.y));
      return;
    }
  } else if (prey) {
    s.job = { ...job, x: Math.floor(prey.x), y: Math.floor(prey.y) };
    goToTile(s, game, Math.floor(prey.x), Math.floor(prey.y));
    return;
  }
  removeJob(game, job);
  s.job = null;
  if (s.state !== "eat") {
    s.state = "idle";
    s.thought = "зверь ушёл";
  }
  s.brain.commit = 0;
}

function finishLoot(s, game, job) {
  const corpse = game.creatures.find((c) => c.id === job.corpseId && c.dead && !c.looted);
  if (corpse && Math.hypot(corpse.x - s.x, corpse.y - s.y) < 1.5) {
    game.stock.food += corpse.food || 3;
    corpse.looted = true;
    game.toast(`${s.name} собрал${nameEnding(s.name)} добычу`);
  }
  removeJob(game, job);
  s.job = null;
  s.state = "idle";
  s.brain.commit = 0;
  s.thought = "добыча собрана";
}

function doWork(s, dt, game) {
  const job = s.job;
  if (!job) {
    s.state = "idle";
    return;
  }

  // Drop work if threatened badly
  const sense = game._sense;
  if (sense) {
    const threat = nearestThreat(sense, s.x, s.y, 3.2);
    if (threat && s.brain.traits.bravery < 0.55 && job.type !== "build") {
      s.brain.commit = 0;
      think(s, game, sense);
      return;
    }
  }

  s.workTimer -= dt;
  s.energy = Math.max(0, s.energy - dt * 1.4);

  // Skill speeds work
  const skill =
    (job.type === "build" && s.brain.role === "builder") ? 1.35 :
    ((job.type === "gather" || job.type === "harvest") && s.brain.role === "gatherer") ? 1.3 :
    (job.type === "chop" && s.brain.role === "gatherer") ? 1.15 : 1;

  if (job.type === "build") {
    const b = game.world.buildings[job.y]?.[job.x];
    if (!b || b.done) {
      finishJob(s, game);
      return;
    }
    const total = (BUILD_TIME[b.type] || 6) / skill;
    b.progress = Math.min(1, b.progress + dt / total);
    s.thought = "строит…";
    if (b.progress >= 1) {
      b.done = true;
      b.progress = 1;
      if (b.type === "farm") b.growth = 0;
      game.toast(`${s.name} построил${nameEnding(s.name)} ${labelBuilding(b.type)}`);
      finishJob(s, game);
    }
    return;
  }

  if (s.workTimer > 0) {
    if (job.type === "chop") s.thought = "рубит…";
    else if (job.type === "mine") s.thought = "долбит камень…";
    else if (job.type === "harvest") s.thought = "собирает урожай…";
    else s.thought = "собирает…";
    // Faster gatherers finish sooner
    s.workTimer -= dt * (skill - 1);
    return;
  }

  if (job.type === "chop" || job.type === "gather" || job.type === "mine") {
    const cell = game.world.resources[job.y]?.[job.x];
    if (cell?.kind) {
      const key = cell.kind === "tree" ? "tree" : cell.kind === "bush" ? "bush" : "rock";
      const yieldMap = YIELD[key];
      const bonus = skill > 1.2 ? 1 : 0;
      for (const [k, v] of Object.entries(yieldMap)) {
        game.stock[k] += v + bonus;
      }
      cell.amount -= 1;
      if (cell.amount <= 0) {
        cell.kind = null;
        cell.amount = 0;
      }
      cell.reserved = false;

      if (job.autoEat && yieldMap.food) {
        if (game.stock.food > 0) game.stock.food -= 1;
        removeJob(game, job);
        s.job = null;
        s.state = "eat";
        s.workTimer = 1.4;
        s.thought = "ест ягоды";
        return;
      }
    }
  }

  if (job.type === "harvest") {
    const b = game.world.buildings[job.y]?.[job.x];
    if (b?.type === "farm" && b.done && (b.growth ?? 0) >= 1) {
      game.stock.food += YIELD.farm.food + (s.brain.role === "gatherer" ? 1 : 0);
      b.growth = 0;
      game.toast(`${s.name} собрал${nameEnding(s.name)} урожай`);
    }
  }

  finishJob(s, game);
}

function nameEnding(name) {
  if (/^(Лёня|Коля|Ваня|Саша|Женя|Гоша|Рома|Глеб)$/i.test(name)) return "";
  return /[ая]$/i.test(name) ? "а" : "";
}

function finishJob(s, game) {
  removeJob(game, s.job);
  s.job = null;
  s.state = "idle";
  s.thought = "свободен";
  s.brain.commit = 0.2;
}

function releaseJob(s, game) {
  if (!s.job) return;
  const job = s.job;
  if (job.auto || job.type === "wander" || job.type === "sleep" || job.type === "hunt" || job.type === "loot") {
    removeJob(game, job);
  } else {
    job.claimedBy = null;
  }
  if ((job.type === "chop" || job.type === "gather" || job.type === "mine") && inBounds(job.x, job.y)) {
    const cell = game.world.resources[job.y][job.x];
    if (cell) cell.reserved = false;
  }
  s.job = null;
}

function removeJob(game, job) {
  if (!job) return;
  game.jobs = game.jobs.filter((j) => j !== job);
}

export { roleLabel };
