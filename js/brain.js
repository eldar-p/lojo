/**
 * Local colony Utility AI — no network, no LLM APIs.
 * Scores candidate goals each think-tick and commits to the best one.
 * Schedule, weather, emotions and roles shape everyday life.
 */

import {
  findFarmToTend,
  findOpenGate,
  findShelterSpot,
  findSocialPartner,
  schedulePhase,
} from "./life.js";
import { MAP_H, MAP_W } from "./config.js";
import { assessThreat, assignWeapon } from "./social.js";
import { inBounds, walkable } from "./world.js";

const ROLES = ["farmer", "builder", "craftsman", "gatherer", "hunter", "trader", "guard"];

export function rollPersonality(id) {
  const role = ROLES[id % ROLES.length];
  const traits = {
    bravery: 0.25 + ((id * 17) % 70) / 100,
    diligence: 0.35 + ((id * 29) % 60) / 100,
    greed: 0.2 + ((id * 13) % 50) / 100,
    empathy: 0.3 + ((id * 41) % 55) / 100,
  };
  // Role bias
  if (role === "guard" || role === "hunter") traits.bravery = Math.min(1, traits.bravery + 0.15);
  if (role === "farmer" || role === "craftsman" || role === "builder") traits.diligence = Math.min(1, traits.diligence + 0.12);
  if (role === "trader") traits.greed = Math.min(1, traits.greed + 0.2);
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

  const phase = schedulePhase(game.dayPhase);
  const weather = game.weather || { kind: "clear", intensity: 0, temp: 18 };
  const raining = weather.kind === "rain" || weather.kind === "storm";

  return {
    threats,
    prey,
    corpses,
    fireNearBase,
    alive,
    needs,
    isNight: game.isNight,
    phase,
    weather,
    raining,
    cold: weather.temp < 6 || weather.kind === "cold",
  };
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
  const phase = sense.phase;
  const life = s.life || {};
  const fear = life.fear || 0;
  const mood = life.mood ?? 0.5;
  const workMul = phase.work * (0.7 + traits.diligence * 0.5);
  const socialMul = phase.social * (0.6 + traits.empathy * 0.6);
  const restMul = phase.rest;

  // --- Critical needs ---
  if (s.hunger < 35) {
    goals.push({
      type: "eat",
      score: 120 + (35 - s.hunger) * 3,
      thought: "срочно есть",
    });
  }
  if ((sense.isNight || s.energy < 25 || restMul > 0.85) && s.energy < 75) {
    goals.push({
      type: "sleep",
      score: 70 + restMul * 55 + (sense.isNight ? 35 : 0) + (25 - Math.min(25, s.energy)),
      thought: sense.isNight ? "ложится спать" : "хочет спать",
    });
  }

  // --- Weather: shelter from rain / cold ---
  if ((sense.raining || sense.cold) && (life.wet > 0.25 || sense.weather.kind === "storm" || sense.cold)) {
    const shelter = findShelterSpot(game, s);
    if (shelter) {
      goals.push({
        type: "shelter",
        score: 95 + (sense.weather.kind === "storm" ? 40 : 0) + life.wet * 40 + (sense.cold ? 25 : 0),
        thought: sense.raining ? "прячется от дождя" : "греется в укрытии",
        payload: { x: shelter.x, y: shelter.y },
      });
    }
  }

  // Close gates at night / storm (security routine)
  if ((sense.isNight || sense.weather.kind === "storm") && (role === "guard" || traits.bravery > 0.5 || traits.diligence > 0.55)) {
    const gate = findOpenGate(game, s);
    if (gate) {
      goals.push({
        type: "close_gate",
        score: 88 + (sense.weather.kind === "storm" ? 20 : 0) + (role === "guard" ? 25 : 0),
        thought: "закрывает ворота",
        payload: { gate },
      });
    }
  }

  // --- Danger: self-preservation (flee / cover / call help / attack) ---
  assignWeapon(s);
  if (threat) {
    const decision = assessThreat(s, threat, allies.filter((a) => a.id !== s.id), game);
    if (decision.action === "attack" && hpProxy > 30) {
      goals.push({
        type: "fight",
        score: 105 + traits.bravery * 45 + (role === "guard" ? 30 : 0) - threat.dist * 3 - fear * 12,
        thought: threat.unit.kind === "bandit" ? "бьёт бандита" : threat.unit.kind === "soldier" ? "бьёт орду" : "бьёт волка",
        payload: { targetId: threat.unit.id },
      });
    } else if (decision.action === "cover") {
      goals.push({
        type: "seek_cover",
        score: 125 + fear * 20,
        thought: "ищет укрытие в бою",
        payload: { fromId: threat.unit.id, targetId: threat.unit.id },
      });
    } else if (decision.action === "call_help") {
      goals.push({
        type: "call_help",
        score: 128 + fear * 25,
        thought: "зовёт стражу!",
        payload: { fromId: threat.unit.id, targetId: threat.unit.id },
      });
    } else if (threat.dist < 5.5) {
      goals.push({
        type: "flee",
        score: 130 + (5 - threat.dist) * 15 - traits.bravery * 20 + fear * 30,
        thought: "убегает",
        payload: { fromId: threat.unit.id },
      });
    }

    // Answer cries for help / defend group mates
    for (const a of sense.alive) {
      if (a.id === s.id) continue;
      const sameGroup = life.groupId && a.life?.groupId === life.groupId;
      if (a.thought?.includes("атакован") || a.thought?.includes("зовёт") || a.state === "fight" || (a.life?.fear || 0) > 0.6 || sameGroup && threat.dist < 8) {
        const d = Math.hypot(a.x - s.x, a.y - s.y);
        if (d < 9) {
          goals.push({
            type: "fight",
            score: 75 + traits.empathy * 40 + traits.bravery * 20 - d * 3 + (sameGroup ? 25 : 0) + (role === "guard" ? 20 : 0),
            thought: `защищает ${a.name}`,
            payload: { targetId: threat.unit.id, allyId: a.id },
          });
        }
      }
    }

    // Distrustful NPCs hesitate to fight near cruel gods (low playerRep) unless bravery high
    if ((life.playerRep ?? 0) < -0.4 && traits.bravery < 0.55) {
      for (const g of goals) {
        if (g.type === "fight") g.score -= 25;
        if (g.type === "flee") g.score += 15;
      }
    }
  }

  const tx = Math.floor(s.x);
  const ty = Math.floor(s.y);
  if (inBounds(tx, ty) && game.world.fire[ty][tx] > 0.35) {
    goals.push({ type: "flee_fire", score: 200, thought: "горит!" });
  }

  // --- Role work during work hours ---
  const foodNeed = Math.max(0, 18 - sense.needs.food);
  const woodNeed = Math.max(0, 16 - sense.needs.wood);
  const stoneNeed = Math.max(0, 6 - sense.needs.stone);

  if (role === "farmer" && workMul > 0.3) {
    const farm = findFarmToTend(game, s);
    if (farm) {
      goals.push({
        type: "tend_farm",
        score: 55 * workMul + foodNeed * 3 + (life.skills?.farming || 0) * 20,
        thought: "ухаживает за грядкой",
        payload: { farm },
      });
    }
  }

  if (role === "craftsman" && workMul > 0.35 && sense.needs.wood >= 2) {
    goals.push({
      type: "craft",
      score: 48 * workMul + woodNeed * 2 + (life.skills?.craft || 0) * 25,
      thought: "занимается ремеслом",
    });
  }

  if (role === "trader" && workMul > 0.25) {
    goals.push({
      type: "trade",
      score: 42 * workMul + traits.greed * 30 + (life.skills?.trade || 0) * 20,
      thought: "торгует у склада",
    });
  }

  // Evening loneliness softens appetite for non-urgent work
  const socialPull = (phase.social > 0.6 && (life.socialNeed || 0) > 0.55) ? 0.55 : 1;

  // Open jobs
  for (const job of game.jobs) {
    if (job.claimedBy && job.claimedBy !== s.id) continue;
    if (job.type === "wander" || job.type === "sleep" || job.type === "social" || job.type === "shelter") continue;
    const dist = Math.hypot(job.x + 0.5 - s.x, job.y + 0.5 - s.y);
    let score = (40 - dist * 1.8 + traits.diligence * 25) * (0.35 + workMul);
    const urgentBuild = job.type === "build" && (
      (job.building === "hut" && sense.needs.people >= sense.needs.homes + 2)
      || (job.building === "farm" && foodNeed > 8)
    );
    if (job.type === "build") {
      score += 35 + (role === "builder" || role === "craftsman" ? 40 : 0);
      if (job.building === "hut" && sense.needs.people >= sense.needs.homes + 2) score += 30;
      if (job.building === "farm" && (foodNeed > 5 || role === "farmer")) score += 25 + (role === "farmer" ? 20 : 0);
    } else if (job.type === "gather" || job.type === "harvest") {
      score += foodNeed * 3 + (role === "gatherer" || role === "farmer" ? 35 : 0);
    } else if (job.type === "chop") {
      score += woodNeed * 2.5 + (role === "builder" || role === "craftsman" ? 20 : 0) + (role === "gatherer" ? 10 : 0);
    } else if (job.type === "mine") {
      score += stoneNeed * 3 + (role === "craftsman" ? 15 : 0);
    }
    const jobThreat = nearestThreat(sense, job.x, job.y, 4);
    if (jobThreat) score -= 40 * (1 - traits.bravery) + fear * 20;
    // Depressed / scared work less
    score *= 0.65 + mood * 0.35;
    if (!urgentBuild && foodNeed < 6) score *= socialPull;
    goals.push({
      type: "job",
      score,
      thought: thoughtForJob(job),
      payload: { job },
    });
  }

  if (foodNeed > 2 && workMul > 0.2) {
    goals.push({
      type: "forage",
      score: (45 + foodNeed * 4 + (role === "gatherer" || role === "farmer" ? 30 : 0)) * workMul,
      thought: "ищет ягоды",
    });
    goals.push({
      type: "hunt",
      score: (40 + foodNeed * 3.5 + (role === "hunter" ? 45 : 0) + traits.bravery * 15) * workMul,
      thought: "охотится",
    });
    goals.push({
      type: "loot",
      score: 55 + foodNeed * 2 + (sense.corpses.length ? 20 : -80),
      thought: "собирает добычу",
    });
  }
  if (woodNeed > 2 && workMul > 0.25) {
    goals.push({
      type: "chop_auto",
      score: (38 + woodNeed * 3 + (role === "builder" || role === "craftsman" ? 20 : 0)) * workMul,
      thought: "рубит впрок",
    });
  }
  if (stoneNeed > 1 && workMul > 0.25) {
    goals.push({
      type: "mine_auto",
      score: (30 + stoneNeed * 4) * workMul,
      thought: "ищет камень",
    });
  }

  // Socialize in evening / when lonely — can interrupt low-priority work
  const partner = findSocialPartner(s, sense);
  if (partner && (life.socialNeed || 0) > 0.3) {
    const lonely = life.socialNeed || 0;
    goals.push({
      type: "socialize",
      score: 25 + socialMul * 55 + lonely * 70 + traits.empathy * 25 + (life.bonds?.[partner.id] || 0) * 20
        + (phase.id === "evening" || phase.id === "midday" ? 25 : 0),
      thought: `болтает с ${partner.name}`,
      payload: { partnerId: partner.id },
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
    if (stance === "defend" || stance === "depth_defense") {
      goals.push({ type: "hold_wall", score: 75 + sense.threats.length * 6, thought: stance === "depth_defense" ? "эшелон обороны" : "держит оборону" });
    } else if (stance === "raid" || stance === "breakthrough" || stance === "blitzkrieg" || stance === "shock") {
      goals.push({
        type: "fight",
        score: 85 + traits.bravery * 30 + (stance === "blitzkrieg" ? 12 : 0),
        thought: stance === "blitzkrieg" ? "клин блицкрига" : stance === "shock" ? "идёт на штурм" : "идёт в атаку",
        payload: { targetId: threat?.unit?.id },
      });
    } else if (stance === "encircle" || stance === "kessel") {
      goals.push({ type: "flank_move", score: 82, thought: stance === "kessel" ? "сжимает котёл" : "заходит с фланга" });
    } else if (stance === "ambush" || stance === "partisans" || stance === "night_raid") {
      goals.push({ type: "ambush_pos", score: 72 + (sense.isNight && stance === "night_raid" ? 20 : 0), thought: stance === "partisans" ? "партизанит" : "готовит засаду" });
    } else if (stance === "siege" || stance === "barrage") {
      goals.push({ type: "fight", score: 78, thought: stance === "barrage" ? "ждёт артналёт" : "давит на врага", payload: { targetId: threat?.unit?.id } });
    } else if (stance === "attrition") {
      goals.push({ type: "fight", score: 80, thought: "изматывает врага", payload: { targetId: threat?.unit?.id } });
    } else if (stance === "elastic") {
      goals.push({ type: "hold_wall", score: 70, thought: "эластичная линия" });
      if (threat && threat.dist < 4) {
        goals.push({ type: "flee", score: 88, thought: "отходит с боем", payload: { fromId: threat.unit.id } });
      }
    } else if (stance === "interdiction") {
      goals.push({ type: "patrol", score: 76, thought: "прикрывает снабжение" });
      if (threat) goals.push({ type: "fight", score: 84, thought: "бьёт диверсантов", payload: { targetId: threat.unit.id } });
    }
  }

  // Rest / idle near friends when not working
  goals.push({
    type: "idle_near",
    score: 8 + traits.empathy * 10 + (1 - workMul) * 12 + mood * 5,
    thought: mood > 0.6 ? "наслаждается покоем" : "отдыхает",
  });

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
  if (a.payload?.partnerId != null) return a.payload.partnerId === b.payload.partnerId;
  if (a.payload?.gate && b.payload?.gate) return a.payload.gate === b.payload.gate;
  return true;
}

function thoughtForJob(job) {
  if (job.type === "build") {
    const names = {
      hut: "домик", farm: "грядку", stockpile: "склад",
      wall: "стену", gate: "ворота", tower: "башню", barracks: "казарму",
    };
    return `строит ${names[job.building] || "здание"}`;
  }
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
    farmer: "Фермер",
    builder: "Строитель",
    craftsman: "Ремесленник",
    gatherer: "Собиратель",
    hunter: "Охотник",
    trader: "Торговец",
    guard: "Страж",
  }[role] || role;
}
