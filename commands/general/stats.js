'use strict';


const { ChannelType } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'stats',
    description : 'Affiche les statistiques vocales en direct du serveur.',
    usage       : 'stats',
    aliases     : ['statistiques', 'serverstats'],
    category    : 'general',
  },

  async run(client, message) {
    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteStatsCmds);
    const deleteReply = Boolean(config?.autoDeleteStatsReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const voiceStates = guild.voiceStates.cache.filter(vs =>
      vs.member && !vs.member.user.bot && vs.channelId
    );

    const inVoice   = voiceStates.size;
    const muted     = voiceStates.filter(vs => vs.selfMute || vs.serverMute).size;
    const deafened  = voiceStates.filter(vs => vs.selfDeaf || vs.serverDeaf).size;
    const inVideo   = voiceStates.filter(vs => vs.selfVideo).size;
    const streaming = voiceStates.filter(vs => vs.streaming).size;

    const voiceChannels = guild.channels.cache.filter(c =>
      c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice
    );

    let busiestChannel = null;
    let busiestCount   = 0;

    for (const vc of voiceChannels.values()) {
      const count = vc.members.filter(m => !m.user.bot).size;
      if (count > busiestCount) {
        busiestCount   = count;
        busiestChannel = vc;
      }
    }

    const busiestText = busiestChannel
      ? `<#${busiestChannel.id}> - ${busiestCount}`
      : 'Aucun';

    const e = embed.build(guildId, null, {
      title    : guild.name,
      thumbnail: guild.iconURL({ dynamic: true, size: 256 }) || client.user.displayAvatarURL({ size: 256 }),
      fields   : [
        { name: 'Membres en vocal',   value: String(inVoice),   inline: true },
        { name: 'Membres mute',     value: String(muted),     inline: true },
        { name: 'Membres sourds',   value: String(deafened),  inline: true },
        { name: 'Membres en vid\u00e9o', value: String(inVideo),   inline: true },
        { name: 'Membres en stream', value: String(streaming), inline: true },
        { name: 'Salon le plus actif', value: busiestText,    inline: true },
      ],
      timestamp: false,
    });

    const sent = await message.channel.send({
      embeds         : [e],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};
