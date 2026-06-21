'use strict';

const { Canvas } = require('skia-canvas');

function fmtCoins(n) {
  if (n == null) return '0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000_000) return (n / 1_000_000_000_000_000).toFixed(2) + 'Qd';
  if (abs >= 1_000_000_000_000) return (n / 1_000_000_000_000).toFixed(2) + 'Td';
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'Bd';
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

const W = 800;
const COLS = 5;
const LANES = 8;
const COL_W = 120;
const LANE_H = 64;
const ROAD_W = COLS * COL_W;
const ROAD_X = (W - ROAD_W) / 2;

const DIFFS = {
  easy:   { accent: '#57F287', label: 'EASY',   cars: 1, mult: 1.4, color: 0x57F287 },
  medium: { accent: '#F1C40F', label: 'MEDIUM', cars: 2, mult: 1.7, color: 0xF1C40F },
  hard:   { accent: '#ED4245', label: 'HARD',   cars: 2, mult: 2.2, color: 0xED4245, cols: 4 },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawSparkle(ctx, x, y, size, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - size, y); ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size); ctx.lineTo(x, y + size);
  ctx.moveTo(x - size * 0.6, y - size * 0.6); ctx.lineTo(x + size * 0.6, y + size * 0.6);
  ctx.moveTo(x - size * 0.6, y + size * 0.6); ctx.lineTo(x + size * 0.6, y - size * 0.6);
  ctx.stroke();
  ctx.restore();
}

function drawStar(ctx, x, y, size, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 2 * Math.PI / 5) - Math.PI / 2;
    const px = x + Math.cos(angle) * size;
    const py = y + Math.sin(angle) * size;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    const angle2 = angle + Math.PI / 5;
    ctx.lineTo(x + Math.cos(angle2) * size * 0.4, y + Math.sin(angle2) * size * 0.4);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCoin(ctx, x, y, size, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const grad = ctx.createRadialGradient(x - size * 0.3, y - size * 0.3, size * 0.1, x, y, size);
  grad.addColorStop(0, '#FFE066');
  grad.addColorStop(0.6, '#FFD700');
  grad.addColorStop(1, '#B8860B');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#B8860B';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = '#B8860B';
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', x, y + 1);
  ctx.restore();
}

function drawCornerOrnaments(ctx, W, H, color, alpha = 0.12) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  const cs = 24;
  const m = 12;
  ctx.beginPath(); ctx.moveTo(m, m + cs); ctx.lineTo(m, m); ctx.lineTo(m + cs, m); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - m - cs, m); ctx.lineTo(W - m, m); ctx.lineTo(W - m, m + cs); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(m, H - m - cs); ctx.lineTo(m, H - m); ctx.lineTo(m + cs, H - m); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - m - cs, H - m); ctx.lineTo(W - m, H - m); ctx.lineTo(W - m, H - m - cs); ctx.stroke();
  ctx.restore();
}

function laneMultVal(diffKey, lane) {
  const base = DIFFS[diffKey]?.mult || 1.7;
  return parseFloat(Math.pow(base, lane).toFixed(2));
}

function laneMultDisplay(diffKey, lane) {
  return laneMultVal(diffKey, lane).toFixed(2);
}

function pickCars(numCols, numCars) {
  const cars = new Set();
  const dirs = {};
  while (cars.size < numCars) {
    const c = Math.floor(Math.random() * numCols);
    cars.add(c);
    dirs[c] = Math.random() > 0.5 ? 1 : -1;
  }
  return { positions: cars, dirs };
}

const CAR_COLORS = ['#E74C3C', '#3498DB', '#F39C12', '#9B59B6', '#1ABC9C', '#E67E22', '#2ECC71', '#E91E63', '#00BCD4', '#FF5722'];

