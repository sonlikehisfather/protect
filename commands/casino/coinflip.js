'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
  AttachmentBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = require('discord.js');
const embed = require('../../utils/embed');
const db    = require('../../core/database');
const { checkCasinoChannel, getGameCoteInfo, checkCasinoLimits, setCooldown } = require('./casino');
const { generateCoinflipImage } = require('../../utils/coinflipImage');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

exports.help = {
  name        : 'coinflip',
  description : 'Pile ou face, double ou rien.',
  use         : 'coinflip <montant>',
  usage       : 'coinflip 500',
  aliases     : ['pf', 'pileface', 'coin'],
  category    : 'casino',
  selfManaged : true,
};

exports.run = async (client, message, args) => {
  const guildId     = message.guild.id;
  const userId      = message.author.id;
  const chErr = checkCasinoChannel(message);
  if (chErr) return embed.replyError(message, chErr);

  // Validate bet amount
  const user = db.getCasinoUser(guildId, userId);
  const cfg = db.getCasinoConfig(guildId);
  let amount;
  if (args[0] && args[0].toLowerCase() === 'all') {
    amount = user.coins;
    if (cfg.limitCfMax > 0) amount = Math.min(amount, cfg.limitCfMax);
  } else {
    amount = parseInt(args[0]);
  }
  if (!amount || amount < 1) {
    if (args[0] && args[0].toLowerCase() === 'all')
      return embed.replyError(message, `Tu n'as aucun coin a parier. Solde : **${embed.fmtCoins(user.coins)}** coins`);
    return embed.replyError(message, 'Tu dois parier un montant valide. Usage : `+coinflip <montant|all>`');
  }

  const limitErr = checkCasinoLimits(message, 'coinflip', amount);
  if (limitErr) return embed.replyError(message, limitErr);

  if (user.coins < amount) {
    return embed.replyError(message, `Tu n'as pas assez de coins. Solde : **${embed.fmtCoins(user.coins)}** coins`);
  }

  setCooldown(guildId, userId, 'coinflip');

  let betDeducted = false;
  const deductBet = () => {
    if (betDeducted) return;
    betDeducted = true;
    db.removeCasinoCoins(guildId, userId, amount, 'spend');
    db.recordPendingBet(guildId, userId, amount, 'coinflip');
  };
  const refundBet = () => {
    if (!betDeducted) return;
    betDeducted = false;
    db.refundCasinoBet(guildId, userId, amount);
    db.clearPendingBet(guildId, userId, 'coinflip');
  };
  const { cote, bonuses } = getGameCoteInfo(guildId, message.member, 'coinflip');

  const guildConfig = db.getGuildConfig(guildId);
  const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
  const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
  const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

  if (deleteCmd) await message.delete().catch(() => {});

  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('coinflip:pile').setLabel('Pile').setEmoji('👤').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('coinflip:face').setLabel('Face').setEmoji('⚡').setStyle(ButtonStyle.Primary),
  );

  const _buildV2 = (state, extra = {}) => {
    const container = new ContainerBuilder();
    if (state === 'pick') {
      container
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🪙 Pile ou Face\n\nMise: **${embed.fmtCoins(amount)}** coins\n\nChoisis ton côté :`))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(1))
        .addActionRowComponents(btnRow);
    } else {
      const { choice, result, win, xpGain, finalCoins } = extra;
      const emoji   = result === 'pile' ? '👤' : '⚡';
      const verdict = win ? `✔ GAGNÉ ! (+${embed.fmtCoins((Math.floor(amount * extra.cote) - amount))} coins)` : `× Perdu... (-${embed.fmtCoins(amount)} coins)`;
      const bonusLine = extra.bonuses?.length ? `\n⭐ Cote x${extra.cote.toFixed(2)} ・ ${extra.bonuses.join(', ')}` : '';
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## 🪙 Pile ou Face\n\n**Ton choix** : ${choice.toUpperCase()}\n**Résultat** : ${emoji} ${result.toUpperCase()}\n\n${verdict}${bonusLine}\n▱ Solde : **${embed.fmtCoins(finalCoins)}**`,
      ));
    }
    return { components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
  };

  const sent = V2_AVAILABLE
    ? await message.reply(_buildV2('pick')).catch(() => null)
    : await message.reply({
        embeds: [embed.build(guildId, null, { title: '🪙 Pile ou Face', description: 'Choisis ton côté :', color: '#F1C40F', timestamp: false })],
        components: [btnRow],
        allowedMentions: { parse: [] },
      }).catch(() => null);

  if (!sent) return;

  deductBet();

  const collector = sent.createMessageComponentCollector({
    filter: i => i.customId === 'coinflip:pile' || i.customId === 'coinflip:face',
    time: 60_000,
  });

  collector.on('collect', async interaction => {
    if (interaction.user.id !== message.author.id) {
      return interaction.reply({ content: "Ce n'est pas ta partie !", flags: 64 }).catch(() => {});
    }
    collector.stop('done');
    await interaction.deferUpdate().catch(() => {});

    const choice  = interaction.customId === 'coinflip:pile' ? 'pile' : 'face';
    const result  = Math.random() < 0.5 ? 'pile' : 'face';
    const win     = choice === result;
    const cfg     = db.getCasinoConfig(guildId);

    // Handle bet result
    let finalCoins, gain;
    if (win) {
      // Win - return bet * cote
      const winAmount = Math.floor(amount * cote);
      db.addCasinoCoins(guildId, userId, winAmount, 'win');
      gain = winAmount - amount; // Net gain (excluding original bet)
    } else {
      gain = -amount;
    }
    db.clearPendingBet(guildId, userId, 'coinflip');

    const baseXp  = win ? (cfg.xpCfWin ?? 30) : (cfg.xpCfLoss ?? 10);
    const xpGain  = win ? Math.max(baseXp, Math.floor(gain / 500) + baseXp) : baseXp;
    db.addXp(guildId, message.author.id, xpGain);

    finalCoins = db.getCasinoUser(guildId, userId).coins;

    const { sendCasinoLog } = require('./casino');
    sendCasinoLog(message.guild, cfg, 'logChannelGames', {
      icon  : win ? '✸' : '↺',
      title : 'Pile ou Face',
      color : win ? 0x57F287 : 0xED4245,
      user  : userId,
      lines : [
        `Mise : **${embed.fmtCoins(amount)}** coins`,
        `Choix : **${choice.toUpperCase()}** ・ Resultat : **${result.toUpperCase()}**`,
        win
          ? `Gagne **+${embed.fmtCoins((Math.floor(amount * cote) - amount))}** coins (x${cote.toFixed(2)})`
          : `Perdu **-${embed.fmtCoins(amount)}** coins`,
        `Solde : **${embed.fmtCoins(finalCoins)}** coins`,
      ],
    });

    let cfImage = null;
    try {
      cfImage = await generateCoinflipImage({
        choice, result, win, amount, cote,
        netGain: win ? gain : -amount,
        finalCoins, bonuses,
      });
    } catch (e) {
      console.error('[CF] Image error:', e?.message);
    }

    if (cfImage) {
      if (V2_AVAILABLE) {
        const container = new ContainerBuilder().setAccentColor(win ? 0x57F287 : 0xED4245);
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://cf_result.png')));
        await sent.edit({
          components: [container],
          flags: COMPONENTS_V2_FLAG,
          files: [new AttachmentBuilder(cfImage, { name: 'cf_result.png' })],
        }).catch(() => {});
      } else {
        await sent.edit({
          embeds: [embed.build(guildId, null, {
            title: 'Pile ou Face',
            image: 'attachment://cf_result.png',
            description: `${choice.toUpperCase()} vs ${result.toUpperCase()} ・ ${win ? 'Gagne' : 'Perdu'} \nSolde : ${embed.fmtCoins(finalCoins)} coins`,
            color: win ? '#57F287' : '#ED4245', timestamp: false,
          })],
          files: [new AttachmentBuilder(cfImage, { name: 'cf_result.png' })],
          components: [],
        }).catch(() => {});
      }
    } else if (V2_AVAILABLE) {
      await sent.edit(_buildV2('result', { choice, result, win, xpGain, finalCoins, cote, bonuses })).catch(() => {});
    } else {
      const emoji    = result === 'pile' ? '👤' : '⚡';
      const winEmoji = win ? '✔' : '×';
      const netGain = win ? Math.floor(amount * cote) - amount : 0;
      const resultText = win ? `Gagné ! (+${embed.fmtCoins(netGain)} coins)${bonuses.length ? ` [x${cote.toFixed(2)} ・ ${bonuses.join(', ')}]` : ''}` : `Perdu... (-${embed.fmtCoins(amount)} coins)`;
      await sent.edit({
        embeds: [embed.build(guildId, null, {
          title: '🪙 Pile ou Face',
          fields: [
            { name: 'Ton choix', value: choice.toUpperCase(), inline: true },
            { name: 'Résultat',  value: `${emoji} ${result.toUpperCase()}`, inline: true },
            { name: 'Score',     value: `${winEmoji} ${resultText}`, inline: false },
            { name: 'Solde',     value: `${embed.fmtCoins(finalCoins)} coins`, inline: false },
          ],
          color: win ? '#57F287' : '#ED4245', timestamp: false,
        })],
        components: [],
      }).catch(() => {});
    }
  });

  collector.on('end', (_, reason) => {
    if (reason === 'done') return;
    refundBet();
    const finalCoins = db.getCasinoUser(guildId, userId).coins;
    const { sendCasinoLog } = require('./casino');
    sendCasinoLog(message.guild, cfg, 'logChannelGames', {
      icon  : '↺',
      title : 'Pile ou Face',
      color : 0xFEE75C,
      user  : userId,
      lines : [
        `Mise : **${embed.fmtCoins(amount)}** coins`,
        `Remboursement : **${embed.fmtCoins(amount)}** coins (expiré)`,
        `Solde : **${embed.fmtCoins(finalCoins)}** coins`,
      ],
    });
    if (V2_AVAILABLE) {
      const c = new ContainerBuilder().setAccentColor(0xFEE75C);
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## 🪙 Pile ou Face\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ **Expiré**\n> Remboursement : **${embed.fmtCoins(amount)}** coins\n> Solde : **${embed.fmtCoins(finalCoins)}** coins`
      ));
      sent.edit({ components: [c], flags: COMPONENTS_V2_FLAG }).catch(() => {});
    } else {
      sent.edit({ content: `🪙 Pile ou Face expiré. Remboursement de ${embed.fmtCoins(amount)} coins. Solde : ${embed.fmtCoins(finalCoins)} coins`, components: [] }).catch(() => {});
    }
  });

  if (deleteReply) embed.scheduleDelete(sent, deleteDelay);
};
