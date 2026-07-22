import { MAP_H, MAP_W, TILE } from "./config.js";
import { BRUSH_TOOLS } from "./powers.js";

const TERRAIN = {
  grass: ["#3f6b49", "#466f4f", "#3a6344"],
  dirt: ["#6a5238", "#735a3e", "#614a32"],
  sand: ["#c2a66e", "#b99a60", "#cbb27a"],
  water: ["#2f5f78", "#356782", "#2a556c"],
  snow: ["#d9e4ef", "#c9d7e6", "#e8f1f8"],
  lava: ["#c44a1a", "#e06020", "#8a2808"],
  mountain: ["#5c6570", "#6a7380", "#4a535c"],
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  const cam = { x: MAP_W / 2, y: MAP_H / 2, zoom: 1.15 };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function worldToScreen(wx, wy) {
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;
    return {
      x: (wx - cam.x) * TILE * cam.zoom + vw / 2,
      y: (wy - cam.y) * TILE * cam.zoom + vh / 2,
    };
  }

  function screenToWorld(sx, sy) {
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;
    return {
      x: (sx - vw / 2) / (TILE * cam.zoom) + cam.x,
      y: (sy - vh / 2) / (TILE * cam.zoom) + cam.y,
    };
  }

  function draw(game, t) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const day = game.dayPhase;
    const sky = lerpColor(
      day < 0.25 || day > 0.85 ? "#1a2430" : day < 0.35 ? "#4a5d6e" : "#7eb0c8",
      day > 0.65 && day < 0.85 ? "#c47a4a" : null,
      day > 0.65 && day < 0.85 ? (day - 0.65) / 0.2 : 0
    );
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, sky);
    g.addColorStop(1, "#1a2a20");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const tl = screenToWorld(0, 0);
    const br = screenToWorld(w, h);
    const x0 = Math.max(0, Math.floor(tl.x) - 1);
    const y0 = Math.max(0, Math.floor(tl.y) - 1);
    const x1 = Math.min(MAP_W - 1, Math.ceil(br.x) + 1);
    const y1 = Math.min(MAP_H - 1, Math.ceil(br.y) + 1);
    const ts = TILE * cam.zoom;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = worldToScreen(x, y);
        const terrain = game.world.terrain[y][x];
        const shades = TERRAIN[terrain] || TERRAIN.dirt;
        const shade = shades[(x * 3 + y * 7) % shades.length];
        ctx.fillStyle = shade;
        ctx.fillRect(p.x, p.y, ts + 0.6, ts + 0.6);

        if (terrain === "grass" && ((x + y) & 3) === 0) {
          ctx.fillStyle = "rgba(255,255,255,0.03)";
          ctx.fillRect(p.x + ts * 0.2, p.y + ts * 0.3, ts * 0.2, ts * 0.15);
        }

        if (terrain === "water") {
          const wave = Math.sin(t * 2 + x * 0.7 + y * 0.5) * 0.5 + 0.5;
          ctx.fillStyle = `rgba(180,220,240,${0.06 + wave * 0.08})`;
          ctx.fillRect(p.x, p.y + ts * 0.3, ts, ts * 0.25);
        }

        if (terrain === "lava") {
          const pulse = Math.sin(t * 5 + x + y) * 0.5 + 0.5;
          ctx.fillStyle = `rgba(255,200,80,${0.15 + pulse * 0.25})`;
          ctx.fillRect(p.x + ts * 0.2, p.y + ts * 0.25, ts * 0.55, ts * 0.4);
        }

        if (terrain === "mountain") {
          ctx.fillStyle = "rgba(255,255,255,0.08)";
          ctx.beginPath();
          ctx.moveTo(p.x + ts * 0.15, p.y + ts * 0.75);
          ctx.lineTo(p.x + ts * 0.45, p.y + ts * 0.2);
          ctx.lineTo(p.x + ts * 0.85, p.y + ts * 0.75);
          ctx.fill();
        }

        drawResource(ctx, game.world.resources[y][x], p.x, p.y, ts, t, x, y);
        drawBuilding(ctx, game.world.buildings[y][x], p.x, p.y, ts, t);

        const fire = game.world.fire[y][x];
        if (fire > 0.05) {
          const flicker = 0.5 + Math.sin(t * 12 + x * 2 + y) * 0.5;
          ctx.fillStyle = `rgba(255,${120 + flicker * 80 | 0},40,${0.25 + fire * 0.45})`;
          ctx.beginPath();
          ctx.ellipse(p.x + ts * 0.5, p.y + ts * 0.55, ts * 0.22 * fire, ts * 0.3 * fire, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    for (const job of game.jobs) {
      if (job.type === "wander" || job.type === "sleep") continue;
      const p = worldToScreen(job.x + 0.5, job.y + 0.15);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = "rgba(224,160,69,0.9)";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(5, -10);
      ctx.lineTo(-5, -10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Brush / build preview
    if (game.hoverTile && (isBuildTool(game.tool) || BRUSH_TOOLS.has(game.tool) || isPowerTool(game.tool))) {
      const r = BRUSH_TOOLS.has(game.tool) ? (game.brushSize || 1) : (game.tool === "meteor" || game.tool === "bomb" ? 2 : 0);
      for (let y = game.hoverTile.y - r; y <= game.hoverTile.y + r; y++) {
        for (let x = game.hoverTile.x - r; x <= game.hoverTile.x + r; x++) {
          if ((x - game.hoverTile.x) ** 2 + (y - game.hoverTile.y) ** 2 > r * r + 0.2) continue;
          const p = worldToScreen(x, y);
          ctx.fillStyle = game.hoverValid ? "rgba(111,173,120,0.22)" : "rgba(211,107,79,0.22)";
          if (game.tool.includes("lava") || game.tool === "meteor" || game.tool === "fire" || game.tool === "bomb") {
            ctx.fillStyle = "rgba(224,100,40,0.28)";
          }
          ctx.fillRect(p.x, p.y, ts, ts);
        }
      }
    }

    for (const c of game.creatures) {
      if (c.dead && c.looted) continue;
      drawCreature(ctx, c, worldToScreen(c.x, c.y), cam.zoom, game.selectedCreature?.id === c.id, t);
    }

    for (const s of game.settlers) {
      if (s.state === "die") continue;
      drawSettler(ctx, s, worldToScreen(s.x, s.y), cam.zoom, game.selected?.id === s.id);
    }

    for (const tw of game.tornadoes || []) {
      drawTornado(ctx, worldToScreen(tw.x, tw.y), cam.zoom, t, tw);
    }

    drawFx(ctx, game, worldToScreen, cam.zoom, t);

    // Weather rain overlay
    if (game.weather && (game.weather.kind === "rain" || game.weather.kind === "storm")) {
      const inten = game.weather.intensity || 0.5;
      ctx.fillStyle = `rgba(40, 70, 95, ${0.08 + inten * 0.12})`;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = `rgba(180, 210, 230, ${0.25 + inten * 0.35})`;
      ctx.lineWidth = 1;
      const drops = game.weather.kind === "storm" ? 55 : 32;
      for (let i = 0; i < drops; i++) {
        const seed = (i * 97 + (t * (40 + inten * 40)) | 0);
        const dx = (seed * 13) % w;
        const dy = (seed * 29 + i * 17) % h;
        ctx.beginPath();
        ctx.moveTo(dx, dy);
        ctx.lineTo(dx + (game.weather.kind === "storm" ? 4 : 1), dy + 8 + inten * 6);
        ctx.stroke();
      }
    }

    const night =
      day < 0.18 ? 1 - day / 0.18 :
      day > 0.88 ? (day - 0.88) / 0.12 :
      day > 0.78 ? (day - 0.78) / 0.1 * 0.55 : 0;
    if (night > 0) {
      ctx.fillStyle = `rgba(8, 14, 22, ${0.15 + night * 0.45})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          const b = game.world.buildings[y][x];
          const lit = (b?.done && b.type === "hut") || game.world.fire[y][x] > 0.3 || game.world.terrain[y][x] === "lava";
          if (!lit) continue;
          const p = worldToScreen(x + 0.5, y + 0.5);
          const rad = (game.world.terrain[y][x] === "lava" ? 40 : 55) * cam.zoom;
          const lg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
          lg.addColorStop(0, `rgba(224,160,69,${0.22 * night})`);
          lg.addColorStop(1, "rgba(224,160,69,0)");
          ctx.fillStyle = lg;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "source-over";
    }

    if (game.selectedBuilding && game.selectedBuilding.x != null) {
      const b = game.selectedBuilding;
      const p = worldToScreen(b.x, b.y);
      ctx.strokeStyle = "rgba(240,194,122,0.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x + 2, p.y + 2, ts - 4, ts - 4);
    }
  }

  return { cam, resize, draw, worldToScreen, screenToWorld };
}

function isBuildTool(tool) {
  return ["hut", "farm", "stockpile", "wall", "gate", "tower", "barracks"].includes(tool);
}

function isPowerTool(tool) {
  return [
    "lightning", "meteor", "bomb", "tornado", "death",
    "spawn_human", "spawn_rabbit", "spawn_wolf", "spawn_bandit", "spawn_army",
  ].includes(tool);
}

function drawResource(ctx, cell, x, y, ts, t, tx, ty) {
  if (!cell?.kind) return;
  if (cell.kind === "tree") {
    const sway = Math.sin(t * 1.4 + tx * 0.3 + ty) * 1.5;
    ctx.fillStyle = "#5a3a22";
    ctx.fillRect(x + ts * 0.45, y + ts * 0.48, ts * 0.12, ts * 0.38);
    ctx.fillStyle = "#2f6a3d";
    ctx.beginPath();
    ctx.ellipse(x + ts * 0.5 + sway, y + ts * 0.42, ts * 0.28, ts * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3f8550";
    ctx.beginPath();
    ctx.ellipse(x + ts * 0.42 + sway, y + ts * 0.34, ts * 0.2, ts * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (cell.kind === "bush") {
    ctx.fillStyle = "#3d6e3a";
    ctx.beginPath();
    ctx.ellipse(x + ts * 0.5, y + ts * 0.62, ts * 0.28, ts * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c45a7a";
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(x + ts * (0.35 + i * 0.14), y + ts * 0.55, ts * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (cell.kind === "rock") {
    ctx.fillStyle = "#7d8790";
    ctx.beginPath();
    ctx.moveTo(x + ts * 0.25, y + ts * 0.7);
    ctx.lineTo(x + ts * 0.35, y + ts * 0.4);
    ctx.lineTo(x + ts * 0.7, y + ts * 0.38);
    ctx.lineTo(x + ts * 0.82, y + ts * 0.68);
    ctx.closePath();
    ctx.fill();
  }
}

function drawBuilding(ctx, b, x, y, ts) {
  if (!b) return;
  const alpha = b.done ? 1 : 0.45 + b.progress * 0.55;
  ctx.save();
  ctx.globalAlpha = alpha;

  if (b.type === "hut") {
    ctx.fillStyle = "#8a5a36";
    ctx.fillRect(x + ts * 0.2, y + ts * 0.45, ts * 0.6, ts * 0.4);
    ctx.fillStyle = "#b24a3a";
    ctx.beginPath();
    ctx.moveTo(x + ts * 0.12, y + ts * 0.48);
    ctx.lineTo(x + ts * 0.5, y + ts * 0.18);
    ctx.lineTo(x + ts * 0.88, y + ts * 0.48);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f0c27a";
    ctx.fillRect(x + ts * 0.42, y + ts * 0.58, ts * 0.16, ts * 0.2);
  } else if (b.type === "farm") {
    ctx.fillStyle = "#6a4a2a";
    ctx.fillRect(x + ts * 0.12, y + ts * 0.18, ts * 0.76, ts * 0.64);
    const g = b.growth ?? 0;
    ctx.fillStyle = g >= 1 ? "#8fbf4a" : `rgb(${70 + g * 40}, ${90 + g * 80}, 40)`;
    for (let row = 0; row < 3; row++) {
      ctx.fillRect(x + ts * 0.2, y + ts * (0.28 + row * 0.18), ts * 0.6, ts * 0.08);
    }
  } else if (b.type === "stockpile") {
    ctx.fillStyle = "#5c6670";
    ctx.fillRect(x + ts * 0.18, y + ts * 0.35, ts * 0.64, ts * 0.42);
    ctx.fillStyle = "#8a949e";
    ctx.fillRect(x + ts * 0.18, y + ts * 0.3, ts * 0.64, ts * 0.1);
  } else if (b.type === "wall") {
    ctx.fillStyle = "#6a7178";
    ctx.fillRect(x + ts * 0.12, y + ts * 0.2, ts * 0.76, ts * 0.62);
    ctx.fillStyle = "#8a929a";
    ctx.fillRect(x + ts * 0.12, y + ts * 0.2, ts * 0.76, ts * 0.12);
  } else if (b.type === "gate") {
    ctx.fillStyle = "#6a7178";
    ctx.fillRect(x + ts * 0.1, y + ts * 0.15, ts * 0.22, ts * 0.7);
    ctx.fillRect(x + ts * 0.68, y + ts * 0.15, ts * 0.22, ts * 0.7);
    ctx.fillStyle = "#8a5a36";
    ctx.fillRect(x + ts * 0.32, y + ts * 0.28, ts * 0.36, ts * 0.5);
  } else if (b.type === "tower") {
    ctx.fillStyle = "#5c6570";
    ctx.fillRect(x + ts * 0.28, y + ts * 0.35, ts * 0.44, ts * 0.5);
    ctx.fillStyle = "#b24a3a";
    ctx.beginPath();
    ctx.moveTo(x + ts * 0.18, y + ts * 0.38);
    ctx.lineTo(x + ts * 0.5, y + ts * 0.1);
    ctx.lineTo(x + ts * 0.82, y + ts * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f0c27a";
    ctx.fillRect(x + ts * 0.42, y + ts * 0.48, ts * 0.16, ts * 0.14);
  } else if (b.type === "barracks") {
    ctx.fillStyle = "#5a4030";
    ctx.fillRect(x + ts * 0.14, y + ts * 0.32, ts * 0.72, ts * 0.5);
    ctx.fillStyle = "#3d4a38";
    ctx.fillRect(x + ts * 0.14, y + ts * 0.22, ts * 0.72, ts * 0.14);
    ctx.fillStyle = "#c45a4a";
    ctx.fillRect(x + ts * 0.4, y + ts * 0.08, ts * 0.08, ts * 0.18);
  }

  // HP chip for damaged military buildings
  if (b.done && b.hp != null && b.hp < (b.type === "wall" ? 80 : 200)) {
    const max = b.type === "wall" ? 80 : b.type === "tower" ? 120 : b.type === "gate" ? 100 : b.type === "barracks" ? 140 : 90;
    if (b.hp < max * 0.95) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(x + ts * 0.15, y + ts * 0.05, ts * 0.7, 3);
      ctx.fillStyle = "#d36b4f";
      ctx.fillRect(x + ts * 0.15, y + ts * 0.05, ts * 0.7 * Math.max(0, b.hp / max), 3);
    }
  }

  if (!b.done) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x + ts * 0.15, y + ts * 0.08, ts * 0.7, ts * 0.1);
    ctx.fillStyle = "#e0a045";
    ctx.fillRect(x + ts * 0.15, y + ts * 0.08, ts * 0.7 * b.progress, ts * 0.1);
  }
  ctx.restore();
}

function drawSettler(ctx, s, p, zoom, selected) {
  const scale = 0.9 * zoom;
  const bob = Math.sin(s.bob) * 1.6 * zoom;
  ctx.save();
  ctx.translate(p.x, p.y + bob);

  if (selected) {
    ctx.strokeStyle = "rgba(240,194,122,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 8 * scale, 10 * scale, 4 * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 9 * scale, 7 * scale, 2.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  const cloth = s.life?.clothing || "plain";
  const body = cloth === "fur" ? "#6a4a32"
    : cloth === "cloak" ? "#3d4f5c"
    : cloth === "light" ? `hsl(${s.hue} 38% 55%)`
    : cloth === "vest" ? "#4a5a3a"
    : `hsl(${s.hue} 42% 42%)`;
  const stride = Math.sin(s.bob * 1.4) * (s.state === "walk" ? 3 : 0.5) * scale;
  ctx.strokeStyle = "#2a3038";
  ctx.lineWidth = 2.2 * scale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-2 * scale, 2 * scale);
  ctx.lineTo(-2 * scale + stride, 9 * scale);
  ctx.moveTo(2 * scale, 2 * scale);
  ctx.lineTo(2 * scale - stride, 9 * scale);
  ctx.stroke();

  ctx.fillStyle = body;
  roundRect(ctx, -5 * scale, -8 * scale, 10 * scale, 12 * scale, 3 * scale);
  ctx.fill();

  // Cloak / fur silhouette
  if (cloth === "cloak" || cloth === "fur") {
    ctx.fillStyle = cloth === "fur" ? "rgba(90,60,40,0.55)" : "rgba(30,45,55,0.5)";
    ctx.beginPath();
    ctx.moveTo(-6 * scale, -6 * scale);
    ctx.lineTo(-8 * scale, 6 * scale);
    ctx.lineTo(8 * scale, 6 * scale);
    ctx.lineTo(6 * scale, -6 * scale);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = "#e7c29a";
  ctx.beginPath();
  ctx.arc(0, -12 * scale, 4.5 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Mood tint on cheeks
  const mood = s.life?.mood ?? 0.5;
  if (mood > 0.65) {
    ctx.fillStyle = "rgba(230,120,120,0.35)";
    ctx.beginPath();
    ctx.arc(-2.2 * scale, -11 * scale, 1.2 * scale, 0, Math.PI * 2);
    ctx.arc(2.2 * scale, -11 * scale, 1.2 * scale, 0, Math.PI * 2);
    ctx.fill();
  } else if ((s.life?.fear || 0) > 0.45) {
    ctx.fillStyle = "rgba(120,160,200,0.35)";
    ctx.beginPath();
    ctx.arc(0, -12 * scale, 4.5 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = `hsl(${(s.hue + 40) % 360} 35% 28%)`;
  ctx.beginPath();
  ctx.arc(0, -14 * scale, 4.2 * scale, Math.PI, 0);
  ctx.fill();

  if (s.state === "work" || s.state === "chat") {
    ctx.fillStyle = s.state === "chat" ? "#9fd49a" : "#e0a045";
    ctx.fillRect(-1 * scale, -22 * scale, 2 * scale, 5 * scale);
  }
  if (s.state === "sleep") {
    ctx.fillStyle = "rgba(180,210,255,0.85)";
    ctx.font = `${10 * scale}px Figtree, sans-serif`;
    ctx.fillText("z", 8 * scale, -14 * scale);
  }
  if (s.military) {
    ctx.fillStyle = "#d36b4f";
    ctx.beginPath();
    ctx.moveTo(-7 * scale, -18 * scale);
    ctx.lineTo(-3 * scale, -22 * scale);
    ctx.lineTo(1 * scale, -18 * scale);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawCreature(ctx, c, p, zoom, selected, t) {
  const scale = zoom * (c.kind === "rabbit" ? 0.7 : 0.95);
  const bob = Math.sin(c.bob) * 1.2 * zoom;
  ctx.save();
  ctx.translate(p.x, p.y + bob);

  if (selected) {
    ctx.strokeStyle = "rgba(240,194,122,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 6 * scale, 9 * scale, 3.5 * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(0, 7 * scale, 6 * scale, 2 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  if (c.dead) {
    ctx.globalAlpha = 0.45;
  }

  if (c.kind === "rabbit") {
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 5 * scale, 3.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-2.5 * scale, -8 * scale, 1.5 * scale, 6 * scale);
    ctx.fillRect(1 * scale, -8 * scale, 1.5 * scale, 6 * scale);
  } else if (c.kind === "wolf") {
    ctx.fillStyle = c.color;
    roundRect(ctx, -7 * scale, -4 * scale, 14 * scale, 8 * scale, 3 * scale);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6 * scale, -2 * scale);
    ctx.lineTo(11 * scale, 0);
    ctx.lineTo(6 * scale, 2 * scale);
    ctx.fill();
    ctx.fillStyle = "#3a3f48";
    ctx.beginPath();
    ctx.moveTo(-4 * scale, -4 * scale);
    ctx.lineTo(-2 * scale, -9 * scale);
    ctx.lineTo(0, -4 * scale);
    ctx.fill();
  } else if (c.kind === "bandit" || c.kind === "soldier") {
    ctx.fillStyle = c.color;
    roundRect(ctx, -5 * scale, -7 * scale, 10 * scale, 12 * scale, 2 * scale);
    ctx.fill();
    ctx.fillStyle = "#e7c29a";
    ctx.beginPath();
    ctx.arc(0, -11 * scale, 4 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.kind === "soldier" ? "#2a1a20" : "#2a3038";
    ctx.fillRect(-6 * scale, -14 * scale, 12 * scale, 3 * scale);
    if (c.kind === "soldier") {
      // spear
      ctx.strokeStyle = "#c0c6cc";
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      ctx.moveTo(6 * scale, -6 * scale);
      ctx.lineTo(12 * scale, -16 * scale);
      ctx.stroke();
    }
  }

  // hp bar for damaged hostiles
  if (!c.dead && c.hp < c.maxHp) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(-8 * scale, -16 * scale, 16 * scale, 3 * scale);
    ctx.fillStyle = "#d36b4f";
    ctx.fillRect(-8 * scale, -16 * scale, 16 * scale * (c.hp / c.maxHp), 3 * scale);
  }

  ctx.restore();
}

function drawTornado(ctx, p, zoom, t, tw) {
  ctx.save();
  ctx.translate(p.x, p.y);
  for (let i = 0; i < 5; i++) {
    const a = t * 6 + i + tw.angle;
    const rr = (4 + i * 3) * zoom;
    ctx.strokeStyle = `rgba(200,210,220,${0.35 - i * 0.05})`;
    ctx.lineWidth = 2 * zoom;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * 2, -i * 5 * zoom, rr, rr * 0.45, a, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFx(ctx, game, worldToScreen, zoom, t) {
  for (const fx of game.fx || []) {
    const p = worldToScreen(fx.x, fx.y);
    const k = fx.life / fx.max;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (fx.kind === "lightning") {
      ctx.strokeStyle = `rgba(220,240,255,${k})`;
      ctx.lineWidth = 2.5 * zoom;
      ctx.beginPath();
      ctx.moveTo(0, -80 * zoom * k);
      ctx.lineTo(6 * zoom, -40 * zoom);
      ctx.lineTo(-4 * zoom, -20 * zoom);
      ctx.lineTo(0, 0);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${0.35 * k})`;
      ctx.beginPath();
      ctx.arc(0, 0, 18 * zoom * k, 0, Math.PI * 2);
      ctx.fill();
    } else if (fx.kind === "meteor" || fx.kind === "bomb") {
      ctx.fillStyle = `rgba(255,140,40,${0.55 * k})`;
      ctx.beginPath();
      ctx.arc(0, 0, 28 * zoom * (1.2 - k * 0.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,220,120,${0.4 * k})`;
      ctx.beginPath();
      ctx.arc(0, 0, 12 * zoom, 0, Math.PI * 2);
      ctx.fill();
    } else if (fx.kind === "spark") {
      ctx.fillStyle = `rgba(255,180,60,${k})`;
      ctx.fillRect(-2 * zoom, -2 * zoom, 4 * zoom, 4 * zoom);
    } else if (fx.kind === "raindrop") {
      ctx.strokeStyle = `rgba(140,190,230,${k})`;
      ctx.beginPath();
      ctx.moveTo(0, -8 * zoom);
      ctx.lineTo(0, 0);
      ctx.stroke();
    } else if (fx.kind === "bless" || fx.kind === "spawn") {
      ctx.strokeStyle = `rgba(180,230,160,${k})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 14 * zoom * (1.3 - k), 0, Math.PI * 2);
      ctx.stroke();
    } else if (fx.kind === "death") {
      ctx.fillStyle = `rgba(40,20,40,${0.5 * k})`;
      ctx.beginPath();
      ctx.arc(0, 0, 16 * zoom, 0, Math.PI * 2);
      ctx.fill();
    } else if (fx.kind === "tornado") {
      ctx.strokeStyle = `rgba(200,210,220,${0.3 * k})`;
      ctx.beginPath();
      ctx.arc(0, 0, 10 * zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function lerpColor(a, b, t) {
  if (!b || t <= 0) return a;
  if (t >= 1) return b;
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = (pa.r + (pb.r - pa.r) * t) | 0;
  const g = (pa.g + (pb.g - pa.g) * t) | 0;
  const bl = (pa.b + (pb.b - pa.b) * t) | 0;
  return `rgb(${r},${g},${bl})`;
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
