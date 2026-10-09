'use strict';

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  TextDisplayBuilder,
} = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { checkCasinoChannel, checkCasinoLimits, setCooldown, sendCasinoLog } = require('./casino');
const { generateGiftImage } = require('../../utils/giftImage');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' &&
                     typeof TextDisplayBuilder === 'function' &&
                     typeof MediaGalleryBuilder === 'function' &&
                     typeof MediaGalleryItemBuilder === 'function';

const GIFT_TIMEOUT = 30_000;
const RESULT_IMAGE_NAME = 'gift_result.png';

exports.help = {
  name       : 'gift',
  description: 'Choisis un cadeau mystère et tente de gagner des coins.',
  use        : 'gift',
  usage      : 'gift',
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message) => {
  const guildId = message.guild.id;
  const userId = message.author.id;

  const chErr = checkCasinoChannel(message);
  if (chErr) return embed.replyError(message, chErr);

  if (!db.isCasinoEnabled(guildId)) {
    return embed.replyError(message, 'Le casino n’est pas actif.');
  }

  const limitErr = checkCasinoLimits(message, 'gift');
  if (limitErr) return embed.replyError(message, limitErr);

  const cfg = db.getCasinoConfig(guildId);
  const giftMin = Number(cfg.giftMin ?? 100);
  const giftMax = Number(cfg.giftMax ?? 1000);
  if (!Number.isSafeInteger(giftMin) || !Number.isSafeInteger(giftMax) || giftMin < 1 || giftMax < giftMin) {
    return embed.replyError(message, 'La récompense du Gift est mal configurée. Contacte un administrateur.');
  }

  const winnerIdx = Math.floor(Math.random() * 3);
  const prize = Math.floor(Math.random() * (giftMax - giftMin + 1)) + giftMin;
  const makeRow = (disabled = false) => new ActionRowBuilder().addComponents(
    [0, 1, 2].map(index => new ButtonBuilder()
      .setCustomId(`gift:${index}`)
      .setLabel(`Cadeau ${index + 1}`)
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled))
  );

  const prompt = `## 🎁 Cadeau mystère\n<@${userId}>, choisis un cadeau. **Une seule tentative** ・ jusqu’à **${embed.fmtCoins(giftMax)} coins** à gagner.`;
  const useV2 = V2_AVAILABLE && embed.shouldUseV2(guildId, module.exports.help.name);
  const initialPayload = useV2
    ? {
        components: [
          new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(prompt))
            .addActionRowComponents(makeRow()),
        ],
        flags: COMPONENTS_V2_FLAG,
        allowedMentions: { parse: [] },
      }
    : {
        content: prompt,
        components: [makeRow()],
        allowedMentions: { parse: [] },
      };

  const gameMessage = await message.reply(initialPayload);
  setCooldown(guildId, userId, 'gift');

  let finished = false;
  const collector = gameMessage.createMessageComponentCollector({
    filter: interaction => /^gift:[0-2]$/.test(interaction.customId),
    time: GIFT_TIMEOUT,
  });

  collector.on('collect', async interaction => {
    if (interaction.user.id !== userId) {
      return interaction.reply({
        content: 'Ce cadeau est réservé à la personne qui a lancé la commande.',
        flags: MessageFlags.Ephemeral,
      }).catch(err => console.error('[GIFT] Impossible de refuser un clic non autorisé :', err));
    }

    if (finished) {
      return interaction.reply({
        content: 'Tu as déjà choisi ton cadeau.',
        flags: MessageFlags.Ephemeral,
      }).catch(err => console.error('[GIFT] Impossible de répondre au clic répété :', err));
    }

    finished = true;
    collector.stop('played');
    await interaction.deferUpdate().catch(err => {
      console.error('[GIFT] Impossible de confirmer le choix :', err);
    });

    const won = Number(interaction.customId.slice('gift:'.length)) === winnerIdx;
    if (won) {
      try {
        db.addCasinoCoins(guildId, userId, prize, 'win');
      } catch (err) {
        console.error('[GIFT] Impossible de créditer la récompense :', err);
        const creditError = '## ⚠️ Récompense non créditée\nLe cadeau gagnant a été trouvé, mais le gain n’a pas pu être ajouté. Préviens un administrateur.';
        const payload = useV2
          ? {
              components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(creditError))],
              flags: COMPONENTS_V2_FLAG,
              allowedMentions: { parse: [] },
            }
          : { content: creditError, components: [], allowedMentions: { parse: [] } };
        return gameMessage.edit(payload)
          .catch(editErr => console.error('[GIFT] Impossible d’afficher l’erreur de récompense :', editErr));
      }

      sendCasinoLog(message.guild, cfg, 'logChannelGames', {
        icon  : '✸',
        title : 'Gift',
        user  : userId,
        lines : [
          `Cadeau trouvé par <@${userId}>`,
          `Gagné **+${embed.fmtCoins(prize)}** coins`,
        ],
      });
    }

    let resultImage = null;
    try {
      resultImage = await generateGiftImage({
        won,
        prize: won ? prize : 0,
        username: message.member?.displayName ?? message.author.username,
      });
    } catch (err) {
      console.error('[GIFT] Impossible de générer l’image du résultat :', err);
    }

    const resultText = won
      ? `## 🎉 Cadeau trouvé !\nTu remportes **+${embed.fmtCoins(prize)} coins**.`
      : '## 🙈 Cadeau vide\nPas de chance cette fois. Retente ta chance plus tard !';
    const fallbackPayload = useV2
      ? {
          components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(resultText))],
          flags: COMPONENTS_V2_FLAG,
          allowedMentions: { parse: [] },
        }
      : { content: resultText, components: [], allowedMentions: { parse: [] } };

    if (resultImage) {
      if (useV2) {
        const resultCard = new ContainerBuilder()
          .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
              new MediaGalleryItemBuilder().setURL(`attachment://${RESULT_IMAGE_NAME}`)
            )
          );
        return gameMessage.edit({
          components: [resultCard],
          flags: COMPONENTS_V2_FLAG,
          files: [new AttachmentBuilder(resultImage, { name: RESULT_IMAGE_NAME })],
          allowedMentions: { parse: [] },
        }).catch(async err => {
          console.error('[GIFT] Impossible d’afficher l’image du résultat :', err);
          await gameMessage.edit(fallbackPayload)
            .catch(editErr => console.error('[GIFT] Impossible d’afficher le résultat de secours :', editErr));
        });
      }

      return gameMessage.edit({
        content: '',
        embeds: [embed.build(guildId, null, {
          title: 'Résultat du cadeau mystère',
          image: `attachment://${RESULT_IMAGE_NAME}`,
          timestamp: false,
        })],
        components: [],
        files: [new AttachmentBuilder(resultImage, { name: RESULT_IMAGE_NAME })],
        allowedMentions: { parse: [] },
      }).catch(async err => {
        console.error('[GIFT] Impossible d’afficher l’image du résultat :', err);
        await gameMessage.edit(fallbackPayload)
          .catch(editErr => console.error('[GIFT] Impossible d’afficher le résultat de secours :', editErr));
      });
    }

    return gameMessage.edit(fallbackPayload)
      .catch(err => console.error('[GIFT] Impossible d’afficher le résultat :', err));
  });

  collector.on('end', async (_, reason) => {
    if (reason !== 'time' || finished) return;
    const expiredText = '## ⌛ Cadeau expiré\nTu n’as pas fait de choix à temps.';
    const payload = useV2
      ? {
          components: [
            new ContainerBuilder()
              .addTextDisplayComponents(new TextDisplayBuilder().setContent(expiredText))
              .addActionRowComponents(makeRow(true)),
          ],
          flags: COMPONENTS_V2_FLAG,
          allowedMentions: { parse: [] },
        }
      : { content: expiredText, components: [makeRow(true)], allowedMentions: { parse: [] } };
    await gameMessage.edit(payload)
      .catch(err => console.error('[GIFT] Impossible de clôturer la partie :', err));
  });
};
