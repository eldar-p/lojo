/**
 * Living NPC layer: weather, daily schedule, emotions, player-event reactions.
 * Pure local simulation — no network / LLM APIs.
 */

import { MAP_H, MAP_W } from "./config.js";
import { inBounds, nearestBuilding, walkable } from "./world.js";

/** Day phases that drive routine (wake → work → social → sleep) */
export const SCHEDULE = [
  { id: "night", from: 0.0, to: 0.18, label: "Ночь", work: 0.05, social: 0.05, rest: 1 },
  { id: "dawn", from: 0.18, to: 0.28, label: "Рассвет", work: 0.35, social: 0.2, rest: 0.4 },
  { id: "morning", from: 0.28, to: 0.48, label: "Утро", work: 1, social: 0.25, rest: 0.1 },
  { id: "midday", from: 0.48, to: 0.62, label: "День", work: 0.85, social: 0.45, rest: 0.2 },
  { id: "evening", from: 0.62, to: 0.78, label: "Вечер", work: 0.35, social: 1, rest: 0.35 },
  { id: "dusk", from: 0.78, to: 0.88, label: "Сумерки", work: 0.15, social: 0.4, rest: 0.7 },
  { id: "late", from: 0.88, to: 1.01, label: "Поздняя ночь", work: 0.05, social: 0.05, rest: 1 },
];

export function createWeather() {
  return {
    kind: "clear", // clear | rain | storm | cold
    intensity: 0,
    temp: 18, // °C-ish
    rainTimer: 0,
    nextRoll: 25 + Math.random() * 40,
  };
}

export function schedulePhase(dayPhase) {
  for (const p of SCHEDULE) {
    if (dayPhase >= p.from && dayPhase < p.to) return p;
  }
  return SCHEDULE[0];
}

export function updateWeather(game, dt) {
  const w = game.weather;
  if (!w) return;

  w.nextRoll -= dt;
  if (w.nextRoll <= 0) {
    w.nextRoll = 35 + Math.random() * 55;
    rollNaturalWeather(game);
  }

  // Decay rain/storm intensity unless refreshed by god rain
  if (w.kind === "rain" || w.kind === "storm") {
    w.rainTimer -= dt;
    w.intensity = Math.max(0, w.intensity - dt * 0.04);
    if (w.rainTimer <= 0 || w.intensity <= 0.05) {
      w.kind = w.temp < 5 ? "cold" : "clear";
      w.intensity = 0;
    } else {
      // Rain grows farms gently & extinguishes fire patches
      douseFires(game, dt * (0.5 + w.intensity));
      if (Math.random() < dt * 2.5 * w.intensity) boostRandomFarm(game);
    }
  }

  // Ambient temperature from biomes near camp + weather
  w.temp = ambientTemperature(game);

  // Close / open gates with the colony rhythm
  maintainGates(game);
}

function rollNaturalWeather(game) {
  const w = game.weather;
  const r = Math.random();
  if (r < 0.55) {
    w.kind = "clear";
    w.intensity = 0;
  } else if (r < 0.78) {
    setRaining(game, 0.45 + Math.random() * 0.35, 18 + Math.random() * 28, false);
  } else if (r < 0.9) {
    setRaining(game, 0.75 + Math.random() * 0.25, 12 + Math.random() * 16, true);
    game.toast("Надвигается буря");
  } else {
    w.kind = "cold";
    w.intensity = 0.3;
    w.temp = Math.min(w.temp, 2);
    game.toast("Похолодало");
  }
}

/** God rain brush / storm tools call this */
export function setRaining(game, intensity = 0.7, duration = 22, storm = false) {
  if (!game.weather) game.weather = createWeather();
  const w = game.weather;
  w.kind = storm ? "storm" : "rain";
  w.intensity = Math.max(w.intensity, intensity);
  w.rainTimer = Math.max(w.rainTimer, duration);
  w.temp = Math.min(w.temp, storm ? 8 : 12);
}

