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
const H = 520;

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

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

function getColor(num) {
  if (num === 0) return '#27ae60';
  return RED_NUMBERS.has(num) ? '#c0392b' : '#2c3e50';
}

function getColorName(num) {
  if (num === 0) return 'VERT';
  return RED_NUMBERS.has(num) ? 'ROUGE' : 'NOIR';
}

function drawWheel(ctx, cx, cy, radius, resultNum) {
  const segments = WHEEL_ORDER.length;
  const segAngle = (Math.PI * 2) / segments;

  const resultIndex = WHEEL_ORDER.indexOf(resultNum);

  for (let i = 0; i < segments; i++) {
    const num = WHEEL_ORDER[i];
    const startAngle = i * segAngle - Math.PI / 2 - segAngle / 2;
    const endAngle = startAngle + segAngle;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = getColor(num);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const midAngle = startAngle + segAngle / 2;
    const textR = radius * 0.78;
    const tx = cx + Math.cos(midAngle) * textR;
    const ty = cy + Math.sin(midAngle) * textR;

    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(midAngle + Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), 0, 0);
    ctx.restore();
  }

  const highlightAngle = resultIndex * segAngle - Math.PI / 2;
  const hx = cx + Math.cos(highlightAngle) * radius * 0.78;
  const hy = cy + Math.sin(highlightAngle) * radius * 0.78;

  ctx.save();
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 20;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(hx, hy, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = getColor(resultNum);
  ctx.beginPath();
  ctx.arc(hx, hy, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.25, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#c0c0c0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.25, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#c0c0c0';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('R', cx, cy);

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy - radius - 2);
  ctx.lineTo(cx + 8, cy - radius - 2);
  ctx.lineTo(cx, cy - radius + 10);
  ctx.closePath();
  ctx.fill();
}

function drawInfoRow(ctx, x, y, label, value, valueColor) {
  ctx.fillStyle = '#8b95a7';
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);

  ctx.fillStyle = valueColor || '#ffffff';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(value, x + 120, y);
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

async function generateRouletteImage({ result, choice, win, winAmount, amount, netGain, finalCoins, bonuses }) {
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');

  const accent = win ? '#57F287' : '#ED4245';
  const resultColor = getColor(result);
  const colorName = getColorName(result);

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
  ctx.fillText('◉ ROULETTE', 30, 35);

  ctx.save();
  ctx.fillStyle = '#c0392b';
  ctx.globalAlpha = 0.08;
  ctx.beginPath();
  ctx.arc(30, H - 30, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2c3e50';
  ctx.beginPath();
  ctx.arc(62, H - 30, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#27ae60';
  ctx.beginPath();
  ctx.arc(94, H - 30, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = '#c0392b';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('R', 30, H - 30);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('N', 62, H - 30);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('0', 94, H - 30);
  ctx.restore();

  ctx.fillStyle = '#8b95a7';
  ctx.font = '15px sans-serif';
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
  ctx.fillText('◉', W / 2, H / 2 + 20);
  ctx.restore();

  for (let i = 0; i < 15; i++) {
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

  const wheelCX = W / 2;
  const wheelCY = 230;
  const wheelR = 140;
  drawWheel(ctx, wheelCX, wheelCY, wheelR, result);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(wheelCX, wheelCY, wheelR + 18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const x = wheelCX + Math.cos(angle) * (wheelR + 25);
    const y = wheelCY + Math.sin(angle) * (wheelR + 25);
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#c0c0c0';
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.shadowColor = resultColor;
  ctx.shadowBlur = 25;
  ctx.fillStyle = resultColor;
  roundRect(ctx, W / 2 - 70, 386, 140, 48, 12);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, W / 2 - 66, 390, 132, 40, 9);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${result}`, W / 2 - 25, 410);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(colorName, W / 2 + 25, 410);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(W / 2 - 70, 386);
  ctx.lineTo(W / 2 - 70, 372);
  ctx.lineTo(W / 2, 372);
  ctx.lineTo(W / 2, 360);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  const leftX = 50;
  const rightX = W / 2 + 60;
  const infoY = 460;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  roundRect(ctx, 30, infoY - 16, W - 60, 36, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  roundRect(ctx, 30, infoY - 16, W - 60, 36, 8);
  ctx.stroke();
  ctx.restore();

  drawInfoRow(ctx, leftX, infoY, 'Pari', choice.label, accent);
  drawInfoRow(ctx, leftX + 240, infoY, 'Cote', `x${choice.cote}`, '#ffffff');
  drawInfoRow(ctx, rightX, infoY, 'Solde', fmtCoins(finalCoins), '#ffffff');

  ctx.fillStyle = accent;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (win) {
    ctx.fillText(`✦ GAGNÉ !  +${fmtCoins(netGain)} coins`, W / 2, 487);
    for (let i = 0; i < 12; i++) {
      const sx = W / 2 - 140 + Math.random() * 280;
      const sy = 470 + Math.random() * 35;
      drawSparkle(ctx, sx, sy, 3 + Math.random() * 3, '#57F287', 0.25 + Math.random() * 0.3);
    }
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const x = wheelCX + Math.cos(angle) * (wheelR + 40);
      const y = wheelCY + Math.sin(angle) * (wheelR + 40);
      drawSparkle(ctx, x, y, 4, '#FFD700', 0.3);
    }
  } else {
    ctx.fillText(`× Perdu  -${fmtCoins(amount)} coins`, W / 2, 487);
    for (let i = 0; i < 6; i++) {
      const sx = W / 2 - 100 + Math.random() * 200;
      const sy = 470 + Math.random() * 25;
      drawSparkle(ctx, sx, sy, 3, '#ED4245', 0.15 + Math.random() * 0.15);
    }
  }

  if (bonuses && bonuses.length) {
    ctx.fillStyle = '#FFD700';
    ctx.font = '12px sans-serif';
    ctx.fillText(`Bonus : ${bonuses.join(' ・ ')}`, W / 2, 505);
  }

  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.05;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('MIN: 10', 130, H - 30);
  ctx.textAlign = 'right';
  ctx.fillText('MAX: 50000', W - 30, H - 30);
  ctx.restore();

  return await canvas.toBuffer('png');
}

module.exports = { generateRouletteImage };
