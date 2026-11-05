'use strict';

const {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const MAX_LENGTH = 1800;

exports.help = {
  name        : 'buyeralert',
  description : 'Envoie un message privé à tous les Buyers du bot. Réservé au Buyer principal.',
  use         : 'buyeralert <message>',
  usage       : 'buyeralert <message>',
  category    : 'owner',
  aliases     : ['alertbuyers', 'notifybuyers'],
  permissionScopes: [
    {
      permission : 'buyerPrincipal',
      usage      : 'buyeralert <message>',
      description: 'Prévenir tous les Buyers par message privé. Réservé au Buyer principal.',
    },
  ],
};

exports.run = async (client, message, args) => {
  const authorId = message.author.id;

  if (!perms.isSuperAdmin(authorId)) {
    return embed.replyError(message, 'Seul le buyer principal peut utiliser cette commande.', { timestamp: false });
  }

  const content = args.join(' ').trim();

  if (!content) {
    return embed.replyError(message, 'Utilisation : `buyeralert <message>`', { timestamp: false });
  }

  if (content.length > MAX_LENGTH) {
    return embed.replyError(message, `Le message ne peut pas dépasser ${MAX_LENGTH} caractères.`, { timestamp: false });
  }

  const targets = db.getGlobalBuyers().filter(id => id !== authorId);

  if (!targets.length) {
    return embed.replyError(message, "Il n'y a aucun autre buyer à prévenir.", { timestamp: false });
  }

  const author = message.member?.displayName ?? message.author.globalName ?? message.author.username;

  const dm = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Annonce de ${author}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${content}\n\n• <@${authorId}>`));

  let sent = 0;
  const failed = [];

  for (const userId of targets) {
    try {
      const user = await client.users.fetch(userId);
      await user.send({
        components      : [dm],
        flags           : MessageFlags.IsComponentsV2,
        allowedMentions : { parse: [] },
      });
      sent++;
    } catch {
      failed.push(userId);
    }
  }

  const lines = [`Message envoyé à **${sent}/${targets.length}** buyer(s).`];

  if (failed.length) {
    lines.push(`Impossible de contacter : ${failed.map(id => `<@${id}>`).join(', ')} (messages privés fermés).`);
  }

  return embed.reply(message, lines.join('\n'), { timestamp: false });
};
