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
const H = 400;

const FONTS = {
  bold  : 'bold 28px sans-serif',
  big   : 'bold 48px sans-serif',
  huge  : 'bold 72px sans-serif',
  small : '16px sans-serif',
  medium: '20px sans-serif',
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

function drawNumberBall(ctx, cx, cy, num, color) {
  const r = 32;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#0a0e17';
  ctx.beginPath();
  ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = FONTS.big;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), cx, cy + 2);
}

function drawBar(ctx, x, y, w, h, rollPct, rangeMinPct, rangeMaxPct, win) {
  ctx.save();

  ctx.fillStyle = '#1a2030';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();

  const rangeX = x + (rangeMinPct * w);
  const rangeW = (rangeMaxPct - rangeMinPct) * w;
  ctx.fillStyle = win ? 'rgba(87, 242, 135, 0.35)' : 'rgba(237, 66, 69, 0.25)';
  roundRect(ctx, rangeX, y, Math.max(rangeW, h), h, h / 2);
  ctx.fill();

  const rollX = x + (rollPct * w);
  ctx.shadowColor = win ? '#57F287' : '#ED4245';
  ctx.shadowBlur = 15;
  ctx.fillStyle = win ? '#57F287' : '#ED4245';
  ctx.beginPath();
  ctx.arc(rollX, y + h / 2, h / 2 + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#0a0e17';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('●', rollX, y + h / 2 + 1);
}

function drawInfoRow(ctx, x, y, label, value, valueColor) {
  ctx.fillStyle = '#8b95a7';
  ctx.font = FONTS.small;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);

  ctx.fillStyle = valueColor || '#ffffff';
  ctx.font = FONTS.medium;
  ctx.fillText(value, x + 140, y);
}

function drawCornerOrnaments(ctx, W, H, color, alpha = 0.12) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  const cs = 22;
  const m = 10;
  ctx.beginPath(); ctx.moveTo(m, m + cs); ctx.lineTo(m, m); ctx.lineTo(m + cs, m); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - m - cs, m); ctx.lineTo(W - m, m); ctx.lineTo(W - m, m + cs); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(m, H - m - cs); ctx.lineTo(m, H - m); ctx.lineTo(m + cs, H - m); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - m - cs, H - m); ctx.lineTo(W - m, H - m); ctx.lineTo(W - m, H - m - cs); ctx.stroke();
  ctx.restore();
}

function drawSparkle(ctx, x, y, size, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - size, y); ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size); ctx.lineTo(x, y + size);
  ctx.moveTo(x - size * 0.6, y - size * 0.6); ctx.lineTo(x + size * 0.6, y + size * 0.6);
  ctx.moveTo(x - size * 0.6, y + size * 0.6); ctx.lineTo(x + size * 0.6, y - size * 0.6);
  ctx.stroke();
  ctx.restore();
}

function drawDie(ctx, cx, cy, size, num, color) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  const grad = ctx.createLinearGradient(cx - size, cy - size, cx + size, cy + size);
  grad.addColorStop(0, '#2a2a3e');
  grad.addColorStop(1, '#1a1a2e');
  ctx.fillStyle = grad;
  roundRect(ctx, cx - size, cy - size, size * 2, size * 2, size * 0.2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundRect(ctx, cx - size, cy - size, size * 2, size * 2, size * 0.2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  roundRect(ctx, cx - size + 4, cy - size + 4, size * 2 - 8, size * 2 - 8, size * 0.15);
  ctx.stroke();

  const dotR = size * 0.12;
  const positions = {
    1: [[0, 0]],
    2: [[-0.4, -0.4], [0.4, 0.4]],
    3: [[-0.4, -0.4], [0, 0], [0.4, 0.4]],
    4: [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]],
    5: [[-0.4, -0.4], [0.4, -0.4], [0, 0], [-0.4, 0.4], [0.4, 0.4]],
    6: [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0], [0.4, 0], [-0.4, 0.4], [0.4, 0.4]],
  };
  const dots = positions[num] || [];
  for (const [dx, dy] of dots) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx + dx * size, cy + dy * size, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

