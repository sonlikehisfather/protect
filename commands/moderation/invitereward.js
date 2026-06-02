'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

async function _resolveRole(guild, query) {
  if (!query) return null;
  const raw = String(query).trim();
  const mentionId = raw.match(/^<@&(\d{17,20})>$/)?.[1];
  const id = mentionId ?? (/^\d{17,20}$/.test(raw) ? raw : null);
  if (id) {
    return guild.roles.cache.get(id) ?? await guild.roles.fetch(id).catch(() => null);
  }
  const lower = raw.toLowerCase();
  return guild.roles.cache.find(r => r.name.toLowerCase() === lower) ?? null;
}

module.exports = {
  help: {
    name        : 'invitereward',
    description : 'Configure les récompenses de rôle selon le nombre d\'invitations.',
    usage       : 'invitereward | invitereward add <seuil> <@role|ID|nom> | invitereward remove <seuil>',
    aliases     : ['invreward'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'invitereward')) return;

    const config      = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const sub = args[0]?.toLowerCase();

    if (sub === 'add') {
      const threshold = parseInt(args[1]);
      const role      = await _resolveRole(guild, args[2]);

      if (isNaN(threshold) || threshold <= 0 || !role) {
        const sent = await embed.replyError(
          message,
          `Utilisation : \`${message.prefix || '+'}invitereward add <seuil> <@role|ID|nom>\``,
          { timestamp: false }
        ).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      db.setInviteReward(guildId, threshold, role.id);

      const sent = await message.channel.send({
        embeds: [embed.build(
          guildId,
          `Récompense ajoutée : **${threshold}** invitation(s) → ${role}`,
          { timestamp: false }
        )],
        allowedMentions: { parse: [] },
      }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'remove' || sub === 'delete') {
      const threshold = parseInt(args[1]);

      if (isNaN(threshold)) {
        const sent = await embed.replyError(
          message,
          `Utilisation : \`${message.prefix || '+'}invitereward remove <seuil>\``,
          { timestamp: false }
        ).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      db.deleteInviteReward(guildId, threshold);

      const sent = await message.channel.send({
        embeds: [embed.build(guildId, `Récompense pour **${threshold}** invitation(s) supprimée.`, { timestamp: false })],
        allowedMentions: { parse: [] },
      }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const rewards = db.getInviteRewards(guildId);

    const text = rewards.length > 0
      ? rewards.map(r => `**${r.threshold}** invitation(s) → <@&${r.roleId}>`).join('\n')
      : 'Aucune récompense configurée.';

    const sent = await message.channel.send({
      embeds: [embed.build(guildId, text, { title: 'Récompenses d\'invitations', timestamp: false })],
      allowedMentions: { parse: [] },
    }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};
