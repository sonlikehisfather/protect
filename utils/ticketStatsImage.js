'use strict';

const { Canvas } = require('skia-canvas');
const embed = require('./embed');

const W = 1000;
const H = 360;

function fmtTimeSecs(secs) {
  if (secs == null) return 'N/A';
  secs = Math.round(secs);
  if (secs < 60) return `${secs} s`;
  if (secs < 3600) return `${Math.round(secs / 60)} min`;
  if (secs < 86400) return `${Math.round(secs / 3600)} h`;
  return `${Math.round(secs / 86400)} j`;
}

function fmtStars(avg) {
  if (avg == null) return 'Aucune évaluation';
  return `${Number(avg).toFixed(1)}/5`;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function generateTicketStatsImage({ guildId, guildName = null, guildIconUrl = null, total = 0, rated = 0, avgRating = null, avgClose = null }) {
  const canvas = new Canvas(W * 2, H * 2);
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  const color = embed.getGuildColor(guildId) || '#2B2D31';

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0f1720');
  bg.addColorStop(1, '#071018');
  ctx.fillStyle = bg;
  drawRoundedRect(ctx, 0, 0, W, H, 18);
  ctx.fill();

  // Header
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 28px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const headerX = 30;
  const headerY = 22;

  // Guild icon (optional)
  let iconSize = 64;
  if (guildIconUrl) {
    try {
      const { loadImage } = require('skia-canvas');
      const img = await loadImage(guildIconUrl);
      // soft shadow backing
      const ix = headerX;
      const iy = headerY;
      ctx.save();
      ctx.beginPath();
      ctx.arc(ix + iconSize / 2, iy + iconSize / 2, iconSize / 2 + 4, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      ctx.restore();

      // clipped icon
      ctx.save();
      ctx.beginPath();
      ctx.arc(ix + iconSize / 2, iy + iconSize / 2, iconSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, ix, iy, iconSize, iconSize);
      ctx.restore();

      // subtle border
      ctx.beginPath();
      ctx.arc(ix + iconSize / 2, iy + iconSize / 2, iconSize / 2, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.stroke();
    } catch {}
  }

  const titleX = headerX + (guildIconUrl ? iconSize + 16 : 0);
  ctx.fillText('Statistiques des tickets', titleX, headerY + 6);

  ctx.font = '400 14px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#9aa6b2';
  ctx.fillText(guildName ? `Synthèse — ${guildName}` : 'Synthèse du serveur', titleX, headerY + 36);

  // Card
  const cx = 28;
  const cy = 110;
  const cardW = W - 56;
  const cardH = 200;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#0e1620';
  drawRoundedRect(ctx, cx, cy, cardW, cardH, 12);
  ctx.fill();
  ctx.restore();

  // Inner content
  const pad = 28;
  const leftX = cx + pad;
  const centerX = cx + cardW / 2;
  const rightX = cx + cardW - pad;

  // Three columns: total | rated+rating | avgClose
  ctx.fillStyle = '#9aa6b2';
  ctx.font = '600 16px Inter, system-ui, sans-serif';
  ctx.fillText('Tickets fermés', leftX, cy + 14);
  ctx.font = '700 44px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(total), leftX, cy + 40);

  const midX = centerX - 80;
  ctx.fillStyle = '#9aa6b2';
  ctx.font = '600 16px Inter, system-ui, sans-serif';
  ctx.fillText('Tickets évalués', midX, cy + 14);
  ctx.font = '700 36px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(rated), midX, cy + 40);

  // Rating block centered under middle metric
  const ratingCenterX = centerX + 6;
  ctx.fillStyle = '#8f9ba8';
  ctx.font = '600 13px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Note moyenne', ratingCenterX, cy + 80);

  const starSize = 16;
  const starGap = 6;
  const starsRowW = (starSize * 5) + (starGap * 4);
  const starsX = ratingCenterX - (starsRowW / 2);
  const starsY = cy + 102;
  const fullStars = avgRating == null ? 0 : Math.floor(avgRating);
  const frac = avgRating == null ? 0 : (avgRating - fullStars);
  function drawStar(cxS, cyS, r, filled) {
    const spikes = 5;
    const outer = r;
    const inner = r * 0.5;
    ctx.save();
    ctx.beginPath();
    let rot = Math.PI / 2 * 3;
    for (let i = 0; i < spikes; i++) {
      const ox = cxS + Math.cos(rot) * outer;
      const oy = cyS + Math.sin(rot) * outer;
      ctx.lineTo(ox, oy);
      rot += Math.PI / spikes;
      const ix = cxS + Math.cos(rot) * inner;
      const iy = cyS + Math.sin(rot) * inner;
      ctx.lineTo(ix, iy);
      rot += Math.PI / spikes;
    }
    ctx.closePath();
    if (filled) {
      ctx.fillStyle = '#ffd166';
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
    }
    ctx.restore();
  }

  for (let i = 0; i < 5; i++) {
    const sx = starsX + i * (starSize + starGap);
    const filled = i < fullStars || (i === fullStars && frac >= 0.5);
    drawStar(sx + starSize / 2, starsY, starSize / 2, filled);
  }

  // Keep numeric rating centered under stars
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#e6edf3';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const avgText = avgRating == null ? 'Aucune évaluation' : `${Number(avgRating).toFixed(1)}/5`;
  ctx.fillText(avgText, ratingCenterX, starsY + 12);

  ctx.fillStyle = '#9aa6b2';
  ctx.font = '600 16px Inter, system-ui, sans-serif';
  ctx.fillText('Durée moyenne', rightX - 160, cy + 14);
  ctx.font = '700 28px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#7dd3fc';
  ctx.fillText(fmtTimeSecs(avgClose), rightX - 160, cy + 40);

  // Progress bar (rated / total) with glow
  const barX = leftX;
  const barY = cy + cardH - 48;
  const pillW = 98;
  const pillGap = 12;
  const barW = cardW - pad * 2 - pillW - pillGap;
  const barH = 14;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  drawRoundedRect(ctx, barX, barY, barW, barH, 8);
  ctx.fill();

  const pct = total > 0 ? (rated / total) : 0;
  const fillWRaw = Math.round(barW * Math.min(1, Math.max(0, pct)));
  const fillW = pct > 0 ? Math.max(8, fillWRaw) : 0;

  // glow
  ctx.save();
  ctx.shadowColor = 'rgba(87,242,135,0.45)';
  ctx.shadowBlur = 18;
  const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  grad.addColorStop(0, '#57F287');
  grad.addColorStop(0.6, '#2ecc71');
  grad.addColorStop(1, '#27ae60');
  ctx.fillStyle = grad;
  drawRoundedRect(ctx, barX, barY, fillW, barH, 8);
  ctx.fill();
  ctx.restore();

  // subtle top highlight
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  drawRoundedRect(ctx, barX + 2, barY + 1, Math.max(0, fillW - 4), 4, 4);
  ctx.fill();

  // percent pill to the right of the bar (kept inside card bounds)
  const pillX = barX + barW + pillGap;
  const pillY = barY - 6;
  const pillH = 26;
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 14);
  ctx.fill();
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#cbd6dd';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.round(pct * 100)}% évalués`, pillX + pillW / 2, pillY + pillH / 2);

  // Footer timestamp
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#88939a';
  ctx.textAlign = 'right';
  const ts = new Date();
  ctx.fillText(`Généré le ${ts.toLocaleString('fr-FR')}`, cx + cardW - 10, H - 12);

  return await canvas.toBuffer('png');
}

module.exports = { generateTicketStatsImage };
