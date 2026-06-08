'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder === 'function';

const IDLE_MS    = 120_000;
const TIMEOUT_MS = 300_000;

module.exports = {
  help: {
    name       : 'ghostping',
    description: 'Configure le ghost ping automatique à l\'arrivée d\'un membre.',
    usage      : 'ghostping',
    use        : 'ghostping',
    aliases    : ['ghost'],
    category   : 'moderation',
    permission : {
      level  : 'owner',
      label  : 'Moderation',
    },
  },

  async run(client, message) {
    if (!perms.check(message, module.exports.help.name)) return;

    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) await message.delete().catch(() => {});

    let savedChannels = [];
    try {
      savedChannels = JSON.parse(config?.ghostPingChannels || '[]');
    } catch {}

    const state = {
      enabled    : Boolean(Number(config?.ghostPingEnabled)),
      channelIds : savedChannels,
    };

    const buildPayload = () => {
      const selectedChannels = state.channelIds.length
        ? state.channelIds.map(id => `<#${id}>`).join(', ')
        : '`Aucun salon configuré`';

      const status = state.enabled ? '✔ Activé' : '✖ Désactivé';

      const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('gp:channels')
        .setPlaceholder('⌬ Sélectionner les salons cibles')
        .setMinValues(1)
        .setMaxValues(10)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('gp:toggle')
          .setLabel(state.enabled ? '◇ Désactiver' : '◆ Activer')
          .setStyle(state.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)
          .setDisabled(state.channelIds.length === 0),
        new ButtonBuilder()
          .setCustomId('gp:reset')
          .setLabel('↺ Reset salons')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(state.channelIds.length === 0),
        new ButtonBuilder()
          .setCustomId('gp:close')
          .setLabel('✖ Fermer')
          .setStyle(ButtonStyle.Danger),
      );

      if (V2_AVAILABLE) {
        try {
          const accent    = _hexToInt(embed.getGuildColor(guildId));
          const container = new ContainerBuilder().setAccentColor(accent);

          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              '## ◈ Ghost Ping — Configuration\n' +
              `**Statut :** ${status}\n` +
              `**Salons :** ${selectedChannels}\n\n` +
              `*Le bot pingera le membre à son arrivée dans chaque salon configuré et supprimera immédiatement le message.*`
            )
          );
          container.addSeparatorComponents(new SeparatorBuilder());
          container.addActionRowComponents(new ActionRowBuilder().addComponents(channelSelect));
          container.addSeparatorComponents(new SeparatorBuilder());
          container.addActionRowComponents(actionRow);

          return {
            embeds          : [],
            components      : [container],
            flags           : COMPONENTS_V2_FLAG,
            allowedMentions : { parse: [] },
          };
        } catch {}
      }

      return {
        embeds: [
          embed.build(guildId, null, {
            title : '◈ Ghost Ping — Configuration',
            fields: [
              { name: 'Statut',  value: status,             inline: true },
              { name: 'Salons',  value: selectedChannels,   inline: false },
            ],
            timestamp: false,
          }),
        ],
        components      : [
          new ActionRowBuilder().addComponents(channelSelect),
          actionRow,
        ],
        allowedMentions : { parse: [] },
      };
    };

    const panel = await message.channel.send(buildPayload()).catch(() => null);
    if (!panel) return;

    embed.registerPrivateInteraction(panel, message.author.id, TIMEOUT_MS);

    const collector = panel.createMessageComponentCollector({
      filter : i => i.user.id === message.author.id && i.message.id === panel.id,
      idle   : IDLE_MS,
      time   : TIMEOUT_MS,
    });

    collector.on('collect', async interaction => {
      const id = interaction.customId;

      if (id === 'gp:close') {
        await interaction.deferUpdate().catch(() => {});
        embed.clearPrivateInteraction(panel);
        collector.stop('closed');
        await panel.delete().catch(() => {});
        if (!deleteCmd) await message.delete().catch(() => {});
        return;
      }

      if (id === 'gp:channels') {
        state.channelIds = interaction.values ?? [];
        db.setGuildConfig(guildId, 'ghostPingChannels', JSON.stringify(state.channelIds));
        await interaction.deferUpdate().catch(() => {});
        await panel.edit(buildPayload()).catch(() => {});
        return;
      }

      if (id === 'gp:toggle') {
        state.enabled = !state.enabled;
        db.setGuildConfig(guildId, 'ghostPingEnabled', state.enabled ? 1 : 0);
        await interaction.deferUpdate().catch(() => {});
        await panel.edit(buildPayload()).catch(() => {});
        return;
      }

      if (id === 'gp:reset') {
        state.channelIds = [];
        state.enabled    = false;
        db.setGuildConfig(guildId, 'ghostPingChannels', null);
        db.setGuildConfig(guildId, 'ghostPingEnabled', 0);
        await interaction.deferUpdate().catch(() => {});
        await panel.edit(buildPayload()).catch(() => {});
        return;
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(panel);
      if (reason === 'closed') return;
      panel.edit({ components: [] }).catch(() => {});
      if (deleteReply) embed.scheduleDelete(panel, deleteDelay);
    });
  },
};

function _hexToInt(hex) {
  const cleaned = String(hex || '').replace('#', '');
  const n = parseInt(cleaned, 16);
  return Number.isNaN(n) ? 0x2f3136 : n;
}
