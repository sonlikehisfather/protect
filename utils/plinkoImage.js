'use strict';

const { Canvas } = require('skia-canvas');

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

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

function fmtCoins(n) {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'Md';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

const MULT_COLORS = {
  high:   ['#FF4444', '#FF7722', '#FFAA00', '#FFDD00', '#AAFFAA', '#88FF88', '#66FF66', '#88FF88', '#AAFFAA', '#FFDD00', '#FFAA00', '#FF7722', '#FF4444'],
  medium: ['#FF4444', '#FF7722', '#FFAA00', '#FFD700', '#AAFFAA', '#88CC88', '#66AA66', '#88CC88', '#AAFFAA', '#FFD700', '#FFAA00', '#FF7722', '#FF4444'],
  low:    ['#57F287', '#6FD98A', '#88CC88', '#A0BF88', '#B8B288', '#C8AA88', '#D8A088', '#C8AA88', '#B8B288', '#A0BF88', '#88CC88', '#6FD98A', '#57F287'],
};

async function generatePlinkoImage({ path, finalSlot, mults, risk, amount, winAmount, netGain, finalCoins, riskLabel }) {
  const ROWS = path.length;
  const SLOTS = ROWS + 1;

  const W = 900;
  const BOARD_H = 520;
  const STATS_H = 120;
  const H = BOARD_H + STATS_H;

  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── Background ──────────────────────────────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0d0d1a');
  bgGrad.addColorStop(1, '#080810');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Ambient glow from result color
  const resultColor = netGain > 0 ? '#57F287' : netGain === 0 ? '#FEE75C' : '#ED4245';
  const glowGrad = ctx.createRadialGradient(W / 2, H, 0, W / 2, H, 400);
  glowGrad.addColorStop(0, hexToRgba(resultColor, 0.12));
  glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, W, H);

  // Border
  ctx.strokeStyle = hexToRgba(resultColor, 0.3);
  ctx.lineWidth = 1.5;
  roundRect(ctx, 1, 1, W - 2, H - 2, 16);
  ctx.stroke();

  // ── Header ──────────────────────────────────────────────────
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('◉ Plinko', 24, 18);

  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#aaaacc';
  ctx.fillText(`Mise : ${fmtCoins(amount)} coins  ·  Risque : ${riskLabel}`, 24, 46);

  // Header divider
  const divGrad = ctx.createLinearGradient(24, 0, W - 24, 0);
  divGrad.addColorStop(0, hexToRgba('#5865F2', 0.5));
  divGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = divGrad;
  ctx.fillRect(24, 68, W - 48, 1);

  // ── Board layout ────────────────────────────────────────────
  const boardTop = 80;
  const boardBottom = BOARD_H - 60;
  const boardH = boardBottom - boardTop;

  // Row spacing
  const rowSpacing = boardH / (ROWS + 1);
  const slotColors = MULT_COLORS[risk] ?? MULT_COLORS.medium;

  // Build peg positions (centered triangle)
  const pegRadius = 5;
  const ballRadius = 9;

  // Max pegs in bottom row = ROWS pegs → SLOTS slots
  // Horizontal spread: use fixed width
  const colSpacing = (W - 120) / SLOTS;

  // For each row r, peg count = r+1, centered
  const getPegX = (row, pegIdx) => {
    const totalPegs = row + 1;
    const totalWidth = totalPegs * colSpacing;
    const startX = (W - totalWidth) / 2 + colSpacing / 2;
    return startX + pegIdx * colSpacing;
  };

  const getRowY = (row) => boardTop + (row + 1) * rowSpacing;

  // ── Draw path trail ──────────────────────────────────────────
  // Build ball positions
  const ballPositions = path.map((pegIdx, row) => ({
    x: getPegX(row, pegIdx),
    y: getRowY(row),
  }));
  // Final slot position (bottom)
  const slotY = boardBottom + 14;
  const slotX = (W - (SLOTS * colSpacing)) / 2 + colSpacing / 2 + finalSlot * colSpacing;

  // Trail line
  if (ballPositions.length > 0) {
    ctx.beginPath();
    ctx.moveTo(W / 2, boardTop - 10);
    for (const bp of ballPositions) ctx.lineTo(bp.x, bp.y);
    ctx.lineTo(slotX, slotY);
    ctx.strokeStyle = hexToRgba(resultColor, 0.35);
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Draw pegs ───────────────────────────────────────────────
  for (let r = 0; r < ROWS; r++) {
    const totalPegs = r + 1;
    for (let p = 0; p < totalPegs; p++) {
      const px = getPegX(r, p);
      const py = getRowY(r);

      // Is this peg on the ball's path?
      const onPath = path[r] === p;

      ctx.beginPath();
      ctx.arc(px, py, pegRadius, 0, Math.PI * 2);
      if (onPath) {
        ctx.fillStyle = resultColor;
        ctx.shadowColor = resultColor;
        ctx.shadowBlur = 10;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.shadowBlur = 0;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // ── Draw ball at final peg ───────────────────────────────────
  const lastBall = ballPositions[ballPositions.length - 1];
  if (lastBall) {
    const ballGrad = ctx.createRadialGradient(lastBall.x - 2, lastBall.y - 2, 1, lastBall.x, lastBall.y, ballRadius);
    ballGrad.addColorStop(0, '#ffffff');
    ballGrad.addColorStop(1, resultColor);
    ctx.beginPath();
    ctx.arc(lastBall.x, lastBall.y, ballRadius, 0, Math.PI * 2);
    ctx.fillStyle = ballGrad;
    ctx.shadowColor = resultColor;
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // ── Draw slots ───────────────────────────────────────────────
  const slotW = colSpacing * 0.82;
  const slotH = 36;
  for (let i = 0; i < SLOTS; i++) {
    const sx = (W - SLOTS * colSpacing) / 2 + i * colSpacing + (colSpacing - slotW) / 2;
    const sy = boardBottom - 4;
    const sc = slotColors[i] ?? '#aaaacc';
    const isWinner = i === finalSlot;

    roundRect(ctx, sx, sy, slotW, slotH, 6);
    ctx.fillStyle = isWinner ? hexToRgba(sc, 0.9) : hexToRgba(sc, 0.18);
    ctx.fill();
    ctx.strokeStyle = isWinner ? sc : hexToRgba(sc, 0.4);
    ctx.lineWidth = isWinner ? 2 : 1;
    if (isWinner) {
      ctx.shadowColor = sc;
      ctx.shadowBlur = 14;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.font = `${isWinner ? 'bold ' : ''}${colSpacing < 60 ? 9 : 11}px sans-serif`;
    ctx.fillStyle = isWinner ? '#ffffff' : hexToRgba(sc, 0.8);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`×${mults[i]}`, sx + slotW / 2, sy + slotH / 2);
  }

  // ── Stats panel ──────────────────────────────────────────────
  const statsY = BOARD_H;
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(0, statsY, W, STATS_H);
  ctx.fillStyle = hexToRgba(resultColor, 0.08);
  ctx.fillRect(0, statsY, W, STATS_H);

  ctx.strokeStyle = hexToRgba(resultColor, 0.15);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, statsY);
  ctx.lineTo(W, statsY);
  ctx.stroke();

  const statItems = [
    { label: 'Multiplicateur', value: `×${mults[finalSlot]}` },
    { label: 'Reçu', value: `${fmtCoins(winAmount)} coins` },
    { label: netGain >= 0 ? 'Gain net' : 'Perte nette', value: `${netGain >= 0 ? '+' : ''}${fmtCoins(netGain)} coins` },
    { label: 'Solde', value: `${fmtCoins(finalCoins)} coins` },
  ];

  const statColW = W / statItems.length;
  statItems.forEach((s, i) => {
    const sx = i * statColW;
    const isResult = i === 2;

    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(s.label.toUpperCase(), sx + statColW / 2, statsY + 18);

    ctx.font = `bold 20px sans-serif`;
    ctx.fillStyle = isResult ? resultColor : '#ffffff';
    if (isResult) {
      ctx.shadowColor = resultColor;
      ctx.shadowBlur = 8;
    }
    ctx.textBaseline = 'top';
    ctx.fillText(s.value, sx + statColW / 2, statsY + 38);
    ctx.shadowBlur = 0;
  });

  // Result label top-right
  const resultLabel = netGain > 0 ? '▲ GAGNÉ' : netGain === 0 ? '= ÉGALITÉ' : '▼ PERDU';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = resultColor;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(resultLabel, W - 24, 18);

  return await canvas.toBuffer('png');
}

module.exports = { generatePlinkoImage };
