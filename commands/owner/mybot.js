'use strict';


const { PermissionFlagsBits } = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');
const config = require('../../config.json');

exports.help = {
  name        : 'mybot',
  description : 'Affiche le lien d’invitation du bot.',
  use         : 'mybot',
  usage       : 'mybot',
  aliases     : ['addbot', 'invitebot', 'botinvite'],
  category    : 'owner',
};

exports.run = async (client, message) => {
  const guildId = message.guild.id;

  if (!perms.isBuyer(message.author.id)) {
    return embed.replyError(
      message,
      'Seul le buyer du bot peut utiliser cette commande.',
      { timestamp: false }
    );
  }

  const guildConfig = db.getGuildConfig(guildId);

  const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
  const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
  const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);
  const prefix      = guildConfig?.prefix ?? config.prefix ?? '+';

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  const clientId = client.user?.id ?? process.env.CLIENT_ID;

  if (!clientId) {
    const sent = await embed.replyError(
      message,
      'Impossible de générer le lien d’invitation : CLIENT_ID introuvable.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const permissions = [
    PermissionFlagsBits.Administrator,
  ].reduce((acc, perm) => acc | perm, 0n).toString();

  const inviteUrl = new URL('https://discord.com/api/oauth2/authorize');
  inviteUrl.searchParams.set('client_id', clientId);
  inviteUrl.searchParams.set('permissions', permissions);
  inviteUrl.searchParams.set('scope', 'bot applications.commands');

  const sent = await message.reply({
    embeds: [
      embed.build(guildId, null, {
        title: 'Invitation du bot',
        fields: [
          {
            name: 'Lien',
            value: `[Cliquez ici pour inviter le bot](${inviteUrl.toString()})`,
          },
          {
            name: 'Commande',
            value: `\`${prefix}mybot\``,
            inline: true,
          },
          {
            name: 'Permissions',
            value: 'Administrateur',
            inline: true,
          },
        ],
        timestamp: false,
      }),
    ],
    allowedMentions: { repliedUser: false, parse: [] },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};
