'use strict';

const { Canvas, loadImage } = require('skia-canvas');
const embed = require('./embed');

const W = 1100;
const H = 520;
const SCALE = 2;

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
  const value = String(text);
  if (ctx.measureText(value).width <= maxWidth) return value;

  let shortened = value;
  while (shortened.length && ctx.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('fr-FR').format(Math.max(0, Number(value) || 0));
}

function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return 'N/D';
  const value = Math.max(0, Math.round(Number(seconds)));
  if (value < 60) return `${value} s`;
  if (value < 3600) return `${Math.round(value / 60)} min`;
  if (value < 86400) return `${Math.round(value / 3600)} h`;
  return `${Math.round(value / 86400)} j`;
}

function drawStar(ctx, centerX, centerY, radius, filled) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.46;
    const angle = -Math.PI / 2 + (i * Math.PI / 5);
    const x = centerX + Math.cos(angle) * r;
    const y = centerY + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = filled ? '#F6C96B' : 'rgba(255,255,255,0.12)';
  ctx.fill();
}

async function generateTicketStatsImage({
  guildId,
  guildName = null,
  guildIconUrl = null,
  total = 0,
  rated = 0,
  avgRating = null,
  avgClose = null,
}) {
  const canvas = new Canvas(W * SCALE, H * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  const accent = embed.getGuildColor(guildId) || '#5865F2';
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#111827');
  bg.addColorStop(1, '#080D17');
  ctx.fillStyle = bg;
  drawRoundedRect(ctx, 0, 0, W, H, 26);
  ctx.fill();

  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 620);
  glow.addColorStop(0, `${accent}35`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, 1, 1, W - 2, H - 2, 25);
  ctx.stroke();

  const headerX = 56;
  const headerY = 48;
  const iconSize = 58;
  let titleX = headerX;

  if (guildIconUrl) {
    const icon = await loadImage(guildIconUrl).catch(() => null);
    if (icon) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(headerX + iconSize / 2, headerY + iconSize / 2, iconSize / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(icon, headerX, headerY, iconSize, iconSize);
      ctx.restore();
      titleX += iconSize + 18;
    }
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#F8FAFC';
  ctx.font = '700 29px Inter, system-ui, sans-serif';
  ctx.fillText('Statistiques des tickets', titleX, headerY + 2);

  ctx.fillStyle = '#9CA9BA';
  ctx.font = '400 15px Inter, system-ui, sans-serif';
  ctx.fillText(
    fitText(ctx, guildName ? `Vue d’ensemble · ${guildName}` : 'Vue d’ensemble du serveur', W - titleX - 70),
    titleX,
    headerY + 41
  );

  const totalCount = Math.max(0, Number(total) || 0);
  const ratedCount = Math.max(0, Number(rated) || 0);
  const ratingValue = avgRating == null ? null : Math.min(5, Math.max(0, Number(avgRating) || 0));
  const cards = [
    { label: 'TICKETS FERMÉS', value: formatNumber(totalCount), note: 'Tickets traités', color: '#8BA4FF' },
    { label: 'AVIS REÇUS', value: formatNumber(ratedCount), note: 'Retours enregistrés', color: '#6DD6B0' },
    { label: 'NOTE MOYENNE', value: ratingValue == null ? '—' : `${ratingValue.toFixed(1).replace('.', ',')}/5`, note: ratingValue == null ? 'Aucun avis pour le moment' : 'Satisfaction moyenne', color: '#F6C96B' },
    { label: 'TEMPS DE RÉSOLUTION', value: formatDuration(avgClose), note: 'Durée moyenne de fermeture', color: '#72C7E8' },
  ];

  const marginX = 56;
  const gap = 16;
  const cardY = 158;
  const cardH = 214;
  const cardW = (W - marginX * 2 - gap * 3) / 4;

  cards.forEach((card, index) => {
    const x = marginX + index * (cardW + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    drawRoundedRect(ctx, x, cardY, cardW, cardH, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.075)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = card.color;
    drawRoundedRect(ctx, x + 20, cardY + 22, 4, 18, 2);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#AAB5C4';
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillText(card.label, x + 34, cardY + 24);

    ctx.fillStyle = '#F8FAFC';
    ctx.font = index === 3 ? '700 34px Inter, system-ui, sans-serif' : '700 42px Inter, system-ui, sans-serif';
    ctx.fillText(fitText(ctx, card.value, cardW - 40), x + 20, cardY + 75);

    ctx.fillStyle = '#8290A3';
    ctx.font = '400 13px Inter, system-ui, sans-serif';
    ctx.fillText(fitText(ctx, card.note, cardW - 40), x + 20, cardY + 130);

    if (index === 2 && ratingValue != null) {
      const starsY = cardY + 174;
      for (let star = 0; star < 5; star++) {
        drawStar(ctx, x + 27 + star * 25, starsY, 8, ratingValue >= star + 0.5);
      }
    }
  });

  const responsePct = totalCount > 0 ? Math.min(1, ratedCount / totalCount) : 0;
  const progressX = marginX;
  const progressY = 420;
  const progressW = W - marginX * 2;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#E5EAF2';
  ctx.font = '600 15px Inter, system-ui, sans-serif';
  ctx.fillText('Taux de réponse aux évaluations', progressX, progressY);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#CBD5E1';
  ctx.font = '600 15px Inter, system-ui, sans-serif';
  ctx.fillText(`${Math.round(responsePct * 100)} %`, progressX + progressW, progressY);

  const barY = progressY + 31;
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  drawRoundedRect(ctx, progressX, barY, progressW, 9, 5);
  ctx.fill();
  if (responsePct > 0) {
    const barGradient = ctx.createLinearGradient(progressX, 0, progressX + progressW, 0);
    barGradient.addColorStop(0, '#687CF5');
    barGradient.addColorStop(1, '#74D6BA');
    ctx.fillStyle = barGradient;
    drawRoundedRect(ctx, progressX, barY, Math.max(9, progressW * responsePct), 9, 5);
    ctx.fill();
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#778497';
  ctx.font = '400 12px Inter, system-ui, sans-serif';
  ctx.fillText(`${formatNumber(ratedCount)} avis sur ${formatNumber(totalCount)} tickets fermés`, marginX, 484);

  ctx.textAlign = 'right';
  ctx.fillText(
    `Généré le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`,
    W - marginX,
    484
  );

  return canvas.toBuffer('png');
}

module.exports = { generateTicketStatsImage };
