import { inBounds, walkable } from "./world.js";

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
    cooldown: 0,
    wanderT: 0,
  };
}

export function updateCreatures(game, dt) {
  for (const c of game.creatures) {
    if (c.dead) continue;
    c.bob += dt * 7;
    c.cooldown = Math.max(0, c.cooldown - dt);

    const tileX = Math.floor(c.x);
    const tileY = Math.floor(c.y);
    if (inBounds(tileX, tileY)) {
      if (game.world.terrain[tileY][tileX] === "lava") {
        c.dead = true;
        continue;
      }
      if (game.world.fire[tileY][tileX] > 0.4) {
        c.hp -= dt * 25;
        if (c.hp <= 0) {
          c.dead = true;
          continue;
        }
      }
    }

    if (c.kind === "rabbit") {
      updateRabbit(c, game, dt);
    } else if (c.kind === "wolf" || c.kind === "bandit") {
      updateHunter(c, game, dt);
    }
  }

  // Settlers can "hunt" dead rabbits nearby for food automatically
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

  // Cull old corpses
  game.creatures = game.creatures.filter((c) => !c.dead || !c.looted);
  if (game.creatures.length > 80) {
    game.creatures = game.creatures.filter((c) => !c.dead).slice(-80);
  }
}

function updateRabbit(c, game, dt) {
  // Flee wolves/bandits/people sometimes
  let fear = null;
  let fearD = 4;
  for (const s of game.settlers) {
    if (s.state === "die") continue;
    const d = Math.hypot(s.x - c.x, s.y - c.y);
    if (d < fearD) {
      fearD = d;
      fear = s;
    }
  }
  for (const other of game.creatures) {
    if (other.dead || other === c || !other.hostile) continue;
    const d = Math.hypot(other.x - c.x, other.y - c.y);
    if (d < fearD) {
      fearD = d;
      fear = other;
    }
  }

  if (fear) {
    const ang = Math.atan2(c.y - fear.y, c.x - fear.x);
    moveCreature(c, game, Math.cos(ang), Math.sin(ang), dt, c.speed * 1.25);
    return;
  }

  c.wanderT -= dt;
  if (c.wanderT <= 0 || !c.target) {
    c.wanderT = 1.5 + Math.random() * 2;
    c.target = {
      x: c.x + (Math.random() - 0.5) * 6,
      y: c.y + (Math.random() - 0.5) * 6,
    };
  }
  const dx = c.target.x - c.x;
  const dy = c.target.y - c.y;
  const dist = Math.hypot(dx, dy) || 1;
  moveCreature(c, game, dx / dist, dy / dist, dt, c.speed * 0.7);
}

function updateHunter(c, game, dt) {
  let prey = null;
  let best = c.kind === "bandit" ? 9 : 7;
  for (const s of game.settlers) {
    if (s.state === "die") continue;
    const d = Math.hypot(s.x - c.x, s.y - c.y);
    if (d < best) {
      best = d;
      prey = s;
    }
  }
  if (c.kind === "wolf") {
    for (const other of game.creatures) {
      if (other.dead || other.kind !== "rabbit") continue;
      const d = Math.hypot(other.x - c.x, other.y - c.y);
      if (d < best) {
        best = d;
        prey = other;
      }
    }
  }

  if (prey) {
    const dx = prey.x - c.x;
    const dy = prey.y - c.y;
    const dist = Math.hypot(dx, dy) || 1;
    moveCreature(c, game, dx / dist, dy / dist, dt, c.speed);
    if (dist < 0.7 && c.cooldown <= 0) {
      c.cooldown = 1.1;
      if (prey.kind) {
        prey.hp -= c.damage;
        if (prey.hp <= 0) prey.dead = true;
      } else {
        // settler
        prey.energy = Math.max(0, prey.energy - c.damage);
        prey.hunger = Math.max(0, prey.hunger - c.damage * 0.3);
        prey.thought = c.kind === "bandit" ? "атакован бандитом" : "атакован волком";
        prey.path = [];
        if (prey.energy < 8) {
          prey.state = "die";
          prey.thought = "убит";
        }
      }
      fx(game, "spark", c.x, c.y, 0.25);
    }
    return;
  }

  c.wanderT -= dt;
  if (c.wanderT <= 0) {
    c.wanderT = 2 + Math.random() * 3;
    c.target = {
      x: c.x + (Math.random() - 0.5) * 8,
      y: c.y + (Math.random() - 0.5) * 8,
    };
  }
  if (c.target) {
    const dx = c.target.x - c.x;
    const dy = c.target.y - c.y;
    const dist = Math.hypot(dx, dy) || 1;
    moveCreature(c, game, dx / dist, dy / dist, dt, c.speed * 0.55);
  }
}

function moveCreature(c, game, dx, dy, dt, speed) {
  const nx = c.x + dx * speed * dt;
  const ny = c.y + dy * speed * dt;
  const tx = Math.floor(nx);
  const ty = Math.floor(ny);
  if (!inBounds(tx, ty)) return;
  const terrain = game.world.terrain[ty][tx];
  if (terrain === "water" || terrain === "lava" || terrain === "mountain") return;
  // Allow walking through buildings for animals loosely
  if (!walkable(game.world, tx, ty) && game.world.buildings[ty][tx]) {
    // squeeze around
    return;
  }
  c.x = nx;
  c.y = ny;
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
