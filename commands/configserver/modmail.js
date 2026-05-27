'use strict';


const {
  ActionRowBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const PANEL_TIMEOUT = 300_000;
const PANEL_IDLE    = 120_000;

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'modmail',
    description : 'Configurer le système de modmail.',
    use         : 'modmail <on|off|channel|category|log|ping|cooldown|spamlimit|spamwindow|spamblock|settings>',
    usage       : 'modmail <on|off|channel|category|log|ping|cooldown|spamlimit|spamwindow|spamblock|settings>',
    aliases     : [],
  },

  async run(client, message, args) {
    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const guildId = message.guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const sub = args[0]?.toLowerCase();

    if (!sub) {
      return await _error(
        message,
        deleteReply,
        deleteDelay,
        'Utilisez `modmail on`, `off`, `channel`, `category`, `log`, `ping`, `cooldown`, `spamlimit`, `spamwindow`, `spamblock` ou `settings`.'
      );
    }

    const me = message.guild.members.me
      ?? await message.guild.members.fetchMe().catch(() => null);

    if (!me) {
      return await _error(
        message,
        deleteReply,
        deleteDelay,
        'Impossible de récupérer mes informations sur ce serveur.'
      );
    }

    if (sub === 'settings') {
      return _openSettingsPanel(message, guildId, me);
    }

    if (sub === 'on' || sub === 'off') {
      const enabled = sub === 'on' ? 1 : 0;

      if (Number(config?.modmailEnabled) === enabled) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          enabled
            ? 'Le modmail est déjà activé.'
            : 'Le modmail est déjà désactivé.'
        );
      }

      if (enabled) {
        if (!config?.modmailCategory) {
          return await _error(
            message,
            deleteReply,
            deleteDelay,
            'Définissez d\'abord une catégorie avec `modmail category <catégorie>`.'
          );
        }


        if (!me.permissions.has('ManageChannels')) {
          return await _error(
            message,
            deleteReply,
            deleteDelay,
            'J\'ai besoin de la permission `Gérer les salons` pour créer les fils de modmail.'
          );
        }
      }

      db.setGuildConfig(guildId, 'modmailEnabled', enabled);

      return await _success(
        message,
        deleteReply,
        deleteDelay,
        enabled ? 'Modmail activé.' : 'Modmail désactivé.'
      );
    }

    if (sub === 'channel') {
      const target = args[1]?.toLowerCase();

      if (!target) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Utilisation : `modmail channel #salon` ou `modmail channel off`.'
        );
      }

      if (['off', 'reset', 'none'].includes(target)) {
        if (!config?.modmailChannel) {
          return await _error(
            message,
            deleteReply,
            deleteDelay,
            'Aucun salon principal modmail n\'est configuré.'
          );
        }

        db.setGuildConfig(guildId, 'modmailChannel', null);

        return await _success(
          message,
          deleteReply,
          deleteDelay,
          'Salon principal modmail retiré.'
        );
      }

      const channel = _resolveTextChannel(message, args[1]);

      if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Salon invalide. Mentionnez un salon textuel.'
        );
      }

      const channelPerms = channel.permissionsFor(me);

      if (!channelPerms?.has('ViewChannel')) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          `Je n'ai pas accès au salon <#${channel.id}> (\`Voir le salon\` manquant).`
        );
      }

      if (!channelPerms.has('SendMessages')) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          `Je n'ai pas la permission \`Envoyer des messages\` dans <#${channel.id}>.`
        );
      }

      if (!channelPerms.has('EmbedLinks')) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          `Je n'ai pas la permission \`Intégrer des liens\` dans <#${channel.id}>.`
        );
      }

      if (config?.modmailChannel === channel.id) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          `Le salon <#${channel.id}> est déjà utilisé comme salon principal modmail.`
        );
      }

      db.setGuildConfig(guildId, 'modmailChannel', channel.id);

      return await _success(
        message,
        deleteReply,
        deleteDelay,
        `Salon principal modmail défini sur <#${channel.id}>.`
      );
    }

    if (sub === 'category') {
      const target = args[1]?.toLowerCase();

      if (!target) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Utilisation : `modmail category <catégorie>` ou `modmail category off`.'
        );
      }

      if (['off', 'reset', 'none'].includes(target)) {
        if (!config?.modmailCategory) {
          return await _error(
            message,
            deleteReply,
            deleteDelay,
            'Aucune catégorie modmail n\'est configurée.'
          );
        }

        db.setGuildConfig(guildId, 'modmailCategory', null);
        db.setGuildConfig(guildId, 'modmailEnabled', 0);

        return await _success(
          message,
          deleteReply,
          deleteDelay,
          'Catégorie modmail retirée. Le modmail a été désactivé.'
        );
      }

      const category = _resolveCategory(message, args[1]);

      if (!category) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Catégorie invalide. Utilisez une vraie catégorie Discord.'
        );
      }

      if (!me.permissions.has('ManageChannels')) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'J\'ai besoin de la permission `Gérer les salons` pour créer des fils dans cette catégorie.'
        );
      }

      const categoryPerms = category.permissionsFor(me);

      if (!categoryPerms?.has('ViewChannel')) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          `Je n'ai pas accès à la catégorie <#${category.id}> (\`Voir le salon\` manquant).`
        );
      }

      if (!categoryPerms.has('ManageChannels')) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          `Je n'ai pas la permission \`Gérer les salons\` dans la catégorie <#${category.id}>.`
        );
      }

      if (config?.modmailCategory === category.id) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          `La catégorie <#${category.id}> est déjà utilisée pour le modmail.`
        );
      }

      db.setGuildConfig(guildId, 'modmailCategory', category.id);

      return await _success(
        message,
        deleteReply,
        deleteDelay,
        `Catégorie modmail définie sur <#${category.id}>.`
      );
    }

    if (sub === 'log') {
      const target = args[1]?.toLowerCase();

      if (!target) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Utilisation : `modmail log #salon` ou `modmail log off`.'
        );
      }

      if (['off', 'reset', 'none'].includes(target)) {
        if (!config?.modmailLogChannel) {
          return await _error(
            message,
            deleteReply,
            deleteDelay,
            'Aucun salon de logs modmail n\'est configuré.'
          );
        }

        db.setGuildConfig(guildId, 'modmailLogChannel', null);

        return await _success(
          message,
          deleteReply,
          deleteDelay,
          'Salon de logs modmail retiré.'
        );
      }

      const channel = _resolveTextChannel(message, args[1]);

      if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Salon invalide. Mentionnez un salon textuel.'
        );
      }

      const channelPerms = channel.permissionsFor(me);

      if (!channelPerms?.has('ViewChannel')) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          `Je n'ai pas accès au salon <#${channel.id}> (\`Voir le salon\` manquant).`
        );
      }

      if (!channelPerms.has('SendMessages')) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          `Je n'ai pas la permission \`Envoyer des messages\` dans <#${channel.id}>.`
        );
      }

      if (!channelPerms.has('EmbedLinks')) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          `Je n'ai pas la permission \`Intégrer des liens\` dans <#${channel.id}>.`
        );
      }

      if (config?.modmailLogChannel === channel.id) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          `Le salon <#${channel.id}> est déjà utilisé pour les logs modmail.`
        );
      }

      db.setGuildConfig(guildId, 'modmailLogChannel', channel.id);

      return await _success(
        message,
        deleteReply,
        deleteDelay,
        `Salon de logs modmail défini sur <#${channel.id}>.`
      );
    }

    if (sub === 'ping') {
      const target = args[1]?.toLowerCase();

      if (!target) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Utilisation : `modmail ping @rôle` ou `modmail ping off`.'
        );
      }

      if (['off', 'reset', 'none'].includes(target)) {
        if (!config?.modmailPingRole) {
          return await _error(
            message,
            deleteReply,
            deleteDelay,
            'Aucun rôle ping modmail n\'est configuré.'
          );
        }

        db.setGuildConfig(guildId, 'modmailPingRole', null);

        return await _success(
          message,
          deleteReply,
          deleteDelay,
          'Rôle ping modmail retiré.'
        );
      }

      const role = _resolveRole(message, args[1]);

      if (!role) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Rôle invalide. Utilisez `modmail ping @rôle`.'
        );
      }

      if (config?.modmailPingRole === role.id) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          `Le rôle <@&${role.id}> est déjà utilisé comme rôle ping modmail.`
        );
      }

      db.setGuildConfig(guildId, 'modmailPingRole', role.id);

      return await _success(
        message,
        deleteReply,
        deleteDelay,
        `Rôle ping modmail défini sur <@&${role.id}>.`
      );
    }

    if (sub === 'cooldown') {
      const value = args[1];

      if (!value) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Utilisation : `modmail cooldown <durée>` (ex: `5m`, `300s`). Minimum 30 secondes.'
        );
      }

      const seconds = parseDuration(value);

      if (!seconds || seconds < 30) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Durée invalide. Minimum 30 secondes. Exemples : `30s`, `5m`, `1h`.'
        );
      }

      db.setGuildConfig(guildId, 'modmailOpenCooldown', seconds);

      return await _success(
        message,
        deleteReply,
        deleteDelay,
        `Cooldown de réouverture défini à **${formatDuration(seconds)}**.`
      );
    }

    if (sub === 'spamlimit') {
      const value = args[1];

      if (!value) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Utilisation : `modmail spamlimit <nombre>`. Minimum 2 messages.'
        );
      }

      const limit = parseInt(value, 10);

      if (!limit || limit < 2) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Nombre invalide. Minimum 2 messages.'
        );
      }

      db.setGuildConfig(guildId, 'modmailSpamLimit', limit);

      return await _success(
        message,
        deleteReply,
        deleteDelay,
        `Limite anti-spam définie à **${limit} messages**.`
      );
    }

    if (sub === 'spamwindow') {
      const value = args[1];

      if (!value) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Utilisation : `modmail spamwindow <durée>` (ex: `30s`, `1m`). Minimum 5 secondes.'
        );
      }

      const seconds = parseDuration(value);

      if (!seconds || seconds < 5) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Durée invalide. Minimum 5 secondes. Exemples : `5s`, `30s`, `1m`.'
        );
      }

      db.setGuildConfig(guildId, 'modmailSpamWindow', seconds);

      return await _success(
        message,
        deleteReply,
        deleteDelay,
        `Fenêtre anti-spam définie à **${formatDuration(seconds)}**.`
      );
    }

    if (sub === 'spamblock') {
      const value = args[1];

      if (!value) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Utilisation : `modmail spamblock <durée>` (ex: `5m`, `300s`). Minimum 30 secondes.'
        );
      }

      const seconds = parseDuration(value);

      if (!seconds || seconds < 30) {
        return await _error(
          message,
          deleteReply,
          deleteDelay,
          'Durée invalide. Minimum 30 secondes. Exemples : `30s`, `5m`, `1h`.'
        );
      }

      db.setGuildConfig(guildId, 'modmailSpamBlockTime', seconds);

      return await _success(
        message,
        deleteReply,
        deleteDelay,
        `Durée de blocage anti-spam définie à **${formatDuration(seconds)}**.`
      );
    }

    return await _error(
      message,
      deleteReply,
      deleteDelay,
      'Action invalide. Utilisez `on`, `off`, `channel`, `category`, `log`, `ping`, `cooldown`, `spamlimit`, `spamwindow`, `spamblock` ou `settings`.'
    );
  },
};


