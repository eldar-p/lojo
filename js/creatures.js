import { MAP_H, MAP_W } from "./config.js";
import { findPath, inBounds, walkable } from "./world.js";

function fx(game, kind, x, y, life = 0.5) {
  game.fx.push({ kind, x, y, life, max: life, seed: Math.random() * 1000 });
}

const DEFS = {
  rabbit: { hp: 20, speed: 2.8, color: "#d9c2a0", hostile: false, food: 4, radius: 0.35 },
  wolf: { hp: 55, speed: 2.4, color: "#6b7280", hostile: true, food: 0, radius: 0.45, damage: 18 },
  bandit: { hp: 70, speed: 1.9, color: "#8b3a3a", hostile: true, food: 0, radius: 0.5, damage: 22 },
};

export function createCreature(kind, x, y, id) {
  const def = DEFS[kind];
  return {
    id,
    kind,
    x: x + 0.5,
    y: y + 0.5,
    hp: def.hp,
    maxHp: def.hp,
    speed: def.speed,
    color: def.color,
    hostile: def.hostile,
    food: def.food,
    radius: def.radius,
    damage: def.damage || 0,
    dead: false,
    bob: Math.random() * Math.PI * 2,
    target: null,
    targetId: null,
    path: [],
    cooldown: 0,
    wanderT: 0,
    memory: { lastPreyX: null, lastPreyY: null, packId: (id % 3) },
    morale: 1,
    thinkCd: Math.random() * 0.5,
  };
}

export function updateCreatures(game, dt) {
  // Pack centers for wolves
  const packs = new Map();
  for (const c of game.creatures) {
    if (c.dead || c.kind !== "wolf") continue;
    const pid = c.memory.packId;
    if (!packs.has(pid)) packs.set(pid, []);
    packs.get(pid).push(c);
  }

  for (const c of game.creatures) {
    if (c.dead) continue;
    c.bob += dt * 7;
    c.cooldown = Math.max(0, c.cooldown - dt);
    c.thinkCd -= dt;

    const tileX = Math.floor(c.x);
    const tileY = Math.floor(c.y);
    if (inBounds(tileX, tileY)) {
      if (game.world.terrain[tileY][tileX] === "lava") {
        c.dead = true;
        continue;
      }
      if (game.world.fire[tileY][tileX] > 0.4) {
        c.hp -= dt * 25;
        // Flee fire
        steer(c, game, c.x - 1.5, c.y - 1.2, dt, c.speed * 1.3);
        if (c.hp <= 0) {
          c.dead = true;
          continue;
        }
      }
    }

    if (c.kind === "rabbit") updateRabbit(c, game, dt);
    else if (c.kind === "wolf") updateWolf(c, game, dt, packs.get(c.memory.packId) || [c]);
    else if (c.kind === "bandit") updateBandit(c, game, dt);
  }

  for (const c of game.creatures) {
    if (!c.dead || c.looted || !c.food) continue;
    for (const s of game.settlers) {
      if (s.state === "die") continue;
      if (Math.hypot(s.x - c.x, s.y - c.y) < 1.2) {
        game.stock.food += c.food;
        c.looted = true;
        game.toast(`${s.name} добыл мясо`);
        fx(game, "bless", c.x, c.y, 0.35);
        break;
      }
    }
  }

  game.creatures = game.creatures.filter((c) => !c.dead || !c.looted);
  if (game.creatures.length > 80) {
    game.creatures = game.creatures.filter((c) => !c.dead).slice(-80);
  }
}

