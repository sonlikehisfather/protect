'use strict';

const { Canvas } = require('skia-canvas');
const { drawCasinoImageFrame } = require('./casinoImageFrame');

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

const W = 800;
const H = 500;

const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_COLORS = { '♠': '#1a1a2e', '♥': '#c0392b', '♦': '#c0392b', '♣': '#1a1a2e' };

const CARD_W = 70;
const CARD_H = 100;
const CARD_GAP = 12;

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

const VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 10, 'Q': 10, 'K': 10, 'A': 11 };

function handValue(hand) {
  let sum = hand.reduce((a, c) => a + VALUES[c], 0);
  let aces = hand.filter(c => c === 'A').length;
  while (sum > 21 && aces > 0) { sum -= 10; aces--; }
  return sum;
}

const suitMap = {};
function getSuit(card) {
  if (!suitMap[card]) suitMap[card] = SUITS[Math.floor(Math.random() * 4)];
  return suitMap[card];
}

function drawCard(ctx, x, y, card, hidden = false) {
  ctx.save();

  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;

  if (hidden) {
    const grad = ctx.createLinearGradient(x, y, x + CARD_W, y + CARD_H);
    grad.addColorStop(0, '#2d4a2d');
    grad.addColorStop(1, '#1a3a1a');
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, CARD_W, CARD_H, 8);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    ctx.strokeStyle = '#c0c0c0';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x + 4, y + 4, CARD_W - 8, CARD_H - 8, 5);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(192,192,192,0.2)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 12 + i * 13);
      ctx.lineTo(x + CARD_W - 8, y + 18 + i * 13);
      ctx.stroke();
    }

    ctx.fillStyle = '#c0c0c0';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x + CARD_W / 2, y + CARD_H / 2);
  } else {
    const cardGrad = ctx.createLinearGradient(x, y, x, y + CARD_H);
    cardGrad.addColorStop(0, '#ffffff');
    cardGrad.addColorStop(0.5, '#f5f5f5');
    cardGrad.addColorStop(1, '#e8e8e8');
    ctx.fillStyle = cardGrad;
    roundRect(ctx, x, y, CARD_W, CARD_H, 8);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, CARD_W, CARD_H, 8);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 2, y + 2, CARD_W - 4, CARD_H - 4, 6);
    ctx.stroke();

    const glossGrad = ctx.createLinearGradient(x, y, x + CARD_W * 0.3, y + CARD_H * 0.3);
    glossGrad.addColorStop(0, 'rgba(255,255,255,0.4)');
    glossGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glossGrad;
    roundRect(ctx, x + 2, y + 2, CARD_W - 4, CARD_H - 4, 6);
    ctx.fill();

    const suit = getSuit(card);
    const color = SUIT_COLORS[suit];

    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    roundRect(ctx, x + 4, y + 4, CARD_W - 8, CARD_H - 8, 5);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(card, x + 6, y + 5);

    ctx.font = '16px sans-serif';
    ctx.fillText(suit, x + 6, y + 28);

    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(suit, x + CARD_W / 2, y + CARD_H / 2 + 3);

    if (card === 'A') {
      ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x + CARD_W / 2, y + CARD_H / 2 + 3, 18, 0, Math.PI * 2);
    ctx.stroke();
    }

    ctx.save();
    ctx.translate(x + CARD_W - 6, y + CARD_H - 5);
    ctx.rotate(Math.PI);
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(card, 0, 0);
    ctx.font = '16px sans-serif';
    ctx.fillText(suit, 0, 23);
    ctx.restore();
  }

  ctx.restore();
}

function drawHand(ctx, hand, cx, y, hideSecond = false) {
  const totalW = hand.length * CARD_W + (hand.length - 1) * CARD_GAP;
  const scale = Math.min(1, (W - 100) / totalW);
  const cardW = CARD_W * scale;
  const cardGap = CARD_GAP * scale;
  const cardH = CARD_H * scale;
  const handW = hand.length * cardW + (hand.length - 1) * cardGap;
  const startX = cx - handW / 2;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  roundRect(ctx, startX - 8 * scale, y - 6 * scale, handW + 16 * scale, cardH + 12 * scale, 10 * scale);
  ctx.fill();
  ctx.restore();

  for (let i = 0; i < hand.length; i++) {
    const hidden = hideSecond && i === 1;
    ctx.save();
    ctx.translate(startX + i * (cardW + cardGap), y);
    ctx.scale(scale, scale);
    drawCard(ctx, 0, 0, hand[i], hidden);
    ctx.restore();
  }

  const val = handValue(hand);
  const labelY = y + cardH + 18 * scale;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  roundRect(ctx, cx - 40, labelY - 15, 80, 30, 15);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  roundRect(ctx, cx - 40, labelY - 15, 80, 30, 15);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (hideSecond) {
    ctx.fillText('? + ?', cx, labelY);
  } else {
    const valColor = val > 21 ? '#ED4245' : val === 21 ? '#57F287' : '#ffffff';
    ctx.fillStyle = valColor;
    ctx.fillText(String(val), cx, labelY);
    if (val === 21) {
      ctx.fillStyle = '#57F287';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText('BLACKJACK', cx, labelY + 14);
    } else if (val > 21) {
      ctx.fillStyle = '#ED4245';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText('BUST', cx, labelY + 14);
    }
  }
}

