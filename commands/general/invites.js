'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

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
      `## Invitations\n\n` +
      `> ${target}\n\n` +
      `**Total** \u203a ${stats.total}\n` +
      `Pr\u00e9sent(s) \u203a ${stats.regular}\n` +
      `Bonus \u203a ${stats.bonus}\n` +
      `Parti(s) \u203a ${stats.left}`;

    let sent = null;

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
        sent = await message.channel.send({
          components      : [container],
          flags           : COMPONENTS_V2_FLAG,
          allowedMentions : { parse: [] },
        }).catch(() => null);
      } catch {}
    }

    if (!sent) {
      sent = await embed.sendEmbed(message.channel, guildId, text.replace(/^##[^\n]*\n\n/, '').replace(/^> [^\n]*\n\n/, ''), { timestamp: false });
    }

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};