async function _openSettingsPanel(message, guildId, me) {
  const guild = message.guild;
  const panel = await message.channel.send({
    embeds          : [_buildSettingsEmbed(guildId)],
    components      : _buildSettingsRows(),
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!panel) return;

  embed.registerPrivateInteraction(panel, message.author.id, PANEL_TIMEOUT);

  let busy = false;

  const collector = panel.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id && i.message.id === panel.id,
    idle   : PANEL_IDLE,
    time   : PANEL_TIMEOUT,
  });

  collector.on('collect', async (interaction) => {
    const choice = interaction.values?.[0];
    if (!choice) return interaction.deferUpdate().catch(() => {});

    if (choice === 'close') {
      collector.stop('closed');
      return;
    }

    if (choice === 'toggle') {
      if (busy) return interaction.deferUpdate().catch(() => {});
      const config = db.getGuildConfig(guildId);
      const current = Number(config?.modmailEnabled) || 0;


      if (!current && (!config?.modmailChannel || !config?.modmailCategory)) {
        return interaction.reply({
          embeds : [embed.build(guildId, 'Configurez d\u2019abord le salon principal et la cat\u00e9gorie modmail.', { color: '#ED4245', timestamp: false })],
          flags  : MessageFlags.Ephemeral,
        }).catch(() => {});
      }

      db.setGuildConfig(guildId, 'modmailEnabled', current ? 0 : 1);
      await interaction.deferUpdate().catch(() => {});
      return _refreshPanel(panel, guildId);
    }

    if (busy) return interaction.deferUpdate().catch(() => {});
    busy = true;

    const meta = _OPTION_META[choice];
    if (!meta) { busy = false; return interaction.deferUpdate().catch(() => {}); }

    const modalId = `local:modmail:modal:${choice}:${interaction.id}`;
    const shown = await interaction.showModal(
      new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(meta.modalTitle)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('value')
              .setLabel(meta.modalLabel)
              .setStyle(TextInputStyle.Short)
              .setPlaceholder(meta.modalPlaceholder)
              .setRequired(true)
              .setMaxLength(100)
          )
        )
    ).then(() => true).catch(() => false);

    busy = false;
    if (!shown) return;

    const submit = await _awaitOwnModal(interaction, modalId);
    if (!submit) return _refreshPanel(panel, guildId);

    busy = true;
    const raw = submit.fields.getTextInputValue('value').trim();
    const result = _applyOption(choice, raw, guildId, guild, me);

    if (result.error) {
      await submit.reply({
        embeds : [embed.build(guildId, result.error, { color: '#ED4245', timestamp: false })],
        flags  : MessageFlags.Ephemeral,
      }).catch(() => {});
      busy = false;
      return _refreshPanel(panel, guildId);
    }

    await submit.deferUpdate().catch(() => {});
    busy = false;
    return _refreshPanel(panel, guildId);
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(panel);
    if (reason === 'closed') {
      panel.delete().catch(() => {});
      return;
    }
    panel.edit({ components: [] }).catch(() => {});
  });
}

