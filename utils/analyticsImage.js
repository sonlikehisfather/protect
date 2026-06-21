'use strict';

const { Canvas } = require('skia-canvas');

const W = 1100;
const H = 660;

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

function fmtNum(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return sign + (abs / 1_000_000_000).toFixed(1) + 'Md';
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return sign + (abs / 1_000).toFixed(1) + 'K';
  return String(n);
}

async function generateAnalyticsImage(username, stats, color = '#5865F2') {
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── Background ─────────────────────────────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#0d0d18');
  bgGrad.addColorStop(1, '#080810');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Ambient glow top-left
  const glowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 500);
  glowGrad.addColorStop(0, hexToRgba(color, 0.07));
  glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, W, H);

  // Border
  ctx.strokeStyle = hexToRgba(color, 0.25);
  ctx.lineWidth = 1.5;
  roundRect(ctx, 1, 1, W - 2, H - 2, 18);
  ctx.stroke();

  // ── Header ─────────────────────────────────────────────────
  ctx.font = 'bold 30px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('◈ Analytics', 36, 28);

  ctx.font = '14px sans-serif';
  ctx.fillStyle = hexToRgba(color, 0.9);
  ctx.fillText(username, 36, 64);

  // Header divider
  const divGrad = ctx.createLinearGradient(36, 0, W - 36, 0);
  divGrad.addColorStop(0, hexToRgba(color, 0.5));
  divGrad.addColorStop(0.6, hexToRgba(color, 0.1));
  divGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = divGrad;
  ctx.fillRect(36, 90, W - 72, 1);

  // ── SECTION GAUCHE : barres verticales par jeu ──────────────
  const games = Object.entries(stats.games || {});
  const chartX = 36;
  const chartY = 110;
  const chartW = 540;
  const chartH = 340;
  const barCount = Math.max(games.length, 1);
  const barGroupW = chartW / barCount;
  const barW = Math.min(barGroupW * 0.55, 60);

  // Chart background
  roundRect(ctx, chartX, chartY, chartW, chartH, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Grid lines
  for (let i = 0; i <= 4; i++) {
    const gy = chartY + (chartH / 4) * i;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartX + 10, gy);
    ctx.lineTo(chartX + chartW - 10, gy);
    ctx.stroke();

    const pct = 100 - i * 25;
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${pct}%`, chartX + 8, gy);
  }

  const gameColors = ['#5865F2', '#57F287', '#FFD700', '#ED4245', '#EB459E', '#FEE75C', '#3BA55D', '#FAA61A'];

  games.forEach(([name, g], i) => {
    const wins = g.wins || 0;
    const losses = g.losses || 0;
    const total = wins + losses;
    const winrate = total > 0 ? wins / total : 0;
    const gc = gameColors[i % gameColors.length];

    const bx = chartX + barGroupW * i + (barGroupW - barW) / 2;
    const maxBarH = chartH - 30;
    const fillH = Math.max(winrate * maxBarH, 4);
    const by = chartY + maxBarH - fillH + 10;

    // Bar shadow/glow
    ctx.save();
    ctx.shadowColor = gc;
    ctx.shadowBlur = 12;

    // Bar fill with gradient
    const barGrad = ctx.createLinearGradient(bx, by + fillH, bx, by);
    barGrad.addColorStop(0, hexToRgba(gc, 0.3));
    barGrad.addColorStop(1, gc);
    roundRect(ctx, bx, by, barW, fillH, 6);
    ctx.fillStyle = barGrad;
    ctx.fill();
    ctx.restore();

    // Wins & losses mini bars side by side
    const miniW = barW / 2 - 2;
    const maxMini = Math.max(wins + losses, 1);
    const wH = Math.min((wins / maxMini) * 30, 30);
    const lH = Math.min((losses / maxMini) * 30, 30);
    const miniY = chartY + chartH - 28;

    roundRect(ctx, bx, miniY + (30 - wH), miniW, wH, 3);
    ctx.fillStyle = '#57F287';
    ctx.fill();

    roundRect(ctx, bx + miniW + 2, miniY + (30 - lH), miniW, lH, 3);
    ctx.fillStyle = '#ED4245';
    ctx.fill();

    // Game name
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = gc;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const shortName = name.charAt(0).toUpperCase() + name.slice(1, 4);
    ctx.fillText(shortName, bx + barW / 2, chartY + chartH - 60);

    // Winrate label above bar
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${(winrate * 100).toFixed(0)}%`, bx + barW / 2, by - 4);
  });

  // Chart title
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('WINRATE PAR JEU', chartX + 12, chartY + 8);

  // ── SECTION GAUCHE BAS : courbe ROI fictive ─────────────────
  const curveX = 36;
  const curveY = 470;
  const curveW = 540;
  const curveH = 150;

  roundRect(ctx, curveX, curveY, curveW, curveH, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('EVOLUTION COINS (NET)', curveX + 12, curveY + 8);

  // Courbe basée sur totalWon vs totalBet
  const totalBet = stats.totalBet || 0;
  const totalWonCoins = stats.totalWon || 0;
  const netGain = totalWonCoins - totalBet;
  const roi = totalBet > 0 ? (netGain / totalBet) * 100 : 0;

  // Courbe cumulative réelle : un point par jeu trié, valeur = net gain cumulé
  const sortedGames = Object.entries(stats.games || {}).sort(([a], [b]) => a.localeCompare(b));
  const rawPts = [0];
  let cumul = 0;
  for (const [, g] of sortedGames) {
    cumul += (g.totalWon || 0) - (g.totalBet || 0);
    rawPts.push(cumul);
  }
  // Si pas assez de jeux, on interpole à 10 points
  const targetCount = Math.max(rawPts.length, 6);
  const pts = [];
  for (let i = 0; i < targetCount; i++) {
    const t = i / (targetCount - 1);
    const idx = t * (rawPts.length - 1);
    const lo = Math.floor(idx), hi = Math.min(lo + 1, rawPts.length - 1);
    pts.push(rawPts[lo] + (rawPts[hi] - rawPts[lo]) * (idx - lo));
  }
  const minPt = Math.min(...pts, 0);
  const maxPt = Math.max(...pts, 1);
  const pad = 24;
  const innerH = curveH - pad * 2;

  // Fill sous la courbe
  ctx.beginPath();
  pts.forEach((v, i) => {
    const px = curveX + pad + (i / (pts.length - 1)) * (curveW - pad * 2);
    const py = curveY + pad + (1 - (v - minPt) / (maxPt - minPt)) * innerH;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.lineTo(curveX + curveW - pad, curveY + pad + innerH);
  ctx.lineTo(curveX + pad, curveY + pad + innerH);
  ctx.closePath();
  const fillGrad = ctx.createLinearGradient(0, curveY + pad, 0, curveY + pad + innerH);
  const curveColor = roi >= 0 ? '#57F287' : '#ED4245';
  fillGrad.addColorStop(0, hexToRgba(curveColor, 0.25));
  fillGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fillGrad;
  ctx.fill();

  // Trait de la courbe
  ctx.beginPath();
  pts.forEach((v, i) => {
    const px = curveX + pad + (i / (pts.length - 1)) * (curveW - pad * 2);
    const py = curveY + pad + (1 - (v - minPt) / (maxPt - minPt)) * innerH;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.strokeStyle = curveColor;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = curveColor;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Dot dernier point
  const lastPt = pts[pts.length - 1];
  const dotX = curveX + curveW - pad;
  const dotY = curveY + pad + (1 - (lastPt - minPt) / (maxPt - minPt)) * innerH;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
  ctx.fillStyle = curveColor;
  ctx.fill();

  // Label ROI sur la courbe
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = curveColor;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`ROI ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`, curveX + curveW - pad - 8, curveY + pad - 2);

  // ── SECTION DROITE : stat cards ─────────────────────────────
  const panelX = 608;
  const panelY = 110;
  const panelW = 456;

  const totalGames = (stats.totalGamesWon || 0) + (stats.totalGamesLost || 0);
  const overallWinrate = totalGames > 0 ? ((stats.totalGamesWon || 0) / totalGames * 100) : 0;

  const cards = [
    { label: 'PARTIES',     value: String(totalGames),                icon: '◆', color: color },
    { label: 'VICTOIRES',   value: String(stats.totalGamesWon || 0),  icon: '▲', color: '#57F287' },
    { label: 'DEFAITES',    value: String(stats.totalGamesLost || 0), icon: '▼', color: '#ED4245' },
    { label: 'WINRATE',     value: `${overallWinrate.toFixed(1)}%`,   icon: '%', color: '#FFD700' },
    { label: 'COINS MISÉS', value: fmtNum(totalBet),                  icon: '◈', color: '#aaaaff' },
    { label: 'COINS GAGNÉS',value: fmtNum(totalWonCoins),             icon: '◈', color: '#57F287' },
    { label: 'NET',         value: (netGain >= 0 ? '+' : '') + fmtNum(netGain), icon: '~', color: netGain >= 0 ? '#57F287' : '#ED4245' },
    { label: 'JEUX',        value: String(Object.keys(stats.games || {}).length), icon: '◉', color: '#aaaacc' },
  ];

  const cW = (panelW - 12) / 2;
  const cH = 72;
  const cGap = 10;

  cards.forEach((card, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = panelX + col * (cW + cGap);
    const cy = panelY + row * (cH + cGap);

    // Card background
    roundRect(ctx, cx, cy, cW, cH, 12);
    const cardGrad = ctx.createLinearGradient(cx, cy, cx + cW, cy + cH);
    cardGrad.addColorStop(0, hexToRgba(card.color, 0.1));
    cardGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cardGrad;
    ctx.fill();
    ctx.strokeStyle = hexToRgba(card.color, 0.2);
    ctx.lineWidth = 1;
    ctx.stroke();

    // Icon
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = hexToRgba(card.color, 0.6);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(card.icon, cx + 12, cy + 10);

    // Label
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textBaseline = 'top';
    ctx.fillText(card.label, cx + 30, cy + 12);

    // Value
    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = card.color;
    ctx.textBaseline = 'bottom';
    ctx.fillText(card.value, cx + 12, cy + cH - 10);
  });

  // ── Meilleur / Pire jeu ──────────────────────────────────────
  const rankedGames = games
    .map(([name, g]) => {
      const t = (g.wins || 0) + (g.losses || 0);
      return { name, wins: g.wins || 0, losses: g.losses || 0, total: t, winrate: t > 0 ? g.wins / t : 0 };
    })
    .filter(g => g.total > 0)
    .sort((a, b) => b.winrate - a.winrate);

  const best = rankedGames[0];
  const worst = rankedGames[rankedGames.length - 1];

  const bottomY = panelY + 4 * (cH + cGap) + 10;
  const bW = (panelW - 12) / 2;

  [[best, '▲ MEILLEUR JEU', '#57F287'], [worst, '▼ PIRE JEU', '#ED4245']].forEach(([g, label, c], i) => {
    if (!g) return;
    const bx = panelX + i * (bW + cGap);
    roundRect(ctx, bx, bottomY, bW, 54, 12);
    const bGrad = ctx.createLinearGradient(bx, bottomY, bx + bW, bottomY + 54);
    bGrad.addColorStop(0, hexToRgba(c, 0.12));
    bGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bGrad;
    ctx.fill();
    ctx.strokeStyle = hexToRgba(c, 0.25);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = '10px sans-serif';
    ctx.fillStyle = hexToRgba(c, 0.7);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, bx + 12, bottomY + 8);

    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.fillText(g.name.charAt(0).toUpperCase() + g.name.slice(1), bx + 12, bottomY + 24);

    ctx.font = '12px sans-serif';
    ctx.fillStyle = c;
    ctx.textAlign = 'right';
    ctx.fillText(`${(g.winrate * 100).toFixed(1)}%`, bx + bW - 12, bottomY + 28);
  });

  return await canvas.toBuffer('png');
}

module.exports = { generateAnalyticsImage };
