'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'hide',
    description : 'Cache un salon textuel ou vocal.',
    usage       : 'hide [salon]',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteLockReplies ?? config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    const channel = resolveChannel(message, args);

    if (!channel) {
      const sent = await embed.replyError(
        message,
        `Aucun salon trouvé pour : \`${args.join(' ') || 'inconnu'}\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const everyone  = guild.roles.everyone;
    const overwrite = channel.permissionOverwrites.cache.get(everyone.id);
    const alreadyHidden = overwrite?.deny.has('ViewChannel');

    if (alreadyHidden) {
      const sent = await embed.replyError(
        message,
        'Ce salon est déjà caché.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const edited = await channel.permissionOverwrites
      .edit(everyone, { ViewChannel: false })
      .catch(() => null);

    if (!edited) {
      const sent = await embed.replyError(
        message,
        'Impossible de cacher ce salon.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Le salon <#${channel.id}> a été caché.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};

function resolveChannel(message, args) {
  const mentioned = message.mentions.channels.first();
  if (mentioned) return mentioned;

  const raw = args.join(' ').trim();
  if (!raw) return message.channel;

  const cleaned = raw.replace(/[<#>]/g, '').trim();
  if (/^\d{17,20}$/.test(cleaned)) {
    return message.guild.channels.cache.get(cleaned) ?? null;
  }

  const lowered = raw.toLowerCase();

  const exact = message.guild.channels.cache.find(c =>
    c.name?.toLowerCase() === lowered
  );
  if (exact) return exact;

  const partial = message.guild.channels.cache.find(c =>
    c.name?.toLowerCase().includes(lowered)
  );
  if (partial) return partial;

  return null;
}