function _refreshPanel(panel, guildId) {
  return panel.edit({
    embeds          : [_buildSettingsEmbed(guildId)],
    components      : _buildSettingsRows(),
    allowedMentions : { parse: [] },
  }).catch(() => {});
}

function _buildSettingsEmbed(guildId) {
  const config = db.getGuildConfig(guildId);

  return embed.build(guildId, null, {
    title  : 'Configuration modmail',
    fields : [
      { name: 'État',                 value: Number(config?.modmailEnabled) ? '`Activé`' : '`Désactivé`',              inline: true },
      { name: 'Salon principal',      value: config?.modmailChannel    ? `<#${config.modmailChannel}>`    : '`Aucun`',  inline: true },
      { name: 'Catégorie',            value: config?.modmailCategory   ? `<#${config.modmailCategory}>`   : '`Aucune`', inline: true },
      { name: 'Salon logs',           value: config?.modmailLogChannel ? `<#${config.modmailLogChannel}>` : '`Aucun`',  inline: true },
      { name: 'Rôle ping',            value: config?.modmailPingRole   ? `<@&${config.modmailPingRole}>`  : '`Aucun`',  inline: true },
      { name: 'Cooldown réouverture', value: `\`${formatDuration(config?.modmailOpenCooldown || 300)}\``,               inline: true },
      { name: 'Limite spam',          value: `\`${config?.modmailSpamLimit || 5} messages\``,                           inline: true },
      { name: 'Fenêtre spam',         value: `\`${formatDuration(config?.modmailSpamWindow || 30)}\``,                  inline: true },
      { name: 'Blocage spam',         value: `\`${formatDuration(config?.modmailSpamBlockTime || 300)}\``,              inline: true },
      { name: 'Intervalle indisponible', value: _formatUnavailableInterval(config?.modmailUnavailableInterval),                inline: true },
    ],
    timestamp: false,
  });
}