export function ambientTemperature(game) {
  const cx = (MAP_W / 2) | 0;
  const cy = (MAP_H / 2) | 0;
  let snow = 0;
  let lava = 0;
  let sand = 0;
  let n = 0;
  for (let y = cy - 6; y <= cy + 6; y++) {
    for (let x = cx - 6; x <= cx + 6; x++) {
      if (!inBounds(x, y)) continue;
      const t = game.world.terrain[y][x];
      n++;
      if (t === "snow") snow++;
      else if (t === "lava") lava++;
      else if (t === "sand") sand++;
    }
  }
  let temp = 17;
  if (n) {
    temp += (sand / n) * 10 + (lava / n) * 28 - (snow / n) * 22;
  }
  if (game.isNight) temp -= 4;
  if (game.weather?.kind === "rain") temp -= 4;
  if (game.weather?.kind === "storm") temp -= 8;
  if (game.weather?.kind === "cold") temp -= 10;
  return Math.round(temp * 10) / 10;
}

function douseFires(game, amount) {
  for (let i = 0; i < 40; i++) {
    const x = (Math.random() * MAP_W) | 0;
    const y = (Math.random() * MAP_H) | 0;
    if (game.world.fire[y][x] > 0) {
      game.world.fire[y][x] = Math.max(0, game.world.fire[y][x] - amount * 0.15);
    }
  }
}

function boostRandomFarm(game) {
  for (let tries = 0; tries < 12; tries++) {
    const x = (Math.random() * MAP_W) | 0;
    const y = (Math.random() * MAP_H) | 0;
    const b = game.world.buildings[y][x];
    if (b?.type === "farm" && b.done && (b.growth ?? 0) < 1) {
      b.growth = Math.min(1, (b.growth ?? 0) + 0.04);
      return;
    }
  }
}

function maintainGates(game) {
  const night = game.isNight;
  const storm = game.weather?.kind === "storm";
  const wantShut = night || storm;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const b = game.world.buildings[y][x];
      if (!b?.done || b.type !== "gate") continue;
      // NPCs closing gates is enacted via goals; ambient slow auto-shut at night
      if (wantShut && b.shutTimer == null) b.shutTimer = 0;
      if (!wantShut) {
        b.shut = false;
        b.shutTimer = null;
      }
    }
  }
}

export function clothingForTemp(temp, role) {
  if (temp < 4) return "fur";
  if (temp < 10) return "cloak";
  if (temp > 26) return "light";
  if (role === "guard" || role === "hunter") return "vest";
  return "plain";
}

export function clothingLabel(c) {
  return {
    fur: "меховая одежда",
    cloak: "плащ",
    light: "лёгкая одежда",
    vest: "жилет",
    plain: "обычная одежда",
  }[c] || c;
}

export function moodLabel(mood) {
  if (mood > 0.7) return "радостный";
  if (mood > 0.45) return "спокойный";
  if (mood > 0.25) return "тревожный";
  return "подавленный";
}

