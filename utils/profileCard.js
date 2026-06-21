'use strict';

const { Canvas, loadImage } = require('skia-canvas');
const { xpForLevel }              = require('../modules/levels');

const W = 900;
const H = 340;

const RANK_COLORS = {
  'Master':       '#FF00FF',
  'Prestige 3':   '#00FFFF',
  'Prestige 2':   '#FFD700',
  'Prestige 1':   '#FF6B6B',
  'Absolu':       '#FFD700',
  'Suprême':      '#FF6B6B',
  'Céleste':      '#A8E6CF',
  'Transcendant': '#2ECC71',
  'Divin':        '#16A085',
  'Immortel':     '#1ABC9C',
  'Mythique':     '#C0392B',
  'Légende':      '#E74C3C',
  'Champion':     '#E67E22',
  'Grand Maître': '#F39C12',
  'Maître':       '#F1C40F',
  'Élite':        '#9B59B6',
  'Expert':       '#8E44AD',
  'Vétéran':      '#3498DB',
  'Aguerri':      '#2980B9',
  'Expérimenté':  '#2471A3',
  'Avisé':        '#1A5276',
  'Confirmé':     '#5D6D7E',
  'Régulier':     '#717D7E',
  'Apprenti':     '#808B96',
  'Novice':       '#95A5A6',
};

function getRankColor(name) {
  return RANK_COLORS[name] ?? '#5865F2';
}

function getXpProgress(totalXp) {
  let level = 0, total = 0;
  while (total + xpForLevel(level) <= totalXp) {
    total += xpForLevel(level);
    level++;
  }
  return { currentXp: totalXp - total, neededXp: xpForLevel(level) };
}

function fmtNum(n) {
  if (n == null) return '0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000_000) return (n / 1_000_000_000_000_000).toFixed(2) + 'Qd';
  if (abs >= 1_000_000_000_000) return (n / 1_000_000_000_000).toFixed(2) + 'Td';
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'Bd';
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
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

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function drawHexagon(ctx, cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const px = cx + Math.cos(angle) * size;
    const py = cy + Math.sin(angle) * size;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawStatCard(ctx, x, y, w, h, icon, label, value, color) {
  ctx.save();

  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, 'rgba(255,255,255,0.05)');
  grad.addColorStop(1, 'rgba(255,255,255,0.01)');
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();

  ctx.strokeStyle = hexToRgba(color, 0.12);
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 12);
  ctx.stroke();

  const iconGrad = ctx.createRadialGradient(x + w / 2, y + 22, 2, x + w / 2, y + 22, 18);
  iconGrad.addColorStop(0, hexToRgba(color, 0.15));
  iconGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = iconGrad;
  ctx.beginPath();
  ctx.arc(x + w / 2, y + 22, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, x + w / 2, y + 22);

  ctx.fillStyle = '#e8e8f0';
  ctx.font = 'bold 19px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(value, x + w / 2, y + 42);

  ctx.fillStyle = '#5a5a72';
  ctx.font = '9px sans-serif';
  ctx.fillText(label, x + w / 2, y + 66);

  ctx.restore();
}

