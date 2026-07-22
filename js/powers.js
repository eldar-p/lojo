import { MAP_H, MAP_W } from "./config.js";
import { createSettler, bindSettler } from "./settlers.js";
import { createCreature } from "./creatures.js";
import {
  declareWar,
  makePeace,
  setColonyStance,
  spawnEnemyArmy,
  trainSoldier,
} from "./war.js";
import { inBounds, walkable } from "./world.js";

/** Brush / click powers inspired by WorldBox god tools */
export const POWER_TABS = {
  world: {
    label: "Мир",
    tools: ["paint_grass", "paint_sand", "paint_dirt", "paint_water", "paint_snow", "paint_lava", "paint_mountain", "plant_tree", "plant_bush", "plant_rock", "erase"],
  },
  life: {
    label: "Жизнь",
    tools: ["select", "spawn_human", "spawn_rabbit", "spawn_wolf", "spawn_bandit", "rain", "bless"],
  },
  war: {
    label: "Война",
    tools: [
      "wall", "gate", "tower", "barracks", "train_soldier",
      "stance_defend", "stance_raid", "stance_encircle", "stance_siege", "stance_breakthrough", "stance_ambush",
      "stance_blitzkrieg", "stance_kessel", "stance_depth_defense", "stance_barrage", "stance_partisans",
      "stance_attrition", "stance_elastic", "stance_night_raid", "stance_interdiction", "stance_shock",
      "declare_war", "spawn_army", "make_peace",
    ],
  },
  chaos: {
    label: "Хаос",
    tools: ["lightning", "meteor", "fire", "bomb", "tornado", "death"],
  },
};

/** War tab sub-filters — keeps the god bar usable */
export const WAR_GROUPS = {
  build: ["wall", "gate", "tower", "barracks", "train_soldier"],
  doctrine: [
    "stance_defend", "stance_raid", "stance_encircle", "stance_siege", "stance_breakthrough", "stance_ambush",
    "stance_blitzkrieg", "stance_kessel", "stance_depth_defense", "stance_barrage", "stance_partisans",
    "stance_attrition", "stance_elastic", "stance_night_raid", "stance_interdiction", "stance_shock",
  ],
  cmd: ["declare_war", "spawn_army", "make_peace"],
};

export const BRUSH_TOOLS = new Set([
  "paint_grass", "paint_sand", "paint_dirt", "paint_water", "paint_snow",
  "paint_lava", "paint_mountain", "plant_tree", "plant_bush", "plant_rock",
  "erase", "fire", "rain", "bless",
]);

export const CLICK_POWERS = new Set([
  "lightning", "meteor", "bomb", "tornado", "death",
  "spawn_human", "spawn_rabbit", "spawn_wolf", "spawn_bandit",
  "spawn_army", "declare_war", "make_peace", "train_soldier",
  "stance_defend", "stance_raid", "stance_encircle", "stance_siege",
  "stance_breakthrough", "stance_ambush",
  "stance_blitzkrieg", "stance_kessel", "stance_depth_defense", "stance_barrage", "stance_partisans",
  "stance_attrition", "stance_elastic", "stance_night_raid", "stance_interdiction", "stance_shock",
]);

export function forBrush(cx, cy, radius, fn) {
  const r = Math.max(0, radius | 0);
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!inBounds(x, y)) continue;
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r + 0.2) continue;
      fn(x, y);
    }
  }
}

export function applyPower(game, tool, tx, ty, { continuous = false } = {}) {
  if (!inBounds(tx, ty)) return;

  if (BRUSH_TOOLS.has(tool)) {
    paintBrush(game, tool, tx, ty);
    return;
  }

  if (tool === "spawn_human") {
    spawnHuman(game, tx, ty);
    return;
  }
  if (tool === "spawn_rabbit") {
    spawnCreature(game, "rabbit", tx, ty);
    return;
  }
  if (tool === "spawn_wolf") {
    spawnCreature(game, "wolf", tx, ty);
    return;
  }
  if (tool === "spawn_bandit") {
    spawnCreature(game, "bandit", tx, ty);
    return;
  }
  if (tool === "lightning") {
    lightning(game, tx, ty);
    return;
  }
  if (tool === "meteor") {
    meteor(game, tx, ty);
    return;
  }
  if (tool === "bomb") {
    bomb(game, tx, ty);
    return;
  }
  if (tool === "tornado") {
    tornado(game, tx, ty);
    return;
  }
  if (tool === "death") {
    deathFinger(game, tx, ty);
    return;
  }
  if (tool === "declare_war") {
    declareWar(game);
    return;
  }
  if (tool === "make_peace") {
    makePeace(game);
    return;
  }
  if (tool === "spawn_army") {
    spawnEnemyArmy(game, tx, ty, 5);
    return;
  }
  if (tool === "train_soldier") {
    trainSoldier(game);
    return;
  }
  if (tool.startsWith("stance_")) {
    setColonyStance(game, tool.slice("stance_".length));
  }
}

