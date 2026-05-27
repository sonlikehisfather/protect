'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'formulaire',
    description : 'Crée un formulaire auquel les membres peuvent répondre.',
    usage       : 'formulaire [ID]',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'formulaire')) return;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me || !me.permissions.has(PermissionsBitField.Flags.SendMessages)) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas la permission d\'envoyer des messages.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const panelId = Number.parseInt(args[0], 10);

    if (!panelId) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}formulaire [ID]\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const panel = db.getTicketPanelByGuild(panelId, guildId);

    if (!panel) {
      const sent = await embed.replyError(
        message,
        'Panel introuvable sur ce serveur.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!config?.ticketLogChannel) {
      const sent = await embed.replyError(
        message,
        'Aucun salon de log ticket n\'est configuré.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const logChannel = guild.channels.cache.get(config.ticketLogChannel);

    if (!logChannel) {
      const sent = await embed.replyError(
        message,
        'Le salon de log ticket configuré est introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`formulaire:open:${panel.id}`)
        .setLabel('Répondre au formulaire')
        .setStyle(ButtonStyle.Primary)
    );

    const sentForm = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          'Cliquez sur le bouton ci-dessous pour répondre au formulaire.',
          {
            title     : 'Formulaire',
            timestamp : false,
          }
        ),
      ],
      components: [row],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (!sentForm) {
      const sent = await embed.replyError(
        message,
        'Impossible d\'envoyer le formulaire.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await embed.reply(
      message,
      'Formulaire envoyé.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};
