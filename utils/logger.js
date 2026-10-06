'use strict';


const db = require('../core/database');
const embed = require('../utils/embed');
const { EmbedBuilder } = require('discord.js');

const LOG_CHANNELS = {
  modlog     : 'modLogChannel',
  joinlog    : 'joinLogChannel',
  leavelog   : 'leaveLogChannel',
  messagelog : 'messageLogChannel',
  voicelog   : 'voiceLogChannel',
  boostlog   : 'boostLogChannel',
  rolelog    : 'roleLogChannel',
  raidlog    : 'raidLogChannel',
  errorlog   : 'errorLogChannel',
  invitelog  : 'inviteLogChannel',
  levellog   : 'levelLogChannel',
  channellog : 'channelLogChannel',
  serverlog  : 'serverLogChannel',
  emojilog   : 'emojiLogChannel',
  ticketlog  : 'ticketLogChannel',
};


async function send(client, guildId, type, embedBuilt, options = null) {
  try {
    const configKey = LOG_CHANNELS[type];

    if (!configKey) {
      return null;
    }

    const sourceChannelId =
      typeof options === 'string'
        ? options
        : options?.sourceChannelId ?? null;

    if (sourceChannelId && isIgnored(guildId, sourceChannelId)) {
      return null;
    }

    const config = db.getGuildConfig(guildId);
    const logChannelId = config?.[configKey];

    if (!logChannelId) {
      return null;
    }


    if (!sourceChannelId && isIgnored(guildId, logChannelId)) {
      return null;
    }

    const channel = await client.channels.fetch(logChannelId).catch(() => null);

    if (!channel?.isTextBased()) {
      return null;
    }

    const _normalize = (guildId, type, built, opts = {}) => {
      try {
        const data = built?.data || built || {};
        const e = new EmbedBuilder(data);

        if (!data.timestamp) e.setTimestamp();

        if (!data.footer?.text) {
          try { e.setFooter({ text: `${type} • ${guildId}`.slice(0, 2048) }); } catch {}
        }

        if ((!data.fields || data.fields.length === 0) && data.description) {
          const desc = String(data.description).slice(0, 1024) || ' ';
          try { e.addFields({ name: 'Détails', value: desc, inline: false }); } catch {}
          try { e.setDescription(null); } catch {}
        }

        // Best-effort: add actor/target fields when provided in options and not already present
        try {
          const hasField = (name) => (e.data?.fields || []).some(f => String(f.name).toLowerCase().includes(String(name).toLowerCase()));

          const actor = opts?.actor;
          if (actor && !hasField('auteur') && !hasField('modérateur') && !hasField('exécuteur')) {
            const aid = actor.id ?? actor.userId ?? null;
            const atag = actor.tag ?? actor.username ?? null;
            const aVal = aid ? `${atag ? `${atag} ` : ''}(<@${aid}>) \`${aid}\`` : (atag ?? 'Inconnu');
            try { e.addFields({ name: 'Auteur', value: aVal, inline: false }); } catch {}
          }

          const target = opts?.target;
          if (target && !hasField('cible') && !hasField('membre') && !hasField('utilisateur') && !hasField('concern')) {
            const tid = target.id ?? target.userId ?? null;
            const ttag = target.tag ?? target.username ?? null;
            const tVal = tid ? `${ttag ? `${ttag} ` : ''}(<@${tid}>) \`${tid}\`` : (ttag ?? 'Inconnu');
            try { e.addFields({ name: 'Concerné', value: tVal, inline: false }); } catch {}
          }
        } catch {}

        return e;
      } catch {
        return built;
      }
    };

    const normalized = _normalize(guildId, type, embedBuilt);

    const payload = embed.embedToPayload(guildId, normalized, {
      allowedMentions: { parse: [] },
      forceV2: type !== 'ticketlog',
    });

    return await channel.send(payload).catch(() => null);
  } catch {
    return null;
  }
}


function isIgnored(guildId, channelId) {
  try {
    if (!guildId || !channelId) return false;
    return db.isNoLogChannel(guildId, channelId);
  } catch {
    return false;
  }
}

module.exports = {
  send,
  isIgnored,
  LOG_CHANNELS,
};