function paintBrush(game, tool, tx, ty) {
  const r = game.brushSize ?? 1;
  forBrush(tx, ty, r, (x, y) => paintTile(game, tool, x, y));
}

function paintTile(game, tool, x, y) {
  const world = game.world;
  const cell = world.resources[y][x];

  if (tool === "erase") {
    world.terrain[y][x] = "dirt";
    cell.kind = null;
    cell.amount = 0;
    cell.reserved = false;
    world.buildings[y][x] = null;
    world.fire[y][x] = 0;
    return;
  }

  if (tool.startsWith("paint_")) {
    const terrain = tool.slice("paint_".length);
    world.terrain[y][x] = terrain;
    world.fire[y][x] = 0;
    if (terrain === "water" || terrain === "lava" || terrain === "mountain") {
      cell.kind = null;
      cell.amount = 0;
      world.buildings[y][x] = null;
    }
    return;
  }

  if (tool === "plant_tree" || tool === "plant_bush" || tool === "plant_rock") {
    const t = world.terrain[y][x];
    if (t === "water" || t === "lava") return;
    if (world.buildings[y][x]) return;
    const kind = tool === "plant_tree" ? "tree" : tool === "plant_bush" ? "bush" : "rock";
    cell.kind = kind;
    cell.amount = kind === "tree" ? 4 : 3;
    cell.reserved = false;
    return;
  }

  if (tool === "fire") {
    const t = world.terrain[y][x];
    if (t === "water" || t === "lava") return;
    world.fire[y][x] = Math.max(world.fire[y][x], 1);
    if (cell.kind === "tree" || cell.kind === "bush") {
      cell.kind = null;
      cell.amount = 0;
    }
    damageLifeAt(game, x, y, 35);
    addFx(game, "spark", x + 0.5, y + 0.5, 0.4);
    return;
  }

  if (tool === "rain") {
    world.fire[y][x] = 0;
    if (world.terrain[y][x] === "lava" && Math.random() < 0.35) {
      world.terrain[y][x] = "dirt";
    }
    const b = world.buildings[y][x];
    if (b?.type === "farm" && b.done) {
      b.growth = Math.min(1, (b.growth ?? 0) + 0.12);
    }
    if (Math.random() < 0.2 && !cell.kind && (world.terrain[y][x] === "grass" || world.terrain[y][x] === "dirt")) {
      cell.kind = "bush";
      cell.amount = 2;
    }
    addFx(game, "raindrop", x + Math.random(), y + Math.random(), 0.35);
    return;
  }

  if (tool === "bless") {
    for (const s of game.settlers) {
      if (s.state === "die") continue;
      if (Math.hypot(s.x - (x + 0.5), s.y - (y + 0.5)) < 2.2) {
        s.hunger = Math.min(100, s.hunger + 25);
        s.energy = Math.min(100, s.energy + 25);
      }
    }
    game.stock.food += 1;
    addFx(game, "bless", x + 0.5, y + 0.5, 0.7);
  }
}

function spawnHuman(game, tx, ty) {
  if (!walkable(game.world, tx, ty) && game.world.terrain[ty][tx] !== "sand") {
    if (game.world.terrain[ty][tx] === "water" || game.world.terrain[ty][tx] === "lava") {
      game.toast("Сюда нельзя призвать");
      return;
    }
  }
  const s = createSettler(tx, ty, game.nextSettlerId++);
  s.faction = "colony";
  bindSettler(s, game);
  game.settlers.push(s);
  addFx(game, "spawn", tx + 0.5, ty + 0.5, 0.6);
  game.toast(`${s.name} явился по воле богов`);
}

