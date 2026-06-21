'use strict';

const { Canvas, loadImage } = require('skia-canvas');

const W = 1100;
const H = 720;
const HALF = W / 2;
const GAP = 2;

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

// ── Draw one side (profile + analytics) ─────────────────────────────────────
async function drawSide(ctx, ox, user, color) {
  const SW = HALF - GAP;

  // Side background with color tint
  const bg = ctx.createLinearGradient(ox, 0, ox + SW, H);
  bg.addColorStop(0, hexToRgba(color, 0.07));
  bg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bg;
  ctx.fillRect(ox, 0, SW, H);

  // ── PROFILE SECTION ──────────────────────────────────────────
  // Avatar circle
  const AV = 80;
  const ACX = ox + SW / 2;
  const ACY = 60;

  // Ring glow
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(ACX, ACY, AV / 2 + 4, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  // Avatar clip
  ctx.save();
  ctx.beginPath();
  ctx.arc(ACX, ACY, AV / 2, 0, Math.PI * 2);
  ctx.clip();
  try {
    const url = user.member.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
    const avatar = await loadImage(url);
    ctx.drawImage(avatar, ACX - AV / 2, ACY - AV / 2, AV, AV);
  } catch {
    ctx.fillStyle = hexToRgba(color, 0.4);
    ctx.fillRect(ACX - AV / 2, ACY - AV / 2, AV, AV);
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((user.member.displayName[0] ?? '?').toUpperCase(), ACX, ACY);
  }
  ctx.restore();

  // Username + rank
  const name = user.member.displayName.length > 18
    ? user.member.displayName.slice(0, 18) + '…'
    : user.member.displayName;
  ctx.font = 'bold 17px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(name, ACX, ACY + 46);

  ctx.font = '11px sans-serif';
  ctx.fillStyle = color;
  ctx.fillText(user.rank, ACX, ACY + 66);

  // Divider
  const divGrad = ctx.createLinearGradient(ox + 20, 0, ox + SW - 20, 0);
  divGrad.addColorStop(0, 'rgba(0,0,0,0)');
  divGrad.addColorStop(0.3, hexToRgba(color, 0.5));
  divGrad.addColorStop(0.7, hexToRgba(color, 0.5));
  divGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = divGrad;
  ctx.fillRect(ox + 20, ACY + 82, SW - 40, 1);

  // ── PROFILE STAT CARDS (2x2) ─────────────────────────────────
  const u = user.casinoUser;
  const totalGames = (u.totalGamesWon || 0) + (u.totalGamesLost || 0);
  const winrate = totalGames > 0 ? ((u.totalGamesWon || 0) / totalGames * 100).toFixed(1) : '0.0';
  const netGain = (user.totalWon || 0) - (user.totalBet || 0);

  const gameLabels = { blackjack: 'BJ', coinflip: 'Flip', roulette: 'Rou.', tower: 'Tower', mine: 'Mine', dice: 'Dice', chicken: 'Chkn', plinko: 'Plinko', russian: 'Russ.', vol: 'Vol' };
  let bestGameStr = '-';
  const gameEntries = Object.entries(user.games || {}).filter(([, g]) => (g.wins + g.losses) > 0);
  if (gameEntries.length > 0) {
    const best = gameEntries.sort(([, a], [, b]) => (b.wins / (b.wins + b.losses)) - (a.wins / (a.wins + a.losses)))[0];
    const wr = ((best[1].wins / (best[1].wins + best[1].losses)) * 100).toFixed(0);
    bestGameStr = `${gameLabels[best[0]] ?? best[0]} ${wr}%`;
  }

  const profileCards = [
    { label: 'COINS',    value: fmtNum(u.coins || 0),           color },
    { label: 'WINRATE',  value: `${winrate}%`,                   color: '#FFD700' },
    { label: 'VICTOIRES',value: String(u.totalGamesWon || 0),    color: '#57F287' },
    { label: 'DEFAITES', value: String(u.totalGamesLost || 0),   color: '#ED4245' },
    { label: 'NET',      value: (netGain >= 0 ? '+' : '') + fmtNum(netGain), color: netGain >= 0 ? '#57F287' : '#ED4245' },
    { label: 'BEST JEU', value: bestGameStr,                      color: '#FFD700' },
  ];

  const cPad = 14;
  const cW = (SW - cPad * 2 - 8) / 3;
  const cH = 56;
  const cGap = 8;
  const cardsTop = ACY + 92;

  profileCards.forEach((card, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cx = ox + cPad + col * (cW + cGap);
    const cy = cardsTop + row * (cH + cGap);

    roundRect(ctx, cx, cy, cW, cH, 8);
    ctx.fillStyle = hexToRgba(card.color, 0.08);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(card.color, 0.25);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = card.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(card.value, cx + cW / 2, cy + 8);

    ctx.font = '9px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(card.label, cx + cW / 2, cy + 36);
  });

  // ── ANALYTICS SECTION ─────────────────────────────────────────
  const analyticsTop = cardsTop + 2 * (cH + cGap) + 16;
  const analyticsH = H - analyticsTop - 16;

  // Section label
  ctx.font = '10px sans-serif';
  ctx.fillStyle = hexToRgba(color, 0.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('PAR JEU', ox + cPad, analyticsTop);

  const games = user.games || {};
  const gameList = Object.entries(games).filter(([, g]) => (g.wins + g.losses) > 0);

  if (gameList.length === 0) {
    ctx.font = '12px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Aucune partie jouée', ox + SW / 2, analyticsTop + analyticsH / 2);
    return;
  }

  const barTop = analyticsTop + 18;
  const barAreaH = analyticsH - 18;
  const barW = (SW - cPad * 2 - (gameList.length - 1) * 6) / Math.max(gameList.length, 1);

  gameList.forEach(([name, g], i) => {
    const total = g.wins + g.losses;
    const wr = g.wins / total;
    const bx = ox + cPad + i * (barW + 6);
    const maxBarH = barAreaH - 30;
    const bh = Math.max(4, wr * maxBarH);
    const by = barTop + maxBarH - bh;

    // Bar background
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(ctx, bx, barTop, barW, maxBarH, 4);
    ctx.fill();

    // Bar fill with gradient
    const barGrad = ctx.createLinearGradient(0, by, 0, by + bh);
    barGrad.addColorStop(0, wr >= 0.5 ? '#57F287' : '#ED4245');
    barGrad.addColorStop(1, hexToRgba(wr >= 0.5 ? '#57F287' : '#ED4245', 0.3));
    roundRect(ctx, bx, by, barW, bh, 4);
    ctx.fillStyle = barGrad;
    ctx.shadowColor = wr >= 0.5 ? '#57F287' : '#ED4245';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Winrate label
    ctx.font = `bold ${barW < 36 ? 8 : 10}px sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${(wr * 100).toFixed(0)}%`, bx + barW / 2, by - 2);

    // Game name label
    ctx.font = `${barW < 36 ? 7 : 9}px sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textBaseline = 'top';
    ctx.fillText((gameLabels[name] ?? name).slice(0, 5), bx + barW / 2, barTop + maxBarH + 4);
  });
}

async function generateCompareImage(user1, user2) {
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0d0d1a');
  bgGrad.addColorStop(1, '#080810');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Center divider
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(HALF - 1, 0, GAP + 1, H);

  // Draw both sides
  await drawSide(ctx, 0, user1, user1.color);
  await drawSide(ctx, HALF + GAP, user2, user2.color);

  // VS badge in center
  const vsCX = HALF;
  const vsCY = 58;
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.3)';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(vsCX, vsCY, 22, 0, Math.PI * 2);
  ctx.fillStyle = '#141420';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VS', vsCX, vsCY);

  // Outer border split-color
  ctx.save();
  const borderGrad = ctx.createLinearGradient(0, 0, W, 0);
  borderGrad.addColorStop(0, hexToRgba(user1.color, 0.4));
  borderGrad.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  borderGrad.addColorStop(1, hexToRgba(user2.color, 0.4));
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 1.5;
  roundRect(ctx, 1, 1, W - 2, H - 2, 0);
  ctx.stroke();
  ctx.restore();

  return await canvas.toBuffer('png');
}

module.exports = { generateCompareImage };