function _formatUnavailableInterval(value) {
  const secs = Number(value);
  if (!Number.isFinite(secs) || secs <= 0) return '`Désactivé`';
  return `\`${formatDuration(secs)}\``;
}

function _buildSettingsRows() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('local:modmail:select')
        .setPlaceholder('Modifier un paramètre...')
        .addOptions([
          { value: 'toggle',     label: 'Activer / Désactiver', description: 'Activer ou désactiver le modmail',   emoji: '\uD83D\uDD18' },
          { value: 'channel',    label: 'Salon principal',      description: 'Salon où les tickets s\'ouvrent',    emoji: '\uD83D\uDCEC' },
          { value: 'category',   label: 'Catégorie',            description: 'Catégorie des fils modmail',         emoji: '\uD83D\uDCC1' },
          { value: 'log',        label: 'Salon logs',           description: 'Salon de logs modmail',              emoji: '\uD83D\uDCCB' },
          { value: 'ping',       label: 'Rôle ping',            description: 'Rôle mentionné a l\'ouverture',      emoji: '\uD83D\uDD14' },
          { value: 'cooldown',   label: 'Cooldown réouverture', description: 'Délai entre deux ouvertures',        emoji: '\u23F1' },
          { value: 'spamlimit',  label: 'Limite spam',          description: 'Nombre de messages max',             emoji: '\uD83D\uDEAB' },
          { value: 'spamwindow', label: 'Fenêtre spam',         description: 'Période de détection spam',          emoji: '\uD83D\uDD50' },
          { value: 'spamblock',   label: 'Blocage spam',         description: 'Durée de blocage anti-spam',         emoji: '\uD83D\uDD12' },
          { value: 'unavailable', label: 'Intervalle indisponible', description: 'Délai entre chaque message "Modmail indisponible" (0 = silence)', emoji: '\u23F1' },
          { value: 'close',       label: 'Fermer',                description: 'Fermer le panel',                    emoji: '\u274C' },
        ])
    ),
  ];
}

