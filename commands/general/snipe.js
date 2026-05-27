'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'snipe',
    description : 'Affiche le dernier message supprimé dans ce salon.',
    usage       : 'snipe',
    aliases     : [],
  },

  async run(client, message) {
    const guildId   = message.guild.id;
    const channelId = message.channel.id;

    const guildConfig = db.getGuildConfig(guildId);

    const autoDeleteDelay = guildConfig?.autoDeleteDelay ?? 5;
    const deleteCmd       = Boolean(guildConfig?.autoDeleteSnipeCmds);
    const deleteReply     = Boolean(guildConfig?.autoDeleteSnipeReplies);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    if (!client.snipes) {
      client.snipes = new Map();
    }

    const snipe = client.snipes.get(channelId);


    const SNIPE_TTL_MS = 10 * 60 * 1000;
    const isExpired = snipe?.deletedTimestamp
      && (Date.now() - snipe.deletedTimestamp) > SNIPE_TTL_MS;

    if (isExpired) {
      client.snipes.delete(channelId);
    }

    if (!snipe || isExpired) {
      const sent = await embed.replyError(
        message,
        isExpired
          ? 'Aucun message récent à afficher.'
          : 'Aucun message supprimé récent n’a été trouvé dans ce salon.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, autoDeleteDelay);
      }

      return;
    }

    const content = snipe.partial
      ? 'Contenu indisponible : le message n’était pas en cache.'
      : (snipe.content?.trim() || '*(message vide)*');

    const imageAttachment = (snipe.attachments || []).find(a =>
      a?.url &&
      (
        (a.contentType && a.contentType.startsWith('image/')) ||
        /\.(png|jpe?g|gif|webp)$/i.test(a.url)
      )
    );

    const otherAttachments = (snipe.attachments || []).filter(a =>
      a?.url && a.url !== imageAttachment?.url
    );

    const fields = [];

    if (otherAttachments.length) {
      fields.push({
        name  : 'Pièces jointes',
        value : otherAttachments
          .slice(0, 5)
          .map(a => `[${a.name || 'fichier'}](${a.url})`)
          .join('\n')
          .slice(0, 1024),
        inline: false,
      });
    }

    if (snipe.authorId) {
      fields.unshift({
        name  : 'Auteur',
        value : `<@${snipe.authorId}> (${snipe.authorTag || 'Inconnu'}) \`${snipe.authorId}\``,
        inline: false,
      });
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          content.slice(0, 4000),
          {
            authorName : snipe.authorTag || 'Inconnu',
            authorIcon : snipe.authorAvatar || null,
            image      : imageAttachment?.url ?? undefined,
            fields,
            footer     : `Supprimé`,
            timestamp  : snipe.deletedTimestamp ?? Date.now(),
          }
        )
      ],
      allowedMentions: {
        repliedUser: false,
      },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, autoDeleteDelay);
    }
  },
};