function updateRabbit(c, game, dt) {
  // Predict danger: sum of repulsion vectors
  let rx = 0;
  let ry = 0;
  let fear = 0;

  for (const s of game.settlers) {
    if (s.state === "die") continue;
    const dx = c.x - s.x;
    const dy = c.y - s.y;
    const d = Math.hypot(dx, dy) || 0.01;
    if (d < 5.5) {
      const w = (5.5 - d) / 5.5;
      rx += (dx / d) * w;
      ry += (dy / d) * w;
      fear += w;
      // Extra fear of hunters
      if (s.brain?.role === "hunter") {
        rx += (dx / d) * w;
        ry += (dy / d) * w;
        fear += w;
      }
    }
  }
  for (const other of game.creatures) {
    if (other.dead || other === c || !other.hostile) continue;
    const dx = c.x - other.x;
    const dy = c.y - other.y;
    const d = Math.hypot(dx, dy) || 0.01;
    if (d < 6) {
      const w = (6 - d) / 6;
      rx += (dx / d) * w * 1.4;
      ry += (dy / d) * w * 1.4;
      fear += w * 1.4;
    }
  }

  // Prefer bushes (cover / food feeling)
  if (fear < 0.3) {
    const bush = nearestBush(game, c.x, c.y, 8);
    if (bush) {
      steer(c, game, bush.x + 0.5, bush.y + 0.5, dt, c.speed * 0.65);
      return;
    }
  }

  if (fear > 0.15) {
    const len = Math.hypot(rx, ry) || 1;
    steer(c, game, c.x + (rx / len) * 4, c.y + (ry / len) * 4, dt, c.speed * (1.1 + Math.min(0.5, fear)));
    return;
  }

  c.wanderT -= dt;
  if (c.wanderT <= 0 || !c.target) {
    c.wanderT = 1.2 + Math.random() * 2;
    c.target = {
      x: c.x + (Math.random() - 0.5) * 6,
      y: c.y + (Math.random() - 0.5) * 6,
    };
  }
  steer(c, game, c.target.x, c.target.y, dt, c.speed * 0.7);
}

function updateWolf(c, game, dt, pack) {
  // Low HP → retreat
  if (c.hp < c.maxHp * 0.3) {
    c.morale = 0.2;
    const away = averageSettlerPos(game) || { x: MAP_W / 2, y: MAP_H / 2 };
    steer(c, game, c.x * 2 - away.x, c.y * 2 - away.y, dt, c.speed * 1.15);
    return;
  }

  // Pack target consensus
  let prey = null;
  let best = -Infinity;
  const packCenter = centroid(pack);

  // Prefer rabbits, then isolated settlers
  for (const r of game.creatures) {
    if (r.dead || r.kind !== "rabbit") continue;
    const d = Math.hypot(r.x - c.x, r.y - c.y);
    if (d > 12) continue;
    let score = 30 - d;
    // Pack bonus if others nearby
    score += pack.filter((p) => p !== c && Math.hypot(p.x - r.x, p.y - r.y) < 6).length * 8;
    if (score > best) {
      best = score;
      prey = r;
    }
  }

  for (const s of game.settlers) {
    if (s.state === "die") continue;
    const d = Math.hypot(s.x - c.x, s.y - c.y);
    if (d > 10) continue;
    const guards = game.settlers.filter((o) => o.state !== "die" && Math.hypot(o.x - s.x, o.y - s.y) < 3.5).length;
    let score = 18 - d - guards * 10 + (s.energy < 30 ? 12 : 0);
    score += pack.length * 3;
    if (s.brain?.role === "hunter") score -= 8;
    if (score > best) {
      best = score;
      prey = s;
    }
  }

  if (prey) {
    c.memory.lastPreyX = prey.x;
    c.memory.lastPreyY = prey.y;
    // Flank: offset approach angle by pack index
    const idx = pack.indexOf(c);
    const ang = Math.atan2(prey.y - packCenter.y, prey.x - packCenter.x) + (idx - pack.length / 2) * 0.55;
    const flankX = prey.x - Math.cos(ang) * 1.2;
    const flankY = prey.y - Math.sin(ang) * 1.2;
    const dist = Math.hypot(prey.x - c.x, prey.y - c.y);
    if (dist > 1.1) {
      smartSteer(c, game, flankX, flankY, dt, c.speed);
    } else if (c.cooldown <= 0) {
      bite(c, game, prey);
    }
    return;
  }

  // Investigate last known prey
  if (c.memory.lastPreyX != null) {
    const d = Math.hypot(c.memory.lastPreyX - c.x, c.memory.lastPreyY - c.y);
    if (d > 1.5) {
      smartSteer(c, game, c.memory.lastPreyX, c.memory.lastPreyY, dt, c.speed * 0.7);
      return;
    }
    c.memory.lastPreyX = null;
  }

  // Keep pack cohesion
  if (pack.length > 1) {
    const d = Math.hypot(packCenter.x - c.x, packCenter.y - c.y);
    if (d > 4) {
      steer(c, game, packCenter.x, packCenter.y, dt, c.speed * 0.8);
      return;
    }
  }

  wander(c, game, dt, 0.5);
}