const _OPTION_META = {
  channel: {
    modalTitle       : 'Salon principal',
    modalLabel       : 'Mention ou ID du salon (ou off)',
    modalPlaceholder : '#modmail ou 123456789 ou off',
  },
  category: {
    modalTitle       : 'Catégorie modmail',
    modalLabel       : 'ID de la catégorie (ou off)',
    modalPlaceholder : '123456789 ou off',
  },
  log: {
    modalTitle       : 'Salon logs',
    modalLabel       : 'Mention ou ID du salon logs (ou off)',
    modalPlaceholder : '#logs ou 123456789 ou off',
  },
  ping: {
    modalTitle       : 'Rôle ping',
    modalLabel       : 'Mention ou ID du rôle (ou off)',
    modalPlaceholder : '@Staff ou 123456789 ou off',
  },
  cooldown: {
    modalTitle       : 'Cooldown réouverture',
    modalLabel       : 'Durée (ex: 5m, 1h, 300s)',
    modalPlaceholder : '5m',
  },
  spamlimit: {
    modalTitle       : 'Limite spam',
    modalLabel       : 'Nombre de messages (min 2)',
    modalPlaceholder : '5',
  },
  spamwindow: {
    modalTitle       : 'Fenêtre spam',
    modalLabel       : 'Durée fenêtre (ex: 30s, 1m)',
    modalPlaceholder : '30s',
  },
  spamblock: {
    modalTitle       : 'Blocage spam',
    modalLabel       : 'Durée blocage (ex: 5m, 1h)',
    modalPlaceholder : '5m',
  },
  unavailable: {
    modalTitle       : 'Intervalle indisponible',
    modalLabel       : 'Durée (ex: 15m, 1h) ou off pour silence total',
    modalPlaceholder : '1h',
  },
};

