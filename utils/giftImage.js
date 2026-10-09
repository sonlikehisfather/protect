'use strict';

const { Canvas } = require('skia-canvas');

const WIDTH = 1100;
const HEIGHT = 500;

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

function drawSparkle(ctx, x, y, size, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#F4D58D';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
  ctx.restore();
}

function drawGiftBox(ctx, x, y, scale, opened) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#9C6BFF';
  roundedRect(ctx, -115, -5, 230, 165, 18);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  const front = ctx.createLinearGradient(-115, 0, 115, 0);
  front.addColorStop(0, '#8052E8');
  front.addColorStop(0.5, '#A77BFF');
  front.addColorStop(1, '#8052E8');
  ctx.fillStyle = front;
  roundedRect(ctx, -115, -5, 230, 165, 18);
  ctx.fill();

  ctx.fillStyle = '#F4D58D';
  ctx.fillRect(-24, -5, 48, 165);
  ctx.fillStyle = '#EAC577';
  ctx.fillRect(-115, 38, 230, 35);

  const lidY = opened ? -65 : -42;
  ctx.save();
  if (opened) {
    ctx.translate(45, -85);
    ctx.rotate(-0.18);
    ctx.translate(-45, 85);
  }
  ctx.fillStyle = '#B18BFF';
  roundedRect(ctx, -140, lidY, 280, 48, 14);
  ctx.fill();
  ctx.fillStyle = '#F4D58D';
  ctx.fillRect(-24, lidY, 48, 48);
  ctx.restore();

  ctx.strokeStyle = '#F4D58D';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.ellipse(-30, lidY - 10, 37, 24, -0.55, Math.PI, Math.PI * 2);
  ctx.ellipse(30, lidY - 10, 37, 24, 0.55, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function fitText(ctx, text, maxWidth, initialSize, minimumSize = 18) {
  let size = initialSize;
  while (size > minimumSize) {
    ctx.font = `600 ${size}px sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return size;
}

async function generateGiftImage({ won, prize, username }) {
  const canvas = new Canvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const accent = won ? '#F4D58D' : '#A8AFC2';

  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, '#10131C');
  background.addColorStop(0.55, '#191B29');
  background.addColorStop(1, '#252039');
  ctx.fillStyle = background;
  roundedRect(ctx, 0, 0, WIDTH, HEIGHT, 28);
  ctx.fill();

  const glow = ctx.createRadialGradient(800, 245, 15, 800, 245, 390);
  glow.addColorStop(0, won ? 'rgba(172, 126, 255, 0.23)' : 'rgba(154, 164, 190, 0.14)');
  glow.addColorStop(1, 'rgba(16, 19, 28, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 2;
  roundedRect(ctx, 1, 1, WIDTH - 2, HEIGHT - 2, 27);
  ctx.stroke();

  for (const [x, y, size, alpha] of [
    [685, 103, 8, 0.55], [920, 130, 12, 0.7], [1010, 300, 7, 0.4],
    [760, 390, 10, 0.5], [605, 300, 6, 0.35], [870, 390, 5, 0.45],
  ]) {
    drawSparkle(ctx, x, y, size, alpha);
  }

  ctx.fillStyle = '#B9A0FF';
  ctx.font = '700 18px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('CADEAU MYSTÈRE', 62, 74);

  ctx.fillStyle = '#F5F3FA';
  const headline = won ? 'Bien joué !' : 'Pas cette fois';
  ctx.font = `700 ${won ? 58 : 52}px sans-serif`;
  ctx.fillText(headline, 60, 178);

  ctx.fillStyle = accent;
  ctx.font = '700 36px sans-serif';
  ctx.fillText(won ? `+${Number(prize).toLocaleString('fr-FR')} coins` : 'Cadeau vide', 64, 252);

  ctx.fillStyle = '#A9ADBD';
  const player = String(username || 'Joueur').trim() || 'Joueur';
  ctx.font = `${fitText(ctx, player, 440, 23)}px sans-serif`;
  ctx.fillText(player, 64, 315);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.beginPath();
  ctx.moveTo(64, 366);
  ctx.lineTo(460, 366);
  ctx.stroke();
  ctx.fillStyle = '#777D91';
  ctx.font = '16px sans-serif';
  ctx.fillText(won ? 'Le bon cadeau était le tien.' : 'Une seule tentative par partie.', 64, 403);

  drawGiftBox(ctx, 805, 276, 1.04, won);
  return canvas.toBuffer('png');
}

module.exports = { generateGiftImage };
