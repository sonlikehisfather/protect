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

const W = 700;
const MAX_CHAMBER = 6;
const MULTIPLIERS = [1.15, 1.4, 1.85, 2.7, 5, 5];

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

function drawChamber(ctx, cx, cy, radius, state, index) {
  ctx.save();

  if (state === 'fired_empty') {
    const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, radius * 0.1, cx, cy, radius);
    grad.addColorStop(0, '#3a3a4a');
    grad.addColorStop(1, '#1a1a2a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.7, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#0a0a1a';
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (state === 'fired_bullet') {
    ctx.save();
    ctx.shadowColor = '#ED4245';
    ctx.shadowBlur = 20;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, '#FF1744');
    grad.addColorStop(0.5, '#ED4245');
    grad.addColorStop(1, '#8B0000');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#FF1744';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#FFD700';
    ctx.font = `bold ${radius * 0.8}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', cx, cy + 1);
  } else if (state === 'current') {
    ctx.save();
    ctx.shadowColor = '#FEE75C';
    ctx.shadowBlur = 15;
    const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, radius * 0.1, cx, cy, radius);
    grad.addColorStop(0, '#4a4a5a');
    grad.addColorStop(0.5, '#3a3a4a');
    grad.addColorStop(1, '#2a2a3a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#FEE75C';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(254,231,92,0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#FEE75C';
    ctx.font = `bold ${radius * 0.6}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', cx, cy + 1);
  } else {
    const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, radius * 0.1, cx, cy, radius);
    grad.addColorStop(0, '#3a3a4a');
    grad.addColorStop(0.5, '#2a2a3a');
    grad.addColorStop(1, '#1a1a2a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#3a3a4a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.75, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#1a1a2a';
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = `bold 9px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${index + 1}`, cx, cy + radius + 12);

  ctx.restore();
}