function updateBandit(c, game, dt) {
  if (c.hp < c.maxHp * 0.28) {
    // Retreat to map edge
    const ex = c.x < MAP_W / 2 ? 2 : MAP_W - 3;
    const ey = c.y < MAP_H / 2 ? 2 : MAP_H - 3;
    smartSteer(c, game, ex, ey, dt, c.speed * 1.2);
    return;
  }

  // Raid logic: prefer weak settlers near stockpile, else steal vibe by camping stockpile
  let target = null;
  let best = -Infinity;
  let stock = null;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const b = game.world.buildings[y][x];
      if (b?.done && b.type === "stockpile") {
        stock = b;
        break;
      }
    }
    if (stock) break;
  }

  for (const s of game.settlers) {
    if (s.state === "die") continue;
    const d = Math.hypot(s.x - c.x, s.y - c.y);
    if (d > 14) continue;
    const nearby = game.settlers.filter((o) => o.state !== "die" && Math.hypot(o.x - s.x, o.y - s.y) < 3).length;
    let score = 25 - d - nearby * 12 + (100 - s.energy) * 0.15;
    if (s.state === "sleep") score += 20;
    if (s.brain?.role === "guard") score -= 15;
    if (score > best) {
      best = score;
      target = s;
    }
  }

  if (target && best > 5) {
    const dist = Math.hypot(target.x - c.x, target.y - c.y);
    if (dist > 0.9) smartSteer(c, game, target.x, target.y, dt, c.speed);
    else if (c.cooldown <= 0) {
      bite(c, game, target);
      // Steal food on hit
      if (game.stock.food > 0 && Math.random() < 0.35) {
        game.stock.food -= 1;
        fx(game, "spark", c.x, c.y, 0.3);
      }
    }
    return;
  }

  if (stock) {
    const spotX = stock.x + (Math.random() < 0.5 ? -2 : 2);
    const spotY = stock.y + (Math.random() < 0.5 ? -2 : 2);
    smartSteer(c, game, spotX, spotY, dt, c.speed * 0.7);
    if (Math.hypot(stock.x - c.x, stock.y - c.y) < 2.5 && c.cooldown <= 0 && game.stock.food > 0) {
      c.cooldown = 2.5;
      game.stock.food = Math.max(0, game.stock.food - 2);
      game.toast("Бандит грабит склад!");
      fx(game, "spark", stock.x + 0.5, stock.y + 0.5, 0.4);
    }
    return;
  }

  wander(c, game, dt, 0.55);
}

function bite(c, game, prey) {
  c.cooldown = c.kind === "bandit" ? 0.95 : 1.05;
  if (prey.kind) {
    prey.hp -= c.damage;
    if (prey.hp <= 0) prey.dead = true;
  } else {
    prey.energy = Math.max(0, prey.energy - c.damage);
    prey.hunger = Math.max(0, prey.hunger - c.damage * 0.3);
    prey.thought = c.kind === "bandit" ? "атакован бандитом" : "атакован волком";
    prey.path = [];
    if (prey.state === "sleep") {
      prey.state = "idle";
      prey.brain && (prey.brain.commit = 0);
    }
    // Knockback
    const ang = Math.atan2(prey.y - c.y, prey.x - c.x);
    const nx = prey.x + Math.cos(ang) * 0.35;
    const ny = prey.y + Math.sin(ang) * 0.35;
    if (walkable(game.world, Math.floor(nx), Math.floor(ny))) {
      prey.x = nx;
      prey.y = ny;
    }
    if (prey.energy < 8) {
      prey.state = "die";
      prey.thought = "убит";
    }
  }
  fx(game, "spark", c.x, c.y, 0.25);
}

function wander(c, game, dt, speedMul) {
  c.wanderT -= dt;
  if (c.wanderT <= 0) {
    c.wanderT = 2 + Math.random() * 3;
    c.target = {
      x: c.x + (Math.random() - 0.5) * 8,
      y: c.y + (Math.random() - 0.5) * 8,
    };
  }
  if (c.target) steer(c, game, c.target.x, c.target.y, dt, c.speed * speedMul);
}

