'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db    = require('../core/database');
const embed = require('./embed');

const TYPE_KEY = {
  warn    : 'modDmWarn',
  kick    : 'modDmKick',
  ban     : 'modDmBan',
  tempban : 'modDmTempban',
  mute    : 'modDmMute',
  cmute   : 'modDmMute',
  unmute  : 'modDmUnmute',
};

const TPL_KEY = {
  warn    : 'modDmTemplateWarn',
  kick    : 'modDmTemplateKick',
  ban     : 'modDmTemplateBan',
  tempban : 'modDmTemplateTempban',
  mute    : 'modDmTemplateMute',
  cmute   : 'modDmTemplateMute',
  unmute  : 'modDmTemplateUnmute',
};

const MODE_KEY = {
  warn    : 'modDmModeWarn',
  kick    : 'modDmModeKick',
  ban     : 'modDmModeBan',
  tempban : 'modDmModeTempban',
  mute    : 'modDmModeMute',
  cmute   : 'modDmModeMute',
  unmute  : 'modDmModeUnmute',
};

function _renderTemplate(tpl, vars) {
  return String(tpl).replace(/\{([a-zA-Z._éà]+)\}/g, (_, k) => vars[k] ?? '');
}


async function send(client, guild, target, { type, reason, duration = null, modDmEnabled, moderator = null }) {
  if (!modDmEnabled) return;

  const guildId = guild.id;

  const config = db.getGuildConfig(guildId);

  const typeKey = TYPE_KEY[type];
  if (typeKey && config && Number(config[typeKey] ?? 1) !== 1) return;


  const tplKey     = TPL_KEY[type];
  const perTypeTpl = tplKey && config?.[tplKey];
  const template   = perTypeTpl || config?.modDmTemplateGlobal || null;
  const modeKey    = perTypeTpl ? MODE_KEY[type] : 'modDmModeGlobal';
  const useEmbed   = modeKey ? Number(config?.[modeKey] ?? 1) === 1 : true;


  if (template) {
    const vars = {
      'user'               : target.user?.tag ?? target.tag ?? '',
      'user.mention'       : `<@${target.user?.id ?? target.id}>`,
      'user.id'            : target.user?.id ?? target.id ?? '',
      'raison'             : reason ?? 'Aucune raison fournie',
      'durée'              : duration ?? 'N/A',
      'serveur'            : guild.name,
      'serveur.id'         : guild.id,
      'type'               : type,
      'modérateur'         : moderator?.user?.tag ?? moderator?.tag ?? 'N/A',
      'modérateur.mention' : moderator ? `<@${moderator.user?.id ?? moderator.id}>` : 'N/A',
      'modérateur.id'      : moderator?.user?.id ?? moderator?.id ?? 'N/A',
    };

    const rendered = _renderTemplate(template, vars);

    const payload = { allowedMentions: { parse: [] } };

    if (useEmbed) {
      const fields = [];
      const tplStr = String(template);
      if (duration && !tplStr.includes('{durée}'))  fields.push({ name: 'Durée',  value: duration, inline: false });
      if (reason   && !tplStr.includes('{raison}')) fields.push({ name: 'Raison', value: reason,   inline: false });

      payload.embeds = [
        embed.build(guildId, rendered.slice(0, 4000), { fields, timestamp: false }),
      ];
    } else {
      payload.content = rendered.slice(0, 1900);
    }

    if (type === 'mute') {
      payload.components = [_buildGuildLinkRow(guild.id)];
    }

    await target.send(payload).catch(() => null);
    return;
  }

  let description;
  const fields = [];

  switch (type) {
    case 'warn':
      description = `Vous avez reçu un avertissement sur **${guild.name}**.`;
      fields.push({ name: 'Raison', value: reason, inline: false });
      break;

    case 'mute':
      description = `Vous avez été muté sur **${guild.name}**.`;
      if (duration) fields.push({ name: 'Durée',  value: duration, inline: false });
      fields.push({ name: 'Raison', value: reason, inline: false });
      break;

    case 'cmute':
      description = `Vous avez été muté dans un salon sur **${guild.name}**.`;
      if (duration) fields.push({ name: 'Durée',  value: duration, inline: false });
      fields.push({ name: 'Raison', value: reason, inline: false });
      break;

    case 'unmute':
      description = `Votre mute a été levé sur **${guild.name}**.`;
      fields.push({ name: 'Raison', value: reason, inline: false });
      break;

    case 'kick':
      description = `Vous avez été expulsé de **${guild.name}**.`;
      fields.push({ name: 'Raison', value: reason, inline: false });
      break;

    case 'ban':
      description = `Vous avez été banni de **${guild.name}**.`;
      fields.push({ name: 'Raison', value: reason, inline: false });
      break;

    case 'tempban':
      description = `Vous avez été temporairement banni de **${guild.name}**.`;
      if (duration) fields.push({ name: 'Durée',  value: duration, inline: false });
      fields.push({ name: 'Raison', value: reason, inline: false });
      break;

    default:
      return;
  }

  const payload = {
    embeds: [
      embed.build(guildId, description, { fields, timestamp: false }),
    ],
  };


  if (type === 'mute') {
    payload.components = [_buildGuildLinkRow(guild.id)];
  }

  await target.send(payload).catch(() => null);
}


function _buildGuildLinkRow(guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Retourner au serveur')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guildId}`)
  );
}

module.exports = { send };