function spawnCreature(game, kind, tx, ty) {
  const t = game.world.terrain[ty][tx];
  if (t === "water" || t === "lava") {
    game.toast("Нельзя сюда");
    return;
  }
  const c = createCreature(kind, tx, ty, game.nextCreatureId++);
  game.creatures.push(c);
  addFx(game, "spawn", tx + 0.5, ty + 0.5, 0.5);
  const names = { rabbit: "Кролик", wolf: "Волк", bandit: "Бандит" };
  game.toast(`${names[kind] || kind} появился`);
}

function lightning(game, tx, ty) {
  addFx(game, "lightning", tx + 0.5, ty + 0.3, 0.45);
  forBrush(tx, ty, 1, (x, y) => {
    game.world.fire[y][x] = Math.max(game.world.fire[y][x], 0.85);
    const cell = game.world.resources[y][x];
    if (cell.kind === "tree" || cell.kind === "bush") {
      cell.kind = null;
      cell.amount = 0;
    }
    damageLifeAt(game, x, y, 55);
  });
  game.toast("Молния!");
}

function meteor(game, tx, ty) {
  addFx(game, "meteor", tx + 0.5, ty + 0.5, 0.9);
  forBrush(tx, ty, 2, (x, y) => {
    const dist = Math.hypot(x - tx, y - ty);
    if (dist <= 1.2) {
      game.world.terrain[y][x] = "lava";
      game.world.buildings[y][x] = null;
      game.world.resources[y][x] = { kind: null, amount: 0, reserved: false };
    } else {
      game.world.fire[y][x] = 1;
      if (game.world.resources[y][x].kind) {
        game.world.resources[y][x].kind = null;
        game.world.resources[y][x].amount = 0;
      }
    }
    damageLifeAt(game, x, y, 80);
  });
  game.toast("Метеорит!");
}

function bomb(game, tx, ty) {
  addFx(game, "bomb", tx + 0.5, ty + 0.5, 0.7);
  forBrush(tx, ty, 3, (x, y) => {
    const dist = Math.hypot(x - tx, y - ty);
    game.world.buildings[y][x] = null;
    game.world.resources[y][x] = { kind: null, amount: 0, reserved: false };
    game.world.fire[y][x] = Math.max(game.world.fire[y][x], 1 - dist / 4);
    if (dist < 1.5 && game.world.terrain[y][x] !== "water") {
      game.world.terrain[y][x] = "dirt";
    }
    damageLifeAt(game, x, y, 70);
  });
  game.toast("Взрыв!");
}

function tornado(game, tx, ty) {
  game.tornadoes.push({
    x: tx + 0.5,
    y: ty + 0.5,
    life: 6,
    angle: Math.random() * Math.PI * 2,
  });
  addFx(game, "tornado", tx + 0.5, ty + 0.5, 0.8);
  game.toast("Торнадо!");
}

function deathFinger(game, tx, ty) {
  let killed = 0;
  for (const s of game.settlers) {
    if (s.state === "die") continue;
    if (Math.hypot(s.x - (tx + 0.5), s.y - (ty + 0.5)) < 1.4) {
      s.state = "die";
      s.thought = "стёрт богом";
      killed++;
    }
  }
  for (const c of game.creatures) {
    if (c.dead) continue;
    if (Math.hypot(c.x - (tx + 0.5), c.y - (ty + 0.5)) < 1.4) {
      c.dead = true;
      c.hp = 0;
      killed++;
    }
  }
  addFx(game, "death", tx + 0.5, ty + 0.5, 0.5);
  game.toast(killed ? `Стерто: ${killed}` : "Пусто");
}

export function damageLifeAt(game, x, y, dmg) {
  for (const s of game.settlers) {
    if (s.state === "die") continue;
    if (Math.hypot(s.x - (x + 0.5), s.y - (y + 0.5)) < 0.95) {
      s.energy = Math.max(0, s.energy - dmg * 0.4);
      s.hunger = Math.max(0, s.hunger - dmg * 0.25);
      if (dmg > 50 || s.energy < 5) {
        s.state = "die";
        s.thought = "погиб";
      } else {
        s.thought = "раненый";
      }
    }
  }
  for (const c of game.creatures) {
    if (c.dead) continue;
    if (Math.hypot(c.x - (x + 0.5), c.y - (y + 0.5)) < 0.95) {
      c.hp -= dmg;
      if (c.hp <= 0) c.dead = true;
    }
  }
}