async function generateProfileCard(member, casinoUser, realLevel, levelData, rank, equipped = {}) {
  const MAX_LEVEL = 1000;
  const prestige = Math.floor(realLevel / MAX_LEVEL);
  const displayLevel = prestige >= 4 ? MAX_LEVEL : realLevel % MAX_LEVEL;
  const isMaster = prestige >= 4;
  const prestInfo = { prestige, displayLevel, isMaster };

  const canvas = new Canvas(W, H);
  const ctx    = canvas.getContext('2d');
  const color  = getRankColor(rank.name);

  roundRect(ctx, 0, 0, W, H, 24);
  ctx.clip();

  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#111118');
  bgGrad.addColorStop(0.5, '#0e0e16');
  bgGrad.addColorStop(1, '#0a0a12');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  const sideGrad = ctx.createLinearGradient(0, 0, 400, 0);
  sideGrad.addColorStop(0, hexToRgba(color, 0.06));
  sideGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sideGrad;
  ctx.fillRect(0, 0, 400, H);

  const glow = ctx.createRadialGradient(155, 145, 10, 155, 145, 300);
  glow.addColorStop(0, hexToRgba(color, 0.08));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 440, H);

  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.fillStyle = '#ffffff';
  for (let y = 0; y < H; y += 24) {
    for (let x = 0; x < W; x += 24) {
      if ((x + y) % 48 === 0) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();

  const topGrad = ctx.createLinearGradient(0, 0, W, 0);
  topGrad.addColorStop(0, color);
  topGrad.addColorStop(0.5, hexToRgba(color, 0.4));
  topGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, W, 3);

  ctx.save();
  ctx.strokeStyle = hexToRgba(color, 0.2);
  ctx.lineWidth = 1.5;
  roundRect(ctx, 1, 1, W - 2, H - 2, 23);
  ctx.stroke();
  ctx.restore();

  const AV = 170;
  const ACX = 155;
  const ACY = 145;

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  drawHexagon(ctx, ACX, ACY, AV / 2 + 6);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  drawHexagon(ctx, ACX, ACY, AV / 2 + 2);
  ctx.strokeStyle = hexToRgba(color, 0.4);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  drawHexagon(ctx, ACX, ACY, AV / 2);
  ctx.clip();
  try {
    const url    = member.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
    const avatar = await loadImage(url);
    const drawSize = AV;
    ctx.drawImage(avatar, ACX - drawSize / 2, ACY - drawSize / 2, drawSize, drawSize);
  } catch {
    ctx.fillStyle = hexToRgba(color, 0.3);
    drawHexagon(ctx, ACX, ACY, AV / 2);
    ctx.fill();
    ctx.font = 'bold 42px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((member.displayName[0] ?? '?').toUpperCase(), ACX, ACY + 2);
  }
  ctx.restore();

  if (equipped.badge && equipped.badge.colorHex) {
    const badge = equipped.badge;
    const BX = ACX + 55;
    const BY = ACY + 55;
    const BS = 36;

    ctx.save();
    ctx.beginPath();
    ctx.arc(BX, BY, BS / 2 + 3, 0, Math.PI * 2);
    ctx.fillStyle = '#111118';
    ctx.fill();
    ctx.strokeStyle = badge.colorHex;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(BX, BY, BS / 2, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(badge.colorHex, 0.25);
    ctx.fill();
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badge.name.charAt(0).toUpperCase(), BX, BY + 1);
    ctx.restore();
  }

  const CX = 300;
  const CW = W - CX - 30;

  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const name = member.displayName.length > 20 ? member.displayName.slice(0, 20) + '...' : member.displayName;
  ctx.fillText(name, CX, 38);

  ctx.save();
  ctx.strokeStyle = hexToRgba(color, 0.15);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CX, 72);
  ctx.lineTo(CX + 120, 72);
  ctx.stroke();
  ctx.restore();

  const lvlText = prestInfo.isMaster ? 'Master' : (prestInfo.prestige > 0 ? `P${prestInfo.prestige} · Niv. ${displayLevel}` : `Niv. ${realLevel}`);
  ctx.font = 'bold 13px sans-serif';
  const lvlW  = ctx.measureText(lvlText).width + 24;
  const lvlX  = W - lvlW - 25;
  const lvlY  = 42;
  roundRect(ctx, lvlX, lvlY, lvlW, 26, 13);
  const lvlGrad = ctx.createLinearGradient(lvlX, 0, lvlX + lvlW, 0);
  lvlGrad.addColorStop(0, hexToRgba(color, 0.2));
  lvlGrad.addColorStop(1, hexToRgba(color, 0.05));
  ctx.fillStyle = lvlGrad;
  ctx.fill();
  ctx.strokeStyle = hexToRgba(color, 0.5);
  ctx.lineWidth = 1;
  roundRect(ctx, lvlX, lvlY, lvlW, 26, 13);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(lvlText, lvlX + lvlW / 2, lvlY + 14);

  ctx.font = '17px sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const rankText = prestInfo.isMaster ? `${rank.icon}  Master` : (prestInfo.prestige > 0 ? `${rank.icon}  ${rank.name} · Niv. ${displayLevel}` : `${rank.icon}  ${rank.name}`);
  ctx.fillText(rankText, CX, 80);

  const xpProg  = getXpProgress(levelData.xp);
  const pct     = prestInfo.isMaster ? 1 : Math.min(xpProg.currentXp / xpProg.neededXp, 1);
  const BAR_Y   = 112;
  const BAR_H   = 8;
  const BAR_W   = CW;

  roundRect(ctx, CX, BAR_Y, BAR_W, BAR_H, 4);
  ctx.fillStyle = '#161624';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  roundRect(ctx, CX, BAR_Y, BAR_W, BAR_H, 4);
  ctx.stroke();

  if (pct > 0) {
    const fillGrad = ctx.createLinearGradient(CX, 0, CX + BAR_W, 0);
    fillGrad.addColorStop(0, hexToRgba(color, 0.6));
    fillGrad.addColorStop(0.5, color);
    fillGrad.addColorStop(1, hexToRgba(color, 0.9));
    ctx.fillStyle = fillGrad;
    roundRect(ctx, CX, BAR_Y, Math.max(BAR_W * pct, 8), BAR_H, 4);
    ctx.fill();

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(CX + Math.max(BAR_W * pct, 8) - 1, BAR_Y + BAR_H / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#666680';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  if (prestInfo.isMaster) {
    ctx.fillText('Niveau maximum atteint', CX, BAR_Y + BAR_H + 8);
  } else {
    const xpText = `${xpProg.currentXp.toLocaleString()} / ${xpProg.neededXp.toLocaleString()} XP`;
    ctx.fillText(xpText, CX, BAR_Y + BAR_H + 8);
    const pctText = `${Math.round(pct * 100)}%`;
    ctx.textAlign = 'right';
    ctx.fillText(pctText, CX + BAR_W, BAR_Y + BAR_H + 8);
  }

  const DIV_Y = 158;
  const divGrad = ctx.createLinearGradient(CX, 0, CX + CW, 0);
  divGrad.addColorStop(0, hexToRgba(color, 0.3));
  divGrad.addColorStop(0.7, hexToRgba(color, 0.05));
  divGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = divGrad;
  ctx.fillRect(CX, DIV_Y, CW, 1);

  const vocH  = Math.floor(casinoUser.vocMinutes / 60);
  const vocM  = casinoUser.vocMinutes % 60;
  const stats = [
    { icon: '\u25C6', label: 'COINS',    value: fmtNum(casinoUser.coins) },
    { icon: '\u2663', label: 'TIRAGES',  value: String(casinoUser.draws) },
    { icon: '\u2193', label: 'PARIE',    value: fmtNum(casinoUser.totalSpent ?? 0) },
    { icon: '\u2191', label: 'GAGNE',    value: fmtNum(casinoUser.totalWon ?? 0) },
    { icon: '\u266A', label: 'VOCAL',    value: `${vocH}h ${vocM}m` },
    { icon: '\u270E', label: 'MESSAGES', value: String(casinoUser.msgCount) },
  ];

  const cardGap = 10;
  const cardW = (CW - cardGap * (stats.length - 1)) / stats.length;
  const cardH = 88;
  const cardY = 178;

  stats.forEach((s, i) => {
    const sx = CX + i * (cardW + cardGap);
    drawStatCard(ctx, sx, cardY, cardW, cardH, s.icon, s.label, s.value, color);
  });

  if (equipped.color || equipped.role || equipped.title) {
    const eqY = 270;
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#555570';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('EQUIPE', CX, eqY);

    const eqItems = [];
    if (equipped.badge) eqItems.push({ icon: ' Badge', name: equipped.badge.name });
    if (equipped.color) eqItems.push({ icon: ' Couleur', name: equipped.color.name || 'Couleur' });
    if (equipped.role) eqItems.push({ icon: ' Role', name: equipped.role.name || 'Role' });

    let eqX = CX + 60;
    for (const item of eqItems.slice(0, 4)) {
      const text = `${item.icon} ${item.name}`;
      ctx.font = '12px sans-serif';
      const tw = ctx.measureText(text).width + 20;
      roundRect(ctx, eqX, eqY - 2, tw, 20, 10);
      ctx.fillStyle = hexToRgba(color, 0.08);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(color, 0.2);
      ctx.lineWidth = 1;
      roundRect(ctx, eqX, eqY - 2, tw, 20, 10);
      ctx.stroke();
      ctx.fillStyle = '#aaaacc';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, eqX + 10, eqY + 8);
      eqX += tw + 8;
    }
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  return await canvas.toBuffer('png');
}

module.exports = { generateProfileCard };
