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
const H = 480;

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

function drawStar(ctx, cx, cy, spikes, outerR, innerR, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / spikes - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawCoin(ctx, x, y, r, alpha = 1, rotation = 0) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);

  const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  grad.addColorStop(0, '#FFF3B0');
  grad.addColorStop(0.3, '#FFE55C');
  grad.addColorStop(0.7, '#FFD700');
  grad.addColorStop(1, '#B8860B');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#DAA520';
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#B8860B';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#B8860B';
  ctx.font = `bold ${Math.floor(r * 1.2)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', 0, 1);

  ctx.restore();
}

function drawSparkle(ctx, x, y, size, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.moveTo(x - size * 0.6, y - size * 0.6);
  ctx.lineTo(x + size * 0.6, y + size * 0.6);
  ctx.moveTo(x - size * 0.6, y + size * 0.6);
  ctx.lineTo(x + size * 0.6, y - size * 0.6);
  ctx.stroke();
  ctx.restore();
}

function drawBolt(ctx, x, y, size, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size * 0.5, y - size * 0.2);
  ctx.lineTo(x + size * 0.2, y);
  ctx.lineTo(x + size * 0.6, y + size);
  ctx.lineTo(x - size * 0.3, y + size * 0.2);
  ctx.lineTo(x, y);
  ctx.lineTo(x - size * 0.4, y - size * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawVault(ctx, x, y, w, h, accentColor, glowColor) {
  ctx.save();
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 30;
  const vaultGrad = ctx.createLinearGradient(x, y, x, y + h);
  vaultGrad.addColorStop(0, '#52525e');
  vaultGrad.addColorStop(0.3, '#3e3e4a');
  vaultGrad.addColorStop(0.7, '#2e2e3a');
  vaultGrad.addColorStop(1, '#22222e');
  ctx.fillStyle = vaultGrad;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = '#62626e';
  ctx.lineWidth = 3;
  roundRect(ctx, x, y, w, h, 14);
  ctx.stroke();

  ctx.strokeStyle = '#3a3a44';
  ctx.lineWidth = 1;
  roundRect(ctx, x + 6, y + 6, w - 12, h - 12, 10);
  ctx.stroke();

  ctx.strokeStyle = '#3a3a44';
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 10, y + (h / 5) * i);
    ctx.lineTo(x + w - 10, y + (h / 5) * i);
    ctx.stroke();
  }

  for (let i = 0; i < 4; i++) {
    const bx = x + 14 + (w - 28) * (i / 3);
    ctx.fillStyle = '#1a1a22';
    ctx.beginPath();
    ctx.arc(bx, y + 6, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx, y + h - 6, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  const plateX = x + 10;
  const plateY = y + 10;
  const plateW = 32;
  const plateH = 10;
  ctx.fillStyle = '#1a1a22';
  roundRect(ctx, plateX, plateY, plateW, plateH, 2);
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1;
  roundRect(ctx, plateX, plateY, plateW, plateH, 2);
  ctx.stroke();
  ctx.fillStyle = accentColor;
  ctx.font = 'bold 7px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BANK', plateX + plateW / 2, plateY + plateH / 2 + 1);

  const dialCX = x + w / 2;
  const dialCY = y + h / 2 + 5;
  const dialR = Math.min(w, h) * 0.28;

  ctx.fillStyle = '#15151e';
  ctx.beginPath();
  ctx.arc(dialCX, dialCY, dialR + 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#4a4a54';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(dialCX, dialCY, dialR + 6, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#5a5a64';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(dialCX, dialCY, dialR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#0d0d14';
  ctx.beginPath();
  ctx.arc(dialCX, dialCY, dialR, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#4a4a54';
  ctx.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    const isMajor = i % 6 === 0;
    const len = isMajor ? 6 : 3;
    ctx.beginPath();
    ctx.moveTo(dialCX + Math.cos(angle) * (dialR - len), dialCY + Math.sin(angle) * (dialR - len));
    ctx.lineTo(dialCX + Math.cos(angle) * (dialR - 1), dialCY + Math.sin(angle) * (dialR - 1));
    ctx.stroke();
  }

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(dialCX, dialCY);
  ctx.lineTo(dialCX + Math.cos(-Math.PI / 3) * (dialR - 8), dialCY + Math.sin(-Math.PI / 3) * (dialR - 8));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(dialCX, dialCY);
  ctx.lineTo(dialCX + Math.cos(Math.PI / 6) * (dialR - 12), dialCY + Math.sin(Math.PI / 6) * (dialR - 12));
  ctx.stroke();
  ctx.lineCap = 'butt';

  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(dialCX, dialCY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0d0d14';
  ctx.lineWidth = 1;
  ctx.stroke();

  const handleX = x + w - 4;
  const handleY = y + h / 2;
  ctx.fillStyle = '#5a5a64';
  roundRect(ctx, handleX, handleY - 18, 12, 36, 4);
  ctx.fill();
  ctx.strokeStyle = '#6a6a74';
  ctx.lineWidth = 1;
  roundRect(ctx, handleX, handleY - 18, 12, 36, 4);
  ctx.stroke();
  ctx.fillStyle = '#3a3a44';
  ctx.beginPath();
  ctx.arc(handleX + 6, handleY - 12, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(handleX + 6, handleY + 12, 2, 0, Math.PI * 2);
  ctx.fill();

  const hingeX = x + 4;
  for (let i = 0; i < 3; i++) {
    const hy = y + 15 + (h - 30) * (i / 2);
    ctx.fillStyle = '#3a3a44';
    ctx.beginPath();
    ctx.arc(hingeX, hy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5a5a64';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
  return { dialCX, dialCY, dialR };
}

function drawBandit(ctx, x, y, accent) {
  ctx.save();

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y + 60, 30, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.arc(x, y - 25, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#0d0d14';
  roundRect(ctx, x - 20, y - 35, 40, 16, 5);
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.fillRect(x - 15, y - 30, 8, 4);
  ctx.fillRect(x + 7, y - 30, 8, 4);

  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.3;
  ctx.fillRect(x - 14, y - 29, 6, 2);
  ctx.fillRect(x + 8, y - 29, 6, 2);
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#0d0d14';
  ctx.beginPath();
  ctx.moveTo(x - 16, y - 18);
  ctx.quadraticCurveTo(x, y - 10, x + 16, y - 18);
  ctx.lineTo(x + 13, y - 2);
  ctx.quadraticCurveTo(x, y + 4, x - 13, y - 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.moveTo(x - 18, y + 2);
  ctx.lineTo(x - 22, y + 15);
  ctx.lineTo(x - 20, y + 35);
  ctx.lineTo(x + 20, y + 35);
  ctx.lineTo(x + 22, y + 15);
  ctx.lineTo(x + 18, y + 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#0d0d14';
  roundRect(ctx, x - 14, y + 10, 28, 25, 4);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  roundRect(ctx, x - 14, y + 10, 28, 25, 4);
  ctx.stroke();

  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', x, y + 24);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 20, y + 20);
  ctx.lineTo(x - 30, y + 40);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 20, y + 20);
  ctx.lineTo(x + 30, y + 40);
  ctx.stroke();
  ctx.lineCap = 'butt';

  ctx.fillStyle = '#1a1a2e';
  roundRect(ctx, x - 12, y + 35, 10, 22, 3);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x - 12, y + 35, 10, 22, 3);
  ctx.stroke();
  roundRect(ctx, x + 2, y + 35, 10, 22, 3);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#0d0d14';
  roundRect(ctx, x - 10, y + 57, 8, 5, 2);
  ctx.fill();
  roundRect(ctx, x + 4, y + 57, 8, 5, 2);
  ctx.fill();

  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.moveTo(x + 18, y + 5);
  ctx.quadraticCurveTo(x + 35, y - 5, x + 40, y - 20);
  ctx.lineTo(x + 36, y - 22);
  ctx.quadraticCurveTo(x + 32, y - 8, x + 16, y + 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

function drawShield(ctx, cx, cy, r, color, glowColor) {
  ctx.save();

  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 20;

  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + r, cy - r * 0.5, cx + r * 0.8, cy + r * 0.3);
  ctx.quadraticCurveTo(cx + r * 0.5, cy + r, cx, cy + r);
  ctx.quadraticCurveTo(cx - r * 0.5, cy + r, cx - r * 0.8, cy + r * 0.3);
  ctx.quadraticCurveTo(cx - r, cy - r * 0.5, cx, cy - r);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + r, cy - r * 0.5, cx + r * 0.8, cy + r * 0.3);
  ctx.quadraticCurveTo(cx + r * 0.5, cy + r, cx, cy + r);
  ctx.quadraticCurveTo(cx - r * 0.5, cy + r, cx - r * 0.8, cy + r * 0.3);
  ctx.quadraticCurveTo(cx - r, cy - r * 0.5, cx, cy - r);
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.6);
  ctx.lineTo(cx, cy + r * 0.6);
  ctx.moveTo(cx - r * 0.5, cy);
  ctx.lineTo(cx + r * 0.5, cy);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = `bold ${Math.floor(r * 0.8)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('◊', cx, cy);

  ctx.restore();
}

