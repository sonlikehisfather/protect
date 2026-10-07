'use strict';

const { Canvas } = require('skia-canvas');
const { drawCasinoImageFrame } = require('./casinoImageFrame');

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

const CAR_COLORS = ['#ed5a71', '#4b91dc', '#efab4a', '#9b7dec', '#45c6b2', '#ea7c5c', '#67c98d', '#e875a6', '#52bcd4', '#ed8357'];

function drawCar(ctx, col, lane, laneY, direction, crashed, roadX, colWidth) {
  const cx = roadX + col * colWidth + colWidth / 2;
  const cy = laneY + LANE_H / 2;
  const cw = colWidth - 22;
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
  ctx.fillStyle = crashed ? '#582737' : bodyGrad;
  roundRect(ctx, x, y, cw, ch, 8);
  ctx.fill();

  ctx.strokeStyle = crashed ? '#ff657f' : 'rgba(255,255,255,0.2)';
  ctx.lineWidth = crashed ? 1.8 : 1;
  roundRect(ctx, x, y, cw, ch, 8);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  if (direction < 0) {
    ctx.translate(cx, cy);
    ctx.scale(-1, 1);
    ctx.translate(-cx, -cy);
  }

  ctx.fillStyle = crashed ? 'rgba(255,101,127,0.12)' : 'rgba(130,205,255,0.4)';
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
    ctx.strokeStyle = '#ff657f';
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

  }
}

