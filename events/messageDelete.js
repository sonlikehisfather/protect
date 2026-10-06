'use strict';


const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const db           = require('../core/database');
const giveaways    = require('../modules/giveaways');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'messageDelete',
  once : false,

  async execute(client, message) {
    if (!message.guild) return;

    const guildId   = message.guild.id;
    const channelId = message.channel.id;


    try {
      if (giveaways?.cleanupDeletedMessage) {
        giveaways.cleanupDeletedMessage(message.id);
      }

      const menu = db.getRoleMenuByMessageId(message.id);
      if (menu) {
        db.clearRoleMenuMessage(menu.id);
      }

      if (typeof db.getTicketPanelByMessageId === 'function') {
        const panel = db.getTicketPanelByMessageId(message.id);
        if (panel && typeof db.clearTicketPanelMessage === 'function') {
          db.clearTicketPanelMessage(panel.id);
        }
      }


      const guildConfig = db.getGuildConfig(guildId);
      if (guildConfig?.verifyMessageId === message.id) {
        db.setGuildConfig(guildId, 'verifyMessageId', null);
        db.setGuildConfig(guildId, 'verifyEnabled', 0);
      }
    } catch {}

    if (message.author?.bot) return;

    try {

      if (!client.snipes) {
        client.snipes = new Map();
      }

      const attachments = message.attachments?.size
        ? [...message.attachments.values()].map(a => ({
            name       : a.name ?? 'fichier',
            url        : a.url,
            contentType: a.contentType ?? null,
          }))
        : [];

      client.snipes.set(channelId, {
        authorId        : message.author?.id ?? null,
        authorTag       : message.author?.tag ?? 'Inconnu',
        authorAvatar    : message.author?.displayAvatarURL?.({ dynamic: true }) ?? null,
        content         : !message.partial ? (message.content ?? '') : '',
        attachments,
        createdTimestamp: message.createdTimestamp ?? Date.now(),
        deletedTimestamp: Date.now(),
        partial         : Boolean(message.partial),
      });

      if (logger.isIgnored(guildId, channelId)) return;

      const isPartial   = message.partial;
      const authorId    = message.author?.id ?? null;
      const authorTag   = isPartial
        ? (authorId ? `Inconnu (${authorId})` : 'Inconnu')
        : message.author.tag;
      const authorIcon  = isPartial ? null : message.author.displayAvatarURL({ size: 64 });
      const channelRef  = message.channel
        ? `<#${message.channel.id}>`
        : '#Aucun acc\u00e8s';

      const attachmentList = message.attachments?.size
        ? [...message.attachments.values()]
        : [];

      const createdAt = message.createdTimestamp ? `<t:${Math.floor(message.createdTimestamp/1000)}:F>` : 'Inconnu';

      const contentValue = (!isPartial && message.content)
        ? (message.content.length > 1024 ? message.content.slice(0, 1021) + '...' : message.content)
        : (isPartial ? '*Contenu non disponible*' : (attachmentList.length ? '*Pièces jointes uniquement*' : '*Aucun contenu*'));

      const attachmentsValue = attachmentList.length
        ? attachmentList.map(a => `[${a.name ?? 'fichier'}](${a.url})`).join('\n')
        : 'Aucun';

      const imageAttach = attachmentList.find(a => a.contentType && a.contentType.startsWith('image/'));

      const fields = [
        { name: 'Auteur', value: `${authorTag} (<@${authorId}>) \`${authorId || 'unknown'}\``, inline: false },
        { name: 'Salon', value: channelRef, inline: true },
        { name: 'Message', value: `\`${message.id || 'unknown'}\``, inline: true },
        { name: 'Créé le', value: createdAt, inline: true },
        { name: 'Contenu', value: contentValue || ' ', inline: false },
        { name: 'Pièces jointes', value: attachmentsValue, inline: false },
      ];

      const e = embed.log(guildId, 'Message supprimé', fields, {
        thumbnail: authorIcon,
        image: imageAttach?.url ?? undefined,
        timestamp: true,
      });

      await logger.send(client, guildId, 'messagelog', e, { sourceChannelId: channelId });

    } catch (err) {
      errorHandler.handle(err, {
        source : 'messageDelete',
        guildId,
      });
    }
  },
};
