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

const W = 600;
const H = 680;
const GRID = 5;
const CELL = 90;
const GAP = 10;
const GRID_W = GRID * CELL + (GRID - 1) * GAP;
const GRID_X = (W - GRID_W) / 2;
const GRID_Y = 160;

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

function drawCell(ctx, x, y, state) {
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;

  if (state === 'hidden') {
    const grad = ctx.createLinearGradient(x, y, x + CELL, y + CELL);
    grad.addColorStop(0, '#2a2a3e');
    grad.addColorStop(1, '#222234');
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, CELL, CELL, 12);
    ctx.fill();
    ctx.strokeStyle = '#3a3a5e';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, CELL, CELL, 12);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 3, y + 3, CELL - 6, CELL - 6, 9);
    ctx.stroke();
    ctx.fillStyle = '#4a4a6e';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', cx, cy + 2);
  } else if (state === 'safe') {
    ctx.save();
    ctx.shadowColor = '#57F287';
    ctx.shadowBlur = 12;
    const grad = ctx.createRadialGradient(cx, cy, 5, cx, cy, CELL / 2);
    grad.addColorStop(0, '#1a4a2a');
    grad.addColorStop(1, '#1a3a2a');
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, CELL, CELL, 12);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#57F287';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, CELL, CELL, 12);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(87,242,135,0.3)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 3, y + 3, CELL - 6, CELL - 6, 9);
    ctx.stroke();
    ctx.fillStyle = '#57F287';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('◇', cx, cy + 2);
  } else if (state === 'bomb') {
    ctx.save();
    ctx.shadowColor = '#ED4245';
    ctx.shadowBlur = 15;
    const grad = ctx.createRadialGradient(cx, cy, 5, cx, cy, CELL / 2);
    grad.addColorStop(0, '#4a1a1a');
    grad.addColorStop(1, '#3a1a1a');
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, CELL, CELL, 12);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#ED4245';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, CELL, CELL, 12);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(237,66,69,0.3)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 3, y + 3, CELL - 6, CELL - 6, 9);
    ctx.stroke();
    ctx.fillStyle = '#ED4245';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✸', cx, cy + 2);
  } else if (state === 'bomb_hidden') {
    ctx.fillStyle = '#2a1a2a';
    roundRect(ctx, x, y, CELL, CELL, 12);
    ctx.fill();
    ctx.strokeStyle = '#5a3a5a';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, CELL, CELL, 12);
    ctx.stroke();
    ctx.fillStyle = '#ED4245';
    ctx.globalAlpha = 0.4;
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✸', cx, cy + 2);
    ctx.globalAlpha = 1;
  } else if (state === 'safe_hidden') {
    ctx.fillStyle = '#1a2a1a';
    roundRect(ctx, x, y, CELL, CELL, 12);
    ctx.fill();
    ctx.strokeStyle = '#3a5a3a';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, CELL, CELL, 12);
    ctx.stroke();
    ctx.fillStyle = '#57F287';
    ctx.globalAlpha = 0.4;
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('◇', cx, cy + 2);
    ctx.globalAlpha = 1;
  }
}

async function generateMineImage({ bombs, revealed, bombCount, amount, winAmount, finalCoins, state, safeClicked, mult, maxMult }) {
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');

  const accent = state === 'dead' ? '#ED4245' : '#57F287';

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
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('■ MINES', 30, 35);

  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.08;
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('5×5 GRID', W / 2, 55);
  ctx.restore();

  ctx.fillStyle = '#8b95a7';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`Mise : ${fmtCoins(amount)} ・ ${bombCount} bombes`, W - 30, 35);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(30, 70);
  ctx.lineTo(W - 30, 70);
  ctx.stroke();

  drawCornerOrnaments(ctx, W, H, accent, 0.1);

  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.fillStyle = accent;
  ctx.font = 'bold 60px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('■', W / 2, H / 2);
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

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  roundRect(ctx, GRID_X - 10, GRID_Y - 10, GRID_W + 20, GRID_W + 20, 8);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  roundRect(ctx, GRID_X - 18, GRID_Y - 18, GRID_W + 36, GRID_W + 36, 10);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.06;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('◇ SAFE', GRID_X - 10 + 40, GRID_Y - 22);
  ctx.fillStyle = '#ED4245';
  ctx.fillText('✸ BOMB', GRID_X + GRID_W - 30, GRID_Y - 22);
  ctx.restore();

  const infoY = 95;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  roundRect(ctx, 20, infoY - 16, W - 40, 32, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  roundRect(ctx, 20, infoY - 16, W - 40, 32, 8);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#8b95a7';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Cases sûres : ${safeClicked} / ${GRID * GRID - bombCount}`, 30, infoY);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(`Cote : x${mult.toFixed(2)} / max x${maxMult.toFixed(2)}`, W - 30, infoY);

  ctx.fillStyle = accent;
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let resultText = '';
  if (state === 'dead') {
    resultText = `‼ BOMBE ! Perdu -${fmtCoins(amount)} coins`;
  } else if (state === 'cashout') {
    resultText = `✓ CASH OUT ! +${fmtCoins(winAmount - amount)} coins`;
  } else if (state === 'cleared') {
    resultText = `✓ GRILLE CLEARED ! +${fmtCoins(winAmount - amount)} coins`;
  }

  ctx.fillText(resultText, W / 2, infoY + 35);

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const idx = r * GRID + c;
      const x = GRID_X + c * (CELL + GAP);
      const y = GRID_Y + r * (CELL + GAP);
      const isRevealed = revealed.has(idx);
      const isBomb = bombs.has(idx);

      let cellState;
      if (isRevealed) {
        cellState = isBomb ? 'bomb' : 'safe';
      } else {
        if (state === 'dead' || state === 'cashout' || state === 'cleared') {
          cellState = isBomb ? 'bomb_hidden' : 'safe_hidden';
        } else {
          cellState = 'hidden';
        }
      }
      drawCell(ctx, x, y, cellState);
    }
  }

  const soldeY = GRID_Y + GRID * (CELL + GAP) + 5;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  roundRect(ctx, 40, soldeY - 16, W - 80, 32, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  roundRect(ctx, 40, soldeY - 16, W - 80, 32, 8);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#8b95a7';
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Solde : ${fmtCoins(finalCoins)} coins`, W / 2, soldeY);

  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.05;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('MIN: 10', 30, H - 15);
  ctx.textAlign = 'right';
  ctx.fillText('MAX: 50000', W - 30, H - 15);
  ctx.restore();

  if (state === 'cashout' || state === 'cleared') {
    for (let i = 0; i < 14; i++) {
      const sx = GRID_X + Math.random() * GRID_W;
      const sy = GRID_Y + Math.random() * GRID_W;
      drawSparkle(ctx, sx, sy, 3 + Math.random() * 4, '#57F287', 0.2 + Math.random() * 0.25);
    }
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const x = W / 2 + Math.cos(angle) * (GRID_W / 2 + 30);
      const y = GRID_Y + GRID_W / 2 + Math.sin(angle) * (GRID_W / 2 + 30);
      drawSparkle(ctx, x, y, 4, '#FFD700', 0.25);
    }
  } else if (state === 'dead') {
    for (let i = 0; i < 10; i++) {
      const sx = GRID_X + Math.random() * GRID_W;
      const sy = GRID_Y + Math.random() * GRID_W;
      drawSparkle(ctx, sx, sy, 3 + Math.random() * 2, '#ED4245', 0.15 + Math.random() * 0.2);
    }
  }

  return await canvas.toBuffer('png');
}

module.exports = { generateMineImage };
