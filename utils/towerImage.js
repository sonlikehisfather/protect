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

const W = 650;

const DIFF_COLORS = {
  easy:   { accent: '#57F287', dark: '#1a3a2a', label: 'EASY',   mult: 1.5 },
  medium: { accent: '#5865F2', dark: '#1a2a4a', label: 'MEDIUM', mult: 2 },
  hard:   { accent: '#ED4245', dark: '#3a1a1a', label: 'HARD',   mult: 3 },
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

function floorMultVal(diffKey, floor) {
  const base = DIFF_COLORS[diffKey]?.mult || 2;
  return parseFloat(Math.pow(base, floor).toFixed(2));
}
function floorMultDisplay(diffKey, floor) {
  return floorMultVal(diffKey, floor).toFixed(2);
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

async function generateTowerImage({ diffKey, floors, tiles, currentFloor, floorBombs, allFloorBombs, revealedFloor, revealedPick, gameOver, won, cashedOut, amount, winAmount, netGain, finalCoins }) {
  const dc = DIFF_COLORS[diffKey] || DIFF_COLORS.medium;
  const accent = gameOver ? (won || cashedOut ? '#57F287' : '#ED4245') : dc.accent;

  const FLOOR_H = 50;
  const FLOOR_GAP = 6;
  const FLOOR_LABEL_W = 70;
  const TILE_W = 75;
  const TILE_GAP = 8;
  const tilesW = tiles * TILE_W + (tiles - 1) * TILE_GAP;
  const towerW = FLOOR_LABEL_W + tilesW + 30;
  const towerX = (W - towerW) / 2;

  const headerH = 170;
  const towerH = floors * (FLOOR_H + FLOOR_GAP) - FLOOR_GAP + 10;
  const footerH = 80;
  const H = headerH + towerH + footerH;

  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');

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
  ctx.fillStyle = dc.accent;
  ctx.globalAlpha = 0.05;
  ctx.fillRect(0, 0, W, 70);
  ctx.restore();

  ctx.fillStyle = dc.accent;
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('▲ TOWER', 30, 35);

  ctx.save();
  ctx.fillStyle = dc.accent;
  ctx.globalAlpha = 0.08;
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${dc.label} MODE`, W / 2, 55);
  ctx.restore();

  ctx.fillStyle = '#8b95a7';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`Mise : ${fmtCoins(amount)} coins`, W - 30, 35);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(30, 70);
  ctx.lineTo(W - 30, 70);
  ctx.stroke();

  drawCornerOrnaments(ctx, W, H, accent, 0.1);

  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.fillStyle = dc.accent;
  ctx.font = 'bold 60px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('▲', W / 2, H / 2);
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

  const displayFloor = gameOver ? (won || cashedOut ? currentFloor : currentFloor + 1) : currentFloor + 1;
  const displayMult = gameOver && (won || cashedOut) ? floorMultDisplay(diffKey, currentFloor) : floorMultDisplay(diffKey, currentFloor + 1);

  ctx.fillStyle = dc.accent;
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(dc.label, W / 2, 92);

  ctx.fillStyle = '#8b95a7';
  ctx.font = '14px sans-serif';
  ctx.fillText(`Etage : ${displayFloor}/${floors} ・ x${displayMult}`, W / 2, 115);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(W / 2 - 100, 128);
  ctx.lineTo(W / 2 + 100, 128);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  const maxMult = floorMultVal(diffKey, floors);
  const maxWin = Math.floor(amount * maxMult);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px sans-serif';
  if (gameOver) {
    if (won || cashedOut) {
      ctx.fillText(`Gain : +${fmtCoins(netGain)} coins`, W / 2, 138);
    } else {
      ctx.fillText(`Perte : -${fmtCoins(amount)} coins`, W / 2, 138);
    }
  } else {
    ctx.fillText(`Gain potentiel : ${fmtCoins(Math.floor(amount * floorMultVal(diffKey, currentFloor + 1)))} coins`, W / 2, 138);
  }

  ctx.fillStyle = '#555566';
  ctx.font = '12px sans-serif';
  ctx.fillText(`Sommet : x${maxMult.toFixed(2)} = ${fmtCoins(maxWin)} coins max`, W / 2, 158);

  ctx.save();
  ctx.fillStyle = dc.accent;
  ctx.globalAlpha = 0.06;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('EASY x1.5', 30, H - 15);
  ctx.textAlign = 'center';
  ctx.fillText('MEDIUM x2', W / 2, H - 15);
  ctx.textAlign = 'right';
  ctx.fillText('HARD x3', W - 30, H - 15);
  ctx.restore();

  const towerStartY = headerH;
  const tilesStartX = towerX + FLOOR_LABEL_W + 15;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  roundRect(ctx, towerX - 8, towerStartY - 8, towerW + 16, towerH + 16, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  roundRect(ctx, towerX - 8, towerStartY - 8, towerW + 16, towerH + 16, 12);
  ctx.stroke();
  ctx.restore();

  for (let f = floors - 1; f >= 0; f--) {
    const fy = towerStartY + (floors - 1 - f) * (FLOOR_H + FLOOR_GAP);
    const isCurrent = f === currentFloor && !gameOver;
    const isPassed = f < currentFloor || (gameOver && (won || cashedOut) && f < currentFloor);
    const isFailed = gameOver && !won && !cashedOut && f === currentFloor;

    ctx.fillStyle = isPassed ? 'rgba(87,242,135,0.06)' : isCurrent ? 'rgba(255,255,255,0.04)' : isFailed ? 'rgba(237,66,69,0.06)' : 'rgba(255,255,255,0.015)';
    roundRect(ctx, towerX, fy, towerW, FLOOR_H, 8);
    ctx.fill();

    ctx.strokeStyle = isPassed ? 'rgba(87,242,135,0.2)' : isCurrent ? accent : isFailed ? 'rgba(237,66,69,0.2)' : 'rgba(255,255,255,0.04)';
    ctx.lineWidth = isCurrent ? 2 : 1;
    roundRect(ctx, towerX, fy, towerW, FLOOR_H, 8);
    ctx.stroke();

    if (isCurrent) {
      ctx.save();
      ctx.shadowColor = accent;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      roundRect(ctx, towerX, fy, towerW, FLOOR_H, 8);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = isPassed ? '#57F287' : isCurrent ? accent : isFailed ? '#ED4245' : '#444455';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`E${f + 1}`, towerX + FLOOR_LABEL_W / 2, fy + FLOOR_H / 2 - 8);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = isPassed ? 'rgba(87,242,135,0.6)' : isCurrent ? 'rgba(255,255,255,0.4)' : '#333344';
    ctx.fillText(`x${floorMultDisplay(diffKey, f + 1)}`, towerX + FLOOR_LABEL_W / 2, fy + FLOOR_H / 2 + 8);

    for (let t = 0; t < tiles; t++) {
      const tx = tilesStartX + t * (TILE_W + TILE_GAP);
      const ty = fy + (FLOOR_H - 36) / 2;
      const isBomb = (allFloorBombs && allFloorBombs[f] && allFloorBombs[f].has(t)) || (floorBombs && floorBombs.has(t));
      const isPick = t === revealedPick;

      if (isPassed) {
        const fBombs = allFloorBombs ? allFloorBombs[f] : null;
        if (fBombs && fBombs.has(t)) {
          ctx.fillStyle = 'rgba(237,66,69,0.08)';
          roundRect(ctx, tx, ty, TILE_W, 36, 5);
          ctx.fill();
          ctx.strokeStyle = 'rgba(237,66,69,0.3)';
          ctx.lineWidth = 1;
          roundRect(ctx, tx, ty, TILE_W, 36, 5);
          ctx.stroke();
          ctx.fillStyle = 'rgba(237,66,69,0.4)';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('bombe', tx + TILE_W / 2, ty + 18);
        } else {
          ctx.fillStyle = 'rgba(87,242,135,0.12)';
          roundRect(ctx, tx, ty, TILE_W, 36, 5);
          ctx.fill();
          ctx.strokeStyle = '#57F287';
          ctx.lineWidth = 1.5;
          roundRect(ctx, tx, ty, TILE_W, 36, 5);
          ctx.stroke();
          ctx.fillStyle = '#57F287';
          ctx.font = 'bold 15px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('✓', tx + TILE_W / 2, ty + 18);
        }
      } else if (isCurrent && revealedFloor === f) {
        if (isBomb) {
          ctx.fillStyle = 'rgba(237,66,69,0.2)';
          roundRect(ctx, tx, ty, TILE_W, 36, 5);
          ctx.fill();
          ctx.strokeStyle = '#ED4245';
          ctx.lineWidth = 2;
          roundRect(ctx, tx, ty, TILE_W, 36, 5);
          ctx.stroke();
          ctx.fillStyle = '#ED4245';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('BOMBE', tx + TILE_W / 2, ty + 18);
        } else {
          ctx.fillStyle = 'rgba(87,242,135,0.2)';
          roundRect(ctx, tx, ty, TILE_W, 36, 5);
          ctx.fill();
          ctx.strokeStyle = '#57F287';
          ctx.lineWidth = 2;
          roundRect(ctx, tx, ty, TILE_W, 36, 5);
          ctx.stroke();
          ctx.fillStyle = '#57F287';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('SAFE', tx + TILE_W / 2, ty + 18);
        }
      } else if (isCurrent) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        roundRect(ctx, tx, ty, TILE_W, 36, 5);
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        roundRect(ctx, tx, ty, TILE_W, 36, 5);
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`T${t + 1}`, tx + TILE_W / 2, ty + 18);
      } else if (isFailed) {
        if (isBomb && isPick) {
          ctx.save();
          ctx.shadowColor = '#ED4245';
          ctx.shadowBlur = 12;
          ctx.fillStyle = 'rgba(237,66,69,0.3)';
          roundRect(ctx, tx, ty, TILE_W, 36, 5);
          ctx.fill();
          ctx.restore();
          ctx.strokeStyle = '#ED4245';
          ctx.lineWidth = 2.5;
          roundRect(ctx, tx, ty, TILE_W, 36, 5);
          ctx.stroke();
          ctx.fillStyle = '#ED4245';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('CLIQUÉ', tx + TILE_W / 2, ty + 12);
          ctx.font = 'bold 10px sans-serif';
          ctx.fillText('BOMBE', tx + TILE_W / 2, ty + 25);
        } else if (isBomb) {
          ctx.fillStyle = 'rgba(237,66,69,0.1)';
          roundRect(ctx, tx, ty, TILE_W, 36, 5);
          ctx.fill();
          ctx.strokeStyle = 'rgba(237,66,69,0.4)';
          ctx.lineWidth = 1;
          roundRect(ctx, tx, ty, TILE_W, 36, 5);
          ctx.stroke();
          ctx.fillStyle = 'rgba(237,66,69,0.5)';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('bombe', tx + TILE_W / 2, ty + 18);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.02)';
          roundRect(ctx, tx, ty, TILE_W, 36, 5);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.06)';
          ctx.lineWidth = 1;
          roundRect(ctx, tx, ty, TILE_W, 36, 5);
          ctx.stroke();
          ctx.fillStyle = '#333344';
          ctx.font = '13px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('—', tx + TILE_W / 2, ty + 18);
        }
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.015)';
        roundRect(ctx, tx, ty, TILE_W, 36, 5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        roundRect(ctx, tx, ty, TILE_W, 36, 5);
        ctx.stroke();
        ctx.fillStyle = '#2a2a3a';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('—', tx + TILE_W / 2, ty + 18);
      }
    }
  }

  const resultY = headerH + towerH + 12;

  ctx.fillStyle = accent;
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let resultText = '';
  if (gameOver) {
    if (cashedOut) {
      resultText = `✸ Encaisse ! Etage ${currentFloor} ・ +${fmtCoins(netGain)} coins`;
    } else if (won) {
      resultText = `★ SOMMET ! x${floorMultDisplay(diffKey, floors)} ・ +${fmtCoins(netGain)} coins`;
    } else {
      resultText = `‼ BOMBE ! Etage ${currentFloor + 1} ・ -${fmtCoins(amount)} coins`;
    }
  } else {
    resultText = 'En cours...';
  }
  ctx.fillText(resultText, W / 2, resultY);

  ctx.fillStyle = '#8b95a7';
  ctx.font = '14px sans-serif';
  ctx.fillText(`Solde : ${fmtCoins(finalCoins)} coins`, W / 2, resultY + 22);

  if (gameOver) {
    ctx.fillStyle = '#555566';
    ctx.font = '12px sans-serif';
    const coteInfo = won || cashedOut ? `x${floorMultDisplay(diffKey, currentFloor)}` : 'x0';
    ctx.fillText(`${dc.label} ・ Cote : ${coteInfo} ・ ${tiles} tuiles/etage`, W / 2, resultY + 42);

    if (won || cashedOut) {
      for (let i = 0; i < 14; i++) {
        const sx = 40 + Math.random() * (W - 80);
        const sy = resultY - 10 + Math.random() * 50;
        drawSparkle(ctx, sx, sy, 3 + Math.random() * 4, '#57F287', 0.2 + Math.random() * 0.25);
      }
      for (let i = 0; i < 6; i++) {
        const sx = 40 + Math.random() * (W - 80);
        const sy = resultY - 10 + Math.random() * 50;
        drawSparkle(ctx, sx, sy, 3, '#FFD700', 0.2 + Math.random() * 0.2);
      }
    } else {
      for (let i = 0; i < 10; i++) {
        const sx = 40 + Math.random() * (W - 80);
        const sy = resultY - 10 + Math.random() * 40;
        drawSparkle(ctx, sx, sy, 3 + Math.random() * 2, '#ED4245', 0.15 + Math.random() * 0.2);
      }
    }
  }

  return await canvas.toBuffer('png');
}

module.exports = { generateTowerImage };
