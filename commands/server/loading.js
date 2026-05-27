'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');
const { parseDuration } = require('../../utils/parseDuration.js');

module.exports = {
  help: {
    name        : 'loading',
    description : 'Affiche une barre de chargement avec le message souhaité.',
    usage       : 'loading <durée> <message>',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'loading')) return;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const durationArg = args[0];
    const content     = args.slice(1).join(' ').trim();

    if (!durationArg || !content) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}loading <durée> <message>\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const duration = parseDuration(durationArg, {
      allowedUnits : ['s', 'm'],
      defaultUnit  : 's',
      minMs        : 3000,
      maxMs        : 60000,
    });

    if (!duration) {
      const sent = await embed.replyError(
        message,
        'Durée invalide. Exemple : `5s`, `30s`, `1m`.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (duration < 3000 || duration > 60000) {
      const sent = await embed.replyError(
        message,
        'La durée doit être comprise entre 3 secondes et 1 minute.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (content.length > 1500) {
      const sent = await embed.replyError(
        message,
        'Le message ne peut pas dépasser 1500 caractères.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const loadingMessage = await message.channel.send({
      embeds: [
        _buildLoadingEmbed(guildId, content, 0),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (!loadingMessage) return;

    const steps         = 10;
    const intervalDelay = Math.max(1000, Math.floor(duration / steps));

    let currentStep = 0;

    const interval = setInterval(async () => {
      currentStep++;

      const percent = Math.min(100, Math.floor((currentStep / steps) * 100));

      if (currentStep >= steps) {
        clearInterval(interval);

        await loadingMessage.edit({
          embeds: [
            _buildLoadingEmbed(guildId, content, 100, true),
          ],
          allowedMentions: { parse: [] },
        }).catch(() => {});

        return;
      }

      await loadingMessage.edit({
        embeds: [
          _buildLoadingEmbed(guildId, content, percent),
        ],
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }, intervalDelay);
  },
};

function _buildLoadingEmbed(guildId, content, percent, done = false) {
  let status = 'Initialisation...';

  if (percent >= 25) status = 'Traitement en cours...';
  if (percent >= 50) status = 'Progression avancée...';
  if (percent >= 75) status = 'Finalisation...';
  if (done)          status = 'Chargement terminé.';

  const title = done
    ? 'Chargement terminé'
    : 'Chargement en cours';

  const text =
    `**Action**\n` +
    `${content}\n\n` +
    `**Progression**\n` +
    `\`${percent}%\`\n\n` +
    `**Statut**\n` +
    `${status}`;

  return embed.build(guildId, text, { title, timestamp: false });
}
