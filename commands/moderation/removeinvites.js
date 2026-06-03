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
    name        : 'removeinvites',
    description : 'Retire des invitations bonus à un membre.',
    usage       : 'removeinvites <@membre|ID|nom> <nombre>',
    aliases     : ['delinvites'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'removeinvites')) return;

    const config      = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const query  = args[0];
    const amount  = parseInt(args[1]);
    const target  = query ? await _resolveMember(guild, query) : null;

    if (!target || isNaN(amount) || amount <= 0) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}removeinvites <@membre|ID|nom> <nombre>\``,
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.addInviteBonus(guildId, target.id, -amount);
    const stats = db.getInviteStats(guildId, target.id);

    const sent = await message.channel.send({
      embeds: [embed.build(
        guildId,
        `**-${amount}** invitation(s) retirée(s) à ${target}.\nBonus total : \`${Math.max(0, stats.bonus)}\``,
        { timestamp: false }
      )],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};
