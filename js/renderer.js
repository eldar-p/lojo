import { MAP_H, MAP_W, TILE } from "./config.js";

const TERRAIN = {
  grass: ["#3f6b49", "#466f4f", "#3a6344"],
  dirt: ["#6a5238", "#735a3e", "#614a32"],
  sand: ["#c2a66e", "#b99a60", "#cbb27a"],
  water: ["#2f5f78", "#356782", "#2a556c"],
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

    // Atmosphere backdrop
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
        const shades = TERRAIN[terrain];
        const shade = shades[(x * 3 + y * 7) % shades.length];
        ctx.fillStyle = shade;
        ctx.fillRect(p.x, p.y, ts + 0.6, ts + 0.6);

        // Subtle tile variation
        if (terrain === "grass" && ((x + y) & 3) === 0) {
          ctx.fillStyle = "rgba(255,255,255,0.03)";
          ctx.fillRect(p.x + ts * 0.2, p.y + ts * 0.3, ts * 0.2, ts * 0.15);
        }

        if (terrain === "water") {
          const wave = Math.sin(t * 2 + x * 0.7 + y * 0.5) * 0.5 + 0.5;
          ctx.fillStyle = `rgba(180,220,240,${0.06 + wave * 0.08})`;
          ctx.fillRect(p.x, p.y + ts * 0.3, ts, ts * 0.25);
        }

        drawResource(ctx, game.world.resources[y][x], p.x, p.y, ts, t, x, y);
        drawBuilding(ctx, game.world.buildings[y][x], p.x, p.y, ts, t);
      }
    }

    // Job markers
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

    // Ghost preview
    if (game.hoverTile && isBuildTool(game.tool)) {
      const p = worldToScreen(game.hoverTile.x, game.hoverTile.y);
      ctx.fillStyle = game.hoverValid ? "rgba(111,173,120,0.35)" : "rgba(211,107,79,0.35)";
      ctx.fillRect(p.x, p.y, ts, ts);
      ctx.strokeStyle = game.hoverValid ? "rgba(159,212,154,0.8)" : "rgba(211,107,79,0.8)";
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x + 1, p.y + 1, ts - 2, ts - 2);
    }

    // Settlers
    for (const s of game.settlers) {
      if (s.state === "die") continue;
      drawSettler(ctx, s, worldToScreen(s.x, s.y), cam.zoom, game.selected?.id === s.id);
    }

    // Night veil
    const night =
      day < 0.18 ? 1 - day / 0.18 :
      day > 0.88 ? (day - 0.88) / 0.12 :
      day > 0.78 ? (day - 0.78) / 0.1 * 0.55 : 0;
    if (night > 0) {
      ctx.fillStyle = `rgba(8, 14, 22, ${0.15 + night * 0.45})`;
      ctx.fillRect(0, 0, w, h);
      // Soft lantern glow near huts and settlers
      ctx.globalCompositeOperation = "lighter";
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          const b = game.world.buildings[y][x];
          if (b?.done && b.type === "hut") {
            const p = worldToScreen(x + 0.5, y + 0.5);
            const rad = 55 * cam.zoom;
            const lg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
            lg.addColorStop(0, `rgba(224,160,69,${0.22 * night})`);
            lg.addColorStop(1, "rgba(224,160,69,0)");
            ctx.fillStyle = lg;
            ctx.beginPath();
            ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // Selection ring for buildings
    if (game.selectedBuilding) {
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
  return tool === "hut" || tool === "farm" || tool === "stockpile";
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
    ctx.fillStyle = "#9aa3ab";
    ctx.beginPath();
    ctx.moveTo(x + ts * 0.35, y + ts * 0.4);
    ctx.lineTo(x + ts * 0.55, y + ts * 0.45);
    ctx.lineTo(x + ts * 0.48, y + ts * 0.68);
    ctx.lineTo(x + ts * 0.28, y + ts * 0.65);
    ctx.closePath();
    ctx.fill();
  }
}

function drawBuilding(ctx, b, x, y, ts, t) {
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
    ctx.fillStyle = "#c4894a";
    ctx.fillRect(x + ts * 0.28, y + ts * 0.48, ts * 0.18, ts * 0.16);
    ctx.fillStyle = "#c45a7a";
    ctx.beginPath();
    ctx.arc(x + ts * 0.62, y + ts * 0.58, ts * 0.08, 0, Math.PI * 2);
    ctx.fill();
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

  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 9 * scale, 7 * scale, 2.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  const body = `hsl(${s.hue} 42% 42%)`;
  const skin = "#e7c29a";

  // legs
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

  // body
  ctx.fillStyle = body;
  roundRect(ctx, -5 * scale, -8 * scale, 10 * scale, 12 * scale, 3 * scale);
  ctx.fill();

  // head
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(0, -12 * scale, 4.5 * scale, 0, Math.PI * 2);
  ctx.fill();

  // hair
  ctx.fillStyle = `hsl(${(s.hue + 40) % 360} 35% 28%)`;
  ctx.beginPath();
  ctx.arc(0, -14 * scale, 4.2 * scale, Math.PI, 0);
  ctx.fill();

  // work indicator
  if (s.state === "work") {
    ctx.fillStyle = "#e0a045";
    ctx.fillRect(-1 * scale, -22 * scale, 2 * scale, 5 * scale);
  }
  if (s.state === "sleep") {
    ctx.fillStyle = "rgba(180,210,255,0.85)";
    ctx.font = `${10 * scale}px Figtree, sans-serif`;
    ctx.fillText("z", 8 * scale, -14 * scale);
  }

  ctx.restore();
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
