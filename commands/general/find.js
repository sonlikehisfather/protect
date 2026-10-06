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

module.exports = {
  help: {
    name        : 'find',
    description : 'Trouve un membre et indique s\'il est en vocal ou non.',
    usage       : 'find <@mention | ID | nom>',
    aliases     : ['finduser', 'locate'],
    category    : 'general',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    if (!args[0]) {
      const prefix = config?.prefix || '+';
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${prefix}find <@mention | ID | nom>\``,
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const query = args[0].replace(/[<@!>]/g, '');

    let member = message.mentions.members?.first()
      ?? message.guild.members.cache.get(query)
      ?? message.guild.members.cache.find(m =>
          m.user.username.toLowerCase() === args[0].toLowerCase() ||
          m.displayName.toLowerCase()   === args[0].toLowerCase()
        )
      ?? await message.guild.members.fetch(query).catch(() => null);

    if (!member) {
      const sent = await embed.replyError(
        message,
        `Membre \`${args[0]}\` introuvable.`,
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const vc      = member.voice?.channel ?? null;
    const isDeaf  = member.voice?.serverDeaf || member.voice?.selfDeaf;
    const isMute  = member.voice?.serverMute || member.voice?.selfMute;
    const isStream = member.voice?.streaming;
    const isVideo  = member.voice?.selfVideo;

    let voiceStatus;
    let voiceDetail = '';

    if (!vc) {
      voiceStatus = 'Pas en vocal';
    } else {
      voiceStatus = `<#${vc.id}>`;
      const flags = [];
      if (isDeaf)   flags.push('🔇 Sourd');
      if (isMute)   flags.push('🔕 Muet');
      if (isStream) flags.push('📡 Stream');
      if (isVideo)  flags.push('📷 Vidéo');
      if (flags.length) voiceDetail = flags.join(' • ');
    }

    const lines = [
      `## Localisation membre`,
      `> <@${member.id}>`,
      '',
      `Vocal \u203a ${voiceStatus}`,
    ];

    if (voiceDetail) {
      lines.push(`\u00c9tat \u203a ${voiceDetail}`);
    }

    if (vc) {
      lines.push(`Participants \u203a ${vc.members.size}`);
    }

    const text = lines.join('\n');

    let sent = null;

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
        sent = await message.reply({
          components      : [container],
          flags           : COMPONENTS_V2_FLAG,
          allowedMentions : { parse: [] },
        }).catch(() => null);
      } catch {}
    }

    if (!sent) {
      const fields = [
        { name: 'Membre',  value: `<@${member.id}>`,           inline: true },
        { name: 'Vocal',   value: voiceStatus,                  inline: true },
      ];

      if (voiceDetail) {
        fields.push({ name: '\u00c9tat', value: voiceDetail, inline: true });
      }

      if (vc) {
        fields.push({ name: 'Participants', value: `${vc.members.size}`, inline: true });
      }

      sent = await message.reply({
        embeds: [
          embed.build(guildId, null, {
            title     : 'Localisation membre',
            fields,
            thumbnail : member.user.displayAvatarURL({ dynamic: true }),
            timestamp : false,
          }),
        ],
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};