function smartSteer(c, game, tx, ty, dt, speed) {
  c.thinkCd -= dt;
  if (c.thinkCd <= 0 || !c.path?.length) {
    c.thinkCd = 0.55 + Math.random() * 0.3;
    const path = findPath(game.world, Math.floor(c.x), Math.floor(c.y), Math.floor(tx), Math.floor(ty));
    c.path = path || [];
  }
  if (c.path?.length) {
    const step = c.path[0];
    const goalX = step.x + 0.5;
    const goalY = step.y + 0.5;
    const dx = goalX - c.x;
    const dy = goalY - c.y;
    const dist = Math.hypot(dx, dy) || 1;
    const sp = speed * dt;
    if (dist <= sp) {
      c.x = goalX;
      c.y = goalY;
      c.path.shift();
    } else {
      tryMove(c, game, c.x + (dx / dist) * sp, c.y + (dy / dist) * sp);
    }
    return;
  }
  steer(c, game, tx, ty, dt, speed);
}

function steer(c, game, tx, ty, dt, speed) {
  const dx = tx - c.x;
  const dy = ty - c.y;
  const dist = Math.hypot(dx, dy) || 1;
  // Local obstacle avoidance: sample side rays
  let vx = dx / dist;
  let vy = dy / dist;
  const look = 1.1;
  if (!canStep(game, c.x + vx * look, c.y + vy * look)) {
    const leftOk = canStep(game, c.x - vy * look, c.y + vx * look);
    const rightOk = canStep(game, c.x + vy * look, c.y - vx * look);
    if (leftOk && !rightOk) {
      const nx = -vy;
      const ny = vx;
      vx = nx;
      vy = ny;
    } else if (rightOk && !leftOk) {
      const nx = vy;
      const ny = -vx;
      vx = nx;
      vy = ny;
    } else if (leftOk) {
      const ox = vx;
      const oy = vy;
      vx = -oy * 0.7 + ox * 0.3;
      vy = ox * 0.7 + oy * 0.3;
    }
  }
  tryMove(c, game, c.x + vx * speed * dt, c.y + vy * speed * dt);
}

function tryMove(c, game, nx, ny) {
  const tx = Math.floor(nx);
  const ty = Math.floor(ny);
  if (!canStep(game, nx, ny)) return;
  c.x = nx;
  c.y = ny;
}

function canStep(game, x, y) {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (!inBounds(tx, ty)) return false;
  const terrain = game.world.terrain[ty][tx];
  if (terrain === "water" || terrain === "lava" || terrain === "mountain") return false;
  if (!walkable(game.world, tx, ty) && game.world.buildings[ty][tx]) return false;
  return true;
}

function moveCreature(c, game, dx, dy, dt, speed) {
  tryMove(c, game, c.x + dx * speed * dt, c.y + dy * speed * dt);
}

function nearestBush(game, x, y, maxD) {
  let best = null;
  let bestD = maxD;
  const x0 = Math.max(0, Math.floor(x - maxD));
  const y0 = Math.max(0, Math.floor(y - maxD));
  const x1 = Math.min(MAP_W - 1, Math.ceil(x + maxD));
  const y1 = Math.min(MAP_H - 1, Math.ceil(y + maxD));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (game.world.resources[ty][tx].kind !== "bush") continue;
      const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
      if (d < bestD) {
        bestD = d;
        best = { x: tx, y: ty };
      }
    }
  }
  return best;
}

function centroid(units) {
  let x = 0;
  let y = 0;
  for (const u of units) {
    x += u.x;
    y += u.y;
  }
  return { x: x / units.length, y: y / units.length };
}

function averageSettlerPos(game) {
  const alive = game.settlers.filter((s) => s.state !== "die");
  if (!alive.length) return null;
  return centroid(alive);
}

export function seedWildlife(game, count = 12) {
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < 400) {
    guard++;
    const x = (Math.random() * game.world.terrain[0].length) | 0;
    const y = (Math.random() * game.world.terrain.length) | 0;
    const t = game.world.terrain[y][x];
    if (t === "water" || t === "lava" || t === "mountain") continue;
    const kind = Math.random() < 0.78 ? "rabbit" : "wolf";
    game.creatures.push(createCreature(kind, x, y, game.nextCreatureId++));
    placed++;
  }
}