function _applyOption(choice, raw, guildId, guild, me) {
  const input = raw.toLowerCase();
  const isOff = ['off', 'reset', 'none', 'aucun', '0'].includes(input);

  switch (choice) {
    case 'channel': {
      if (isOff) {
        db.setGuildConfig(guildId, 'modmailChannel', null);
        return { ok: true };
      }
      const id = raw.replace(/[<#>]/g, '');
      const channel = guild.channels.cache.get(id);
      if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        return { error: 'Salon textuel introuvable.' };
      }
      const chPerms = channel.permissionsFor(me);
      if (!chPerms?.has('ViewChannel'))   return { error: `Pas d'acces a <#${channel.id}>.` };
      if (!chPerms?.has('SendMessages'))  return { error: `Pas la permission d'envoyer dans <#${channel.id}>.` };
      db.setGuildConfig(guildId, 'modmailChannel', channel.id);
      return { ok: true };
    }

    case 'category': {
      if (isOff) {
        db.setGuildConfig(guildId, 'modmailCategory', null);
        db.setGuildConfig(guildId, 'modmailEnabled', 0);
        return { ok: true };
      }
      const id = raw.replace(/[<#>]/g, '');
      const cat = guild.channels.cache.get(id);
      if (!cat || cat.type !== ChannelType.GuildCategory) {
        return { error: 'Catégorie introuvable. Utilisez l\'ID d\'une catégorie.' };
      }
      const catPerms = cat.permissionsFor(me);
      if (!catPerms?.has('ViewChannel'))     return { error: `Pas d'accès a la catégorie <#${cat.id}>.` };
      if (!catPerms?.has('ManageChannels'))  return { error: `Pas la permission Gerer les salons dans <#${cat.id}>.` };
      db.setGuildConfig(guildId, 'modmailCategory', cat.id);
      return { ok: true };
    }

    case 'log': {
      if (isOff) {
        db.setGuildConfig(guildId, 'modmailLogChannel', null);
        return { ok: true };
      }
      const id = raw.replace(/[<#>]/g, '');
      const channel = guild.channels.cache.get(id);
      if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        return { error: 'Salon textuel introuvable.' };
      }
      const chPerms = channel.permissionsFor(me);
      if (!chPerms?.has('ViewChannel'))   return { error: `Pas d'acces a <#${channel.id}>.` };
      if (!chPerms?.has('SendMessages'))  return { error: `Pas la permission d'envoyer dans <#${channel.id}>.` };
      db.setGuildConfig(guildId, 'modmailLogChannel', channel.id);
      return { ok: true };
    }

    case 'ping': {
      if (isOff) {
        db.setGuildConfig(guildId, 'modmailPingRole', null);
        return { ok: true };
      }
      const id = raw.replace(/[<@&>]/g, '');
      const role = guild.roles.cache.get(id);
      if (!role) return { error: 'Rôle introuvable.' };
      db.setGuildConfig(guildId, 'modmailPingRole', role.id);
      return { ok: true };
    }

    case 'cooldown': {
      const seconds = parseDuration(raw);
      if (!seconds || seconds < 30) return { error: 'Duree invalide. Minimum 30 secondes (ex: 30s, 5m, 1h).' };
      db.setGuildConfig(guildId, 'modmailOpenCooldown', seconds);
      return { ok: true };
    }

    case 'spamlimit': {
      const limit = parseInt(raw, 10);
      if (!limit || limit < 2) return { error: 'Nombre invalide. Minimum 2 messages.' };
      db.setGuildConfig(guildId, 'modmailSpamLimit', limit);
      return { ok: true };
    }

    case 'spamwindow': {
      const seconds = parseDuration(raw);
      if (!seconds || seconds < 5) return { error: 'Duree invalide. Minimum 5 secondes (ex: 5s, 30s, 1m).' };
      db.setGuildConfig(guildId, 'modmailSpamWindow', seconds);
      return { ok: true };
    }

    case 'spamblock': {
      const seconds = parseDuration(raw);
      if (!seconds || seconds < 30) return { error: 'Duree invalide. Minimum 30 secondes (ex: 30s, 5m, 1h).' };
      db.setGuildConfig(guildId, 'modmailSpamBlockTime', seconds);
      return { ok: true };
    }

    case 'unavailable': {
      if (isOff) {
        db.setGuildConfig(guildId, 'modmailUnavailableInterval', 0);
        return { ok: true };
      }
      const seconds = parseDuration(raw);
      if (!seconds || seconds < 0) {
        return { error: 'Duree invalide. Exemples : 15m, 1h, ou off pour silence total.' };
      }
      db.setGuildConfig(guildId, 'modmailUnavailableInterval', seconds);
      return { ok: true };
    }

    default:
      return { error: 'Option inconnue.' };
  }
}


function _resolveTextChannel(message, raw) {
  if (!raw) return null;

  const id = String(raw).replace(/[<#>]/g, '');

  return message.mentions.channels.first()
    ?? message.guild.channels.cache.get(id)
    ?? null;
}

function _resolveCategory(message, raw) {
  if (!raw) return null;

  const id = String(raw).replace(/[<#>]/g, '');

  const channel = message.mentions.channels.first()
    ?? message.guild.channels.cache.get(id)
    ?? null;

  if (!channel || channel.type !== ChannelType.GuildCategory) {
    return null;
  }

  return channel;
}

function _resolveRole(message, raw) {
  if (!raw) return null;

  const id = String(raw).replace(/[<@&>]/g, '');

  return message.mentions.roles.first()
    ?? message.guild.roles.cache.get(id)
    ?? null;
}


async function _awaitOwnModal(interaction, customId) {
  try {
    return await interaction.awaitModalSubmit({
      filter: i => i.customId === customId && i.user.id === interaction.user.id,
      time: 60_000,
    });
  } catch { return null; }
}


async function _error(message, deleteReply, deleteDelay, text) {
  const sent = await embed.replyError(
    message,
    text,
    { timestamp: false, allowedMentions: { parse: [] } }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }

  return sent;
}

async function _success(message, deleteReply, deleteDelay, text) {
  const sent = await embed.reply(
    message,
    text,
    { timestamp: false, allowedMentions: { parse: [] } }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }

  return sent;
}


function parseDuration(str) {
  if (!str) return null;

  const match = String(str).match(/^(\d+)(s|m|h)?$/);
  if (!match) return null;

  const num  = parseInt(match[1], 10);
  const unit = match[2] || 's';

  switch (unit) {
    case 's': return num;
    case 'm': return num * 60;
    case 'h': return num * 3600;
    default : return null;
  }
}


function formatDuration(seconds) {
  const secs = parseInt(seconds, 10) || 0;

  if (secs >= 3600 && secs % 3600 === 0) return `${secs / 3600}h`;
  if (secs >= 60   && secs % 60   === 0) return `${secs / 60}m`;
  return `${secs}s`;
}
