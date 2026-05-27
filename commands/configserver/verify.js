'use strict';


const {
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'verify',
    description : 'Configure la vérification à l\'arrivée via un bouton.',
    use         : 'verify <setup/on/off/show> [#salon] [@role]',
    usage       : 'verify <setup/on/off/show> [#salon] [@role]',
    aliases     : ['verification', 'verif'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const action = args[0]?.toLowerCase();

    if (!action || ['show', 'settings', 'config'].includes(action)) {
      return _show(message, guildId, config, deleteReply, deleteDelay);
    }

    if (['setup', 'set', 'install'].includes(action)) {
      return _setup(message, guildId, args.slice(1), deleteReply, deleteDelay);
    }

    if (['on', 'enable', 'activate'].includes(action)) {
      return _enable(message, guildId, deleteReply, deleteDelay);
    }

    if (['off', 'disable'].includes(action)) {
      return _disable(message, guildId, deleteReply, deleteDelay);
    }

    if (['removebutton', 'clearbutton', 'delbutton', 'deletebutton'].includes(action)) {
      return _removeButton(client, message, guildId, deleteReply, deleteDelay);
    }

    return _usage(message, deleteReply, deleteDelay);
  },
};

async function _show(message, guildId, config, deleteReply, deleteDelay) {
  const enabled       = Number(config?.verifyEnabled) === 1;
  const verifyType    = config?.verifyType || 'button';
  const channelId     = config?.verifyChannel || null;
  const roleId        = config?.verifyRoleId || null;
  const verifyMsgId   = config?.verifyMessageId || null;

  let messageStatus = '`Aucun`';

  if (verifyMsgId) {
    if (channelId) {
      const channel = message.guild.channels.cache.get(channelId);
      if (channel?.isTextBased()) {
        const found = await channel.messages.fetch(verifyMsgId).catch(() => null);
        messageStatus = found
          ? `\`${verifyMsgId}\``
          : `\`${verifyMsgId}\` (introuvable)`;
      } else {
        messageStatus = `\`${verifyMsgId}\` (salon introuvable)`;
      }
    } else {
      messageStatus = `\`${verifyMsgId}\``;
    }
  }

  const text =
    `État : ${enabled ? '`Activée`' : '`Désactivée`'}\n` +
    `Type : \`${verifyType}\`\n` +
    `Salon : ${channelId ? `<#${channelId}>` : '`Aucun`'}\n` +
    `Rôle : ${roleId ? `<@&${roleId}>` : '`Aucun`'}\n` +
    `Message : ${messageStatus}`;

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        text,
        {
          title    : 'Vérification',
          timestamp: false,
        }
      ),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _setup(message, guildId, args, deleteReply, deleteDelay) {
  const channelArg = args[0];
  const roleArg    = args.slice(1).join(' ').trim() || null;

  if (!channelArg || !roleArg) {
    return _sendError(
      message,
      `Utilisation : \`${message.prefix || '+'}verify setup #salon @role\``,
      deleteReply,
      deleteDelay
    );
  }

  const channel = await _resolveTextChannel(message.guild, channelArg);

  if (!channel) {
    return _sendError(message, 'Salon introuvable ou invalide.', deleteReply, deleteDelay);
  }

  const role = await _resolveRole(message.guild, roleArg);

  if (!role) {
    return _sendError(message, 'Rôle introuvable.', deleteReply, deleteDelay);
  }

  if (role.id === message.guild.id) {
    return _sendError(message, 'Le rôle @everyone ne peut pas être utilisé.', deleteReply, deleteDelay);
  }

  if (role.managed) {
    return _sendError(
      message,
      'Ce rôle est géré par une intégration et ne peut pas être utilisé.',
      deleteReply,
      deleteDelay
    );
  }

  const me = message.guild.members.me
    ?? await message.guild.members.fetchMe().catch(() => null);

  if (!me) {
    return _sendError(message, 'Impossible de vérifier mes permissions.', deleteReply, deleteDelay);
  }

  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return _sendError(
      message,
      'Je n\'ai pas la permission de gérer les rôles.',
      deleteReply,
      deleteDelay
    );
  }

  if (role.position >= me.roles.highest.position) {
    return _sendError(
      message,
      'Ce rôle est au-dessus ou au même niveau que mon rôle le plus haut.',
      deleteReply,
      deleteDelay
    );
  }

  const botPerms = channel.permissionsFor(me);

  if (
    !botPerms?.has(PermissionsBitField.Flags.ViewChannel) ||
    !botPerms?.has(PermissionsBitField.Flags.SendMessages)
  ) {
    return _sendError(
      message,
      'Je n\'ai pas les permissions nécessaires dans ce salon.',
      deleteReply,
      deleteDelay
    );
  }

  const cfg = db.getGuildConfig(guildId) || {};
  const button = _buildVerifyButton(guildId, cfg);

  const row = new ActionRowBuilder().addComponents(button);

  const verifyEmbed = embed.build(
    guildId,
    `Cliquez sur le bouton ci-dessous pour accéder au serveur.\nLe rôle <@&${role.id}> vous sera attribué.`,
    {
      title    : 'Vérification',
      timestamp: false,
    }
  );

  const sentVerify = await channel.send({
    embeds          : [verifyEmbed],
    components      : [row],
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!sentVerify) {
    return _sendError(
      message,
      'Impossible de poster le message de vérification dans ce salon.',
      deleteReply,
      deleteDelay
    );
  }

  db.setGuildConfig(guildId, 'verifyChannel', channel.id);
  db.setGuildConfig(guildId, 'verifyMessageId', sentVerify.id);
  db.setGuildConfig(guildId, 'verifyRoleId', role.id);
  db.setGuildConfig(guildId, 'verifyType', 'button');
  db.setGuildConfig(guildId, 'verifyEnabled', 1);

  const sent = await embed.reply(
    message,
    `Vérification configurée dans ${channel}. Rôle attribué : <@&${role.id}>.`,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _enable(message, guildId, deleteReply, deleteDelay) {
  const config = db.getGuildConfig(guildId);

  if (Number(config?.verifyEnabled) === 1) {
    const sent = await embed.reply(
      message,
      'La vérification est déjà activée.',
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (!config?.verifyChannel || !config?.verifyMessageId || !config?.verifyRoleId) {
    return _sendError(
      message,
      `Configuration incomplète. Lancez d'abord \`${message.prefix || '+'}verify setup #salon @role\`.`,
      deleteReply,
      deleteDelay
    );
  }

  db.setGuildConfig(guildId, 'verifyEnabled', 1);

  const sent = await embed.reply(
    message,
    'Vérification activée.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _disable(message, guildId, deleteReply, deleteDelay) {
  const config = db.getGuildConfig(guildId);

  if (
    Number(config?.verifyEnabled) !== 1 &&
    Number(config?.welcomeAfterVerify) !== 1
  ) {
    const sent = await embed.reply(
      message,
      'La vérification est déjà désactivée.',
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  db.setGuildConfig(guildId, 'verifyEnabled', 0);
  db.setGuildConfig(guildId, 'welcomeAfterVerify', 0);

  try {
    const verifyTimeouts = require('../../utils/verifyTimeouts');
    verifyTimeouts.cancelGuildAll(guildId);
  } catch {
  }

  const sent = await embed.reply(
    message,
    'Vérification désactivée. La configuration est conservée.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _removeButton(client, message, guildId, deleteReply, deleteDelay) {
  const config = db.getGuildConfig(guildId);

  if (!config?.verifyChannel || !config?.verifyMessageId) {
    return _sendError(
      message,
      'Aucun message de vérification configuré.',
      deleteReply,
      deleteDelay
    );
  }

  const channel = message.guild.channels.cache.get(config.verifyChannel)
    ?? await message.guild.channels.fetch(config.verifyChannel).catch(() => null);

  if (!channel?.isTextBased?.()) {
    return _sendError(message, 'Salon de vérification introuvable.', deleteReply, deleteDelay);
  }

  const targetMessage = await channel.messages.fetch(config.verifyMessageId).catch(() => null);

  if (!targetMessage) {
    return _sendError(message, 'Message de vérification introuvable.', deleteReply, deleteDelay);
  }

  if (targetMessage.author?.id !== client.user.id) {
    return _sendError(
      message,
      'Je ne peux modifier que mes propres messages.',
      deleteReply,
      deleteDelay
    );
  }

  const hasVerifyButton = (targetMessage.components ?? []).some(row =>
    (row.components ?? []).some(c =>
      String(c.customId || c.custom_id || '').startsWith('verify:button:')
    )
  );

  if (!hasVerifyButton) {
    const sent = await embed.reply(
      message,
      'Aucun bouton de vérification n\'est présent sur ce message.',
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const nextRows = [];

  for (const row of targetMessage.components ?? []) {
    const rowData = row.toJSON();
    rowData.components = (rowData.components ?? []).filter(component => {
      const customId = component.custom_id || component.customId || '';
      return !customId.startsWith('verify:button:');
    });

    if (rowData.components.length > 0) {
      nextRows.push(ActionRowBuilder.from(rowData));
    }
  }

  const edited = await targetMessage.edit({ components: nextRows }).catch(() => null);

  if (!edited) {
    return _sendError(
      message,
      'Impossible de modifier le message de vérification.',
      deleteReply,
      deleteDelay
    );
  }

  db.setGuildConfig(guildId, 'verifyEnabled', 0);
  db.setGuildConfig(guildId, 'welcomeAfterVerify', 0);

  try {
    const verifyTimeouts = require('../../utils/verifyTimeouts');
    verifyTimeouts.cancelGuildAll(guildId);
  } catch {
  }

  const sent = await embed.reply(
    message,
    'Bouton de vérification retiré. La configuration est conservée.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _usage(message, deleteReply, deleteDelay) {
  const sent = await embed.replyError(
    message,
    `Utilisation :\n` +
    `\`${message.prefix || '+'}verify\`\n` +
    `\`${message.prefix || '+'}verify setup #salon @role\`\n` +
    `\`${message.prefix || '+'}verify on\`\n` +
    `\`${message.prefix || '+'}verify off\`\n` +
    `\`${message.prefix || '+'}verify removebutton\`\n` +
    `\`${message.prefix || '+'}verify show\``,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

async function _resolveTextChannel(guild, query) {
  if (!query) return null;

  const raw = String(query).trim();
  const mention = raw.match(/^<#(\d{17,20})>$/);
  const id = mention?.[1] ?? (/^\d{17,20}$/.test(raw) ? raw : null);

  if (id) {
    const channel = guild.channels.cache.get(id)
      ?? await guild.channels.fetch(id).catch(() => null);

    return _isTextChannel(channel) ? channel : null;
  }

  const normalized = _normalizeName(raw);

  return guild.channels.cache.find(channel =>
    _isTextChannel(channel) &&
    _normalizeName(channel.name) === normalized
  ) ?? null;
}

function _isTextChannel(channel) {
  return Boolean(
    channel &&
    (
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement
    )
  );
}

async function _resolveRole(guild, query) {
  if (!query) return null;

  const raw = String(query).trim();
  const mention = raw.match(/^<@&(\d{17,20})>$/);
  const id = mention?.[1] ?? (/^\d{17,20}$/.test(raw) ? raw : null);

  if (id) {
    return guild.roles.cache.get(id)
      ?? await guild.roles.fetch(id).catch(() => null);
  }

  const normalized = _normalizeName(raw);

  return guild.roles.cache.find(role =>
    _normalizeName(role.name) === normalized
  ) ?? null;
}

function _normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^#/, '')
    .trim();
}

const _BUTTON_STYLES = {
  Primary   : ButtonStyle.Primary,
  Secondary : ButtonStyle.Secondary,
  Success   : ButtonStyle.Success,
  Danger    : ButtonStyle.Danger,
};

function _buildVerifyButton(guildId, config) {
  const label = (config?.verifyButtonLabel && String(config.verifyButtonLabel).trim().slice(0, 80)) || 'Vérifier';
  const styleKey = String(config?.verifyButtonStyle || 'Success');
  const style = _BUTTON_STYLES[styleKey] || ButtonStyle.Success;

  const btn = new ButtonBuilder()
    .setCustomId(`verify:button:${guildId}`)
    .setLabel(label)
    .setStyle(style);

  const emoji = config?.verifyButtonEmoji ? String(config.verifyButtonEmoji).trim() : null;
  if (emoji) {
    try {
      btn.setEmoji(emoji);
    } catch {

    }
  }

  return btn;
}

async function _sendError(message, content, deleteReply, deleteDelay) {
  const sent = await embed.replyError(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
