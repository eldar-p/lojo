import { MAP_H, MAP_W } from "./config.js";

/** @typedef {"grass"|"dirt"|"sand"|"water"|"snow"|"lava"|"mountain"} Terrain */
/** @typedef {"tree"|"bush"|"rock"|null} ResourceKind */

/**
 * Simple value noise via hashed gradients.
 */
function hash2(x, y, seed) {
  let n = Math.imul(x + seed * 374761393, 668265263) ^ Math.imul(y + seed, 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function smoothNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, seed) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < 4; i++) {
    sum += smoothNoise(x * freq, y * freq, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function createWorld(seed = (Math.random() * 1e9) | 0) {
  /** @type {Terrain[][]} */
  const terrain = [];
  /** @type {{kind: ResourceKind, amount: number, reserved: boolean}[][]} */
  const resources = [];
  /** @type {(null|{id:number,type:string,progress:number,done:boolean,x:number,y:number,growth?:number})[][]} */
  const buildings = [];
  /** @type {number[][]} */
  const fire = [];

  let waterBodies = 0;

  for (let y = 0; y < MAP_H; y++) {
    terrain[y] = [];
    resources[y] = [];
    buildings[y] = [];
    fire[y] = [];
    for (let x = 0; x < MAP_W; x++) {
      const elev = fbm(x / 18, y / 18, seed);
      const moist = fbm(x / 22 + 40, y / 22 - 10, seed + 99);
      let t = "grass";
      if (elev < 0.34) {
        t = "water";
        waterBodies++;
      } else if (elev < 0.4) t = "sand";
      else if (elev > 0.78) t = "mountain";
      else if (elev > 0.7 && moist < 0.45) t = "snow";
      else if (moist < 0.38) t = "dirt";

      terrain[y][x] = t;
      buildings[y][x] = null;
      fire[y][x] = 0;

      let kind = null;
      let amount = 0;
      if (t === "grass" || t === "dirt") {
        const r = hash2(x, y, seed + 7);
        if (r > 0.78 && t === "grass") {
          kind = "tree";
          amount = 3 + ((hash2(x, y, seed + 3) * 3) | 0);
        } else if (r > 0.68 && r <= 0.78) {
          kind = "bush";
          amount = 2 + ((hash2(x, y, seed + 5) * 2) | 0);
        } else if (r > 0.62 && r <= 0.68 && moist < 0.5) {
          kind = "rock";
          amount = 2 + ((hash2(x, y, seed + 9) * 3) | 0);
        }
      }
      resources[y][x] = { kind, amount, reserved: false };
    }
  }

  // Ensure spawn clearing near center
  const cx = (MAP_W / 2) | 0;
  const cy = (MAP_H / 2) | 0;
  for (let y = cy - 4; y <= cy + 4; y++) {
    for (let x = cx - 4; x <= cx + 4; x++) {
      if (!inBounds(x, y)) continue;
      if (terrain[y][x] === "water") terrain[y][x] = "sand";
      resources[y][x] = { kind: null, amount: 0, reserved: false };
    }
  }

  // Guarantee some nearby trees/bushes/rocks
  placeNear(resources, terrain, cx, cy, "tree", 10, seed);
  placeNear(resources, terrain, cx, cy, "bush", 8, seed);
  placeNear(resources, terrain, cx, cy, "rock", 6, seed);

  return {
    seed,
    terrain,
    resources,
    buildings,
    fire,
    nextBuildingId: 1,
    waterBodies,
  };
}

function placeNear(resources, terrain, cx, cy, kind, count, seed) {
  let placed = 0;
  let radius = 5;
  let guard = 0;
  while (placed < count && guard < 400) {
    guard++;
    const ang = hash2(placed, guard, seed + kind.length) * Math.PI * 2;
    const dist = 3 + hash2(guard, placed, seed) * radius;
    const x = Math.round(cx + Math.cos(ang) * dist);
    const y = Math.round(cy + Math.sin(ang) * dist);
    if (!inBounds(x, y)) continue;
    if (terrain[y][x] === "water") continue;
    if (resources[y][x].kind) continue;
    resources[y][x] = {
      kind,
      amount: kind === "tree" ? 4 : kind === "bush" ? 3 : 3,
      reserved: false,
    };
    placed++;
    if (placed % 3 === 0) radius += 1.5;
  }
}

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
}

export function walkable(world, x, y) {
  if (!inBounds(x, y)) return false;
  const t = world.terrain[y][x];
  if (t === "water" || t === "lava" || t === "mountain") return false;
  const b = world.buildings[y][x];
  if (b && b.done) {
    // Closed gates block like walls (NPCs shut them at night / storms)
    if (b.type === "gate") return !b.shut;
    if (b.type === "wall" || b.type === "hut" || b.type === "stockpile" || b.type === "tower" || b.type === "barracks") {
      return false;
    }
  }
  return true;
}

/** Min-heap A* with fire/snow costs — much faster & smarter than sort-each-step */
export function findPath(world, sx, sy, tx, ty) {
  sx |= 0;
  sy |= 0;
  tx |= 0;
  ty |= 0;
  if (!inBounds(tx, ty)) return null;
  if (sx === tx && sy === ty) return [];

  const key = (x, y) => y * MAP_W + x;
  const open = new MinHeap();
  open.push(sx, sy, 0, heuristic(sx, sy, tx, ty));
  const came = new Int32Array(MAP_W * MAP_H).fill(-1);
  const gScore = new Float32Array(MAP_W * MAP_H).fill(1e9);
  gScore[key(sx, sy)] = 0;
  const closed = new Uint8Array(MAP_W * MAP_H);

  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  let expansions = 0;
  while (open.size) {
    const cur = open.pop();
    if (!cur) break;
    const ck = key(cur.x, cur.y);
    if (closed[ck]) continue;
    closed[ck] = 1;
    expansions++;

    if (cur.x === tx && cur.y === ty) {
      const path = [];
      let cx = tx;
      let cy = ty;
      while (!(cx === sx && cy === sy)) {
        path.push({ x: cx, y: cy });
        const prev = came[key(cx, cy)];
        if (prev < 0) break;
        cx = prev % MAP_W;
        cy = (prev / MAP_W) | 0;
      }
      path.reverse();
      return path;
    }

    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!inBounds(nx, ny)) continue;
      const isTarget = nx === tx && ny === ty;
      if (!isTarget && !walkable(world, nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!walkable(world, cur.x + dx, cur.y) && !isTarget) continue;
        if (!walkable(world, cur.x, cur.y + dy) && !isTarget) continue;
      }
      const nk = key(nx, ny);
      if (closed[nk]) continue;

      let step = dx !== 0 && dy !== 0 ? 1.414 : 1;
      const terrain = world.terrain[ny][nx];
      if (terrain === "snow") step *= 1.35;
      if (terrain === "sand") step *= 1.1;
      const fire = world.fire?.[ny]?.[nx] || 0;
      if (fire > 0.2) step += 6 + fire * 8;
      // Soft avoid lava adjacency
      if (hasLavaNear(world, nx, ny)) step += 2.5;

      const tg = cur.g + step;
      if (tg < gScore[nk]) {
        came[nk] = ck;
        gScore[nk] = tg;
        open.push(nx, ny, tg, tg + heuristic(nx, ny, tx, ty));
      }
    }

    if (expansions > 3200) break;
  }
  return null;
}

