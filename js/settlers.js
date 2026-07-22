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
    state: "idle",
    bob: Math.random() * Math.PI * 2,
    thought: "осматривается",
  };
}

export function bindSettler(s, game) {
  s._game = game;
}

export function updateSettler(s, dt, game) {
  s.bob += dt * 6;
  s.hunger = Math.max(0, s.hunger - dt * 1.35);
  s.energy = Math.max(0, s.energy - dt * (game.isNight ? 2.2 : 0.55));

  if (s.hunger <= 0) {
    s.state = "die";
    s.thought = "не выдержал голода";
    releaseJob(s, game);
    s.path = [];
    return;
  }

  if (s.state === "die") return;

  if (s.state !== "eat" && s.state !== "sleep" && s.state !== "work") {
    if (s.hunger < 28) {
      tryEat(s, game);
      if (s.state === "eat" || s.state === "walk") return;
    }
    if ((game.isNight || s.energy < 22) && s.energy < 60) {
      trySleep(s, game);
      if (s.state === "sleep" || s.state === "walk") return;
    }
  }

  if (s.state === "walk") {
    advancePath(s, dt, 2.5);
    if (!s.path.length) onArrived(s, game);
    return;
  }

  if (s.state === "work") {
    doWork(s, dt, game);
    return;
  }

  if (s.state === "eat") {
    s.workTimer -= dt;
    s.hunger = Math.min(100, s.hunger + dt * 28);
    s.thought = "ест";
    if (s.workTimer <= 0 || s.hunger >= 92) {
      s.state = "idle";
      s.thought = "сыт";
    }
    return;
  }

  if (s.state === "sleep") {
    const indoors = s.job?.type === "sleep" || s.thought.includes("домик");
    s.energy = Math.min(100, s.energy + dt * (indoors ? 20 : 10));
    s.hunger = Math.max(0, s.hunger - dt * 0.35);
    if (!game.isNight && s.energy > 85) {
      s.state = "idle";
      s.thought = "проснулся";
      s.job = null;
    }
    return;
  }

  if (!s.job) {
    const job = claimJob(game);
    if (job) {
      job.claimedBy = s.id;
      assignJob(s, job, game);
      return;
    }
    autoSurvive(s, game);
  }
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
  const bush = nearestResource(game.world, s.x, s.y, "bush");
  if (bush) {
    game.world.resources[bush.y][bush.x].reserved = true;
    const job = { type: "gather", x: bush.x, y: bush.y, claimedBy: s.id, auto: true, autoEat: true };
    game.jobs.push(job);
    assignJob(s, job, game);
    s.thought = "ищет ягоды";
  } else {
    s.thought = "нет еды!";
  }
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

function claimJob(game) {
  const order = ["build", "chop", "gather", "mine", "harvest"];
  for (const type of order) {
    const job = game.jobs.find((j) => j.type === type && !j.claimedBy);
    if (job) return job;
  }
  return null;
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
  if (job.type === "build") s.thought = `строит ${labelBuilding(job.building)}`;
  else if (job.type === "chop") s.thought = "рубит дерево";
  else if (job.type === "gather") s.thought = "собирает ягоды";
  else if (job.type === "mine") s.thought = "добывает камень";
  else if (job.type === "harvest") s.thought = "собирает урожай";
  else if (job.type === "sleep") s.thought = "идёт спать";
}

function labelBuilding(type) {
  return type === "hut" ? "домик" : type === "farm" ? "грядку" : "склад";
}

function autoSurvive(s, game) {
  const ripe = findRipeFarm(game.world, s.x, s.y);
  if (ripe) {
    const job = { type: "harvest", x: ripe.x, y: ripe.y, claimedBy: s.id, auto: true };
    if (!game.jobs.some((j) => j.type === "harvest" && j.x === ripe.x && j.y === ripe.y)) {
      game.jobs.push(job);
    } else {
      const existing = game.jobs.find((j) => j.type === "harvest" && j.x === ripe.x && j.y === ripe.y && !j.claimedBy);
      if (existing) {
        existing.claimedBy = s.id;
        assignJob(s, existing, game);
        return;
      }
    }
    assignJob(s, job, game);
    return;
  }

  if (game.stock.food < 10) {
    const bush = nearestResource(game.world, s.x, s.y, "bush");
    if (bush) {
      game.world.resources[bush.y][bush.x].reserved = true;
      const job = { type: "gather", x: bush.x, y: bush.y, claimedBy: s.id, auto: true };
      game.jobs.push(job);
      assignJob(s, job, game);
      return;
    }
  }

  if (game.stock.wood < 12) {
    const tree = nearestResource(game.world, s.x, s.y, "tree");
    if (tree) {
      game.world.resources[tree.y][tree.x].reserved = true;
      const job = { type: "chop", x: tree.x, y: tree.y, claimedBy: s.id, auto: true };
      game.jobs.push(job);
      assignJob(s, job, game);
      return;
    }
  }

  if (game.stock.stone < 4 && Math.random() < 0.3) {
    const rock = nearestResource(game.world, s.x, s.y, "rock");
    if (rock) {
      game.world.resources[rock.y][rock.x].reserved = true;
      const job = { type: "mine", x: rock.x, y: rock.y, claimedBy: s.id, auto: true };
      game.jobs.push(job);
      assignJob(s, job, game);
      return;
    }
  }

  if (Math.random() < 0.015) {
    const tx = Math.round(s.x + (Math.random() - 0.5) * 8);
    const ty = Math.round(s.y + (Math.random() - 0.5) * 8);
    if (walkable(game.world, tx, ty)) {
      s.job = { type: "wander", x: tx, y: ty, claimedBy: s.id };
      goToTile(s, game, tx, ty);
      s.thought = "бродит";
      return;
    }
  }

  s.thought = "ждёт работу";
}

function findRipeFarm(world, x, y) {
  let best = null;
  let bestD = Infinity;
  for (let ty = 0; ty < world.terrain.length; ty++) {
    for (let tx = 0; tx < world.terrain[0].length; tx++) {
      const b = world.buildings[ty][tx];
      if (b && b.type === "farm" && b.done && (b.growth ?? 0) >= 1) {
        const d = Math.abs(tx - x) + Math.abs(ty - y);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
    }
  }
  return best;
}

function goToTile(s, game, tx, ty) {
  const path = findPath(game.world, Math.floor(s.x), Math.floor(s.y), tx | 0, ty | 0);
  if (!path) {
    s.thought = "не может пройти";
    releaseJob(s, game);
    s.state = "idle";
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
    s.thought = "осматривается";
    return;
  }
  if (job.type === "sleep") {
    s.state = "sleep";
    s.thought = "спит в домике";
    return;
  }
  s.state = "work";
  s.workTimer =
    job.type === "build" ? (BUILD_TIME[job.building] || 6) :
    job.type === "chop" ? 3.2 :
    job.type === "mine" ? 3.6 :
    job.type === "harvest" ? 2.2 : 2.4;
}

function doWork(s, dt, game) {
  const job = s.job;
  if (!job) {
    s.state = "idle";
    return;
  }
  s.workTimer -= dt;
  s.energy = Math.max(0, s.energy - dt * 1.4);

  if (job.type === "build") {
    const b = game.world.buildings[job.y]?.[job.x];
    if (!b) {
      finishJob(s, game);
      return;
    }
    if (b.done) {
      finishJob(s, game);
      return;
    }
    const total = BUILD_TIME[b.type] || 6;
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
    return;
  }

  if (job.type === "chop" || job.type === "gather" || job.type === "mine") {
    const cell = game.world.resources[job.y]?.[job.x];
    if (cell?.kind) {
      const key = cell.kind === "tree" ? "tree" : cell.kind === "bush" ? "bush" : "rock";
      const yieldMap = YIELD[key];
      for (const [k, v] of Object.entries(yieldMap)) {
        game.stock[k] += v;
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
      game.stock.food += YIELD.farm.food;
      b.growth = 0;
      game.toast(`${s.name} собрал${nameEnding(s.name)} урожай`);
    }
  }

  finishJob(s, game);
}

function nameEnding(name) {
  // Names that look feminine by ending but are used as masculine here
  if (/^(Лёня|Коля|Ваня|Саша|Женя|Гоша|Рома|Глеб)$/i.test(name)) return "";
  return /[ая]$/i.test(name) ? "а" : "";
}

function finishJob(s, game) {
  removeJob(game, s.job);
  s.job = null;
  s.state = "idle";
  s.thought = "свободен";
}

function releaseJob(s, game) {
  if (!s.job) return;
  const job = s.job;
  if (job.auto || job.type === "wander" || job.type === "sleep") {
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