/** Tick emotions + wetness + clothing choice */
export function updateLivingNeeds(s, dt, game, sense) {
  if (!s.life) return;
  const w = game.weather;
  const temp = w?.temp ?? 18;
  const raining = w?.kind === "rain" || w?.kind === "storm";
  const indoors = isIndoors(game, s);

  // Clothing adapts (visible change when they "put on" gear)
  const want = clothingForTemp(temp, s.brain.role);
  if (s.life.clothing !== want) {
    s.life.clothingCd = (s.life.clothingCd || 0) - dt;
    if (s.life.clothingCd <= 0) {
      s.life.clothing = want;
      s.life.clothingCd = 4 + Math.random() * 4;
      if (want === "cloak" || want === "fur") s.thought = `надевает ${clothingLabel(want)}`;
      if (want === "light") s.thought = "снимает лишнее";
    }
  }

  // Wetness outdoors in rain
  if (raining && !indoors) {
    s.life.wet = Math.min(1, s.life.wet + dt * (0.15 + (w.intensity || 0.3)));
    s.energy = Math.max(0, s.energy - dt * (w.kind === "storm" ? 1.2 : 0.45));
    s.life.mood = Math.max(0, s.life.mood - dt * 0.02);
  } else {
    s.life.wet = Math.max(0, s.life.wet - dt * (indoors ? 0.25 : 0.08));
  }

  // Cold stress without proper clothes
  const insulation = s.life.clothing === "fur" ? 12 : s.life.clothing === "cloak" ? 7 : 0;
  const feel = temp + insulation - s.life.wet * 6;
  if (feel < 2 && !indoors) {
    s.energy = Math.max(0, s.energy - dt * 1.4);
    s.life.mood = Math.max(0, s.life.mood - dt * 0.03);
    s.life.fear = Math.min(1, s.life.fear + dt * 0.02);
  } else if (feel > 30 && !indoors) {
    s.energy = Math.max(0, s.energy - dt * 0.6);
    s.hunger = Math.max(0, s.hunger - dt * 0.4);
  }

  // Social need grows over time
  s.life.socialNeed = Math.min(1, s.life.socialNeed + dt * 0.012 * (0.5 + s.brain.traits.empathy));
  s.life.chatCd = Math.max(0, (s.life.chatCd || 0) - dt);

  // Clear combat flags when safe
  if (s.life.underAttack || s.life.callingHelp) {
    const dangerNear = sense?.threats?.some((t) => Math.hypot(t.x - s.x, t.y - s.y) < 6);
    if (!dangerNear && s.state !== "fight") {
      s.life.underAttack = false;
      s.life.callingHelp = false;
      if (s.brain) s.brain.attackerId = null;
    }
  }

  // Emotion decay toward baseline
  const base = 0.45 + s.brain.traits.empathy * 0.15 - s.life.fear * 0.25;
  s.life.mood += (base - s.life.mood) * Math.min(1, dt * 0.08);
  s.life.fear = Math.max(0, s.life.fear - dt * 0.04);
  s.life.joy = Math.max(0, s.life.joy - dt * 0.05);

  // Threats raise fear
  if (sense?.threats?.length) {
    const near = sense.threats.some((t) => Math.hypot(t.x - s.x, t.y - s.y) < 7);
    if (near) {
      s.life.fear = Math.min(1, s.life.fear + dt * 0.25);
      s.life.mood = Math.max(0, s.life.mood - dt * 0.08);
    }
  }

  // Night safety preference
  if (game.isNight && !indoors && s.state !== "sleep") {
    s.life.fear = Math.min(1, s.life.fear + dt * 0.015);
  }

  // Skill growth when working
  if (s.state === "work") {
    const skill = skillForRole(s.brain.role);
    s.life.skills[skill] = Math.min(1, (s.life.skills[skill] || 0) + dt * 0.008);
  }
}

function skillForRole(role) {
  if (role === "farmer") return "farming";
  if (role === "craftsman" || role === "builder") return "craft";
  if (role === "trader") return "trade";
  if (role === "hunter" || role === "guard") return "combat";
  return "gather";
}

export function isIndoors(game, s) {
  const tx = Math.floor(s.x);
  const ty = Math.floor(s.y);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const b = game.world.buildings[ty + dy]?.[tx + dx];
      if (b?.done && (b.type === "hut" || b.type === "barracks" || b.type === "stockpile")) return true;
    }
  }
  return false;
}

export function findShelterSpot(game, s) {
  const hut = nearestBuilding(game.world, s.x, s.y, "hut", true)
    || nearestBuilding(game.world, s.x, s.y, "barracks", true)
    || nearestBuilding(game.world, s.x, s.y, "stockpile", true);
  if (!hut) return null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = hut.x + dx;
      const y = hut.y + dy;
      if (walkable(game.world, x, y)) return { x, y, building: hut };
    }
  }
  return null;
}

export function findSocialPartner(s, sense) {
  let best = null;
  let bestScore = -Infinity;
  for (const a of sense.alive) {
    if (a.id === s.id || a.state === "die" || a.state === "sleep" || a.state === "fight") continue;
    if ((a.life?.chatCd || 0) > 0) continue;
    const d = Math.hypot(a.x - s.x, a.y - s.y);
    if (d > 10) continue;
    const bond = s.life?.bonds?.[a.id] || 0;
    const score = 10 - d + bond * 8 + (a.brain?.traits?.empathy || 0) * 4;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

export function findOpenGate(game, s) {
  let best = null;
  let bestD = Infinity;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const b = game.world.buildings[y][x];
      if (!b?.done || b.type !== "gate" || b.shut) continue;
      const d = Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y);
      if (d < bestD && d < 14) {
        bestD = d;
        best = b;
      }
    }
  }
  return best;
}

