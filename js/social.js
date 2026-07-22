/**
 * Social layer: player memory/reputation, rumors, groups, procedural quests.
 * Local only — no network / LLM APIs.
 */

import { MAP_H, MAP_W } from "./config.js";

export const WEAPONS = {
  fists: { name: "кулаки", dmg: 1, range: 1.05, style: "melee", coverBonus: 0 },
  club: { name: "дубина", dmg: 1.35, range: 1.15, style: "melee", coverBonus: 0 },
  spear: { name: "копьё", dmg: 1.55, range: 1.45, style: "reach", coverBonus: 0.1 },
  bow: { name: "лук", dmg: 1.25, range: 4.2, style: "ranged", coverBonus: 0.35 },
};

export function createSocialState() {
  return {
    /** Aggregate god standing −1..1 */
    playerRep: 0.1,
    memories: [], // { kind, weight, day, x, y, note }
    rumors: [], // { id, kind, text, about, trust, day, fromId }
    quests: [], // active quests
    nextRumorId: 1,
    nextQuestId: 1,
    nextGroupId: 1,
    groups: Object.create(null), // id -> { id, members: number[], purpose, ttl }
  };
}

export function attitudeLabel(rep) {
  if (rep > 0.55) return "почитает богов";
  if (rep > 0.2) return "доверяет";
  if (rep > -0.15) return "насторожен";
  if (rep > -0.45) return "боится богов";
  return "ненавидит богов";
}

export function personalAttitude(s) {
  const r = s.life?.playerRep ?? 0;
  return attitudeLabel(r);
}

/** Record a player–world interaction and update colony + nearby NPC memory */
export function rememberPlayer(game, kind, x, y, { radius = 8, note = "", weight = 0.2 } = {}) {
  if (!game.social) game.social = createSocialState();
  const soc = game.social;
  const signed =
    kind === "help" || kind === "bless" || kind === "defend" ? Math.abs(weight) :
    kind === "aggression" || kind === "theft" || kind === "murder" ? -Math.abs(weight) :
    0;

  soc.playerRep = clamp(soc.playerRep + signed * 0.35, -1, 1);
  soc.memories.push({
    kind,
    weight: signed,
    day: game.day,
    x,
    y,
    note: note || noteForKind(kind),
  });
  if (soc.memories.length > 40) soc.memories.shift();

  for (const s of game.settlers) {
    if (s.state === "die" || !s.life) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d > radius) continue;
    const fall = 1 - d / radius;
    s.life.playerRep = clamp((s.life.playerRep ?? 0) + signed * fall, -1, 1);
    s.life.memories = s.life.memories || [];
    s.life.memories.push({ kind, day: game.day, note: note || noteForKind(kind), weight: signed * fall });
    if (s.life.memories.length > 12) s.life.memories.shift();

    if (signed < 0) {
      s.life.fear = Math.min(1, s.life.fear + 0.2 * fall);
      s.life.mood = Math.max(0, s.life.mood - 0.15 * fall);
    } else if (signed > 0) {
      s.life.joy = Math.min(1, s.life.joy + 0.2 * fall);
      s.life.mood = Math.min(1, s.life.mood + 0.12 * fall);
    }
  }

  // Seed a rumor so NPCs gossip about the god
  seedRumor(game, {
    kind: kind === "help" || kind === "bless" || kind === "defend" ? "god_kind" : "god_cruel",
    text: rumorText(kind, note),
    about: "player",
    trust: 0.55 + Math.abs(signed) * 0.3,
    fromId: null,
  });
}

function noteForKind(kind) {
  return {
    help: "боги помогли",
    bless: "благословение",
    defend: "боги защитили",
    aggression: "боги ударили",
    theft: "боги разорили запасы",
    murder: "боги убили наших",
  }[kind] || kind;
}

function rumorText(kind, note) {
  if (note) return note;
  return {
    help: "Говорят, боги помогли поселению",
    bless: "Кто-то видел благословение с небес",
    defend: "Боги встали на нашу сторону в бою",
    aggression: "Боги в ярости — берегись",
    theft: "Запасы пропали после гнева богов",
    murder: "Боги унесли жизнь поселенца",
  }[kind] || "Странные вести о богах";
}

export function seedRumor(game, { kind, text, about = "world", trust = 0.5, fromId = null }) {
  if (!game.social) game.social = createSocialState();
  const soc = game.social;
  // Dedup similar recent rumors
  if (soc.rumors.some((r) => r.kind === kind && r.text === text && game.day - r.day < 1)) return null;
  const rumor = {
    id: soc.nextRumorId++,
    kind,
    text,
    about,
    trust: clamp(trust, 0, 1),
    day: game.day,
    fromId,
  };
  soc.rumors.push(rumor);
  if (soc.rumors.length > 24) soc.rumors.shift();
  return rumor;
}