function drawCar(ctx, col, lane, laneY, direction, crashed, numCols) {
  const cx = ROAD_X + col * COL_W + COL_W / 2;
  const cy = laneY + LANE_H / 2;
  const cw = COL_W - 22;
  const ch = LANE_H - 18;
  const x = cx - cw / 2;
  const y = cy - ch / 2;
  const color = CAR_COLORS[(col + lane * 3) % CAR_COLORS.length];

  ctx.save();
  if (!crashed) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
  }

  if (direction < 0) {
    ctx.translate(cx, cy);
    ctx.scale(-1, 1);
    ctx.translate(-cx, -cy);
  }

  const bodyGrad = ctx.createLinearGradient(x, y, x, y + ch);
  bodyGrad.addColorStop(0, color);
  bodyGrad.addColorStop(0.4, color);
  bodyGrad.addColorStop(1, '#1a1a2e');
  ctx.fillStyle = crashed ? '#444' : bodyGrad;
  roundRect(ctx, x, y, cw, ch, 8);
  ctx.fill();

  ctx.strokeStyle = crashed ? '#222' : 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, cw, ch, 8);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  if (direction < 0) {
    ctx.translate(cx, cy);
    ctx.scale(-1, 1);
    ctx.translate(-cx, -cy);
  }

  ctx.fillStyle = crashed ? 'rgba(80,80,80,0.3)' : 'rgba(100,180,255,0.35)';
  roundRect(ctx, x + cw * 0.18, y + ch * 0.12, cw * 0.5, ch * 0.38, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 0.8;
  roundRect(ctx, x + cw * 0.18, y + ch * 0.12, cw * 0.5, ch * 0.38, 4);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(x + cw * 0.18, y + ch * 0.5);
  ctx.lineTo(x + cw * 0.68, y + ch * 0.5);
  ctx.stroke();

  if (!crashed) {
    ctx.fillStyle = '#FFD700';
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(x + cw * 0.9, y + ch * 0.25, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + cw * 0.9, y + ch * 0.75, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(255,255,200,0.2)';
    ctx.beginPath();
    ctx.moveTo(x + cw, y + ch * 0.25);
    ctx.lineTo(x + cw + 12, y + ch * 0.15);
    ctx.lineTo(x + cw + 12, y + ch * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + cw, y + ch * 0.75);
    ctx.lineTo(x + cw + 12, y + ch * 0.65);
    ctx.lineTo(x + cw + 12, y + ch * 0.85);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#FF1744';
    ctx.beginPath();
    ctx.arc(x + cw * 0.1, y + ch * 0.25, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + cw * 0.1, y + ch * 0.75, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = '#0a0a1a';
  ctx.beginPath();
  ctx.arc(x + cw * 0.22, y + ch * 0.95, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + cw * 0.78, y + ch * 0.95, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x + cw * 0.22, y + ch * 0.95, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + cw * 0.78, y + ch * 0.95, 4, 0, Math.PI * 2);
  ctx.stroke();

  if (!crashed) {
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x + cw * 0.3, y + 2, cw * 0.12, ch - 4, 2);
    ctx.fill();
    ctx.restore();
  }

  if (crashed) {
    ctx.save();
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    const s = 10;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
    ctx.moveTo(cx - s, cy + s); ctx.lineTo(cx + s, cy - s);
    ctx.moveTo(cx - s * 1.4, cy); ctx.lineTo(cx + s * 1.4, cy);
    ctx.moveTo(cx, cy - s * 1.4); ctx.lineTo(cx, cy + s * 1.4);
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < 5; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 12;
      const px = cx + Math.cos(ang) * dist;
      const py = cy + Math.sin(ang) * dist;
      ctx.save();
      ctx.globalAlpha = 0.3 + Math.random() * 0.2;
      ctx.fillStyle = '#FF6347';
      ctx.beginPath();
      ctx.arc(px, py, 1 + Math.random() * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawChicken(ctx, col, laneY, size, accent, moving, numCols) {
  const cx = ROAD_X + col * COL_W + COL_W / 2;
  const cy = laneY + LANE_H / 2;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.55, size * 0.65, size * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = moving ? 18 : 10;

  const bodyGrad = ctx.createRadialGradient(cx - size * 0.25, cy - size * 0.25, size * 0.1, cx, cy, size * 1.1);
  bodyGrad.addColorStop(0, '#FFFDE7');
  bodyGrad.addColorStop(0.5, '#FFF8DC');
  bodyGrad.addColorStop(1, '#F0E68C');
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.12, size * 0.6, size * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = '#DAA520';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.12, size * 0.6, size * 0.55, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(cx - size * 0.2, cy - size * 0.05, size * 0.15, size * 0.25, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const headGrad = ctx.createRadialGradient(cx - size * 0.1, cy - size * 0.4, size * 0.05, cx, cy - size * 0.35, size * 0.35);
  headGrad.addColorStop(0, '#FFFDE7');
  headGrad.addColorStop(1, '#FF4500');
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.38, size * 0.32, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#CC3700';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.38, size * 0.32, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#FF4500';
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.14, cy - size * 0.6);
  ctx.quadraticCurveTo(cx, cy - size * 0.7, cx + size * 0.14, cy - size * 0.6);
  ctx.lineTo(cx + size * 0.1, cy - size * 0.48);
  ctx.quadraticCurveTo(cx, cy - size * 0.42, cx - size * 0.1, cy - size * 0.48);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#CC3700';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(cx - size * 0.12, cy - size * 0.42, size * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + size * 0.12, cy - size * 0.42, size * 0.06, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx - size * 0.1, cy - size * 0.44, size * 0.02, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + size * 0.14, cy - size * 0.44, size * 0.02, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#FFA500';
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.3);
  ctx.lineTo(cx + size * 0.18, cy - size * 0.24);
  ctx.lineTo(cx + size * 0.12, cy - size * 0.18);
  ctx.lineTo(cx, cy - size * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#CC8400';
  ctx.lineWidth = 0.6;
  ctx.stroke();

  ctx.strokeStyle = '#FFA500';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.22, cy + size * 0.5);
  ctx.lineTo(cx - size * 0.22, cy + size * 0.68);
  ctx.moveTo(cx + size * 0.22, cy + size * 0.5);
  ctx.lineTo(cx + size * 0.22, cy + size * 0.68);
  ctx.stroke();

  ctx.fillStyle = '#FFA500';
  ctx.beginPath();
  ctx.arc(cx - size * 0.22, cy + size * 0.7, size * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + size * 0.22, cy + size * 0.7, size * 0.06, 0, Math.PI * 2);
  ctx.fill();

  if (moving) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const off = (i + 1) * 6;
      const yOff = (i - 1.5) * 5;
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.55 - off, cy + yOff);
      ctx.lineTo(cx - size * 0.55 - off - 8, cy + yOff);
      ctx.stroke();
    }

    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = accent;
    for (let i = 0; i < 3; i++) {
      const px = cx - size * 0.8 - 10 - i * 8;
      const py = cy + (Math.random() - 0.5) * size * 0.4;
      ctx.beginPath();
      ctx.arc(px, py, 1.5 + Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.restore();
}

function drawTree(ctx, x, y, s) {
  ctx.save();
  ctx.fillStyle = '#3a2510';
  ctx.fillRect(x - s * 0.1, y, s * 0.2, s * 0.4);

  ctx.fillStyle = '#2a2510';
  ctx.fillRect(x - s * 0.08, y + s * 0.1, s * 0.16, s * 0.3);

  const g = ctx.createRadialGradient(x - s * 0.1, y - s * 0.15, s * 0.1, x, y - s * 0.1, s * 0.5);
  g.addColorStop(0, '#4a8a2a');
  g.addColorStop(0.5, '#2a6a1a');
  g.addColorStop(1, '#0a3a0a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y - s * 0.1, s * 0.42, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#3a7a1a';
  ctx.beginPath();
  ctx.arc(x - s * 0.2, y - s * 0.25, s * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + s * 0.18, y - s * 0.05, s * 0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(87,242,135,0.2)';
  ctx.beginPath();
  ctx.arc(x - s * 0.15, y - s * 0.3, s * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBush(ctx, x, y, s) {
  ctx.save();
  const g = ctx.createRadialGradient(x - s * 0.25, y - s * 0.25, s * 0.1, x, y, s * 0.6);
  g.addColorStop(0, '#3a6a1a');
  g.addColorStop(0.6, '#1a4a0a');
  g.addColorStop(1, '#0a2a0a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, s, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(87,242,135,0.15)';
  ctx.beginPath();
  ctx.arc(x - s * 0.3, y - s * 0.3, s * 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFlower(ctx, x, y, s, color) {
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * s * 0.5, y + Math.sin(angle) * s * 0.5, s * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  ctx.arc(x, y, s * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRock(ctx, x, y, s) {
  ctx.save();
  const g = ctx.createRadialGradient(x - s * 0.3, y - s * 0.3, s * 0.1, x, y, s);
  g.addColorStop(0, '#666');
  g.addColorStop(1, '#333');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, s, s * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTrafficLight(ctx, x, y, isRed) {
  ctx.save();
  ctx.fillStyle = '#1a1a2e';
  roundRect(ctx, x - 8, y - 20, 16, 40, 4);
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  roundRect(ctx, x - 8, y - 20, 16, 40, 4);
  ctx.stroke();

  ctx.fillStyle = isRed ? '#FF1744' : '#3a1a1a';
  if (isRed) { ctx.shadowColor = '#FF1744'; ctx.shadowBlur = 8; }
  ctx.beginPath();
  ctx.arc(x, y - 10, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = !isRed ? '#FFD700' : '#3a3a1a';
  if (!isRed) { ctx.shadowColor = '#FFD700'; ctx.shadowBlur = 8; }
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#1a3a1a';
  ctx.beginPath();
  ctx.arc(x, y + 10, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(x - 2, y + 20, 4, 8);
  ctx.restore();
}

function drawFirework(ctx, x, y, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + 0.3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * size * 0.6, y + Math.sin(angle) * size * 0.6);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSmoke(ctx, x, y, size, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(x, y, 0, x, y, size);
  g.addColorStop(0, 'rgba(100,100,100,0.6)');
  g.addColorStop(1, 'rgba(50,50,50,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTireMark(ctx, x, y, w, h) {
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawCrack(ctx, cx, cy, size) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * size, cy + Math.sin(angle) * size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * size * 0.5, cy + Math.sin(angle) * size * 0.5);
    ctx.lineTo(cx + Math.cos(angle + 0.4) * size * 0.8, cy + Math.sin(angle + 0.4) * size * 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

async function generateChickenImage({
  diffKey, currentLane, chickenCol, allLaneCars, gameOver, won, cashedOut,
  amount, winAmount, netGain, finalCoins, crashedCol, crashedLane
}) {
  const diff = DIFFS[diffKey] || DIFFS.medium;
  const numCols = diff.cols || COLS;
  const accent = gameOver ? (won || cashedOut ? '#57F287' : '#ED4245') : diff.accent;

  const headerH = 70;
  const infoH = 60;
  const roadH = LANES * LANE_H;
  const footerH = 90;
  const H = headerH + infoH + roadH + footerH;

  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');

  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0d1117');
  bgGrad.addColorStop(0.3, '#161b24');
  bgGrad.addColorStop(0.7, '#161b24');
  bgGrad.addColorStop(1, '#0d1117');
  ctx.fillStyle = bgGrad;
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  roundRect(ctx, 1, 1, W - 2, H - 2, 19);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  roundRect(ctx, 5, 5, W - 10, H - 10, 16);
  ctx.stroke();
  ctx.restore();

  drawCornerOrnaments(ctx, W, H, accent, 0.1);

  ctx.save();
  ctx.fillStyle = diff.accent;
  ctx.globalAlpha = 0.06;
  ctx.fillRect(0, 0, W, headerH);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.1;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, headerH);
  ctx.lineTo(W, headerH);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.fillStyle = diff.accent;
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('~ CHICKEN CROSSING', 30, 35);

  ctx.save();
  ctx.fillStyle = diff.accent;
  ctx.globalAlpha = 0.1;
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${diff.label} MODE`, W / 2, 50);
  ctx.restore();

  ctx.fillStyle = '#8b95a7';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`Mise : ${fmtCoins(amount)} coins`, W - 30, 35);

  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(30, headerH);
  ctx.lineTo(W - 30, headerH);
  ctx.stroke();

  const displayLane = gameOver && (won || cashedOut) ? (won ? LANES : currentLane) : (gameOver ? currentLane + 1 : currentLane + 1);
  const displayMult = gameOver && (won || cashedOut) ? (won ? laneMultDisplay(diffKey, LANES) : laneMultDisplay(diffKey, currentLane)) : laneMultDisplay(diffKey, currentLane + 1);
  const potentialWin = Math.floor(amount * (gameOver && (won || cashedOut) ? (won ? laneMultVal(diffKey, LANES) : laneMultVal(diffKey, currentLane)) : laneMultVal(diffKey, currentLane + 1)));

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  roundRect(ctx, 20, headerH + 8, W - 40, infoH - 16, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  roundRect(ctx, 20, headerH + 8, W - 40, infoH - 16, 10);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = diff.accent;
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(diff.label, 35, headerH + infoH / 2);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(100, headerH + 12);
  ctx.lineTo(100, headerH + infoH - 12);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Route ${displayLane}/${LANES}`, W / 2 - 140, headerH + infoH / 2);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 70, headerH + 12);
  ctx.lineTo(W / 2 - 70, headerH + infoH - 12);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = accent;
  ctx.fillText(`x${displayMult}`, W / 2 - 20, headerH + infoH / 2);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2 + 50, headerH + 12);
  ctx.lineTo(W / 2 + 50, headerH + infoH - 12);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${fmtCoins(potentialWin)}`, W / 2 + 120, headerH + infoH / 2);

  ctx.fillStyle = '#555566';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  const maxMult = laneMultVal(diffKey, LANES);
  ctx.fillText(`Max x${maxMult.toFixed(2)}`, W - 35, headerH + infoH / 2);

  const roadStartY = headerH + infoH;

  const grassGrad = ctx.createLinearGradient(0, roadStartY, 0, roadStartY + roadH);
  grassGrad.addColorStop(0, '#1a3a1a');
  grassGrad.addColorStop(0.5, '#152a15');
  grassGrad.addColorStop(1, '#1a3a1a');
  ctx.fillStyle = grassGrad;
  ctx.fillRect(0, roadStartY, ROAD_X, roadH);
  ctx.fillRect(ROAD_X + ROAD_W, roadStartY, W - ROAD_X - ROAD_W, roadH);

  for (let i = 0; i < 20; i++) {
    const px = Math.random() * ROAD_X;
    const py = roadStartY + Math.random() * roadH;
    ctx.save();
    ctx.globalAlpha = 0.1 + Math.random() * 0.1;
    ctx.fillStyle = '#2a5a2a';
    ctx.fillRect(px, py, 2, 4);
    ctx.restore();
  }
  for (let i = 0; i < 20; i++) {
    const px = ROAD_X + ROAD_W + Math.random() * (W - ROAD_X - ROAD_W);
    const py = roadStartY + Math.random() * roadH;
    ctx.save();
    ctx.globalAlpha = 0.1 + Math.random() * 0.1;
    ctx.fillStyle = '#2a5a2a';
    ctx.fillRect(px, py, 2, 4);
    ctx.restore();
  }

  drawTree(ctx, 35, roadStartY + 30, 32);
  drawTree(ctx, 35, roadStartY + roadH / 3, 28);
  drawTree(ctx, 35, roadStartY + roadH * 2 / 3, 30);
  drawTree(ctx, 35, roadStartY + roadH - 30, 32);
  drawTree(ctx, W - 35, roadStartY + 30, 32);
  drawTree(ctx, W - 35, roadStartY + roadH / 3, 28);
  drawTree(ctx, W - 35, roadStartY + roadH * 2 / 3, 30);
  drawTree(ctx, W - 35, roadStartY + roadH - 30, 32);

  drawBush(ctx, 60, roadStartY + roadH / 4, 10);
  drawBush(ctx, 60, roadStartY + roadH * 3 / 4, 10);
  drawBush(ctx, W - 60, roadStartY + roadH / 4, 10);
  drawBush(ctx, W - 60, roadStartY + roadH * 3 / 4, 10);

  drawFlower(ctx, 50, roadStartY + roadH / 2 - 20, 4, '#E91E63');
  drawFlower(ctx, 55, roadStartY + roadH / 2 + 30, 3, '#FFD700');
  drawFlower(ctx, W - 50, roadStartY + roadH / 2 - 30, 4, '#9C27B0');
  drawFlower(ctx, W - 55, roadStartY + roadH / 2 + 20, 3, '#FF5722');

  drawRock(ctx, 45, roadStartY + roadH / 2, 6);
  drawRock(ctx, W - 45, roadStartY + roadH / 2 + 40, 5);

  for (let l = 0; l < LANES; l++) {
    const laneY = roadStartY + (LANES - 1 - l) * LANE_H;
    const isGrass = l > 0 && l % 3 === 0;

    if (isGrass) {
      const grassLaneGrad = ctx.createLinearGradient(0, laneY, 0, laneY + LANE_H);
      grassLaneGrad.addColorStop(0, '#1a4a1a');
      grassLaneGrad.addColorStop(0.5, '#1a3a1a');
      grassLaneGrad.addColorStop(1, '#1a4a1a');
      ctx.fillStyle = grassLaneGrad;
      ctx.fillRect(ROAD_X, laneY, ROAD_W, LANE_H);

      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(ROAD_X, laneY);
      ctx.lineTo(ROAD_X + ROAD_W, laneY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ROAD_X, laneY + LANE_H);
      ctx.lineTo(ROAD_X + ROAD_W, laneY + LANE_H);
      ctx.stroke();
      ctx.setLineDash([]);

      for (let i = 0; i < 5; i++) {
        const bx = ROAD_X + 20 + Math.random() * (ROAD_W - 40);
        const by = laneY + 8 + Math.random() * (LANE_H - 16);
        drawBush(ctx, bx, by, 3 + Math.random() * 4);
      }

      for (let i = 0; i < 3; i++) {
        const fx = ROAD_X + 30 + Math.random() * (ROAD_W - 60);
        const fy = laneY + 10 + Math.random() * (LANE_H - 20);
        const fcolors = ['#E91E63', '#FFD700', '#9C27B0', '#FF5722'];
        drawFlower(ctx, fx, fy, 3, fcolors[Math.floor(Math.random() * fcolors.length)]);
      }

      ctx.save();
      ctx.fillStyle = '#57F287';
      ctx.globalAlpha = 0.08;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SAFE ZONE', ROAD_X + ROAD_W / 2, laneY + LANE_H / 2);
      ctx.restore();
      continue;
    }

    const roadGrad = ctx.createLinearGradient(0, laneY, 0, laneY + LANE_H);
    roadGrad.addColorStop(0, '#2e2e3a');
    roadGrad.addColorStop(0.3, '#282834');
    roadGrad.addColorStop(0.7, '#282834');
    roadGrad.addColorStop(1, '#2e2e3a');
    ctx.fillStyle = roadGrad;
    ctx.fillRect(ROAD_X, laneY, ROAD_W, LANE_H);

    ctx.save();
    ctx.globalAlpha = 0.03;
    for (let i = 0; i < 8; i++) {
      const px = ROAD_X + Math.random() * ROAD_W;
      const py = laneY + Math.random() * LANE_H;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px, py, 1 + Math.random() * 2, 1);
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.setLineDash([12, 8]);
    for (let c = 1; c < numCols; c++) {
      const lx = ROAD_X + c * COL_W;
      ctx.beginPath();
      ctx.moveTo(lx, laneY + 3);
      ctx.lineTo(lx, laneY + LANE_H - 3);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (l > 0) {
      ctx.strokeStyle = 'rgba(255,200,0,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ROAD_X, laneY);
      ctx.lineTo(ROAD_X + ROAD_W, laneY);
      ctx.stroke();
    }

    if (l < LANES - 1) {
      const nextIsGrass = (l + 1) > 0 && (l + 1) % 3 === 0;
      if (!nextIsGrass) {
        ctx.strokeStyle = 'rgba(255,200,0,0.08)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(ROAD_X, laneY + LANE_H);
        ctx.lineTo(ROAD_X + ROAD_W, laneY + LANE_H);
        ctx.stroke();
      }
    }
  }

  ctx.strokeStyle = 'rgba(255,200,0,0.4)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(ROAD_X, roadStartY);
  ctx.lineTo(ROAD_X, roadStartY + roadH);
  ctx.moveTo(ROAD_X + ROAD_W, roadStartY);
  ctx.lineTo(ROAD_X + ROAD_W, roadStartY + roadH);
  ctx.stroke();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,200,0,0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(ROAD_X - 5, roadStartY);
  ctx.lineTo(ROAD_X - 5, roadStartY + roadH);
  ctx.moveTo(ROAD_X + ROAD_W + 5, roadStartY);
  ctx.lineTo(ROAD_X + ROAD_W + 5, roadStartY + roadH);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  drawTrafficLight(ctx, ROAD_X - 20, roadStartY + 20, !gameOver);
  drawTrafficLight(ctx, ROAD_X + ROAD_W + 20, roadStartY + 20, !gameOver);

  ctx.save();
  ctx.fillStyle = '#57F287';
  ctx.globalAlpha = 0.08;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('START', ROAD_X + ROAD_W / 2, roadStartY + roadH - 12);

  ctx.fillStyle = '#FFD700';
  ctx.fillText('GOAL', ROAD_X + ROAD_W / 2, roadStartY + 14);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,215,0,0.2)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  const goalY = roadStartY + 2;
  for (let c = 0; c <= numCols; c++) {
    const gx = ROAD_X + c * COL_W;
    if (c === 0) ctx.moveTo(gx, goalY);
    else ctx.lineTo(gx, goalY);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  for (let l = 0; l < LANES; l++) {
    const laneY = roadStartY + (LANES - 1 - l) * LANE_H;
    const isGrass = l > 0 && l % 3 === 0;
    if (isGrass) continue;

    const laneData = allLaneCars && allLaneCars[l] ? allLaneCars[l] : null;
    if (!laneData) continue;

    const isPassed = l < currentLane;
    const isCurrent = l === currentLane && !gameOver;
    const isFailed = gameOver && !won && !cashedOut && l === currentLane;
    const showCars = isPassed || isCurrent || isFailed || gameOver;

    if (isPassed) {
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = '#57F287';
      ctx.fillRect(ROAD_X, laneY, ROAD_W, LANE_H);
      ctx.restore();
    }

    if (isCurrent) {
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = accent;
      ctx.fillRect(ROAD_X, laneY, ROAD_W, LANE_H);
      ctx.restore();
    }

    if (isFailed) {
      ctx.save();
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = '#ED4245';
      ctx.fillRect(ROAD_X, laneY, ROAD_W, LANE_H);
      ctx.restore();
    }

    if (showCars) {
      for (const col of laneData.positions) {
        const isCrash = isFailed && col === crashedCol;
        drawCar(ctx, col, l, laneY, laneData.dirs[col] || 1, isCrash, numCols);
      }
    }

    if (isPassed) {
      for (let i = 0; i < 3; i++) {
        const sx = ROAD_X + 20 + Math.random() * (ROAD_W - 40);
        const sy = laneY + 10 + Math.random() * (LANE_H - 20);
        drawSparkle(ctx, sx, sy, 2 + Math.random() * 2, '#57F287', 0.15 + Math.random() * 0.1);
      }
    }

    if (isFailed && crashedCol >= 0) {
      const cx = ROAD_X + crashedCol * COL_W + COL_W / 2;
      const cy = laneY + LANE_H / 2;
      drawCrack(ctx, cx, cy, 20);
      drawSmoke(ctx, cx - 15, cy - 10, 12, 0.3);
      drawSmoke(ctx, cx + 15, cy + 10, 10, 0.25);
      drawSmoke(ctx, cx, cy - 20, 14, 0.2);

      for (let i = 0; i < 6; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 15 + Math.random() * 20;
        drawSparkle(ctx, cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, 3 + Math.random() * 2, '#FFD700', 0.3 + Math.random() * 0.2);
      }
    }

    ctx.save();
    ctx.fillStyle = isPassed ? 'rgba(87,242,135,0.6)' : isCurrent ? accent : isFailed ? '#ED4245' : '#444455';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`L${l + 1}`, ROAD_X + 5, laneY + 10);
    ctx.font = '9px sans-serif';
    ctx.fillStyle = isPassed ? 'rgba(87,242,135,0.5)' : '#333344';
    ctx.fillText(`x${laneMultDisplay(diffKey, l + 1)}`, ROAD_X + 5, laneY + LANE_H - 10);
    ctx.restore();
  }

  if (!gameOver || won || cashedOut) {
    const chickenLaneY = roadStartY + (LANES - 1 - currentLane) * LANE_H;
    drawChicken(ctx, chickenCol, chickenLaneY, 20, accent, !gameOver, numCols);
  }

  if (gameOver && !won && !cashedOut && crashedCol >= 0) {
    const crashY = roadStartY + (LANES - 1 - crashedLane) * LANE_H;
    ctx.save();
    ctx.shadowColor = '#ED4245';
    ctx.shadowBlur = 25;
    ctx.strokeStyle = '#ED4245';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    const cx = ROAD_X + crashedCol * COL_W + COL_W / 2;
    const cy = crashY + LANE_H / 2;
    const s = 16;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
    ctx.moveTo(cx - s, cy + s); ctx.lineTo(cx + s, cy - s);
    ctx.moveTo(cx - s * 1.5, cy); ctx.lineTo(cx + s * 1.5, cy);
    ctx.moveTo(cx, cy - s * 1.5); ctx.lineTo(cx, cy + s * 1.5);
    ctx.stroke();
    ctx.restore();
  }

  if (gameOver && (won || cashedOut)) {
    const goalY = roadStartY;

    for (let i = 0; i < 6; i++) {
      const fx = ROAD_X + 30 + Math.random() * (ROAD_W - 60);
      const fy = goalY + 10 + Math.random() * 40;
      drawFirework(ctx, fx, fy, 15 + Math.random() * 10, ['#FFD700', '#57F287', '#FF1744', '#3498DB'][i % 4]);
    }

    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const x = ROAD_X + ROAD_W / 2 + Math.cos(angle) * 50;
      const y = goalY + 25 + Math.sin(angle) * 35;
      drawSparkle(ctx, x, y, 5 + Math.random() * 3, '#FFD700', 0.3 + Math.random() * 0.2);
    }

    for (let i = 0; i < 6; i++) {
      const x = ROAD_X + 40 + Math.random() * (ROAD_W - 80);
      const y = goalY + 15 + Math.random() * 30;
      drawStar(ctx, x, y, 5 + Math.random() * 3, '#FFD700', 0.2 + Math.random() * 0.2);
    }

    for (let i = 0; i < 8; i++) {
      const x = ROAD_X + 20 + Math.random() * (ROAD_W - 40);
      const y = goalY + 20 + Math.random() * 40;
      drawCoin(ctx, x, y, 4 + Math.random() * 2, 0.2 + Math.random() * 0.2);
    }

    ctx.save();
    ctx.fillStyle = '#FFD700';
    ctx.globalAlpha = 0.15;
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(won ? 'VICTORY!' : 'CASH OUT!', ROAD_X + ROAD_W / 2, goalY + 30);
    ctx.restore();
  }

  if (gameOver && !won && !cashedOut) {
    for (let i = 0; i < 10; i++) {
      const sx = ROAD_X + Math.random() * ROAD_W;
      const sy = roadStartY + Math.random() * roadH;
      drawSmoke(ctx, sx, sy, 8 + Math.random() * 6, 0.1 + Math.random() * 0.1);
    }
  }

  for (let i = 0; i < 25; i++) {
    const px = 30 + Math.random() * (W - 60);
    const py = roadStartY + Math.random() * roadH;
    ctx.save();
    ctx.globalAlpha = 0.04 + Math.random() * 0.06;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(px, py, 1 + Math.random() * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const resultY = roadStartY + roadH + 15;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  roundRect(ctx, 30, resultY - 5, W - 60, footerH - 20, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  roundRect(ctx, 30, resultY - 5, W - 60, footerH - 20, 10);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = accent;
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let resultText = '';
  if (gameOver) {
    if (cashedOut) resultText = `~ Encaisse ! Route ${currentLane} ・ +${fmtCoins(netGain)} coins`;
    else if (won) resultText = `~ SOMMET ! x${laneMultDisplay(diffKey, LANES)} ・ +${fmtCoins(netGain)} coins`;
    else resultText = `CRASH ! Route ${crashedLane + 1} ・ -${fmtCoins(amount)} coins`;
  } else {
    resultText = 'Utilise les boutons pour bouger le poulet';
  }
  ctx.fillText(resultText, W / 2, resultY + 12);

  ctx.fillStyle = '#8b95a7';
  ctx.font = '14px sans-serif';
  ctx.fillText(`Solde : ${fmtCoins(finalCoins)} coins`, W / 2, resultY + 35);

  if (gameOver) {
    ctx.fillStyle = '#555566';
    ctx.font = '11px sans-serif';
    const coteInfo = won ? `x${laneMultDisplay(diffKey, LANES)}` : cashedOut ? `x${laneMultDisplay(diffKey, currentLane)}` : 'x0';
    ctx.fillText(`${diff.label} ・ Cote : ${coteInfo} ・ ${numCols} colonnes`, W / 2, resultY + 55);

    if (won || cashedOut) {
      for (let i = 0; i < 16; i++) {
        const sx = 40 + Math.random() * (W - 80);
        const sy = resultY - 5 + Math.random() * 50;
        drawSparkle(ctx, sx, sy, 3 + Math.random() * 4, '#57F287', 0.2 + Math.random() * 0.25);
      }
      for (let i = 0; i < 8; i++) {
        const sx = 40 + Math.random() * (W - 80);
        const sy = resultY - 5 + Math.random() * 50;
        drawSparkle(ctx, sx, sy, 3, '#FFD700', 0.2 + Math.random() * 0.2);
      }
      for (let i = 0; i < 4; i++) {
        const sx = 40 + Math.random() * (W - 80);
        const sy = resultY + Math.random() * 40;
        drawStar(ctx, sx, sy, 4, '#FFD700', 0.15 + Math.random() * 0.15);
      }
    } else {
      for (let i = 0; i < 12; i++) {
        const sx = 40 + Math.random() * (W - 80);
        const sy = resultY - 5 + Math.random() * 45;
        drawSparkle(ctx, sx, sy, 3 + Math.random() * 2, '#ED4245', 0.15 + Math.random() * 0.2);
      }
    }
  }

  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.05;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('MIN: 10', 30, H - 12);
  ctx.textAlign = 'right';
  ctx.fillText('MAX: 50000', W - 30, H - 12);
  ctx.restore();

  return await canvas.toBuffer('png');
}

module.exports = { generateChickenImage, DIFFS, laneMultVal, laneMultDisplay, pickCars, LANES, COLS };