async function generateDiceImage({ roll, rangeMin, rangeMax, rangeSize, mult, winChance, win, winAmount, amount, finalCoins }) {
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');

  const accent = win ? '#57F287' : '#ED4245';
  const accentDark = win ? '#2d6b3f' : '#6b2d2d';

  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0d1117');
  bgGrad.addColorStop(1, '#161b24');
  ctx.fillStyle = bgGrad;
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W - 2, H - 2, 19);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.06;
  ctx.fillRect(0, 0, W, 70);
  ctx.restore();

  ctx.fillStyle = accent;
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('◆ DICE', 30, 35);

  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.08;
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ROLL 0-99', W / 2, 55);
  ctx.restore();

  ctx.fillStyle = '#8b95a7';
  ctx.font = FONTS.small;
  ctx.textAlign = 'right';
  ctx.fillText(`Mise : ${fmtCoins(amount)} coins`, W - 30, 35);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(30, 70);
  ctx.lineTo(W - 30, 70);
  ctx.stroke();

  drawCornerOrnaments(ctx, W, H, accent, 0.1);

  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.fillStyle = accent;
  ctx.font = 'bold 70px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('◆', W / 2, H / 2 + 10);
  ctx.restore();

  for (let i = 0; i < 12; i++) {
    const px = 30 + Math.random() * (W - 60);
    const py = 75 + Math.random() * (H - 150);
    ctx.save();
    ctx.globalAlpha = 0.04 + Math.random() * 0.06;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(px, py, 1 + Math.random() * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawDie(ctx, 70, H - 35, 12, Math.floor(roll / 16) + 1, accent);
  drawDie(ctx, 110, H - 35, 12, (roll % 6) + 1, accent);
  drawDie(ctx, W - 70, H - 35, 12, Math.floor(roll / 25) + 1, accent);
  drawDie(ctx, W - 110, H - 35, 12, (roll % 4) + 1, accent);

  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.05;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MIN: 10', W / 2 - 60, H - 35);
  ctx.fillText('MAX: 50000', W / 2 + 60, H - 35);
  ctx.restore();

  const numY = 155;

  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.06;
  ctx.beginPath();
  ctx.arc(W / 2, numY, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(W / 2, numY, 68, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const x = W / 2 + Math.cos(angle) * 72;
    const y = numY + Math.sin(angle) * 72;
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = accent;
  ctx.font = FONTS.huge;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(roll), W / 2, numY);

  ctx.fillStyle = '#8b95a7';
  ctx.font = FONTS.small;
  ctx.fillText('TIRAGE', W / 2, numY - 55);

  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.1;
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText(roll < 50 ? 'LOW' : 'HIGH', W / 2, numY + 48);
  ctx.restore();

  const barY = 230;
  const barX = 60;
  const barW = W - 120;
  const barH = 24;
  const rollPct = roll / 99;
  const rangeMinPct = rangeMin / 99;
  const rangeMaxPct = rangeMax / 99;
  drawBar(ctx, barX, barY, barW, barH, rollPct, rangeMinPct, rangeMaxPct, win);

  ctx.fillStyle = '#8b95a7';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('0', barX, barY + barH + 14);
  ctx.textAlign = 'center';
  ctx.fillText('50', barX + barW / 2, barY + barH + 14);
  ctx.textAlign = 'right';
  ctx.fillText('99', barX + barW, barY + barH + 14);

  const infoY = 310;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  roundRect(ctx, 40, infoY - 16, W - 80, 36, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  roundRect(ctx, 40, infoY - 16, W - 80, 36, 8);
  ctx.stroke();
  ctx.restore();

  drawInfoRow(ctx, 60, infoY, 'Plage', `${rangeMin} - ${rangeMax} (${rangeSize} num)`, accent);
  drawInfoRow(ctx, 60, infoY + 30, 'Cote', `x${mult.toFixed(2)} (${winChance}%)`, '#ffffff');

  const rightX = W / 2 + 40;
  drawInfoRow(ctx, rightX, infoY, 'Tirage', String(roll), accent);
  drawInfoRow(ctx, rightX, infoY + 30, 'Solde', `${fmtCoins(finalCoins)} coins`, '#ffffff');

  ctx.fillStyle = accent;
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (win) {
    ctx.fillText(`✦ GAGNE !  +${fmtCoins(winAmount - amount)} coins (x${mult.toFixed(2)})`, W / 2, 375);
    for (let i = 0; i < 14; i++) {
      const sx = W / 2 - 140 + Math.random() * 280;
      const sy = 355 + Math.random() * 30;
      drawSparkle(ctx, sx, sy, 3 + Math.random() * 3, '#57F287', 0.25 + Math.random() * 0.3);
    }
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const x = W / 2 + Math.cos(angle) * 90;
      const y = numY + Math.sin(angle) * 90;
      drawSparkle(ctx, x, y, 4, '#FFD700', 0.25);
    }
  } else {
    ctx.fillText(`× Perdu  -${fmtCoins(amount)} coins`, W / 2, 375);
    for (let i = 0; i < 8; i++) {
      const sx = W / 2 - 100 + Math.random() * 200;
      const sy = 355 + Math.random() * 25;
      drawSparkle(ctx, sx, sy, 3, '#ED4245', 0.15 + Math.random() * 0.15);
    }
  }

  return await canvas.toBuffer('png');
}

module.exports = { generateDiceImage };
