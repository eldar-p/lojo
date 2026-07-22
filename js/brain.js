/**
 * Local colony Utility AI — no network, no LLM APIs.
 * Scores candidate goals each think-tick and commits to the best one.
 */

import { MAP_H, MAP_W } from "./config.js";
import { inBounds, walkable } from "./world.js";

const ROLES = ["builder", "gatherer", "hunter", "guard"];

export function rollPersonality(id) {
  const role = ROLES[id % ROLES.length];
  // 0..1 traits
  const traits = {
    bravery: 0.25 + ((id * 17) % 70) / 100,
    diligence: 0.35 + ((id * 29) % 60) / 100,
    greed: 0.2 + ((id * 13) % 50) / 100,
    empathy: 0.3 + ((id * 41) % 55) / 100,
  };
  return { role, traits };
}

/** Spatial hash of threats / opportunities rebuilt cheaply each frame group */
export function senseWorld(game) {
  const threats = [];
  const prey = [];
  const corpses = [];
  let fireNearBase = 0;

  for (const c of game.creatures) {
    if (c.dead) {
      if (c.food && !c.looted) corpses.push(c);
      continue;
    }
    if (c.hostile || c.faction === "horde" || c.kind === "soldier") threats.push(c);
    else if (c.kind === "rabbit") prey.push(c);
  }

  const cx = MAP_W / 2;
  const cy = MAP_H / 2;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (game.world.fire[y][x] > 0.4) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < 12) fireNearBase++;
      }
    }
  }

  const alive = game.settlers.filter((s) => s.state !== "die");
  const needs = {
    food: game.stock.food,
    wood: game.stock.wood,
    stone: game.stock.stone,
    people: alive.length,
    homes: countType(game.world, "hut"),
    farms: countType(game.world, "farm"),
  };

  return { threats, prey, corpses, fireNearBase, alive, needs, isNight: game.isNight };
}

function countType(world, type) {
  let n = 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const b = world.buildings[y][x];
      if (b?.done && b.type === type) n++;
    }
  }
  return n;
}