/** During chat: exchange rumor, possibly quarrel or deepen bond */
export function exchangeSocial(s, partner, game) {
  if (!s.life || !partner.life) return { line: "молчит", quarrel: false };

  // Share personal memory of the player
  const mem = (s.life.memories || []).slice(-1)[0];
  if (mem && Math.random() < 0.45) {
    partner.life.memories = partner.life.memories || [];
    partner.life.memories.push({ ...mem, heardFrom: s.id });
    if (partner.life.memories.length > 12) partner.life.memories.shift();
    partner.life.playerRep = clamp(
      (partner.life.playerRep ?? 0) + mem.weight * 0.25,
      -1,
      1
    );
    seedRumor(game, {
      kind: mem.kind === "aggression" || mem.kind === "murder" || mem.kind === "theft" ? "god_cruel" : "god_kind",
      text: `${s.name}: «${mem.note}»`,
      about: "player",
      trust: 0.4,
      fromId: s.id,
    });
    return { line: `рассказывает ${partner.name}: «${mem.note}»`, quarrel: false };
  }

  // Spread colony rumor
  const rumor = pickRumor(game, s);
  if (rumor && Math.random() < 0.55) {
    partner.life.heardRumors = partner.life.heardRumors || [];
    if (!partner.life.heardRumors.includes(rumor.id)) {
      partner.life.heardRumors.push(rumor.id);
      rumor.trust = Math.min(1, rumor.trust + 0.08);
      if (rumor.about === "player") {
        const delta = rumor.kind === "god_cruel" ? -0.08 : 0.08;
        partner.life.playerRep = clamp((partner.life.playerRep ?? 0) + delta, -1, 1);
      } else if (rumor.about === "quest") {
        partner.life.mood = Math.min(1, partner.life.mood + 0.04);
        partner.thought = "слышал про поручение богам";
      }
    }
    return { line: `шепчет ${partner.name}: «${rumor.text}»`, quarrel: false };
  }

  // Quarrel if opposite player attitudes or low mood
  const repDiff = Math.abs((s.life.playerRep ?? 0) - (partner.life.playerRep ?? 0));
  if (repDiff > 0.55 && Math.random() < 0.4) {
    s.life.bonds[partner.id] = Math.max(-0.5, (s.life.bonds[partner.id] || 0) - 0.2);
    partner.life.bonds[s.id] = Math.max(-0.5, (partner.life.bonds[s.id] || 0) - 0.2);
    s.life.mood = Math.max(0, s.life.mood - 0.08);
    partner.life.mood = Math.max(0, partner.life.mood - 0.08);
    return { line: `ссорится с ${partner.name} о богах`, quarrel: true };
  }

  // Form / reinforce a small friend group
  if ((s.life.bonds[partner.id] || 0) > 0.35 && Math.random() < 0.35) {
    ensureGroup(game, s, partner, "friends");
    return { line: `сговаривается с ${partner.name} держаться вместе`, quarrel: false };
  }

  const lines = [
    `спрашивает ${partner.name} про урожай`,
    `смеётся с ${partner.name}`,
    `жалуется ${partner.name} на погоду`,
    `хвалит работу ${partner.name}`,
  ];
  return { line: lines[(s.id + partner.id) % lines.length], quarrel: false };
}

function pickRumor(game, s) {
  const list = game.social?.rumors || [];
  if (!list.length) return null;
  // Prefer unheard
  const heard = new Set(s.life?.heardRumors || []);
  const fresh = list.filter((r) => !heard.has(r.id));
  const pool = fresh.length ? fresh : list;
  return pool[(Math.random() * pool.length) | 0];
}

export function ensureGroup(game, a, b, purpose = "friends") {
  if (!game.social) game.social = createSocialState();
  const soc = game.social;
  if (a.life?.groupId && soc.groups[a.life.groupId]) {
    const g = soc.groups[a.life.groupId];
    if (!g.members.includes(b.id)) g.members.push(b.id);
    b.life.groupId = g.id;
    g.ttl = 90;
    return g;
  }
  if (b.life?.groupId && soc.groups[b.life.groupId]) {
    const g = soc.groups[b.life.groupId];
    if (!g.members.includes(a.id)) g.members.push(a.id);
    a.life.groupId = g.id;
    g.ttl = 90;
    return g;
  }
  const id = soc.nextGroupId++;
  const g = { id, members: [a.id, b.id], purpose, ttl: 90 };
  soc.groups[id] = g;
  a.life.groupId = id;
  b.life.groupId = id;
  return g;
}

