'use strict';

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
    name        : 'invites',
    description : 'Affiche les invitations d\'un membre.',
    usage       : 'invites [@membre|ID|nom]',
    aliases     : ['inv'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    const config      = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const query  = args[0];
    const target = query ? await _resolveMember(guild, query) : message.member;

    if (query && !target) {
      const sent = await embed.replyError(message, 'Membre introuvable.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const stats  = db.getInviteStats(guildId, target.id);

    const text =
      `**Invitations de ${target}**\n\n` +
      `**Total** : \`${stats.total}\`\n` +
      `**Présent(s)** : \`${stats.regular}\`\n` +
      `**Bonus** : \`${stats.bonus}\`\n` +
      `**Parti(s)** : \`${stats.left}\``;

    const sent = await message.channel.send({
      embeds: [embed.build(guildId, text, { timestamp: false })],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};