export function nearestThreat(sense, x, y, maxDist = 8) {
  let best = null;
  let bestD = maxDist;
  for (const t of sense.threats) {
    const d = Math.hypot(t.x - x, t.y - y);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best ? { unit: best, dist: bestD } : null;
}

export function alliesNearby(sense, x, y, radius = 4) {
  return sense.alive.filter((s) => Math.hypot(s.x - x, s.y - y) < radius);
}

/**
 * Build scored goal list for a settler. Higher = better.
 * Goals: { type, score, thought, payload }
 */
export function decideGoal(s, game, sense) {
  const goals = [];
  const { traits, role } = s.brain;
  const threat = nearestThreat(sense, s.x, s.y, 7);
  const allies = alliesNearby(sense, s.x, s.y, 4.5);
  const hpProxy = (s.energy + s.hunger) / 2;

  // --- Critical needs ---
  if (s.hunger < 35) {
    goals.push({
      type: "eat",
      score: 120 + (35 - s.hunger) * 3,
      thought: "срочно есть",
    });
  }
  if ((sense.isNight || s.energy < 25) && s.energy < 70) {
    goals.push({
      type: "sleep",
      score: 90 + (sense.isNight ? 40 : 0) + (25 - Math.min(25, s.energy)),
      thought: "хочет спать",
    });
  }

  // --- Danger ---
  if (threat) {
    const fightPower = allies.length * 18 + traits.bravery * 40 + (role === "guard" || role === "hunter" ? 25 : 0);
    const danger = threat.unit.damage + threat.unit.hp * 0.15;
    if (fightPower > danger && hpProxy > 40 && threat.dist < 5.5) {
      goals.push({
        type: "fight",
        score: 100 + traits.bravery * 50 + (role === "guard" ? 30 : 0) - threat.dist * 4,
        thought: threat.unit.kind === "bandit" ? "бьёт бандита" : "бьёт волка",
        payload: { targetId: threat.unit.id },
      });
    } else if (threat.dist < 5) {
      goals.push({
        type: "flee",
        score: 130 + (5 - threat.dist) * 15 - traits.bravery * 20,
        thought: "убегает",
        payload: { fromId: threat.unit.id },
      });
    }

    // Help friend under attack (empathy)
    for (const a of sense.alive) {
      if (a.id === s.id) continue;
      if (a.thought?.includes("атакован") || a.state === "fight") {
        const d = Math.hypot(a.x - s.x, a.y - s.y);
        if (d < 8) {
          goals.push({
            type: "fight",
            score: 70 + traits.empathy * 40 + traits.bravery * 20 - d * 3,
            thought: `защищает ${a.name}`,
            payload: { targetId: threat.unit.id, allyId: a.id },
          });
        }
      }
    }
  }

  // Avoid standing in fire
  const tx = Math.floor(s.x);
  const ty = Math.floor(s.y);
  if (inBounds(tx, ty) && game.world.fire[ty][tx] > 0.35) {
    goals.push({ type: "flee_fire", score: 200, thought: "горит!" });
  }

  // --- Colony economy via utility ---
  const foodNeed = Math.max(0, 18 - sense.needs.food);
  const woodNeed = Math.max(0, 16 - sense.needs.wood);
  const stoneNeed = Math.max(0, 6 - sense.needs.stone);

  // Open jobs
  for (const job of game.jobs) {
    if (job.claimedBy && job.claimedBy !== s.id) continue;
    if (job.type === "wander" || job.type === "sleep") continue;
    const dist = Math.hypot(job.x + 0.5 - s.x, job.y + 0.5 - s.y);
    let score = 40 - dist * 1.8 + traits.diligence * 25;
    if (job.type === "build") {
      score += 35 + (role === "builder" ? 40 : 0);
      if (job.building === "hut" && sense.needs.people >= sense.needs.homes + 2) score += 30;
      if (job.building === "farm" && foodNeed > 5) score += 25;
    } else if (job.type === "gather" || job.type === "harvest") {
      score += foodNeed * 3 + (role === "gatherer" ? 35 : 0);
    } else if (job.type === "chop") {
      score += woodNeed * 2.5 + (role === "builder" ? 15 : 0) + (role === "gatherer" ? 10 : 0);
    } else if (job.type === "mine") {
      score += stoneNeed * 3;
    }
    // Prefer safer jobs
    const jobThreat = nearestThreat(sense, job.x, job.y, 4);
    if (jobThreat) score -= 40 * (1 - traits.bravery);
    goals.push({
      type: "job",
      score,
      thought: thoughtForJob(job),
      payload: { job },
    });
  }

  // Auto goals when stock low
  if (foodNeed > 2) {
    goals.push({
      type: "forage",
      score: 45 + foodNeed * 4 + (role === "gatherer" ? 30 : 0),
      thought: "ищет ягоды",
    });
    goals.push({
      type: "hunt",
      score: 40 + foodNeed * 3.5 + (role === "hunter" ? 45 : 0) + traits.bravery * 15,
      thought: "охотится",
    });
    goals.push({
      type: "loot",
      score: 55 + foodNeed * 2 + (sense.corpses.length ? 20 : -80),
      thought: "собирает добычу",
    });
  }
  if (woodNeed > 2) {
    goals.push({
      type: "chop_auto",
      score: 38 + woodNeed * 3 + (role === "builder" ? 20 : 0),
      thought: "рубит впрок",
    });
  }
  if (stoneNeed > 1) {
    goals.push({
      type: "mine_auto",
      score: 30 + stoneNeed * 4,
      thought: "ищет камень",
    });
  }

  // Guard patrol / war doctrine
  if (role === "guard" || s.military || (sense.threats.length && traits.bravery > 0.55)) {
    goals.push({
      type: "patrol",
      score: 28 + sense.threats.length * 8 + (sense.isNight ? 15 : 0) + (role === "guard" || s.military ? 25 : 0),
      thought: "патрулирует",
    });
  }

  const stance = game.war?.colonyStance;
  const atWar = game.war?.atWar || sense.threats.some((t) => t.kind === "soldier");
  if (atWar && (s.military || role === "guard" || traits.bravery > 0.6)) {
    if (stance === "defend") {
      goals.push({ type: "hold_wall", score: 75 + sense.threats.length * 6, thought: "держит оборону" });
    } else if (stance === "raid" || stance === "breakthrough") {
      goals.push({ type: "fight", score: 85 + traits.bravery * 30, thought: "идёт в атаку", payload: { targetId: threat?.unit?.id } });
    } else if (stance === "encircle") {
      goals.push({ type: "flank_move", score: 80, thought: "заходит с фланга" });
    } else if (stance === "ambush") {
      goals.push({ type: "ambush_pos", score: 70, thought: "готовит засаду" });
    } else if (stance === "siege") {
      goals.push({ type: "fight", score: 78, thought: "давит на врага", payload: { targetId: threat?.unit?.id } });
    }
  }

  // Social idle near friends
  goals.push({
    type: "idle_near",
    score: 8 + traits.empathy * 10,
    thought: "отдыхает",
  });

  // Soft commitment: stick to current goal a bit
  if (s.brain.goal && s.brain.commit > 0) {
    const cur = goals.find((g) => g.type === s.brain.goal.type && samePayload(g, s.brain.goal));
    if (cur) cur.score += 18 + s.brain.commit * 8;
  }

  goals.sort((a, b) => b.score - a.score);
  return goals[0] || { type: "idle_near", score: 0, thought: "ждёт" };
}

function samePayload(a, b) {
  if (a.type !== b.type) return false;
  if (a.payload?.job && b.payload?.job) return a.payload.job === b.payload.job;
  if (a.payload?.targetId != null) return a.payload.targetId === b.payload.targetId;
  return true;
}

function thoughtForJob(job) {
  if (job.type === "build") return `строит ${job.building === "hut" ? "домик" : job.building === "farm" ? "грядку" : "склад"}`;
  if (job.type === "chop") return "рубит дерево";
  if (job.type === "gather") return "собирает ягоды";
  if (job.type === "mine") return "добывает камень";
  if (job.type === "harvest") return "собирает урожай";
  return "работает";
}

/** Find a walkable escape tile away from danger */
export function fleePoint(world, fromX, fromY, dangerX, dangerY) {
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 24; i++) {
    const ang = (i / 24) * Math.PI * 2 + Math.random() * 0.2;
    const dist = 4 + Math.random() * 4;
    const x = Math.round(fromX + Math.cos(ang) * dist);
    const y = Math.round(fromY + Math.sin(ang) * dist);
    if (!walkable(world, x, y)) continue;
    if (world.fire[y]?.[x] > 0.2) continue;
    const away = Math.hypot(x - dangerX, y - dangerY);
    const from = Math.hypot(x - fromX, y - fromY);
    const score = away * 2 - from * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  return best;
}

export function roleLabel(role) {
  return {
    builder: "Строитель",
    gatherer: "Собиратель",
    hunter: "Охотник",
    guard: "Страж",
  }[role] || role;
}