export function formDefenseGroup(game, leader, allies) {
  if (!game.social) game.social = createSocialState();
  const members = [leader.id, ...allies.map((a) => a.id)].slice(0, 5);
  const id = game.social.nextGroupId++;
  const g = { id, members, purpose: "defense", ttl: 45 };
  game.social.groups[id] = g;
  for (const sid of members) {
    const s = game.settlers.find((x) => x.id === sid);
    if (s?.life) s.life.groupId = id;
  }
  return g;
}

export function updateGroups(game, dt) {
  const soc = game.social;
  if (!soc) return;
  for (const id of Object.keys(soc.groups)) {
    const g = soc.groups[id];
    g.ttl -= dt;
    g.members = g.members.filter((mid) => {
      const s = game.settlers.find((x) => x.id === mid);
      return s && s.state !== "die";
    });
    if (g.ttl <= 0 || g.members.length < 2) {
      for (const mid of g.members) {
        const s = game.settlers.find((x) => x.id === mid);
        if (s?.life?.groupId === g.id) s.life.groupId = null;
      }
      delete soc.groups[id];
    }
  }
}

/** Procedural quests from colony needs / attacks */
export function updateQuests(game, dt) {
  if (!game.social) game.social = createSocialState();
  const soc = game.social;
  soc._questCd = (soc._questCd || 0) - dt;
  for (const q of soc.quests) {
    q.ttl -= dt;
    if (q.status === "active") tryCompleteQuest(game, q);
  }
  soc.quests = soc.quests.filter((q) => q.status === "active" && q.ttl > 0);

  if (soc._questCd > 0) return;
  soc._questCd = 6 + Math.random() * 4;

  const alive = game.settlers.filter((s) => s.state !== "die");
  if (!alive.length) return;
  if (soc.quests.length >= 2) return;

  const threats = game.creatures.filter((c) => !c.dead && (c.kind === "soldier" || c.kind === "wolf" || c.kind === "bandit" || c.hostile));
  const giver = alive.reduce((best, s) => {
    const fear = s.life?.fear || 0;
    if (!best || fear > (best.life?.fear || 0)) return s;
    return best;
  }, null);

  // Urgent personal needs before generic war spam
  if (game.stock.food < 8) {
    offerQuest(game, {
      type: "food",
      title: "Нужна еда",
      text: `${giver.name} просит благословения едой — запасы на исходе`,
      giverId: giver.id,
      need: { foodGain: 10 },
      progress: { foodGain: 0 },
      baseline: { food: game.stock.food },
      reward: { rep: 0.25 },
      ttl: 70,
    });
    return;
  }

  const hurt = alive.filter((s) => s.hunger < 40 || s.energy < 35 || (s.life?.fear || 0) > 0.5);
  if (hurt.length >= 2) {
    offerQuest(game, {
      type: "heal",
      title: "Исцелите раненых",
      text: `${giver.name} просит благословения для ослабших`,
      giverId: giver.id,
      need: { blesses: 2 },
      progress: { blesses: 0 },
      reward: { rep: 0.3 },
      ttl: 60,
    });
    return;
  }

  if (threats.length >= 3 || game.war?.atWar) {
    offerQuest(game, {
      type: "defend",
      title: "Защитите деревню",
      text: `${giver.name} молит богов: отбейте нападение (${threats.length} врагов)`,
      giverId: giver.id,
      need: { kills: Math.min(4, Math.max(2, threats.length - 1)) },
      progress: { kills: 0 },
      reward: { rep: 0.35, food: 4 },
      ttl: 90,
    });
    return;
  }

  const homes = countDone(game, "hut");
  if (alive.length > homes + 1 && game.stock.wood < 12) {
    offerQuest(game, {
      type: "wood",
      title: "Нужно дерево",
      text: `${giver.name}: посадите лес или дайте силы для рубки`,
      giverId: giver.id,
      need: { woodGain: 8 },
      progress: { woodGain: 0 },
      baseline: { wood: game.stock.wood },
      reward: { rep: 0.2 },
      ttl: 80,
    });
  }
}

function countDone(game, type) {
  let n = 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const b = game.world.buildings[y][x];
      if (b?.done && b.type === type) n++;
    }
  }
  return n;
}