function hasLavaNear(world, x, y) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (world.terrain[ny][nx] === "lava") return true;
    }
  }
  return false;
}

function heuristic(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + Math.min(dx, dy) * 0.414;
}

class MinHeap {
  constructor() {
    this.data = [];
  }
  get size() {
    return this.data.length;
  }
  push(x, y, g, f) {
    const node = { x, y, g, f };
    this.data.push(node);
    let i = this.data.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].f <= this.data[i].f) break;
      const tmp = this.data[p];
      this.data[p] = this.data[i];
      this.data[i] = tmp;
      i = p;
    }
  }
  pop() {
    if (!this.data.length) return null;
    const top = this.data[0];
    const last = this.data.pop();
    if (!this.data.length) return top;
    this.data[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;
      if (l < this.data.length && this.data[l].f < this.data[smallest].f) smallest = l;
      if (r < this.data.length && this.data[r].f < this.data[smallest].f) smallest = r;
      if (smallest === i) break;
      const tmp = this.data[i];
      this.data[i] = this.data[smallest];
      this.data[smallest] = tmp;
      i = smallest;
    }
    return top;
  }
}

export function nearestResource(world, x, y, kind, onlyMarked = false, marks = null) {
  let best = null;
  let bestD = Infinity;
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const cell = world.resources[ty][tx];
      if (!cell.kind || cell.kind !== kind || cell.amount <= 0 || cell.reserved) continue;
      if (onlyMarked && marks && !marks.has(`${tx},${ty}`)) continue;
      const d = Math.abs(tx - x) + Math.abs(ty - y);
      if (d < bestD) {
        bestD = d;
        best = { x: tx, y: ty };
      }
    }
  }
  return best;
}

export function nearestBuilding(world, x, y, type, onlyDone = true) {
  let best = null;
  let bestD = Infinity;
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const b = world.buildings[ty][tx];
      if (!b || b.type !== type) continue;
      if (onlyDone && !b.done) continue;
      const d = Math.abs(tx - x) + Math.abs(ty - y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
  }
  return best;
}

export function countBuildings(world, type, onlyDone = true) {
  let n = 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const b = world.buildings[y][x];
      if (b && b.type === type && (!onlyDone || b.done)) n++;
    }
  }
  return n;
}

export function findBuildSite(world, x, y) {
  if (!inBounds(x, y)) return false;
  const t = world.terrain[y][x];
  if (t === "water" || t === "lava" || t === "mountain") return false;
  if (world.buildings[y][x]) return false;
  if (world.resources[y][x].kind) return false;
  return true;
}
