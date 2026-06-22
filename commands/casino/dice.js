'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const embed = require('../../utils/embed');
const db    = require('../../core/database');
const { checkCasinoChannel, checkCasinoLimits, setCooldown, sendCasinoLog } = require('./casino');
const { generateDiceImage } = require('../../utils/diceImage');
const { AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

const ROLL_MAX = 100;
const HOUSE_EDGE = 0.97;

function calcMultiplier(rangeSize) {
  if (rangeSize < 1) return 0;
  if (rangeSize >= ROLL_MAX) return HOUSE_EDGE;
  return Math.floor((ROLL_MAX / rangeSize) * HOUSE_EDGE * 100) / 100;
}

exports.help = {
  name        : 'dice',
  description : 'Dice ・ choisis ta plage, le bot tire un chiffre 0-99, plus ta plage est petite plus tu gagnes !',
  use         : 'dice <mise|all>',
  usage       : 'dice 1000',
  aliases     : ['de', 'des'],
  category    : 'casino',
  selfManaged : true,
};

exports.run = async (client, message, args) => {
  try {
  const guildId = message.guild.id;
  const userId  = message.author.id;

  const chErr = checkCasinoChannel(message);
  if (chErr) return embed.replyError(message, chErr);

  if (!db.isCasinoEnabled(guildId)) {
    return embed.replyError(message, 'Le casino n\'est pas actif.');
  }

  const user = db.getCasinoUser(guildId, userId);
  const cfg  = db.getCasinoConfig(guildId);

  let amount;
  if (args[0] && args[0].toLowerCase() === 'all') {
    amount = user.coins;
    if (cfg.limitDiceMax > 0) amount = Math.min(amount, cfg.limitDiceMax);
  } else {
    amount = parseInt(args[0]);
  }
  if (!amount || amount < 1) {
    if (args[0] && args[0].toLowerCase() === 'all')
      return embed.replyError(message, `Tu n'as aucun coin a parier. Solde : **${embed.fmtCoins(user.coins)}** coins`);
    return embed.replyError(message, 'Tu dois parier un montant valide. Usage : `+dice <mise|all>`');
  }

  const limitErr = checkCasinoLimits(message, 'dice', amount);
  if (limitErr) return embed.replyError(message, limitErr);

  if (user.coins < amount) {
    return embed.replyError(message, `Tu n'as pas assez de coins. Solde : **${embed.fmtCoins(user.coins)}** coins`);
  }

  setCooldown(guildId, userId, 'dice');

  const startTime = Date.now();

  let betDeducted = false;
  const deductBet = () => {
    if (betDeducted) return;
    betDeducted = true;
    db.removeCasinoCoins(guildId, userId, amount, 'spend');
    db.recordPendingBet(guildId, userId, amount, 'dice');
  };
  const refundBet = () => {
    if (!betDeducted) return;
    betDeducted = false;
    db.refundCasinoBet(guildId, userId, amount);
    db.clearPendingBet(guildId, userId, 'dice');
  };

  const guildConfig = db.getGuildConfig(guildId);
  const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
  const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
  const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

  if (deleteCmd) await message.delete().catch(() => {});

  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('dice:pick').setLabel('Choisir ma plage').setEmoji('🎯').setStyle(ButtonStyle.Primary),
  );

  const buildPickV2 = () => {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## 🎯 Dice\n\n` +
      `Mise : **${embed.fmtCoins(amount)}** coins\n\n` +
      `### Comment jouer\n` +
      `> Choisis une plage entre **0** et **${ROLL_MAX - 1}**\n` +
      `> Le bot tire un chiffre aleatoire entre 0 et ${ROLL_MAX - 1}\n` +
      `> Si le chiffre est dans ta plage, tu gagnes !\n\n` +
      `### Exemples de cotes\n` +
      `> Plage 0-99 (100 num) ・ x${calcMultiplier(100).toFixed(2)} ・ ~100%\n` +
      `> Plage 0-49 (50 num) ・ x${calcMultiplier(50).toFixed(2)} ・ ~50%\n` +
      `> Plage 30-39 (10 num) ・ x${calcMultiplier(10).toFixed(2)} ・ ~10%\n` +
      `> Plage 45-47 (3 num) ・ x${calcMultiplier(3).toFixed(2)} ・ ~3%\n\n` +
      `Plus ta plage est petite, plus tu risques, plus tu gagnes !`
    ));
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(btnRow);
    return { components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
  };

  const buildPickLegacy = () => ({
    embeds: [embed.build(guildId, null, {
      title: '🎯 Dice',
      description: `Mise : **${embed.fmtCoins(amount)}** coins\n\nChoisis une plage entre **0** et **${ROLL_MAX - 1}**.\nLe bot tire un chiffre. S'il est dans ta plage, tu gagnes !\n\nPlus ta plage est petite, plus la cote est élevée.\n\nExemples :\n• 0-99 (100 num) → x${calcMultiplier(100).toFixed(2)} (~100%)\n• 0-49 (50 num) → x${calcMultiplier(50).toFixed(2)} (~50%)\n• 30-39 (10 num) → x${calcMultiplier(10).toFixed(2)} (~10%)\n• 45-47 (3 num) → x${calcMultiplier(3).toFixed(2)} (~3%)`,
      timestamp: false,
    })],
    components: [btnRow],
    allowedMentions: { parse: [] },
  });

  let sent;
  try {
    sent = V2_AVAILABLE
      ? await message.reply(buildPickV2())
      : await message.reply(buildPickLegacy());
  } catch (e) {
    console.error('[DICE] Reply error:', e?.message);
    return embed.replyError(message, 'Erreur lors de la création de la partie.');
  }

  if (!sent) return;

  deductBet();

  const collector = sent.createMessageComponentCollector({
    filter: i => i.customId === 'dice:pick',
    time: 60_000,
  });

  collector.on('collect', async interaction => {
    try {
      if (interaction.user.id !== userId) {
        return interaction.reply({ content: "Ce n'est pas ta partie !", flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
      const modal = new ModalBuilder().setCustomId('dice:range_modal').setTitle('Choisir ta plage (0-99)');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('range_min')
            .setLabel('Minimum (0-99)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(2)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('range_max')
            .setLabel('Maximum (0-99)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(2)
        ),
      );
      await interaction.showModal(modal).catch(() => {});

      const modalSubmit = await interaction.awaitModalSubmit({
        filter: i => i.customId === 'dice:range_modal' && i.user.id === userId,
        time: 60_000,
      }).catch(() => null);

      if (!modalSubmit) return;

      const minVal = parseInt(modalSubmit.fields.getTextInputValue('range_min'));
      const maxVal = parseInt(modalSubmit.fields.getTextInputValue('range_max'));

      if (isNaN(minVal) || isNaN(maxVal)) {
        return modalSubmit.reply({ content: 'Valeurs invalides. Utilise des chiffres entre 0 et 99.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      let rangeMin = Math.min(minVal, maxVal);
      let rangeMax = Math.max(minVal, maxVal);

      if (rangeMin < 0) rangeMin = 0;
      if (rangeMax > ROLL_MAX - 1) rangeMax = ROLL_MAX - 1;
      if (rangeMin > ROLL_MAX - 1) rangeMin = ROLL_MAX - 1;
      if (rangeMax < 0) rangeMax = 0;
      if (rangeMax < rangeMin) rangeMax = rangeMin;

      const rangeSize = rangeMax - rangeMin + 1;
      if (rangeSize < 1 || rangeSize > ROLL_MAX) {
        return modalSubmit.reply({ content: 'Plage invalide.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      await handleResult(rangeMin, rangeMax, modalSubmit);
    } catch (e) {
      console.error('[DICE] Collect error:', e?.message, e?.stack);
    }
  });

  const handleResult = async (rangeMin, rangeMax, modalSubmit) => {
    try {
      collector.stop('done');

      const roll = Math.floor(Math.random() * ROLL_MAX);
      const rangeSize = rangeMax - rangeMin + 1;
      const win = roll >= rangeMin && roll <= rangeMax;
      const mult = calcMultiplier(rangeSize);
      const winChance = ((rangeSize / ROLL_MAX) * 100).toFixed(1);
      let winAmount = 0;
      if (win) winAmount = Math.floor(amount * mult);

      if (winAmount > 0) db.addCasinoCoins(guildId, userId, winAmount, 'win');

    // Track game stats
    const gameDuration = Math.floor((Date.now() - startTime) / 1000);
    db.recordGameStat(guildId, userId, 'dice', win ? 1 : 0, amount, win ? winAmount - amount : 0);
    db.addPlaytime(guildId, userId, gameDuration);
      db.clearPendingBet(guildId, userId, 'dice');

      const gain = win ? winAmount - amount : -amount;
      const baseXp = win ? 40 : 10;
      const xpGain = win ? Math.max(baseXp, Math.floor(gain / 500) + baseXp) : baseXp;
      db.addXp(guildId, userId, xpGain);

      const finalCoins = db.getCasinoUser(guildId, userId).coins;

      sendCasinoLog(message.guild, cfg, 'logChannelGames', {
        icon  : win ? '✸' : '↺',
        title : 'Dice',

        user  : userId,
        lines : [
          `Mise : **${embed.fmtCoins(amount)}** coins`,
          `Plage : **${rangeMin}-${rangeMax}** (${rangeSize} num) ・ x${mult.toFixed(2)} (${winChance}%)`,
          `Tirage : **${roll}**`,
          win
            ? `Gagne **+${embed.fmtCoins((winAmount - amount))}** coins (x${mult.toFixed(2)})`
            : `Perdu **-${embed.fmtCoins(amount)}** coins`,
          `Solde : **${embed.fmtCoins(finalCoins)}** coins`,
        ],
      });

      const barLen = 30;
      const barPos = Math.floor((roll / (ROLL_MAX - 1)) * (barLen - 1));
      const rangeStartBar = Math.floor((rangeMin / (ROLL_MAX - 1)) * (barLen - 1));
      const rangeEndBar = Math.floor((rangeMax / (ROLL_MAX - 1)) * (barLen - 1));
      let bar = '';
      for (let i = 0; i < barLen; i++) {
        if (i === barPos) bar += '●';
        else if (i >= rangeStartBar && i <= rangeEndBar) bar += '─';
        else bar += '·';
      }

      let imageBuffer = null;
      try {
        imageBuffer = await generateDiceImage({
          roll, rangeMin, rangeMax, rangeSize, mult, winChance, win, winAmount, amount, finalCoins,
        });
      } catch (e) {
        console.error('[DICE] Image generation error:', e?.message);
      }

      let editPayload;

      if (imageBuffer && V2_AVAILABLE) {
        const c = new ContainerBuilder();
        c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://dice_result.png')));
        editPayload = {
          components: [c],
          flags: COMPONENTS_V2_FLAG,
          files: [new AttachmentBuilder(imageBuffer, { name: 'dice_result.png' })],
        };
      } else if (imageBuffer) {
        editPayload = {
          embeds: [embed.build(guildId, null, {
            title: '🎯 Dice',
            image: 'attachment://dice_result.png',
            timestamp: false,
          })],
          components: [],
          files: [new AttachmentBuilder(imageBuffer, { name: 'dice_result.png' })],
        };
      } else if (V2_AVAILABLE) {
        const c = new ContainerBuilder();
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `## 🎯 Dice\n\n` +
          `Plage : **${rangeMin} - ${rangeMax}** (${rangeSize} num) ・ x${mult.toFixed(2)} ・ ${winChance}%\n` +
          `Tirage : **${roll}**\n\n` +
          (win
            ? `✔ **GAGNE !** +${embed.fmtCoins((winAmount - amount))} coins (x${mult.toFixed(2)})\n`
            : `× **Perdu...** -${embed.fmtCoins(amount)} coins\n`) +
          `\n▱ Solde : **${embed.fmtCoins(finalCoins)}** coins`
        ));
        editPayload = { components: [c], flags: COMPONENTS_V2_FLAG };
      } else {
        editPayload = {
          embeds: [embed.build(guildId, null, {
            title: '🎯 Dice',
            fields: [
              { name: 'Plage', value: `${rangeMin} - ${rangeMax} (${rangeSize} num)`, inline: true },
              { name: 'Cote', value: `x${mult.toFixed(2)} (${winChance}%)`, inline: true },
              { name: 'Tirage', value: `**${roll}**`, inline: true },
              { name: 'Resultat', value: win ? `✔ Gagne +${embed.fmtCoins((winAmount - amount))} coins` : `× Perdu -${embed.fmtCoins(amount)} coins`, inline: false },
              { name: 'Solde', value: `${embed.fmtCoins(finalCoins)} coins`, inline: false },
            ],
            timestamp: false,
          })],
          components: [],
        };
      }

      if (modalSubmit && !modalSubmit.deferred && !modalSubmit.replied) {
        await modalSubmit.deferUpdate().catch(() => {});
      }
      await sent.edit(editPayload).catch(() => {});
    } catch (e) {
      console.error('[DICE] Result error:', e?.message, e?.stack);
    }
  };

  collector.on('end', (_, reason) => {
    if (reason === 'done') return;
    refundBet();
    const finalCoins = db.getCasinoUser(guildId, userId).coins;
    sendCasinoLog(message.guild, cfg, 'logChannelGames', {
      icon  : '↺',
      title : 'Dice',

      user  : userId,
      lines : [
        `Mise : **${embed.fmtCoins(amount)}** coins`,
        `Remboursement : **${embed.fmtCoins(amount)}** coins (expiré)`,
        `Solde : **${embed.fmtCoins(finalCoins)}** coins`,
      ],
    });
    if (V2_AVAILABLE) {
      const c = new ContainerBuilder();
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## 🎯 Dice\n\n> Mise : **${embed.fmtCoins(amount)}** coins ・ **Expiré**\n> Remboursement : **${embed.fmtCoins(amount)}** coins\n> Solde : **${embed.fmtCoins(finalCoins)}** coins`
      ));
      sent.edit({ components: [c], flags: COMPONENTS_V2_FLAG }).catch(() => {});
    } else {
      sent.edit({ content: `🎯 Dice expiré. Remboursement de ${embed.fmtCoins(amount)} coins. Solde : ${embed.fmtCoins(finalCoins)} coins`, components: [] }).catch(() => {});
    }
  });

  if (deleteReply) embed.scheduleDelete(sent, deleteDelay);
  } catch (e) {
    console.error('[DICE] Run error:', e?.message, e?.stack);
    embed.replyError(message, 'Une erreur est survenue lors de la partie.').catch(() => {});
  }
};