function offerQuest(game, q) {
  const soc = game.social;
  if (soc.quests.some((x) => x.type === q.type && x.status === "active")) return;
  const quest = {
    id: soc.nextQuestId++,
    status: "active",
    ...q,
  };
  soc.quests.push(quest);
  game.toast(`Поручение: ${quest.title}`);
  seedRumor(game, {
    kind: "quest",
    text: quest.text,
    about: "quest",
    trust: 0.7,
    fromId: q.giverId,
  });
  const giver = game.settlers.find((s) => s.id === q.giverId);
  if (giver) giver.thought = "ждёт помощи богов";
}

function tryCompleteQuest(game, q) {
  if (q.type === "food") {
    const gained = Math.max(0, game.stock.food - (q.baseline?.food ?? 0));
    q.progress.foodGain = Math.max(q.progress.foodGain || 0, gained);
    if (q.progress.foodGain >= q.need.foodGain) completeQuest(game, q);
  } else if (q.type === "wood") {
    const gained = Math.max(0, game.stock.wood - (q.baseline?.wood ?? 0));
    q.progress.woodGain = Math.max(q.progress.woodGain || 0, gained);
    if (q.progress.woodGain >= q.need.woodGain) completeQuest(game, q);
  } else if (q.type === "defend") {
    if (q.progress.kills >= q.need.kills) completeQuest(game, q);
    const left = game.creatures.filter((c) => !c.dead && (c.kind === "soldier" || c.hostile || c.kind === "wolf" || c.kind === "bandit")).length;
    if (left === 0 && q.progress.kills > 0) completeQuest(game, q);
  } else if (q.type === "heal") {
    if (q.progress.blesses >= q.need.blesses) completeQuest(game, q);
  }
}

export function completeQuest(game, q) {
  if (q.status !== "active") return;
  q.status = "done";
  const rep = q.reward?.rep || 0.2;
  rememberPlayer(game, q.type === "defend" ? "defend" : "help", MAP_W / 2, MAP_H / 2, {
    radius: 14,
    weight: rep,
    note: `выполнено: ${q.title}`,
  });
  if (q.reward?.food) game.stock.food += q.reward.food;
  game.toast(`Поручение выполнено: ${q.title}`);
  const giver = game.settlers.find((s) => s.id === q.giverId);
  if (giver?.life) {
    giver.life.joy = Math.min(1, giver.life.joy + 0.4);
    giver.thought = "благодарит за помощь";
  }
}

export function onQuestEvent(game, event, amount = 1) {
  if (!game.social) return;
  for (const q of game.social.quests) {
    if (q.status !== "active") continue;
    if (event === "kill" && q.type === "defend") q.progress.kills += amount;
    if (event === "bless" && q.type === "heal") q.progress.blesses += amount;
    if (event === "bless" && q.type === "food") {
      q.progress.foodGain = (q.progress.foodGain || 0) + amount * 2;
      if (q.baseline) q.baseline.food = Math.min(q.baseline.food, game.stock.food);
    }
    if (event === "plant" && q.type === "wood") {
      q.progress.woodGain = (q.progress.woodGain || 0) + amount;
    }
  }
}

export function assignWeapon(s) {
  if (s.weapon) return s.weapon;
  const role = s.brain?.role;
  if (s.military || role === "guard") s.weapon = "spear";
  else if (role === "hunter") s.weapon = "bow";
  else if (role === "craftsman" || role === "builder") s.weapon = "club";
  else s.weapon = "fists";
  return s.weapon;
}

export function weaponInfo(s) {
  return WEAPONS[assignWeapon(s)] || WEAPONS.fists;
}

/** True if settler stands next to tree/wall cover */
export function isInCover(game, s) {
  const ox = Math.floor(s.x);
  const oy = Math.floor(s.y);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = ox + dx;
      const y = oy + dy;
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      if (game.world.resources[y][x]?.kind === "tree") return true;
      const b = game.world.buildings[y][x];
      if (b?.done && (b.type === "wall" || b.type === "tower" || b.type === "gate")) return true;
    }
  }
  return false;
}

/**
 * Cover between self and threat when possible (blocking geometry),
 * otherwise a reachable spot that still keeps some distance.
 */
