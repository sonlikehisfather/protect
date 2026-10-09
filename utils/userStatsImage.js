'use strict';

const { Canvas, loadImage } = require('skia-canvas');

const WIDTH = 1200;
const HEIGHT = 660;

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function formatNumber(value) {
  return new Intl.NumberFormat('fr-FR').format(Math.max(0, Number(value) || 0));
}

function formatDuration(seconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} j`);
  if (hours || days) parts.push(`${hours} h`);
  if (minutes || (!hours && !days)) parts.push(`${minutes} min`);
  return parts.join(' ');
}

function fitText(ctx, value, maxWidth) {
  const text = String(value ?? '');
  if (ctx.measureText(text).width <= maxWidth) return text;

  let shortened = text;
  while (shortened.length && ctx.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
}

async function loadOptionalImage(url) {
  if (!url) return null;
  try {
    return await loadImage(url);
  } catch {
    return null;
  }
}

function drawImageCircle(ctx, image, x, y, size, fallbackText) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#28253A';
  ctx.fillRect(x, y, size, size);
  if (image) {
    ctx.drawImage(image, x, y, size, size);
  } else {
    ctx.fillStyle = '#C3A7FF';
    ctx.font = `700 ${Math.round(size * 0.38)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fallbackText, x + size / 2, y + size / 2);
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawStatCard(ctx, { x, y, width, title, value, subtitle, accent }) {
  const height = 204;
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, 'rgba(255,255,255,0.055)');
  gradient.addColorStop(1, 'rgba(255,255,255,0.018)');
  ctx.fillStyle = gradient;
  roundedRect(ctx, x, y, width, height, 22);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1;
  roundedRect(ctx, x + 0.5, y + 0.5, width - 1, height - 1, 21);
  ctx.stroke();

  ctx.fillStyle = accent;
  roundedRect(ctx, x + 22, y + 24, 5, 28, 2);
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#AEB2C2';
  ctx.font = '600 17px sans-serif';
  ctx.fillText(title.toLocaleUpperCase('fr-FR'), x + 40, y + 38);

  let fontSize = 42;
  ctx.font = `700 ${fontSize}px sans-serif`;
  while (fontSize > 28 && ctx.measureText(value).width > width - 44) {
    fontSize -= 1;
    ctx.font = `700 ${fontSize}px sans-serif`;
  }
  ctx.fillStyle = '#F5F3FA';
  ctx.fillText(value, x + 24, y + 108);

  ctx.fillStyle = '#81869A';
  ctx.font = '15px sans-serif';
  ctx.fillText(fitText(ctx, subtitle, width - 48), x + 24, y + 161);
}

function drawRankCard(ctx, { x, y, width, title, rank, detail, accent }) {
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  roundedRect(ctx, x, y, width, 104, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.075)';
  ctx.lineWidth = 1;
  roundedRect(ctx, x + 0.5, y + 0.5, width - 1, 103, 17);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = accent;
  ctx.font = '700 14px sans-serif';
  ctx.fillText(title.toLocaleUpperCase('fr-FR'), x + 22, y + 25);
  ctx.fillStyle = '#F5F3FA';
  ctx.font = '700 31px sans-serif';
  ctx.fillText(rank ? `#${rank}` : '—', x + 22, y + 66);
  ctx.fillStyle = '#8F94A8';
  ctx.font = '14px sans-serif';
  ctx.fillText(detail, x + 120, y + 67);
}