function drawLabel(ctx, text, x, y, color = '#8b95a7') {
  ctx.fillStyle = color;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
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

async function generateBlackjackImage({ playerHand, dealerHand, gameOver, win, push, bust, amount, finalCoins, cote, netGain, bonuses }) {
  for (const k of Object.keys(suitMap)) delete suitMap[k];

  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');

  const accent = win ? '#57F287' : push ? '#F1C40F' : '#ED4245';

  const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 500);
  bgGrad.addColorStop(0, '#1a4d2e');
  bgGrad.addColorStop(0.6, '#0f3320');
  bgGrad.addColorStop(1, '#0a1a10');
  ctx.fillStyle = bgGrad;
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = '#c0c0c0';
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W - 2, H - 2, 19);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  roundRect(ctx, 20, 20, W - 40, H - 40, 15);
  ctx.stroke();

  drawCornerOrnaments(ctx, W, H, '#c0c0c0', 0.1);

  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.fillStyle = '#c0c0c0';
  ctx.font = 'bold 80px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('♠', W / 2, H / 2 + 20);
  ctx.fillText('♥', W / 2 - 200, H / 2);
  ctx.fillText('♦', W / 2 + 200, H / 2);
  ctx.restore();

  for (let i = 0; i < 15; i++) {
    const px = 30 + Math.random() * (W - 60);
    const py = 55 + Math.random() * (H - 110);
    ctx.save();
    ctx.globalAlpha = 0.04 + Math.random() * 0.06;
    ctx.fillStyle = '#c0c0c0';
    ctx.beginPath();
    ctx.arc(px, py, 1 + Math.random() * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = '#c0c0c0';
  ctx.globalAlpha = 0.45;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BLACKJACK PAYS 3:2', W / 2, H - 30);
  ctx.fillText('INSURANCE PAYS 2:1', W / 2, H - 15);
  ctx.restore();

  ctx.fillStyle = '#c0c0c0';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('♠ BLACKJACK', 30, 30);

  ctx.fillStyle = '#8b95a7';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`Mise : ${fmtCoins(amount)} coins`, W - 30, 30);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(30, 50);
  ctx.lineTo(W - 30, 50);
  ctx.stroke();

  const pVal = handValue(playerHand);
  const dVal = handValue(dealerHand);

  let resultText = '';
  let resultColor = accent;
  if (!gameOver) {
    resultText = 'En cours...';
    resultColor = '#8b95a7';
  } else if (bust || pVal > 21) {
    resultText = `‼ BUST ! Tu as ${pVal} ・ Perdu -${fmtCoins(amount)}`;
    resultColor = '#ED4245';
  } else if (dVal > 21) {
    resultText = `★ Croupier BUST (${dVal}) ! Gagné +${fmtCoins(netGain)}`;
    resultColor = '#57F287';
  } else if (win) {
    resultText = `★ VICTOIRE ! ${pVal} vs ${dVal} ・ +${fmtCoins(netGain)} (x${cote.toFixed(2)})`;
    resultColor = '#57F287';
  } else if (push) {
    resultText = `= ÉGALITÉ ${pVal} vs ${dVal} ・ Remboursé`;
    resultColor = '#F1C40F';
  } else {
    resultText = `○ Défaite ${pVal} vs ${dVal} ・ -${fmtCoins(amount)}`;
    resultColor = '#ED4245';
  }

  ctx.fillStyle = resultColor;
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(resultText, W / 2, 82);

  ctx.fillStyle = '#8b95a7';
  ctx.font = '15px sans-serif';
  ctx.fillText(`Solde : ${fmtCoins(finalCoins)} coins`, W / 2, 108);

  if (bonuses && bonuses.length) {
    ctx.fillStyle = '#FFD700';
    ctx.font = '13px sans-serif';
    ctx.fillText(`Bonus : ${bonuses.join(' ・ ')}`, W / 2, 126);
  }

  const dealerY = 150;
  const playerY = 315;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  roundRect(ctx, 30, dealerY - 18, W - 60, CARD_H + 30, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  roundRect(ctx, 30, dealerY - 18, W - 60, CARD_H + 30, 12);
  ctx.stroke();
  ctx.restore();

  drawLabel(ctx, '◊ CROUPIER', W / 2, dealerY - 8, '#c0c0c0');
  drawHand(ctx, dealerHand, W / 2, dealerY, !gameOver);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(40, 285);
  ctx.lineTo(W - 40, 285);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  roundRect(ctx, 30, playerY - 18, W - 60, CARD_H + 30, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  roundRect(ctx, 30, playerY - 18, W - 60, CARD_H + 30, 12);
  ctx.stroke();
  ctx.restore();

  drawLabel(ctx, '● TOI', W / 2, playerY - 8, '#c0c0c0');
  drawHand(ctx, playerHand, W / 2, playerY, false);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(W / 2, 285, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.08;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('21', W / 2, 285);
  ctx.restore();

  drawCasinoImageFrame(ctx, W, H, accent);
  return await canvas.toBuffer('png');
}

module.exports = { generateBlackjackImage };