function drawRevolver(ctx, cx, cy, scale, isFiring, isDead) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  const barrelW = 120;
  const barrelH = 22;
  const cylinderR = 28;
  const gripW = 26;
  const gripH = 55;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(0, 30, 60, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const metalGrad = ctx.createLinearGradient(0, -15, 0, 15);
  metalGrad.addColorStop(0, '#5a5a6a');
  metalGrad.addColorStop(0.3, '#4a4a5a');
  metalGrad.addColorStop(0.7, '#3a3a4a');
  metalGrad.addColorStop(1, '#2a2a3a');
  ctx.fillStyle = metalGrad;
  roundRect(ctx, -10, -barrelH / 2, barrelW, barrelH, 4);
  ctx.fill();

  ctx.strokeStyle = '#1a1a2a';
  ctx.lineWidth = 1.5;
  roundRect(ctx, -10, -barrelH / 2, barrelW, barrelH, 4);
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, -5, -barrelH / 2 + 2, barrelW - 10, 3, 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#1a1a2a';
  ctx.beginPath();
  ctx.arc(barrelW - 12, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(barrelW - 12, 0, 6, 0, Math.PI * 2);
  ctx.stroke();

  if (isFiring) {
    ctx.save();
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.moveTo(barrelW - 6, -8);
    ctx.lineTo(barrelW + 25, -15);
    ctx.lineTo(barrelW + 35, -5);
    ctx.lineTo(barrelW + 40, 0);
    ctx.lineTo(barrelW + 35, 5);
    ctx.lineTo(barrelW + 25, 15);
    ctx.lineTo(barrelW - 6, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.shadowColor = '#FF6347';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#FF6347';
    ctx.beginPath();
    ctx.arc(barrelW + 10, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    for (let i = 0; i < 8; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 15 + Math.random() * 25;
      ctx.save();
      ctx.globalAlpha = 0.3 + Math.random() * 0.3;
      ctx.fillStyle = ['#FFD700', '#FF6347', '#FF1744'][i % 3];
      ctx.beginPath();
      ctx.arc(barrelW + 10 + Math.cos(ang) * dist, Math.sin(ang) * dist, 2 + Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  const cylGrad = ctx.createRadialGradient(-8, -8, 5, 0, 0, cylinderR);
  cylGrad.addColorStop(0, '#5a5a6a');
  cylGrad.addColorStop(0.5, '#4a4a5a');
  cylGrad.addColorStop(1, '#2a2a3a');
  ctx.fillStyle = cylGrad;
  ctx.beginPath();
  ctx.arc(0, 0, cylinderR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a1a2a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, cylinderR, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const chx = Math.cos(angle) * cylinderR * 0.55;
    const chy = Math.sin(angle) * cylinderR * 0.55;
    const chr = cylinderR * 0.22;

    ctx.fillStyle = '#1a1a2a';
    ctx.beginPath();
    ctx.arc(chx, chy, chr, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(chx, chy, chr, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = '#2a2a3a';
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(-8, -8, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const gripGrad = ctx.createLinearGradient(0, 10, 0, 10 + gripH);
  if (isDead) {
    gripGrad.addColorStop(0, '#4a1a1a');
    gripGrad.addColorStop(1, '#2a0a0a');
  } else {
    gripGrad.addColorStop(0, '#3a2a1a');
    gripGrad.addColorStop(0.5, '#2a1a0a');
    gripGrad.addColorStop(1, '#1a0a05');
  }
  ctx.fillStyle = gripGrad;
  ctx.beginPath();
  ctx.moveTo(-gripW / 2, 8);
  ctx.lineTo(gripW / 2, 8);
  ctx.lineTo(gripW / 2 - 3, 8 + gripH);
  ctx.lineTo(-gripW / 2 + 3, 8 + gripH);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#1a0a05';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 4; i++) {
    const y = 15 + i * 12;
    ctx.beginPath();
    ctx.moveTo(-gripW / 2 + 3, y);
    ctx.lineTo(gripW / 2 - 3, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#3a3a4a';
  roundRect(ctx, -15, -4, 12, 14, 2);
  ctx.fill();
  ctx.strokeStyle = '#1a1a2a';
  ctx.lineWidth = 1;
  roundRect(ctx, -15, -4, 12, 14, 2);
  ctx.stroke();

  ctx.fillStyle = '#3a3a4a';
  ctx.beginPath();
  ctx.moveTo(barrelW - 15, -barrelH / 2);
  ctx.lineTo(barrelW - 5, -barrelH / 2 - 8);
  ctx.lineTo(barrelW - 5, -barrelH / 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#1a1a2a';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

function drawBullet(ctx, x, y, size, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;

  const grad = ctx.createLinearGradient(x - size, y, x + size, y);
  grad.addColorStop(0, '#DAA520');
  grad.addColorStop(0.5, '#FFD700');
  grad.addColorStop(1, '#B8860B');
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(x - size, y - size * 0.3);
  ctx.lineTo(x + size * 0.3, y - size * 0.3);
  ctx.quadraticCurveTo(x + size, y - size * 0.3, x + size, y);
  ctx.quadraticCurveTo(x + size, y + size * 0.3, x + size * 0.3, y + size * 0.3);
  ctx.lineTo(x - size, y + size * 0.3);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#8B6914';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  ctx.fillStyle = '#8B6914';
  ctx.fillRect(x - size, y - size * 0.3, size * 0.15, size * 0.6);

  ctx.restore();
}

function drawSmoke(ctx, x, y, size, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(x, y, 0, x, y, size);
  g.addColorStop(0, 'rgba(80,80,80,0.5)');
  g.addColorStop(0.5, 'rgba(60,60,60,0.3)');
  g.addColorStop(1, 'rgba(40,40,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBloodSplatter(ctx, x, y, size, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#8B0000';
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.5;
    const dist = size * (0.3 + Math.random() * 0.7);
    const r = 2 + Math.random() * 4;
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, size * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCrack(ctx, cx, cy, size) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * size, cy + Math.sin(angle) * size);
    ctx.stroke();
    const midX = cx + Math.cos(angle) * size * 0.5;
    const midY = cy + Math.sin(angle) * size * 0.5;
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(midX + Math.cos(angle + 0.5) * size * 0.4, midY + Math.sin(angle + 0.5) * size * 0.4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFirework(ctx, x, y, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
    ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + 0.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * size * 0.5, y + Math.sin(angle) * size * 0.5);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawInfoPill(ctx, x, y, w, h, label, value, color) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 12, y + h / 2);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(value, x + w - 12, y + h / 2);
  ctx.restore();
}

async function generateRussianImage({
  state, pulled, amount, winAmount, netGain, finalCoins, bulletPos, currentPos
}) {
  const isDead = state === 'dead';
  const isCashout = state === 'cashout';
  const isMaxSurvived = state === 'maxsurvived';
  const isPlaying = state === 'playing';

  const accent = isDead ? '#ED4245' : (isCashout || isMaxSurvived) ? '#57F287' : '#FEE75C';
  const headerH = 65;
  const sceneH = 200;
  const chamberH = 130;
  const infoH = 100;
  const footerH = 90;
  const H = headerH + sceneH + chamberH + infoH + footerH;

  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');

  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  if (isDead) {
    bgGrad.addColorStop(0, '#1a0808');
    bgGrad.addColorStop(0.3, '#1a0a0a');
    bgGrad.addColorStop(0.7, '#150808');
    bgGrad.addColorStop(1, '#0d0505');
  } else if (isCashout || isMaxSurvived) {
    bgGrad.addColorStop(0, '#0a1a0a');
    bgGrad.addColorStop(0.3, '#0d1510');
    bgGrad.addColorStop(0.7, '#0a1a0a');
    bgGrad.addColorStop(1, '#050d05');
  } else {
    bgGrad.addColorStop(0, '#0d1117');
    bgGrad.addColorStop(0.3, '#161b24');
    bgGrad.addColorStop(0.7, '#161b24');
    bgGrad.addColorStop(1, '#0d1117');
  }
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
  ctx.fillStyle = accent;
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

  ctx.fillStyle = accent;
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('◉ ROULETTE RUSSE', 30, 35);

  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.1;
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(isPlaying ? 'EN JEU' : isDead ? 'TERMINÉ' : 'GAGNÉ', W / 2, 50);
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

  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.fillStyle = accent;
  ctx.font = 'bold 80px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('◉', W / 2, headerH + sceneH / 2);
  ctx.restore();

  for (let i = 0; i < 20; i++) {
    const px = 30 + Math.random() * (W - 60);
    const py = headerH + 10 + Math.random() * (sceneH + chamberH + infoH - 20);
    ctx.save();
    ctx.globalAlpha = 0.04 + Math.random() * 0.06;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(px, py, 1 + Math.random() * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const revolverY = headerH + sceneH / 2 + 10;
  drawRevolver(ctx, W / 2, revolverY, 1.2, isDead, isDead);

  if (isDead) {
    for (let i = 0; i < 6; i++) {
      const sx = W / 2 + 60 + Math.random() * 80;
      const sy = revolverY - 20 + Math.random() * 40;
      drawSmoke(ctx, sx, sy, 15 + Math.random() * 10, 0.2 + Math.random() * 0.15);
    }

    drawBloodSplatter(ctx, W / 2 + 80, revolverY, 25, 0.4);
    drawBloodSplatter(ctx, W / 2 + 100, revolverY - 15, 15, 0.3);

    for (let i = 0; i < 10; i++) {
      const sx = W / 2 + 50 + Math.random() * 120;
      const sy = revolverY - 30 + Math.random() * 60;
      drawSparkle(ctx, sx, sy, 3 + Math.random() * 3, '#ED4245', 0.2 + Math.random() * 0.2);
    }

    drawCrack(ctx, W / 2 + 70, revolverY, 30);
  }

  if (isCashout || isMaxSurvived) {
    for (let i = 0; i < 5; i++) {
      const fx = 100 + Math.random() * (W - 200);
      const fy = headerH + 20 + Math.random() * (sceneH - 40);
      drawFirework(ctx, fx, fy, 15 + Math.random() * 10, ['#FFD700', '#57F287', '#3498DB', '#FF1744'][i % 4]);
    }

    for (let i = 0; i < 10; i++) {
      const sx = 80 + Math.random() * (W - 160);
      const sy = headerH + 20 + Math.random() * (sceneH - 40);
      drawSparkle(ctx, sx, sy, 4 + Math.random() * 3, '#FFD700', 0.2 + Math.random() * 0.2);
    }

    for (let i = 0; i < 6; i++) {
      const sx = 80 + Math.random() * (W - 160);
      const sy = headerH + 30 + Math.random() * (sceneH - 60);
      drawStar(ctx, sx, sy, 5, '#FFD700', 0.15 + Math.random() * 0.15);
    }

    for (let i = 0; i < 8; i++) {
      const sx = 80 + Math.random() * (W - 160);
      const sy = headerH + 30 + Math.random() * (sceneH - 60);
      drawCoin(ctx, sx, sy, 5 + Math.random() * 2, 0.2 + Math.random() * 0.2);
    }

    ctx.save();
    ctx.fillStyle = '#FFD700';
    ctx.globalAlpha = 0.15;
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isMaxSurvived ? 'SURVIVANT!' : 'CASH OUT!', W / 2, headerH + 40);
    ctx.restore();
  }

  if (isPlaying) {
    for (let i = 0; i < 4; i++) {
      const bx = W / 2 - 30 + i * 20;
      const by = headerH + sceneH - 20;
      drawBullet(ctx, bx, by, 5, 0.2 + Math.random() * 0.15);
    }
  }

  const chamberY = headerH + sceneH + 20;
  const chamberR = 32;
  const chamberSpacing = 90;
  const chamberStartX = W / 2 - (MAX_CHAMBER - 1) * chamberSpacing / 2;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  roundRect(ctx, 40, chamberY - 20, W - 80, chamberH - 30, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  roundRect(ctx, 40, chamberY - 20, W - 80, chamberH - 30, 12);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(chamberStartX - 40, chamberY + chamberR + 5);
  ctx.lineTo(chamberStartX + (MAX_CHAMBER - 1) * chamberSpacing + 40, chamberY + chamberR + 5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  for (let i = 0; i < MAX_CHAMBER; i++) {
    const cx = chamberStartX + i * chamberSpacing;
    const cy = chamberY + chamberR;

    let chamberState = 'pending';
    if (i < pulled) {
      chamberState = (i === bulletPos) ? 'fired_bullet' : 'fired_empty';
    } else if (i === pulled && isPlaying) {
      chamberState = 'current';
    } else if (i === pulled && isDead) {
      chamberState = 'fired_bullet';
    } else if (i < pulled || (isMaxSurvived && i < MAX_CHAMBER - 1)) {
      chamberState = (i === bulletPos) ? 'fired_bullet' : 'fired_empty';
    }

    drawChamber(ctx, cx, cy, chamberR, chamberState, i);

    if (chamberState === 'current') {
      ctx.save();
      ctx.strokeStyle = 'rgba(254,231,92,0.1)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(cx, cy + chamberR + 18);
      ctx.lineTo(cx, chamberY + chamberH - 35);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  const mult = MULTIPLIERS[pulled] ?? MULTIPLIERS[MULTIPLIERS.length - 1];
  const potentialWin = Math.floor(amount * mult);
  const survivedCount = isDead ? pulled - 1 : pulled;

  const infoY = headerH + sceneH + chamberH + 10;

  drawInfoPill(ctx, 40, infoY, 180, 32, 'Tirs survécus', `${survivedCount} / ${MAX_CHAMBER - 1}`, accent);
  drawInfoPill(ctx, 240, infoY, 180, 32, 'Cote', `x${mult.toFixed(2)}`, '#ffffff');

  const cashLabel = isCashout ? fmtCoins(winAmount) : isMaxSurvived ? fmtCoins(winAmount) : fmtCoins(potentialWin);
  drawInfoPill(ctx, 440, infoY, 220, 32, isDead ? 'Perdu' : 'Gain', isDead ? `-${fmtCoins(amount)}` : cashLabel, isDead ? '#ED4245' : '#57F287');

  const resultY = infoY + 45;

  ctx.fillStyle = accent;
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let resultText = '';
  if (isPlaying) {
    resultText = 'Appuie sur TIRER ou CASH OUT';
  } else if (isDead) {
    resultText = `‼ PAN ! Tu es mort. -${fmtCoins(amount)} coins`;
  } else if (isCashout) {
    resultText = `✓ Cash out ! +${fmtCoins(netGain)} coins (x${(MULTIPLIERS[pulled - 1] ?? 1).toFixed(2)})`;
  } else if (isMaxSurvived) {
    resultText = `✓ Survivant ! +${fmtCoins(netGain)} coins (x${mult.toFixed(2)})`;
  }
  ctx.fillText(resultText, W / 2, resultY + 10);

  ctx.fillStyle = '#8b95a7';
  ctx.font = '14px sans-serif';
  ctx.fillText(`Solde : ${fmtCoins(finalCoins)} coins`, W / 2, resultY + 32);

  if (!isPlaying) {
    ctx.fillStyle = '#555566';
    ctx.font = '11px sans-serif';
    ctx.fillText(`Mise : ${fmtCoins(amount)} ・ ${survivedCount}/${MAX_CHAMBER - 1} tirs`, W / 2, resultY + 50);
  }

  if (isCashout || isMaxSurvived) {
    for (let i = 0; i < 16; i++) {
      const sx = 40 + Math.random() * (W - 80);
      const sy = resultY - 10 + Math.random() * 50;
      drawSparkle(ctx, sx, sy, 3 + Math.random() * 4, '#57F287', 0.2 + Math.random() * 0.25);
    }
    for (let i = 0; i < 8; i++) {
      const sx = 40 + Math.random() * (W - 80);
      const sy = resultY - 10 + Math.random() * 50;
      drawSparkle(ctx, sx, sy, 3, '#FFD700', 0.2 + Math.random() * 0.2);
    }
    for (let i = 0; i < 4; i++) {
      const sx = 40 + Math.random() * (W - 80);
      const sy = resultY + Math.random() * 40;
      drawStar(ctx, sx, sy, 4, '#FFD700', 0.15 + Math.random() * 0.15);
    }
  } else if (isDead) {
    for (let i = 0; i < 12; i++) {
      const sx = 40 + Math.random() * (W - 80);
      const sy = resultY - 10 + Math.random() * 45;
      drawSparkle(ctx, sx, sy, 3 + Math.random() * 2, '#ED4245', 0.15 + Math.random() * 0.2);
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

module.exports = { generateRussianImage, MAX_CHAMBER, MULTIPLIERS };
