'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
} = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { checkCasinoChannel, checkCasinoLimits, setCooldown, sendCasinoLog } = require('./casino');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

const GIFT_TIMEOUT = 30_000;
const BTN_COLORS   = [ButtonStyle.Primary, ButtonStyle.Success, ButtonStyle.Danger];

exports.help = {
  name       : 'gift',
  description: 'Fait apparaître 3 boutons mystère ・ 1 seul est gagnant !',
  use        : 'gift',
  usage      : 'gift',
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;

  const chErr = checkCasinoChannel(message);
  if (chErr) return embed.replyError(message, chErr);

  if (!db.isCasinoEnabled(guildId)) {
    return embed.replyError(message, 'Le casino n\'est pas active.');
  }

  const limitErr = checkCasinoLimits(message, 'gift');
  if (limitErr) return embed.replyError(message, limitErr);

  const cfg = db.getCasinoConfig(guildId);
  const giftMin = Number(cfg.giftMin ?? 100);
  const giftMax = Number(cfg.giftMax ?? 1000);
  if (!Number.isSafeInteger(giftMin) || !Number.isSafeInteger(giftMax) || giftMin < 1 || giftMax < giftMin) {
    return embed.replyError(message, 'La récompense du Gift est mal configurée. Contacte un administrateur.');
  }

  const useV2 = V2_AVAILABLE && embed.shouldUseV2(guildId, module.exports.help.name);
  const winnerIdx = Math.floor(Math.random() * 3);
  const prize = Math.floor(Math.random() * (giftMax - giftMin + 1)) + giftMin;
  const makeRow = (disabled = false, revealResult = false) =>
    new ActionRowBuilder().addComponents(
      [0, 1, 2].map(i =>
        new ButtonBuilder()
          .setCustomId(`gift:${i}`)
          .setLabel(revealResult
            ? (i === winnerIdx ? `+${embed.fmtCoins(prize)}` : 'Vide')
            : '?')
          .setStyle(BTN_COLORS[i])
          .setDisabled(disabled)
      )
    );

  const giftText = `**<@${message.author.id}>** lance un cadeau mystère ・ **1 bouton sur 3** cache une récompense !`;
  const buildPayload = (
    text,
    { disabled = false, revealResult = false, ephemeral = false, includeButtons = true } = {}
  ) => {
    const row = includeButtons ? makeRow(disabled, revealResult) : null;
    const flags = (useV2 ? COMPONENTS_V2_FLAG : 0) | (ephemeral ? MessageFlags.Ephemeral : 0);

    if (useV2) {
      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
      if (row) container.addActionRowComponents(row);
      return { components: [container], flags };
    }

    const payload = { content: text };
    if (row) payload.components = [row];
    if (flags) payload.flags = flags;
    return payload;
  };

  const msg = await message.reply(buildPayload(giftText));
  setCooldown(guildId, message.author.id, 'gift');

  const clicked = new Set();
  let winnerUserId = null;
  const collector = msg.createMessageComponentCollector({
    filter: i => /^gift:[0-2]$/.test(i.customId),
    time:   GIFT_TIMEOUT,
  });

  collector.on('collect', async i => {
    if (winnerUserId) {
      return i.reply({ content: 'Cette partie est déjà terminée.', flags: MessageFlags.Ephemeral })
        .catch(err => console.error('[GIFT] Impossible de répondre après la fin :', err));
    }

    if (clicked.has(i.user.id)) {
      return i.reply({ content: 'Tu as déjà cliqué !', flags: MessageFlags.Ephemeral })
        .catch(err => console.error('[GIFT] Impossible de répondre au clic répété :', err));
    }
    clicked.add(i.user.id);

    const btnIdx = Number(i.customId.slice('gift:'.length));
    const isWin = btnIdx === winnerIdx;

    if (isWin) {
      winnerUserId = i.user.id;
      collector.stop('won');
      db.addCasinoCoins(guildId, i.user.id, prize, 'win');
      sendCasinoLog(message.guild, cfg, 'logChannelGames', {
        icon  : '✸',
        title : 'Gift',
        user  : i.user.id,
        lines : [
          `Cadeau trouvé par <@${i.user.id}>`,
          `Gagné **+${embed.fmtCoins(prize)}** coins`,
        ],
      });
      await i.reply(buildPayload(
        `## Cadeau trouvé !\n\n> **<@${i.user.id}>** a trouvé le cadeau ・ **+${embed.fmtCoins(prize)} coins** !`,
        { includeButtons: false }
      )).catch(err => console.error('[GIFT] Impossible d’annoncer le gagnant :', err));
    } else {
      await i.reply(buildPayload(
        `> **<@${i.user.id}>** a raté ・ ce bouton était vide.`,
        { ephemeral: true, includeButtons: false }
      )).catch(err => console.error('[GIFT] Impossible d’annoncer le résultat :', err));
    }
  });

  collector.on('end', async (_, reason) => {
    const expired = reason === 'time';
    const endText = expired
      ? `Le cadeau a expiré ・ personne ne l'a trouvé. La récompense de **+${embed.fmtCoins(prize)} coins** n'a pas été attribuée.`
      : winnerUserId
        ? `## Cadeau trouvé !\n\n> **<@${winnerUserId}>** a trouvé le cadeau ・ **+${embed.fmtCoins(prize)} coins** !`
        : giftText;
    await msg.edit(buildPayload(endText, { disabled: true, revealResult: true }))
      .catch(err => console.error('[GIFT] Impossible de clôturer la partie :', err));
  });
};
