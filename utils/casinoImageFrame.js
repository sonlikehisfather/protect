'use strict';

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

function drawCasinoImageFrame(ctx, width, height, accent = '#8b7cff') {
  const supplied = Array.isArray(accent) ? accent : [accent, accent];
  const colors = supplied.map(color =>
    typeof color === 'string' && color.trim() ? color : '#8b7cff'
  );
  const border = ctx.createLinearGradient(0, 0, width, height);
  border.addColorStop(0, colors[0]);
  border.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  border.addColorStop(1, colors[1] || colors[0]);

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = border;
  roundedRect(ctx, 1, 1, width - 2, height - 2, 18);
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  roundedRect(ctx, 6, 6, width - 12, height - 12, 14);
  ctx.stroke();

  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = colors[0];
  const inset = 12;
  const corner = 19;
  ctx.beginPath();
  ctx.moveTo(inset, inset + corner);
  ctx.lineTo(inset, inset);
  ctx.lineTo(inset + corner, inset);
  ctx.moveTo(width - inset - corner, inset);
  ctx.lineTo(width - inset, inset);
  ctx.lineTo(width - inset, inset + corner);
  ctx.moveTo(inset, height - inset - corner);
  ctx.lineTo(inset, height - inset);
  ctx.lineTo(inset + corner, height - inset);
  ctx.strokeStyle = border;
  ctx.stroke();
  ctx.restore();
}

module.exports = { drawCasinoImageFrame };