export function addFx(game, kind, x, y, life = 0.5) {
  game.fx.push({ kind, x, y, life, max: life, seed: Math.random() * 1000 });
}

export function updateWorldForces(game, dt) {
  // Fire spread / burn out
  const nextFire = [];
  for (let y = 0; y < MAP_H; y++) {
    nextFire[y] = game.world.fire[y].slice();
  }
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      let f = game.world.fire[y][x];
      if (f <= 0) continue;
      const t = game.world.terrain[y][x];
      if (t === "water" || t === "snow") {
        nextFire[y][x] = 0;
        continue;
      }
      f -= dt * 0.22;
      if (Math.random() < dt * 1.8) {
        const nx = x + ((Math.random() * 3) | 0) - 1;
        const ny = y + ((Math.random() * 3) | 0) - 1;
        if (inBounds(nx, ny) && game.world.terrain[ny][nx] !== "water") {
          const cell = game.world.resources[ny][nx];
          if (cell.kind === "tree" || cell.kind === "bush" || Math.random() < 0.15) {
            nextFire[ny][nx] = Math.max(nextFire[ny][nx], 0.7);
            if (cell.kind === "tree" || cell.kind === "bush") {
              cell.kind = null;
              cell.amount = 0;
            }
          }
        }
      }
      if (f > 0.3 && Math.random() < dt * 2) damageLifeAt(game, x, y, 12 * dt * 8);
      // Burn buildings slowly
      const b = game.world.buildings[y][x];
      if (b && f > 0.5 && Math.random() < dt * 0.4) {
        game.world.buildings[y][x] = null;
        game.toast("Здание сгорело");
      }
      nextFire[y][x] = Math.max(0, f);
      if (f > 0.4 && Math.random() < dt * 8) {
        addFx(game, "spark", x + Math.random(), y + Math.random(), 0.25);
      }
    }
  }
  game.world.fire = nextFire;

  // Lava hurts
  for (const s of game.settlers) {
    if (s.state === "die") continue;
    const tx = Math.floor(s.x);
    const ty = Math.floor(s.y);
    if (inBounds(tx, ty) && game.world.terrain[ty][tx] === "lava") {
      s.state = "die";
      s.thought = "упал в лаву";
    }
  }

  // Tornadoes
  for (const tw of game.tornadoes) {
    tw.life -= dt;
    tw.angle += dt * 3;
    tw.x += Math.cos(tw.angle) * dt * 2.2;
    tw.y += Math.sin(tw.angle * 0.7) * dt * 1.6;
    const cx = Math.floor(tw.x);
    const cy = Math.floor(tw.y);
    forBrush(cx, cy, 2, (x, y) => {
      if (Math.random() < dt * 3) {
        const cell = game.world.resources[y][x];
        if (cell.kind) {
          cell.kind = null;
          cell.amount = 0;
        }
        if (game.world.buildings[y][x] && Math.random() < 0.2) {
          game.world.buildings[y][x] = null;
        }
      }
      // Fling units
      for (const s of game.settlers) {
        if (s.state === "die") continue;
        const d = Math.hypot(s.x - tw.x, s.y - tw.y);
        if (d < 2.5) {
          const ang = Math.atan2(s.y - tw.y, s.x - tw.x) + 0.8;
          s.x += Math.cos(ang) * dt * 6;
          s.y += Math.sin(ang) * dt * 6;
          s.path = [];
          s.state = "idle";
          s.energy = Math.max(0, s.energy - dt * 8);
        }
      }
    });
    if (Math.random() < dt * 10) addFx(game, "tornado", tw.x, tw.y, 0.2);
  }
  game.tornadoes = game.tornadoes.filter((t) => t.life > 0);

  // FX lifetime
  for (const fx of game.fx) fx.life -= dt;
  game.fx = game.fx.filter((f) => f.life > 0);
}