export function findCover(game, s, threatX, threatY) {
  let best = null;
  let bestScore = -Infinity;
  const ox = Math.floor(s.x);
  const oy = Math.floor(s.y);
  for (let y = oy - 7; y <= oy + 7; y++) {
    for (let x = ox - 7; x <= ox + 7; x++) {
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      const t = game.world.terrain[y][x];
      if (t === "water" || t === "lava" || t === "mountain") continue;
      const b = game.world.buildings[y][x];
      const tree = game.world.resources[y][x]?.kind === "tree";
      const wallish = b?.done && (b.type === "wall" || b.type === "tower" || b.type === "gate");
      if (!tree && !wallish) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const sx = x + dx;
        const sy = y + dy;
        if (sx < 0 || sy < 0 || sx >= MAP_W || sy >= MAP_H) continue;
        const bt = game.world.terrain[sy][sx];
        if (bt === "water" || bt === "lava" || bt === "mountain") continue;
        const bb = game.world.buildings[sy][sx];
        if (bb?.done && bb.type !== "farm" && bb.type !== "gate") continue;
        if (game.world.fire[sy]?.[sx] > 0.2) continue;

        // Prefer standing so cover object lies between settler and threat
        const toThreatX = threatX - sx;
        const toThreatY = threatY - sy;
        const toCoverX = x - sx;
        const toCoverY = y - sy;
        const dot = toThreatX * toCoverX + toThreatY * toCoverY;
        const between = dot > 0 ? 8 : 0;

        const away = Math.hypot(sx - threatX, sy - threatY);
        const near = Math.hypot(sx - s.x, sy - s.y);
        // Stay at weapon-friendly distance, not marathon flee
        const rangeBias = Math.abs(away - 3.2);
        const score = between + away * 0.6 - near * 0.9 - rangeBias * 0.8 + (wallish ? 3 : 1.5);
        if (score > bestScore) {
          bestScore = score;
          best = { x: sx, y: sy, kind: tree ? "tree" : "wall" };
        }
      }
    }
  }
  return best;
}

/**
 * Self-preservation decision: flee | cover | call_help | attack
 */
export function assessThreat(s, threat, allies, game) {
  const wpn = weaponInfo(s);
  const bravery = s.brain?.traits?.bravery || 0.4;
  const fear = s.life?.fear || 0;
  const rep = s.life?.playerRep ?? 0;
  const hpProxy = (s.energy + s.hunger) / 2;
  const allyPower = allies.reduce((sum, a) => {
    const aw = weaponInfo(a);
    return sum + 10 + (a.military ? 12 : 0) + aw.dmg * 6 + (a.life?.skills?.combat || 0) * 10;
  }, 0) + (s.life?.groupId ? 10 : 0);

  const inRange = threat.dist <= wpn.range + 0.4;
  const canKite = wpn.style === "ranged" && threat.dist > 1.6;
  const myPower = bravery * 36 + wpn.dmg * 16 + (s.military ? 18 : 0) + (rep > 0.3 ? 6 : 0)
    + (s.life?.skills?.combat || 0) * 20 + (canKite ? 12 : 0) + (inRange ? 8 : -10);
  const danger = (threat.unit.damage || 12) * 0.85 + threat.unit.hp * 0.1
    + (threat.dist < 1.4 ? 18 : 0) + (hpProxy < 40 ? 20 : 0);

  let fightScore = myPower + allyPower * 0.7 - danger - fear * 30;
  let fleeScore = 18 + fear * 38 + (5 - Math.min(5, threat.dist)) * 8 - bravery * 22 + (hpProxy < 35 ? 30 : 0);
  let coverScore = 22 + (wpn.style === "ranged" ? 18 : 12) + fear * 12 + (isInCover(game, s) ? -15 : 10);
  let callScore = allies.length < 2 ? 28 + (1 - bravery) * 28 + fear * 20 : 8 + fear * 10;

  // Critical: never prefer attack when nearly dead
  if (hpProxy < 28 || s.energy < 22) {
    fightScore -= 50;
    fleeScore += 35;
    callScore += 25;
  }

  const options = [
    { action: "attack", score: fightScore },
    { action: "flee", score: fleeScore },
    { action: "cover", score: coverScore },
    { action: "call_help", score: callScore },
  ];
  options.sort((a, b) => b.score - a.score);
  return options[0];
}

export function activeQuestSummary(game) {
  const q = game.social?.quests?.find((x) => x.status === "active");
  if (!q) return null;
  if (q.type === "defend") return `${q.title}: ${q.progress.kills}/${q.need.kills}`;
  if (q.type === "heal") return `${q.title}: ${q.progress.blesses}/${q.need.blesses}`;
  if (q.type === "food") return `${q.title}: ${Math.floor(q.progress.foodGain || 0)}/${q.need.foodGain}`;
  if (q.type === "wood") return `${q.title}: ${Math.floor(q.progress.woodGain || 0)}/${q.need.woodGain}`;
  return q.title;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