async function generateUserStatsImage({
  guildName,
  guildIconUrl,
  memberName = 'Membre',
  username = 'inconnu',
  avatarUrl,
  joinedAt,
  voiceSeconds = 0,
  voiceSubtitle = 'Temps total suivi sur le serveur',
  messageCount = 0,
  recentMessageCount = 0,
  recentVoiceSeconds = 0,
  voiceRank = null,
  messageRank = null,
  isInVoice = false,
}) {
  const canvas = new Canvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, '#10131C');
  background.addColorStop(0.52, '#171927');
  background.addColorStop(1, '#201B31');
  ctx.fillStyle = background;
  roundedRect(ctx, 0, 0, WIDTH, HEIGHT, 28);
  ctx.fill();

  const glow = ctx.createRadialGradient(1010, 80, 0, 1010, 80, 440);
  glow.addColorStop(0, 'rgba(157,117,255,0.20)');
  glow.addColorStop(1, 'rgba(157,117,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 2;
  roundedRect(ctx, 1, 1, WIDTH - 2, HEIGHT - 2, 27);
  ctx.stroke();

  const [avatar, guildIcon] = await Promise.all([
    loadOptionalImage(avatarUrl),
    loadOptionalImage(guildIconUrl),
  ]);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#BBA0FF';
  ctx.font = '700 15px sans-serif';
  ctx.fillText('STATISTIQUES DU MEMBRE', 56, 49);

  drawImageCircle(ctx, avatar, 56, 78, 94, String(memberName || '?').slice(0, 1).toUpperCase());

  ctx.fillStyle = '#F6F4FB';
  ctx.font = `700 ${String(memberName).length > 24 ? 32 : 38}px sans-serif`;
  ctx.fillText(fitText(ctx, memberName, 650), 174, 111);

  ctx.fillStyle = '#9CA1B3';
  ctx.font = '17px sans-serif';
  const joinedLabel = joinedAt
    ? `@${username}  ·  Membre depuis le ${new Intl.DateTimeFormat('fr-FR').format(new Date(joinedAt))}`
    : `@${username}`;
  ctx.fillText(fitText(ctx, joinedLabel, 700), 176, 154);

  drawImageCircle(ctx, guildIcon, 1072, 58, 72, String(guildName || '?').slice(0, 1).toUpperCase());
  ctx.textAlign = 'right';
  ctx.fillStyle = '#D7D4E2';
  ctx.font = '600 16px sans-serif';
  ctx.fillText(fitText(ctx, guildName, 300), 1054, 94);
  ctx.fillStyle = '#7E8294';
  ctx.font = '13px sans-serif';
  ctx.fillText('STATISTIQUES CUMULÉES', 1054, 120);

  const cardY = 202;
  const cardWidth = 344;
  const gap = 28;
  drawStatCard(ctx, {
    x: 56,
    y: cardY,
    width: cardWidth,
    title: 'Temps vocal',
    value: formatDuration(voiceSeconds),
    subtitle: voiceSubtitle || (isInVoice ? 'En vocal actuellement' : 'Temps total suivi sur le serveur'),
    accent: '#BBA0FF',
  });
  drawStatCard(ctx, {
    x: 56 + cardWidth + gap,
    y: cardY,
    width: cardWidth,
    title: 'Messages envoyés',
    value: formatNumber(messageCount),
    subtitle: 'Total enregistré depuis le début du suivi',
    accent: '#73D6C2',
  });
  drawStatCard(ctx, {
    x: 56 + (cardWidth + gap) * 2,
    y: cardY,
    width: cardWidth,
    title: 'Activité · 7 jours',
    value: `${formatNumber(recentMessageCount)} messages`,
    subtitle: `${formatDuration(recentVoiceSeconds)} en vocal`,
    accent: '#F4C978',
  });

  ctx.fillStyle = '#B3B6C5';
  ctx.textAlign = 'left';
  ctx.font = '700 14px sans-serif';
  ctx.fillText('CLASSEMENT SUR LE SERVEUR', 58, 450);

  drawRankCard(ctx, {
    x: 56,
    y: 472,
    width: 518,
    title: 'Rang vocal',
    rank: voiceRank,
    detail: voiceRank ? 'par temps passé en vocal' : 'aucun temps vocal classé',
    accent: '#BBA0FF',
  });
  drawRankCard(ctx, {
    x: 598,
    y: 472,
    width: 546,
    title: 'Rang messages',
    rank: messageRank,
    detail: messageRank ? 'par nombre de messages' : 'aucun message classé',
    accent: '#73D6C2',
  });

  ctx.textAlign = 'left';
  ctx.fillStyle = '#707589';
  ctx.font = '13px sans-serif';
  ctx.fillText('Les statistiques dépendent de la période où le suivi était activé. Classements basés sur les membres suivis.', 58, 619);

  return canvas.toBuffer('png');
}

module.exports = { generateUserStatsImage, formatDuration };
