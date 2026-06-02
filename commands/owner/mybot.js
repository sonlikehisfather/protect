'use strict';


const {
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');
const perms  = require('../../utils/permissions');
const config = require('../../config.json');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? null;
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder    === 'function' &&
  typeof TextDisplayBuilder  === 'function'
);

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

  const btnInvite = new ButtonBuilder()
    .setCustomId('mybot:get_invite')
    .setLabel('✓')
    .setStyle(ButtonStyle.Primary);

  const btnClose = new ButtonBuilder()
    .setCustomId('mybot:close')
    .setLabel('\u2716')
    .setStyle(ButtonStyle.Danger);

  let sent;

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('# Invitation du bot'),
    );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(btnInvite, btnClose));

    sent = await message.reply({
      flags: COMPONENTS_V2_FLAG,
      components: [container],
      allowedMentions: { repliedUser: false, parse: [] },
    }).catch(() => null);
  } else {
    const row = new ActionRowBuilder().addComponents(btnInvite, btnClose);
    sent = await message.reply({
      embeds: [
        embed.build(guildId, null, {
          title: 'Invitation du bot',
          description: 'Clique sur le bouton ci-dessous pour recevoir le lien d\'invitation en message privé.',
          timestamp: false,
        }),
      ],
      components: [row],
      allowedMentions: { repliedUser: false, parse: [] },
    }).catch(() => null);
  }

  if (!sent) return;

  const collector = sent.createMessageComponentCollector({
    filter: i => (
      (i.customId === 'mybot:get_invite' || i.customId === 'mybot:close') &&
      i.user.id === message.author.id
    ),
    time: 60_000,
  });

  collector.on('ignore', async interaction => {
    await interaction.reply({
      embeds: [
        embed.build(guildId, 'Seul le buyer du bot peut utiliser ces boutons.', {
          title: 'Accès refusé',
          timestamp: false,
        }),
      ],
      flags: 64,
    }).catch(() => {});
  });

  collector.on('collect', async interaction => {
    if (interaction.customId === 'mybot:close') {
      collector.stop('closed');
      await message.delete().catch(() => {});
      await sent.delete().catch(() => {});
      return;
    }

    const url = inviteUrl.toString();
    await interaction.reply({
      embeds: [
        embed.build(guildId, `[Clique ici pour inviter le bot](${url})`, {
          title: 'Lien d\'invitation',
          timestamp: false,
        }),
      ],
      flags: 64,
    }).catch(() => {});
  });

  collector.on('end', (_, reason) => {
    if (reason === 'closed') return;
    sent.edit({ components: [] }).catch(() => {});
  });

  if (deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};