export function findFarmToTend(game, s) {
  let best = null;
  let bestD = Infinity;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const b = game.world.buildings[y][x];
      if (!b?.done || b.type !== "farm") continue;
      if ((b.growth ?? 0) >= 1) continue;
      const d = Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y);
      if (d < bestD && d < 16) {
        bestD = d;
        best = b;
      }
    }
  }
  return best;
}

/**
 * Instant emotional / behavioral reaction to player god actions.
 * kind: bless | harm | spawn_threat | rain | fire | death | tornado
 */
export function reactToPlayer(game, kind, x, y, radius = 4) {
  // Memory / reputation handled in social.rememberPlayer via powers hooks.
  // Here we keep immediate emotional reaction.
  for (const s of game.settlers) {
    if (s.state === "die" || !s.life) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d > radius) continue;
    const falloff = 1 - d / radius;
    const trusts = (s.life.playerRep ?? 0) > 0.25;

    if (kind === "bless") {
      s.life.joy = Math.min(1, s.life.joy + 0.45 * falloff);
      s.life.mood = Math.min(1, s.life.mood + 0.35 * falloff);
      s.life.fear = Math.max(0, s.life.fear - 0.2);
      s.thought = trusts ? "благодарит богов" : "осторожно принимает дар";
      s.brain.commit = 0;
    } else if (kind === "harm" || kind === "fire" || kind === "meteor" || kind === "bomb" || kind === "lightning") {
      s.life.fear = Math.min(1, s.life.fear + 0.55 * falloff);
      s.life.mood = Math.max(0, s.life.mood - 0.4 * falloff);
      s.thought = kind === "fire" ? "огонь!" : trusts ? "не понимает гнева богов" : "в ужасе от богов";
      s.brain.commit = 0;
      s.brain.thinkCd = 0;
    } else if (kind === "death" || kind === "tornado") {
      s.life.fear = Math.min(1, s.life.fear + 0.7 * falloff);
      s.life.mood = Math.max(0, s.life.mood - 0.5 * falloff);
      s.thought = "паникует";
      s.brain.commit = 0;
      s.brain.thinkCd = 0;
    } else if (kind === "rain") {
      s.life.mood -= 0.05 * falloff;
      if (!isIndoors(game, s)) s.thought = "мокнет под дождём";
    } else if (kind === "spawn_threat") {
      s.life.fear = Math.min(1, s.life.fear + 0.35 * falloff);
      s.thought = (s.life.playerRep ?? 0) < -0.2 ? "боги наслали беду" : "замечает опасность";
      s.brain.commit = 0;
    } else if (kind === "spawn_friend") {
      s.life.joy = Math.min(1, s.life.joy + 0.2 * falloff);
      s.life.mood = Math.min(1, s.life.mood + 0.15 * falloff);
      s.thought = "рад новому соседу";
    }
  }
}

export function weatherStatus(game) {
  const w = game.weather;
  if (!w) return "Ясно";
  if (w.kind === "storm") return "Буря";
  if (w.kind === "rain") return "Дождь";
  if (w.kind === "cold") return "Холод";
  return "Ясно";
}

export function createLifeState(id) {
  return {
    mood: 0.55 + (id % 5) * 0.05,
    fear: 0,
    joy: 0,
    wet: 0,
    socialNeed: 0.2 + Math.random() * 0.3,
    clothing: "plain",
    clothingCd: 0,
    chatCd: 0,
    bonds: Object.create(null),
    skills: { farming: 0.1, craft: 0.1, trade: 0.1, combat: 0.1, gather: 0.15 },
    homeId: null,
    playerRep: 0.1,
    memories: [],
    heardRumors: [],
    groupId: null,
    underAttack: false,
    callingHelp: false,
  };
}
