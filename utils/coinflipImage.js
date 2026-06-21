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
const H = 400;

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

async function generateCoinflipImage({ choice, result, win, amount, cote, netGain, finalCoins, bonuses }) {
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');

  const accent = win ? '#57F287' : '#ED4245';
  const goldA = win ? '#FFD700' : '#FFD700';
  const goldB = win ? '#B8860B' : '#8B6914';

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
  ctx.fillStyle = '#FFD700';
  ctx.globalAlpha = 0.05;
  ctx.fillRect(0, 0, W, 70);
  ctx.restore();

  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('◎ COINFLIP', 30, 35);

  ctx.fillStyle = '#8b95a7';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`Mise : ${fmtCoins(amount)} coins`, W - 30, 35);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(30, 70);
  ctx.lineTo(W - 30, 70);
  ctx.stroke();

  drawCornerOrnaments(ctx, W, H, '#FFD700', 0.1);

  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 60px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', W / 2, H / 2 + 10);
  ctx.restore();

  for (let i = 0; i < 12; i++) {
    const px = 30 + Math.random() * (W - 60);
    const py = 75 + Math.random() * (H - 150);
    ctx.save();
    ctx.globalAlpha = 0.04 + Math.random() * 0.06;
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(px, py, 1 + Math.random() * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const coinCX = W / 2;
  const coinCY = 200;
  const coinR = 75;

  ctx.save();
  ctx.shadowColor = goldA;
  ctx.shadowBlur = 30;
  const coinGrad = ctx.createRadialGradient(coinCX - 20, coinCY - 20, 10, coinCX, coinCY, coinR);
  coinGrad.addColorStop(0, '#FFE55C');
  coinGrad.addColorStop(0.5, goldA);
  coinGrad.addColorStop(1, goldB);
  ctx.fillStyle = coinGrad;
  ctx.beginPath();
  ctx.arc(coinCX, coinCY, coinR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = goldB;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(coinCX, coinCY, coinR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(coinCX - 15, coinCY - 15, 55, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,215,0,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(coinCX, coinCY, coinR - 8, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,215,0,0.2)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(coinCX, coinCY, coinR + 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(255,215,0,0.1)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.arc(coinCX, coinCY, coinR + 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const x1 = coinCX + Math.cos(angle) * (coinR - 5);
    const y1 = coinCY + Math.sin(angle) * (coinR - 5);
    const x2 = coinCX + Math.cos(angle) * (coinR + 5);
    const y2 = coinCY + Math.sin(angle) * (coinR + 5);
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = goldB;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const x = coinCX + Math.cos(angle) * (coinR + 20);
    const y = coinCY + Math.sin(angle) * (coinR + 20);
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = goldB;
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const x = coinCX + Math.cos(angle) * (coinR - 15);
    const y = coinCY + Math.sin(angle) * (coinR - 15);
    ctx.fillText('★', x, y);
  }
  ctx.restore();

  if (win) {
    for (let i = 0; i < 14; i++) {
      const sx = coinCX - 100 + Math.random() * 200;
      const sy = coinCY - 100 + Math.random() * 200;
      drawSparkle(ctx, sx, sy, 3 + Math.random() * 4, '#FFD700', 0.2 + Math.random() * 0.3);
    }
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const x = coinCX + Math.cos(angle) * (coinR + 35);
      const y = coinCY + Math.sin(angle) * (coinR + 35);
      drawSparkle(ctx, x, y, 4, '#57F287', 0.4);
    }
  } else {
    for (let i = 0; i < 8; i++) {
      const sx = coinCX - 80 + Math.random() * 160;
      const sy = coinCY - 80 + Math.random() * 160;
      drawSparkle(ctx, sx, sy, 3, '#ED4245', 0.15 + Math.random() * 0.15);
    }
  }

  ctx.fillStyle = goldB;
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (result === 'pile') {
    ctx.fillText('P', coinCX, coinCY + 2);
  } else {
    ctx.fillText('F', coinCX, coinCY + 2);
  }

  ctx.fillStyle = '#8b95a7';
  ctx.font = '13px sans-serif';
  ctx.fillText(result.toUpperCase(), coinCX, coinCY + coinR + 18);

  const leftX = 50;
  const rightX = W - 50;
  const choiceY = 105;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  roundRect(ctx, 30, choiceY - 12, 160, 52, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  roundRect(ctx, 30, choiceY - 12, 160, 52, 8);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  roundRect(ctx, W - 190, choiceY - 12, 160, 52, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  roundRect(ctx, W - 190, choiceY - 12, 160, 52, 8);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#8b95a7';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Ton choix', leftX, choiceY);
  ctx.textAlign = 'right';
  ctx.fillText('Cote', rightX, choiceY);

  ctx.fillStyle = accent;
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(choice.toUpperCase(), leftX, choiceY + 24);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.fillText(`x${cote.toFixed(2)}`, rightX, choiceY + 24);

  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.06;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PILE', coinCX - coinR - 50, coinCY);
  ctx.fillText('FACE', coinCX + coinR + 50, coinCY);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,215,0,0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(coinCX - coinR - 30, coinCY);
  ctx.lineTo(coinCX - coinR - 5, coinCY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(coinCX + coinR + 5, coinCY);
  ctx.lineTo(coinCX + coinR + 30, coinCY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  const resultY = 320;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  roundRect(ctx, 40, resultY - 18, W - 80, 40, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  roundRect(ctx, 40, resultY - 18, W - 80, 40, 8);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = accent;
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (win) {
    ctx.fillText(`✦ GAGNE !  +${fmtCoins(netGain)} coins`, W / 2, resultY);
  } else {
    ctx.fillText(`× Perdu  -${fmtCoins(amount)} coins`, W / 2, resultY);
  }

  if (bonuses && bonuses.length) {
    ctx.fillStyle = '#FFD700';
    ctx.font = '13px sans-serif';
    ctx.fillText(`Bonus : ${bonuses.join(' ・ ')}`, W / 2, resultY + 25);
  }

  ctx.fillStyle = '#8b95a7';
  ctx.font = '15px sans-serif';
  ctx.fillText(`Solde : ${fmtCoins(finalCoins)} coins`, W / 2, resultY + (bonuses && bonuses.length ? 48 : 28));

  ctx.save();
  ctx.fillStyle = '#FFD700';
  ctx.globalAlpha = 0.05;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('MIN: 10', 30, H - 15);
  ctx.textAlign = 'right';
  ctx.fillText('MAX: 50000', W - 30, H - 15);
  ctx.restore();

  return await canvas.toBuffer('png');
}

module.exports = { generateCoinflipImage };
