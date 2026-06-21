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
const { checkCasinoChannel, checkCasinoLimits, setCooldown } = require('./casino');

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
  setCooldown(guildId, message.author.id, 'gift');

  const cfg        = db.getCasinoConfig(guildId);
  const giftMin    = cfg.giftMin ?? 100;
  const giftMax    = cfg.giftMax ?? 1000;
  const winnerIdx  = Math.floor(Math.random() * 3);
  const prize      = Math.floor(Math.random() * (giftMax - giftMin + 1)) + giftMin;

  const makeRow = (disabled = false, revealWinner = false) =>
    new ActionRowBuilder().addComponents(
      [0, 1, 2].map(i =>
        new ButtonBuilder()
          .setCustomId(`gift:${i}`)
          .setLabel(revealWinner && i === winnerIdx ? `+${embed.fmtCoins(prize)}` : '\u200b')
          .setStyle(BTN_COLORS[i])
          .setDisabled(disabled)
      )
    );

  const giftText = `**<@${message.author.id}>** lance un cadeau mystere ・ **1 bouton sur 3** cache une recompense !`;

  let msg;
  if (V2_AVAILABLE) {
    const container = new ContainerBuilder().setAccentColor(0x57F287);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(giftText));
    container.addActionRowComponents(makeRow());
    msg = await message.reply({ components: [container], flags: COMPONENTS_V2_FLAG }).catch(() => null);
  } else {
    msg = await message.reply({ content: giftText, components: [makeRow()] }).catch(() => null);
  }

  if (!msg) return;

  const clicked  = new Set();
  const collector = msg.createMessageComponentCollector({
    filter: i => i.customId.startsWith('gift:'),
    time:   GIFT_TIMEOUT,
  });

  collector.on('collect', async i => {
    if (clicked.has(i.user.id)) {
      return i.reply({ content: 'Tu as déjà cliqué !', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    clicked.add(i.user.id);

    const btnIdx = parseInt(i.customId.split(':')[1]);
    const isWin  = btnIdx === winnerIdx;

    if (isWin) {
      db.addCasinoCoins(guildId, i.user.id, prize, 'win');
      const { sendCasinoLog } = require('./casino');
      sendCasinoLog(message.guild, cfg, 'logChannelGames', {
        icon  : '✸',
        title : 'Gift',
        color : 0x57F287,
        user  : i.user.id,
        lines : [
          `Cadeau trouve par <@${i.user.id}>`,
          `Gagne **+${embed.fmtCoins(prize)}** coins`,
        ],
      });
      if (V2_AVAILABLE) {
        const winContainer = new ContainerBuilder().setAccentColor(0x57F287);
        winContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `## Cadeau trouve !\n\n> **<@${i.user.id}>** a trouve le cadeau ・ **+${embed.fmtCoins(prize)} coins** !`
        ));
        await i.reply({ components: [winContainer], flags: COMPONENTS_V2_FLAG }).catch(() => {});
      } else {
        await i.reply({
          content: `**<@${i.user.id}>** a trouve le cadeau ・ **+${embed.fmtCoins(prize)} coins** !`,
        }).catch(() => {});
      }
      collector.stop('won');
    } else {
      if (V2_AVAILABLE) {
        const loseContainer = new ContainerBuilder().setAccentColor(0xED4245);
        loseContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `> **<@${i.user.id}>** a rate ・ ce bouton etait vide.`
        ));
        await i.reply({ components: [loseContainer], flags: [COMPONENTS_V2_FLAG, MessageFlags.Ephemeral] }).catch(() => {});
      } else {
        await i.reply({
          content: `**<@${i.user.id}>** a rate ・ ce bouton etait vide.`,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    }
  });

  collector.on('end', async (_, reason) => {
    const expired = reason === 'time';
    if (V2_AVAILABLE) {
      const endText = expired
        ? `Le cadeau a expire ・ personne n'a trouve ! *(+${embed.fmtCoins(prize)} coins perdus)*`
        : giftText;
      const container = new ContainerBuilder().setAccentColor(expired ? 0xED4245 : 0x57F287);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(endText));
      container.addActionRowComponents(makeRow(true, true));
      await msg.edit({ components: [container], flags: COMPONENTS_V2_FLAG }).catch(() => {});
    } else {
      await msg.edit({
        content: expired
          ? `Le cadeau a expire ・ personne n'a trouve ! *(+${embed.fmtCoins(prize)} coins perdus)*`
          : msg.content,
        components: [makeRow(true, true)],
      }).catch(() => {});
    }
  });
};