function drawChicken(ctx, col, laneY, size, accent, moving, roadX, colWidth) {
  const cx = roadX + col * colWidth + colWidth / 2;
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

function drawStatCard(ctx, x, y, w, label, value, accent) {
  ctx.save();
  ctx.fillStyle = 'rgba(17,24,39,0.92)';
  roundRect(ctx, x, y, w, 46, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, 46, 10);
  ctx.stroke();
  ctx.fillStyle = accent;
  roundRect(ctx, x + 10, y + 9, 3, 28, 1.5);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#8290a8';
  ctx.font = 'bold 9px sans-serif';
  ctx.fillText(label, x + 22, y + 15);
  ctx.fillStyle = '#f3f6fc';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(value, x + 22, y + 32);
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
  const infoH = 58;
  const roadH = LANES * LANE_H;
  const footerH = 90;
  const H = headerH + infoH + roadH + footerH;
  const roadX = ROAD_X;
  const colWidth = ROAD_W / numCols;

  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');

  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#101629');
  bgGrad.addColorStop(0.48, '#0b1220');
  bgGrad.addColorStop(1, '#080d18');
  ctx.fillStyle = bgGrad;
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();

  const glowGrad = ctx.createRadialGradient(W / 2, roadH / 2 + headerH, 20, W / 2, roadH / 2 + headerH, W * 0.7);
  glowGrad.addColorStop(0, 'rgba(72,104,170,0.13)');
  glowGrad.addColorStop(1, 'rgba(72,104,170,0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, headerH, W, H - headerH);

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

  drawCornerOrnaments(ctx, W, H, accent, 0.16);

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  ctx.fillRect(0, 0, W, headerH);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, headerH);
  ctx.lineTo(W - 20, headerH);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = diff.accent;
  ctx.shadowBlur = 12;
  ctx.fillStyle = diff.accent;
  ctx.beginPath();
  ctx.arc(42, 35, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#101629';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('C', 42, 35);

  ctx.fillStyle = diff.accent;
  ctx.font = 'bold 23px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('CHICKEN RUN', 70, 31);
  ctx.fillStyle = '#77839a';
  ctx.font = 'bold 9px sans-serif';
  ctx.fillText('CROSS THE ROAD  /  CLAIM THE MULTIPLIER', 71, 51);

  ctx.save();
  ctx.fillStyle = diff.accent;
  ctx.globalAlpha = 0.12;
  roundRect(ctx, 430, 23, 105, 24, 12);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = diff.accent;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1;
  roundRect(ctx, 430, 23, 105, 24, 12);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = diff.accent;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${diff.label} MODE`, 482, 35);

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  roundRect(ctx, 598, 13, 172, 44, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, 598, 13, 172, 44, 10);
  ctx.stroke();
  ctx.fillStyle = '#77839a';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('MISE', 612, 27);
  ctx.fillStyle = '#f3f6fc';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`${fmtCoins(amount)} coins`, 612, 44);
  ctx.restore();

  const displayLane = won ? LANES : cashedOut ? currentLane : currentLane + 1;
  const displayMult = won ? laneMultDisplay(diffKey, LANES) : cashedOut ? laneMultDisplay(diffKey, currentLane) : gameOver ? '0.00' : laneMultDisplay(diffKey, currentLane + 1);
  const displayedWin = gameOver ? winAmount : Math.floor(amount * laneMultVal(diffKey, Number(displayLane)));
  const metricY = headerH + 6;
  const metricGap = 10;
  const metricW = (W - 40 - metricGap * 3) / 4;

  drawStatCard(ctx, 20, metricY, metricW, 'DIFFICULTÉ', diff.label, diff.accent);
  drawStatCard(ctx, 20 + metricW + metricGap, metricY, metricW, 'PROGRESSION', `${displayLane} / ${LANES} ROUTES`, '#53d8e8');
  drawStatCard(ctx, 20 + (metricW + metricGap) * 2, metricY, metricW, 'COTE', `x${displayMult}`, '#b49aff');
  drawStatCard(ctx, 20 + (metricW + metricGap) * 3, metricY, metricW, gameOver ? 'GAIN TOTAL' : 'GAIN POTENTIEL', `${fmtCoins(displayedWin)} coins`, '#f6c85f');

  const roadStartY = headerH + infoH;

  const grassGrad = ctx.createLinearGradient(0, roadStartY, 0, roadStartY + roadH);
  grassGrad.addColorStop(0, '#12312e');
  grassGrad.addColorStop(0.5, '#102925');
  grassGrad.addColorStop(1, '#0d2326');
  ctx.fillStyle = grassGrad;
  ctx.fillRect(0, roadStartY, ROAD_X, roadH);
  ctx.fillRect(ROAD_X + ROAD_W, roadStartY, W - ROAD_X - ROAD_W, roadH);

  drawTree(ctx, 35, roadStartY + 30, 28);
  drawTree(ctx, 35, roadStartY + roadH / 3, 24);
  drawTree(ctx, 35, roadStartY + roadH * 2 / 3, 26);
  drawTree(ctx, 35, roadStartY + roadH - 30, 28);
  drawTree(ctx, W - 35, roadStartY + 30, 28);
  drawTree(ctx, W - 35, roadStartY + roadH / 3, 24);
  drawTree(ctx, W - 35, roadStartY + roadH * 2 / 3, 26);
  drawTree(ctx, W - 35, roadStartY + roadH - 30, 28);

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

    const roadGrad = ctx.createLinearGradient(0, laneY, 0, laneY + LANE_H);
    roadGrad.addColorStop(0, '#1b263b');
    roadGrad.addColorStop(0.45, '#202c43');
    roadGrad.addColorStop(1, '#141d30');
    ctx.fillStyle = roadGrad;
    ctx.fillRect(roadX, laneY, ROAD_W, LANE_H);

    ctx.strokeStyle = 'rgba(161,180,220,0.23)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([7, 7]);
    for (let c = 1; c < numCols; c++) {
      const lx = roadX + c * colWidth;
      ctx.beginPath();
      ctx.moveTo(lx, laneY + 3);
      ctx.lineTo(lx, laneY + LANE_H - 3);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (l > 0) {
      ctx.strokeStyle = 'rgba(255,200,0,0.16)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(roadX, laneY);
      ctx.lineTo(roadX + ROAD_W, laneY);
      ctx.stroke();
    }

    if (l < LANES - 1) {
      ctx.strokeStyle = 'rgba(255,200,0,0.1)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(roadX, laneY + LANE_H);
      ctx.lineTo(roadX + ROAD_W, laneY + LANE_H);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = 'rgba(255,200,0,0.55)';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(roadX, roadStartY);
  ctx.lineTo(roadX, roadStartY + roadH);
  ctx.moveTo(roadX + ROAD_W, roadStartY);
  ctx.lineTo(roadX + ROAD_W, roadStartY + roadH);
  ctx.stroke();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,200,0,0.24)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(roadX - 5, roadStartY);
  ctx.lineTo(roadX - 5, roadStartY + roadH);
  ctx.moveTo(roadX + ROAD_W + 5, roadStartY);
  ctx.lineTo(roadX + ROAD_W + 5, roadStartY + roadH);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  drawTrafficLight(ctx, roadX - 20, roadStartY + 20, !gameOver);
  drawTrafficLight(ctx, roadX + ROAD_W + 20, roadStartY + 20, !gameOver);

  ctx.save();
  ctx.fillStyle = '#b0fff0';
  ctx.globalAlpha = 0.56;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('START', roadX + ROAD_W / 2, roadStartY + roadH + 5);
  ctx.restore();

  for (let i = 0; i < Math.ceil(ROAD_W / 12); i++) {
    ctx.fillStyle = i % 2 === 0 ? '#ffe38a' : '#172033';
    ctx.globalAlpha = 0.72;
    ctx.fillRect(roadX + i * 12, roadStartY, Math.min(12, ROAD_W - i * 12), 7);
  }
  ctx.globalAlpha = 1;

  for (let l = 0; l < LANES; l++) {
    const laneY = roadStartY + (LANES - 1 - l) * LANE_H;

    const laneData = allLaneCars && allLaneCars[l] ? allLaneCars[l] : null;
    if (!laneData) continue;

    const isPassed = l < currentLane || (gameOver && (won || cashedOut) && l === currentLane);
    const isCurrent = l === currentLane && !gameOver;
    const isFailed = gameOver && !won && !cashedOut && l === currentLane;
    const showCars = !isPassed && (isCurrent || isFailed || gameOver);

    if (isPassed) {
      ctx.save();
      ctx.fillStyle = 'rgba(49,213,164,0.1)';
      ctx.fillRect(roadX, laneY, ROAD_W, LANE_H);
      ctx.restore();
    }

    if (isCurrent) {
      ctx.save();
      ctx.fillStyle = 'rgba(180,154,255,0.11)';
      ctx.fillRect(roadX, laneY, ROAD_W, LANE_H);
      ctx.shadowColor = accent;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      roundRect(ctx, roadX + 3, laneY + 3, ROAD_W - 6, LANE_H - 6, 7);
      ctx.stroke();
      ctx.restore();
    }

    if (isFailed) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,74,107,0.13)';
      ctx.fillRect(roadX, laneY, ROAD_W, LANE_H);
      ctx.strokeStyle = 'rgba(255,74,107,0.6)';
      ctx.lineWidth = 2;
      roundRect(ctx, roadX + 3, laneY + 3, ROAD_W - 6, LANE_H - 6, 7);
      ctx.stroke();
      ctx.restore();
    }

    if (showCars) {
      for (const col of laneData.positions) {
        const isCrash = isFailed && col === crashedCol;
        drawCar(ctx, col, l, laneY, laneData.dirs[col] || 1, isCrash, roadX, colWidth);
      }
    }

    if (isFailed && crashedCol >= 0) {
      const cx = roadX + crashedCol * colWidth + colWidth / 2;
      const cy = laneY + LANE_H / 2;
      drawCrack(ctx, cx, cy, 20);
      drawSmoke(ctx, cx - 15, cy - 10, 12, 0.3);
      drawSmoke(ctx, cx + 15, cy + 10, 10, 0.25);
      drawSmoke(ctx, cx, cy - 20, 14, 0.2);
    }

    ctx.save();
    ctx.fillStyle = isPassed ? '#62e7c3' : isCurrent ? accent : isFailed ? '#ff657f' : '#65718a';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(isPassed ? `✓ ${l + 1}` : isCurrent ? `▶ ${l + 1}` : `L${l + 1}`, roadX + 8, laneY + 11);
    ctx.font = 'bold 9px sans-serif';
    ctx.fillStyle = isPassed ? 'rgba(98,231,195,0.8)' : '#8a96ad';
    ctx.fillText(`x${laneMultDisplay(diffKey, l + 1)}`, roadX + 8, laneY + LANE_H - 10);
    ctx.restore();
  }

  if (!gameOver || won || cashedOut) {
    const chickenLaneY = roadStartY + (LANES - 1 - currentLane) * LANE_H;
    drawChicken(ctx, chickenCol, chickenLaneY, 23, accent, !gameOver, roadX, colWidth);
  }

  if (gameOver && !won && !cashedOut && crashedCol >= 0) {
    const crashY = roadStartY + (LANES - 1 - crashedLane) * LANE_H;
    ctx.save();
    ctx.shadowColor = '#ED4245';
    ctx.shadowBlur = 25;
    ctx.strokeStyle = '#ED4245';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    const cx = roadX + crashedCol * colWidth + colWidth / 2;
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

  const resultY = roadStartY + roadH + 15;

  ctx.save();
  ctx.fillStyle = 'rgba(17,24,39,0.96)';
  roundRect(ctx, 20, resultY - 7, W - 40, footerH - 18, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1.2;
  roundRect(ctx, 20, resultY - 7, W - 40, footerH - 18, 12);
  ctx.stroke();
  ctx.fillStyle = accent;
  roundRect(ctx, 20, resultY + 3, 3, 34, 1.5);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = accent;
  ctx.font = 'bold 19px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let resultText = '';
  if (gameOver) {
    if (cashedOut) resultText = `CASH OUT  /  ROUTE ${currentLane}  /  +${fmtCoins(netGain)} coins`;
    else if (won) resultText = `FINISH LINE  /  x${laneMultDisplay(diffKey, LANES)}  /  +${fmtCoins(netGain)} coins`;
    else resultText = `CRASH  /  ROUTE ${crashedLane + 1}  /  -${fmtCoins(amount)} coins`;
  } else {
    resultText = 'YOUR MOVE  /  Choisis la prochaine voie';
  }
  ctx.fillText(resultText, W / 2, resultY + 12);

  ctx.fillStyle = '#c2cadd';
  ctx.font = '13px sans-serif';
  ctx.fillText(`Solde : ${fmtCoins(finalCoins)} coins`, W / 2, resultY + 35);

  if (gameOver) {
    ctx.fillStyle = '#728099';
    ctx.font = 'bold 9px sans-serif';
    const coteInfo = won ? `x${laneMultDisplay(diffKey, LANES)}` : cashedOut ? `x${laneMultDisplay(diffKey, currentLane)}` : 'x0';
    ctx.fillText(`${diff.label}  •  COTE ${coteInfo}  •  ${numCols} VOIES`, W / 2, resultY + 55);
  }

  drawCasinoImageFrame(ctx, W, H, accent);
  return await canvas.toBuffer('png');
}

module.exports = { generateChickenImage, DIFFS, laneMultVal, laneMultDisplay, pickCars, LANES, COLS };
