'use strict';

const { ComponentType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

async function _resolveMember(guild, query) {
  const raw = String(query).trim();
  const mentionId = raw.match(/^<@!?(\d{17,20})>$/)?.[1];
  const id = mentionId ?? (/^\d{17,20}$/.test(raw) ? raw : null);
  if (id) {
    return guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => null);
  }
  const lower = raw.toLowerCase();
  return guild.members.cache.find(m =>
    m.user.username.toLowerCase() === lower ||
    m.displayName.toLowerCase() === lower
  ) ?? null;
}

module.exports = {
  help: {
    name        : 'clearinvites',
    description : 'Réinitialise les invitations d\'un membre ou de tout le serveur.',
    usage       : 'clearinvites [@membre|ID|nom]',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'clearinvites')) return;

    const config      = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const query   = args[0];
    const target   = query ? await _resolveMember(guild, query) : null;
    const isAll    = !target;
    const label   = isAll ? 'tout le serveur' : target.toString();

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('inv:confirm')
        .setLabel('Confirmer')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('inv:cancel')
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Secondary),
    );

    const confirmMsg = await message.channel.send({
      embeds: [embed.build(guildId, `Réinitialiser les invitations de **${label}** ?`, { timestamp: false })],
      components: [confirmRow],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (!confirmMsg) return;

    try {
      const interaction = await confirmMsg.awaitMessageComponent({
        componentType : ComponentType.Button,
        filter        : i => {
          if (i.user.id !== message.author.id) {
            i.deferUpdate().catch(() => {});
            return false;
          }
          return true;
        },
        time          : 30_000,
      });

      await interaction.deferUpdate().catch(() => {});

      if (interaction.customId === 'inv:confirm') {
        if (isAll) {
          db.clearAllInvites(guildId);
        } else {
          db.clearInvites(guildId, target.id);
        }

        await confirmMsg.edit({
          embeds: [embed.build(guildId, `Invitations de **${label}** réinitialisées.`, { timestamp: false })],
          components: [],
        }).catch(() => {});
      } else {
        await confirmMsg.edit({
          embeds: [embed.build(guildId, 'Annulé.', { timestamp: false })],
          components: [],
        }).catch(() => {});
      }
    } catch {
      await confirmMsg.edit({ components: [] }).catch(() => {});
    }

    if (deleteReply) embed.scheduleDelete(confirmMsg, deleteDelay);
  },
};