function drawWarningSign(ctx, cx, cy, size, color) {
  ctx.save();

  ctx.shadowColor = color;
  ctx.shadowBlur = 15;

  ctx.fillStyle = '#2a1a1a';
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size, cy + size * 0.7);
  ctx.lineTo(cx - size, cy + size * 0.7);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size, cy + size * 0.7);
  ctx.lineTo(cx - size, cy + size * 0.7);
  ctx.closePath();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.floor(size * 1.2)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', cx, cy + size * 0.2);

  ctx.restore();
}

function drawCoinPile(ctx, x, y, count, baseR) {
  for (let i = 0; i < count; i++) {
    const layer = Math.floor(i / 5);
    const inLayer = i % 5;
    const cx = x + (inLayer - 2) * (baseR * 1.5) + Math.sin(i) * 3;
    const cy = y - layer * (baseR * 0.8) + Math.cos(i) * 2;
    drawCoin(ctx, cx, cy, baseR - layer * 0.5, 0.7 + layer * 0.05, i * 0.3);
  }
}

function drawRays(ctx, cx, cy, innerR, outerR, count, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const nextAngle = ((i + 1) / count) * Math.PI * 2;
    const midAngle = (angle + nextAngle) / 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    ctx.lineTo(cx + Math.cos(midAngle) * outerR, cy + Math.sin(midAngle) * outerR);
    ctx.lineTo(cx + Math.cos(nextAngle) * innerR, cy + Math.sin(nextAngle) * innerR);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawWeb(ctx, cornerX, cornerY, size, color, alpha = 0.15) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const spokes = 5;
  const rings = 4;
  for (let i = 0; i < spokes; i++) {
    const angle = (i / (spokes - 1)) * Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cornerX, cornerY);
    ctx.lineTo(cornerX + Math.cos(angle) * size, cornerY + Math.sin(angle) * size);
    ctx.stroke();
  }
  for (let r = 1; r <= rings; r++) {
    const t = r / rings;
    ctx.beginPath();
    for (let i = 0; i < spokes; i++) {
      const angle = (i / (spokes - 1)) * Math.PI / 2;
      const x = cornerX + Math.cos(angle) * size * t;
      const y = cornerY + Math.sin(angle) * size * t;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawBars(ctx, x, y, w, h, count, color, alpha = 0.08) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const barW = 4;
  const gap = (w - count * barW) / (count + 1);
  for (let i = 0; i < count; i++) {
    const bx = x + gap + i * (barW + gap);
    const grad = ctx.createLinearGradient(bx, y, bx, y + h);
    grad.addColorStop(0, color);
    grad.addColorStop(0.5, 'rgba(40,40,50,0.8)');
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    roundRect(ctx, bx, y, barW, h, 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFloor(ctx, y, w, color, alpha = 0.06) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const grad = ctx.createLinearGradient(0, y, 0, y + 40);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(20, y, w - 40, 40);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = alpha * 1.5;
  ctx.beginPath();
  ctx.moveTo(20, y);
  ctx.lineTo(w - 20, y);
  ctx.stroke();
  ctx.restore();
}

function drawParticle(ctx, x, y, r, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (r > 2) {
    ctx.globalAlpha = alpha * 0.3;
    ctx.beginPath();
    ctx.arc(x, y, r * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDollarSign(ctx, x, y, size, color, alpha, rotation = 0) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', 0, 0);
  ctx.restore();
}

function drawCornerOrnaments(ctx, W, H, accent, alpha = 0.15) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  const cs = 25;
  const m = 12;
  ctx.beginPath(); ctx.moveTo(m, m + cs); ctx.lineTo(m, m); ctx.lineTo(m + cs, m); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - m - cs, m); ctx.lineTo(W - m, m); ctx.lineTo(W - m, m + cs); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(m, H - m - cs); ctx.lineTo(m, H - m); ctx.lineTo(m + cs, H - m); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - m - cs, H - m); ctx.lineTo(W - m, H - m); ctx.lineTo(W - m, H - m - cs); ctx.stroke();
  ctx.restore();
}

async function generateVolImage({ targetName, stolenCoins, stolenXp, stealPercent, finalCoins, success, blocked, shieldsLeft }) {
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');

  const accent = success ? '#57F287' : blocked ? '#5865F2' : '#ED4245';
  const accentGlow = success ? 'rgba(87,242,135,0.4)' : blocked ? 'rgba(88,101,242,0.4)' : 'rgba(237,66,69,0.4)';

  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0d1117');
  bgGrad.addColorStop(0.3, '#131820');
  bgGrad.addColorStop(0.7, '#131820');
  bgGrad.addColorStop(1, '#0d1117');
  ctx.fillStyle = bgGrad;
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W - 2, H - 2, 19);
  ctx.stroke();
  ctx.restore();

  const glowGrad = ctx.createRadialGradient(W / 2, 240, 60, W / 2, 240, 320);
  glowGrad.addColorStop(0, success ? 'rgba(87,242,135,0.1)' : blocked ? 'rgba(88,101,242,0.1)' : 'rgba(237,66,69,0.1)');
  glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.04;
  ctx.fillRect(0, 0, W, 60);
  ctx.restore();

  ctx.fillStyle = accent;
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('VOL', 30, 32);

  ctx.fillStyle = '#8b95a7';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'right';
  const tName = targetName.length > 20 ? targetName.slice(0, 20) + '...' : targetName;
  ctx.fillText(`Cible : ${tName}`, W - 30, 32);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(30, 60);
  ctx.lineTo(W - 30, 60);
  ctx.stroke();

  drawCornerOrnaments(ctx, W, H, accent, 0.12);

  drawWeb(ctx, 15, 65, 55, '#8b95a7', 0.1);
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  drawWeb(ctx, 15, 65, 55, '#8b95a7', 0.1);
  ctx.restore();

  drawBars(ctx, 30, 70, W - 60, 320, 7, accent, 0.04);

  const sceneCY = 250;

  drawFloor(ctx, 360, W, accent, 0.05);

  for (let i = 0; i < 25; i++) {
    const px = 40 + Math.random() * (W - 80);
    const py = 70 + Math.random() * 320;
    const pr = 1 + Math.random() * 2.5;
    const pColor = success ? '#FFD700' : blocked ? '#5865F2' : '#ED4245';
    drawParticle(ctx, px, py, pr, pColor, 0.06 + Math.random() * 0.14);
  }

  for (let i = 0; i < 12; i++) {
    const px = 50 + Math.random() * (W - 100);
    const py = 80 + Math.random() * 300;
    drawDollarSign(ctx, px, py, 10 + Math.random() * 8, accent, 0.03 + Math.random() * 0.04, Math.random() * 0.5 - 0.25);
  }

  for (let i = 0; i < 6; i++) {
    const px = 60 + Math.random() * (W - 120);
    const py = 75 + Math.random() * 50;
    drawSparkle(ctx, px, py, 3 + Math.random() * 3, accent, 0.1 + Math.random() * 0.1);
  }

  for (let i = 0; i < 10; i++) {
    const px = 30 + Math.random() * (W - 60);
    const py = 330 + Math.random() * 30;
    drawParticle(ctx, px, py, 1 + Math.random() * 1.5, accent, 0.06 + Math.random() * 0.08);
  }

  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.06;
  ctx.font = 'bold 60px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('HEIST', W / 2, sceneCY + 10);
  ctx.globalAlpha = 0.03;
  ctx.font = 'bold 90px sans-serif';
  ctx.fillText('$', 80, sceneCY + 80);
  ctx.fillText('$', W - 80, sceneCY + 80);
  ctx.restore();

  if (success) {
    drawRays(ctx, W / 2, sceneCY - 10, 80, 200, 12, 'rgba(255,215,0,0.03)', 1);

    const vaultX = W / 2 - 75;
    const vaultY = sceneCY - 75;
    const vaultW = 150;
    const vaultH = 130;

    const dial = drawVault(ctx, vaultX, vaultY, vaultW, vaultH, '#FFD700', 'rgba(255,215,0,0.3)');

    const banditX = vaultX - 140;
    const banditY = sceneCY;

    drawBandit(ctx, banditX, banditY, accent);

    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255,215,0,0.5)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(banditX + 22, banditY + 10);
    ctx.quadraticCurveTo(banditX + 70, banditY - 30, vaultX + 25, vaultY + 40);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineCap = 'butt';

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,215,0,0.4)';
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(banditX + 22, banditY + 10);
    ctx.quadraticCurveTo(banditX + 70, banditY - 30, vaultX + 25, vaultY + 40);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < 18; i++) {
      const t = i / 18;
      const baseX = banditX + 22 + (vaultX + 25 - banditX - 22) * t;
      const baseY = banditY + 10 + (vaultY + 40 - banditY - 10) * t;
      const cx = baseX + Math.sin(i * 1.8 + 0.5) * 18;
      const cy = baseY - Math.sin(i * 1.8) * 25 - t * 15;
      const r = 8 + Math.sin(i * 0.5) * 3;
      drawCoin(ctx, cx, cy, r, 0.9 - t * 0.3, i * 0.4);
    }

    for (let i = 0; i < 10; i++) {
      const cx = vaultX + vaultW + 20 + Math.random() * 60;
      const cy = vaultY + 15 + Math.random() * 100;
      drawCoin(ctx, cx, cy, 9, 0.5 + Math.random() * 0.2, Math.random() * Math.PI);
    }

    for (let i = 0; i < 8; i++) {
      const cx = vaultX - 35 - Math.random() * 45;
      const cy = vaultY + vaultH - 15 + Math.random() * 35;
      drawCoin(ctx, cx, cy, 7, 0.4 + Math.random() * 0.2, Math.random() * Math.PI);
    }

    drawCoinPile(ctx, vaultX + vaultW + 50, sceneCY + 50, 12, 10);
    drawCoinPile(ctx, banditX - 40, sceneCY + 55, 8, 8);

    if (stolenXp > 0) {
      const xpStartX = banditX + 18;
      const xpStartY = banditY + 25;
      const xpEndX = vaultX + 35;
      const xpEndY = vaultY + vaultH - 25;
      const xpMidX = (xpStartX + xpEndX) / 2 + 20;
      const xpMidY = (xpStartY + xpEndY) / 2 + 40;

      ctx.strokeStyle = '#5865F2';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(88,101,242,0.6)';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(xpStartX, xpStartY);
      ctx.quadraticCurveTo(xpMidX, xpMidY, xpEndX, xpEndY);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineCap = 'butt';

      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(88,101,242,0.3)';
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(xpStartX, xpStartY);
      ctx.quadraticCurveTo(xpMidX, xpMidY, xpEndX, xpEndY);
      ctx.stroke();
      ctx.setLineDash([]);

      for (let i = 0; i < 14; i++) {
        const t = i / 14;
        const bx = (1 - t) * (1 - t) * xpStartX + 2 * (1 - t) * t * xpMidX + t * t * xpEndX;
        const by = (1 - t) * (1 - t) * xpStartY + 2 * (1 - t) * t * xpMidY + t * t * xpEndY;
        const ox = bx + Math.sin(i * 2.5 + 1) * 15;
        const oy = by + Math.cos(i * 2.5) * 10 - t * 8;
        const orbR = 10 + Math.sin(i * 0.4) * 2;
        ctx.save();
        ctx.globalAlpha = 0.95 - t * 0.25;
        ctx.shadowColor = 'rgba(88,101,242,0.5)';
        ctx.shadowBlur = 6;
        const og = ctx.createRadialGradient(ox - orbR * 0.3, oy - orbR * 0.3, 1, ox, oy, orbR);
        og.addColorStop(0, '#C0D0FF');
        og.addColorStop(0.4, '#7B8CFF');
        og.addColorStop(0.8, '#5865F2');
        og.addColorStop(1, '#2A35A0');
        ctx.fillStyle = og;
        ctx.beginPath();
        ctx.arc(ox, oy, orbR, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#7B8CFF';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(ox, oy, orbR * 0.85, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#3A45A0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ox, oy, orbR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#E0E8FF';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('XP', ox, oy + 1);
        ctx.restore();
      }

      const xpBoxX = banditX + 5;
      const xpBoxY = banditY + 52;
      const xpBoxW = 90;
      const xpBoxH = 22;
      ctx.save();
      ctx.fillStyle = 'rgba(88,101,242,0.15)';
      roundRect(ctx, xpBoxX, xpBoxY, xpBoxW, xpBoxH, 5);
      ctx.fill();
      ctx.strokeStyle = '#5865F2';
      ctx.lineWidth = 1.5;
      roundRect(ctx, xpBoxX, xpBoxY, xpBoxW, xpBoxH, 5);
      ctx.stroke();
      ctx.fillStyle = '#A0B4FF';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+${stolenXp.toLocaleString()} XP`, xpBoxX + xpBoxW / 2, xpBoxY + xpBoxH / 2 + 1);
      ctx.restore();

      for (let i = 0; i < 5; i++) {
        drawSparkle(ctx, xpBoxX + Math.random() * xpBoxW, xpBoxY - 5 + Math.random() * 5, 3, '#7B8CFF', 0.4);
      }

      ctx.save();
      ctx.fillStyle = '#5865F2';
      ctx.globalAlpha = 0.1;
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('XP', xpMidX, xpMidY + 5);
      ctx.restore();
    }

    for (let i = 0; i < 14; i++) {
      const sx = banditX - 45 + Math.random() * 300;
      const sy = vaultY - 40 + Math.random() * 60;
      drawSparkle(ctx, sx, sy, 4 + Math.random() * 5, '#FFD700', 0.2 + Math.random() * 0.4);
    }

    for (let i = 0; i < 8; i++) {
      drawStar(ctx, banditX - 40 + i * 11, banditY - 60 + Math.sin(i * 2) * 12, 4, 6, 2.5, 'rgba(255,215,0,0.5)');
    }

    for (let i = 0; i < 12; i++) {
      const fx = 40 + Math.random() * (W - 80);
      const fy = 70 + Math.random() * 25;
      drawParticle(ctx, fx, fy, 1.5 + Math.random(), '#FFD700', 0.12 + Math.random() * 0.18);
    }

    for (let i = 0; i < 8; i++) {
      const lx = vaultX + vaultW / 2 + Math.cos(i * 0.9) * 100;
      const ly = vaultY + vaultH / 2 + Math.sin(i * 0.9) * 55;
      drawSparkle(ctx, lx, ly, 5 + Math.random() * 2, '#FFD700', 0.15 + Math.random() * 0.15);
    }

    for (let i = 0; i < 6; i++) {
      const sx = vaultX + vaultW + 40 + Math.random() * 50;
      const sy = sceneCY + 30 + Math.random() * 40;
      drawStar(ctx, sx, sy, 5, 5, 2, 'rgba(255,215,0,0.3)', 0.5);
    }

    for (let i = 0; i < 5; i++) {
      const sx = banditX - 50 + Math.random() * 40;
      const sy = sceneCY + 30 + Math.random() * 40;
      drawStar(ctx, sx, sy, 5, 5, 2, 'rgba(255,215,0,0.3)', 0.5);
    }

    ctx.save();
    ctx.fillStyle = '#FFD700';
    ctx.globalAlpha = 0.08;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BUTIN', vaultX + vaultW + 55, sceneCY + 30);
    ctx.fillText('BUTIN', banditX - 45, sceneCY + 35);
    ctx.restore();

    ctx.fillStyle = '#8b95a7';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BANDIT', banditX, banditY + 75);
    ctx.fillText('COFFRE', vaultX + vaultW / 2, vaultY + vaultH + 18);

    ctx.strokeStyle = 'rgba(255,215,0,0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(banditX, banditY + 82);
    ctx.lineTo(banditX, banditY + 88);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(vaultX + vaultW / 2, vaultY + vaultH + 22);
    ctx.lineTo(vaultX + vaultW / 2, vaultY + vaultH + 28);
    ctx.stroke();
    ctx.setLineDash([]);

  } else if (blocked) {
    const vaultX = W / 2 - 75;
    const vaultY = sceneCY - 65;
    const vaultW = 150;
    const vaultH = 120;

    drawVault(ctx, vaultX, vaultY, vaultW, vaultH, '#5865F2', 'rgba(88,101,242,0.3)');

    drawShield(ctx, W / 2, sceneCY - 5, 38, '#5865F2', 'rgba(88,101,242,0.5)');

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + 0.3;
      const dist = 55 + Math.sin(i) * 10;
      const x = W / 2 + Math.cos(angle) * dist;
      const y = sceneCY - 5 + Math.sin(angle) * dist * 0.7;
      drawStar(ctx, x, y, 4, 6, 2.5, 'rgba(88,101,242,0.4)', 0.6);
    }

    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 - 0.5;
      const x = W / 2 + Math.cos(angle) * 80;
      const y = sceneCY - 5 + Math.sin(angle) * 60;
      drawSparkle(ctx, x, y, 5, '#5865F2', 0.4);
    }

    drawRays(ctx, W / 2, sceneCY - 5, 45, 120, 8, 'rgba(88,101,242,0.04)', 1);

    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const dist = 70 + Math.sin(i * 2) * 15;
      const x = W / 2 + Math.cos(angle) * dist;
      const y = sceneCY - 5 + Math.sin(angle) * dist * 0.65;
      drawParticle(ctx, x, y, 1.5 + Math.random(), '#5865F2', 0.1 + Math.random() * 0.15);
    }

    ctx.save();
    ctx.fillStyle = '#5865F2';
    ctx.globalAlpha = 0.08;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PROTEGE', W / 2, sceneCY + 55);
    ctx.restore();

    ctx.fillStyle = '#8b95a7';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('COFFRE PROTEGE', vaultX + vaultW / 2, vaultY + vaultH + 18);

  } else {
    const vaultX = W / 2 - 75;
    const vaultY = sceneCY - 65;
    const vaultW = 150;
    const vaultH = 120;

    drawVault(ctx, vaultX, vaultY, vaultW, vaultH, '#ED4245', 'rgba(237,66,69,0.2)');

    drawWarningSign(ctx, W / 2, sceneCY - 5, 30, '#ED4245');

    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 2 + (i - 2) * 0.5;
      const x = W / 2 + Math.cos(angle) * 60;
      const y = sceneCY - 5 + Math.sin(angle) * 40 - 20;
      drawBolt(ctx, x, y, 8, '#ED4245', 0.3 + Math.random() * 0.2);
    }

    for (let i = 0; i < 6; i++) {
      const x = vaultX + 20 + Math.random() * (vaultW - 40);
      const y = vaultY + 20 + Math.random() * (vaultH - 40);
      drawSparkle(ctx, x, y, 4, '#ED4245', 0.3);
    }

    for (let i = 0; i < 8; i++) {
      const px = 40 + Math.random() * (W - 80);
      const py = 80 + Math.random() * 250;
      drawParticle(ctx, px, py, 1.5, '#ED4245', 0.08 + Math.random() * 0.1);
    }

    ctx.save();
    ctx.fillStyle = '#ED4245';
    ctx.globalAlpha = 0.08;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ECHEC', W / 2, sceneCY + 55);
    ctx.restore();

    ctx.fillStyle = '#8b95a7';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('COFFRE INTACT', vaultX + vaultW / 2, vaultY + vaultH + 18);
  }

  const resultY = 400;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  roundRect(ctx, 40, resultY - 22, W - 80, 80, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  roundRect(ctx, 40, resultY - 22, W - 80, 80, 10);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = accent;
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let resultText = '';
  if (success) {
    resultText = '◆ VOL REUSSI !';
  } else if (blocked) {
    resultText = '◊ VOL BLOQUE !';
  } else {
    resultText = '× VOL RATE !';
  }
  ctx.fillText(resultText, W / 2, resultY);

  if (success) {
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(`+${fmtCoins(stolenCoins)} coins (${stealPercent.toFixed(1)}%)`, W / 2, resultY + 28);

    if (stolenXp > 0) {
      ctx.fillStyle = '#5865F2';
      ctx.font = 'bold 17px sans-serif';
      ctx.fillText(`+${stolenXp.toLocaleString()} XP`, W / 2, resultY + 50);
    }

    ctx.fillStyle = '#8b95a7';
    ctx.font = '15px sans-serif';
    ctx.fillText(`Solde : ${fmtCoins(finalCoins)} coins`, W / 2, resultY + (stolenXp > 0 ? 72 : 52));
  } else if (blocked) {
    ctx.fillStyle = '#8b95a7';
    ctx.font = '16px sans-serif';
    ctx.fillText(`Bouclier consomme (${shieldsLeft} restant(s))`, W / 2, resultY + 28);
  } else {
    ctx.fillStyle = '#8b95a7';
    ctx.font = '16px sans-serif';
    ctx.fillText('Retente ta chance plus tard', W / 2, resultY + 28);
  }

  return await canvas.toBuffer('png');
}

module.exports = { generateVolImage };
