'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

const embed     = require('../../utils/embed');
const giveaways = require('../../modules/giveaways');
const db        = require('../../core/database');
const perms     = require('../../utils/permissions');
const { parseDuration, formatDuration } = require('../../utils/parseDuration.js');

exports.help = {
  name       : 'gstart',
  description: 'Cr\u00e9er un giveaway.',
  use        : 'gstart <dur\u00e9e> <gagnant(s)> <prix> [#salon] [--config]',
  usage      : 'gstart <dur\u00e9e> <gagnant(s)> <prix> [#salon] [--config]',
};


const MAX_GIVEAWAY_DURATION_MS = 28 * 24 * 60 * 60 * 1000 - 1000;

const DEFAULT_CONFIG = {
  color      : null,
  image      : null,
  thumbnail  : null,
  description: null,
  emoji      : '\uD83C\uDF89',
  footer     : null,
  entryMode  : 'button',

  requiredRoleId    : null,
  deniedRoleId      : null,
  soutienRequired   : false,
  statusRequired    : false,
  tagRequired       : false,
  requireBeforeStart: true,
  minLevel          : null,
  voiceRequired     : false,
  minVoiceSeconds   : null,
  forcedWinners     : [],
  requiredGuildIds  : [],
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;

  if (!perms.check(message, 'giveaway')) return;

  if (args.length < 3) {
    return embed.replyError(message, `Utilisation : \`${exports.help.use}\``);
  }

  const configFlag = args.includes('--config');
  const cleanArgs  = args.filter(a => a !== '--config');

  let channel = message.channel;
  const mentioned = message.mentions.channels.first();
  const finalArgs = cleanArgs.filter(a => !a.includes(mentioned?.id ?? '__none__'));

  if (mentioned?.isTextBased()) {
    channel = mentioned;
  }

  const durationMs = parseDuration(finalArgs[0], {
    minMs: 10_000,
    maxMs: MAX_GIVEAWAY_DURATION_MS,
  });

  if (durationMs === null) {


    const probe = parseDuration(finalArgs[0]);
    if (probe !== null && probe > MAX_GIVEAWAY_DURATION_MS) {
      return embed.replyError(message, 'La dur\u00e9e maximale d\'un giveaway est de 28 jours.');
    }
    return embed.replyError(message, 'Dur\u00e9e invalide. Exemples : `10m`, `1h`, `2d`.');
  }

  const winnerCount = parseInt(finalArgs[1], 10);

  if (isNaN(winnerCount) || winnerCount < 1) {
    return embed.replyError(message, 'Nombre de gagnants invalide.');
  }

  const prize = finalArgs.slice(2).join(' ').trim();

  if (!prize) {
    return embed.replyError(message, 'Veuillez indiquer un prix.');
  }

  if (prize.length > 256) {
    return embed.replyError(message, 'Le prix est trop long. Limite : 256 caract\u00e8res.');
  }

  await message.delete().catch(() => {});

  if (!configFlag) {
    await giveaways.start(client, {
      guildId,
      channelId   : channel.id,
      hostId      : message.author.id,
      prize,
      winnerCount,
      durationMs,
      customConfig: {},
    });

    const _gsCfg   = db.getGuildConfig(guildId);
    const _gsDelay = _gsCfg?.autoDeleteDelay ?? 4;

    const confirm = await message.channel.send({
      embeds: [
        embed.build(guildId, `Giveaway lanc\u00e9 dans <#${channel.id}> !`, {
          timestamp: false,
        }),
      ],
    }).catch(() => null);

    if (confirm) embed.scheduleDelete(confirm, _gsDelay);

    return;
  }


  const prizeKey = _normalizePrizeKey(prize);
  const config   = { ...DEFAULT_CONFIG };

  let presetSnapshot = null;

  const loadedPreset = db.getGiveawayConfigPreset(guildId, prizeKey);
  if (loadedPreset) {
    try {
      const saved = JSON.parse(loadedPreset.configJson);
      Object.assign(config, saved);
      presetSnapshot = { ...DEFAULT_CONFIG, ...saved };
    } catch {  }
  }


  const buildRecapEmbed = () => {
    const endDate   = new Date(Date.now() + durationMs);
    const endTs     = Math.floor(endDate.getTime() / 1000);
    const durationH = formatDuration(durationMs, { format: 'fr-long' });

    const fields = [
      { name: 'Gain',               value: `**${prize}**`,       inline: true },
      { name: 'Dur\u00e9e',         value: `${durationH}\n<t:${endTs}:f>`, inline: true },
      { name: 'Salon',              value: `<#${channel.id}>`,   inline: true },

      { name: 'Emoji',              value: config.emoji,         inline: true },
      { name: 'Nombre de gagnants', value: String(winnerCount),  inline: true },
      { name: 'Mode',               value: config.entryMode === 'reaction' ? 'R\u00e9action' : 'Bouton', inline: true },

      {
        name  : 'R\u00f4le requis',
        value : config.requiredRoleId ? `<@&${config.requiredRoleId}>` : 'Aucun',
        inline: true,
      },
      {
        name  : 'R\u00f4le interdit',
        value : config.deniedRoleId ? `<@&${config.deniedRoleId}>` : 'Aucun',
        inline: true,
      },
      {
        name  : 'Pr\u00e9sence en vocal obligatoire',
        value : config.voiceRequired ? '' : '',
        inline: true,
      },
    ];


    const condParts = [];
    if (config.soutienRequired) condParts.push('Soutien');
    if (config.statusRequired)  condParts.push('Statut');
    if (config.tagRequired)     condParts.push('Tag');

    const condValue = condParts.length ? condParts.join(', ') : 'Aucune';

    fields.push({ name: 'Conditions', value: condValue, inline: true });
    fields.push({
      name  : 'Avant lancement',
      value : config.requireBeforeStart ? '' : '',
      inline: true,
    });

    fields.push({
      name  : 'Temps vocal minimum',
      value : config.minVoiceSeconds ? formatDuration(config.minVoiceSeconds, { unit: 's', format: 'short' }) : 'Aucun',
      inline: true,
    });
    fields.push({
      name  : 'Niveau minimum',
      value : config.minLevel ? String(config.minLevel) : 'Aucun',
      inline: true,
    });

    fields.push({
      name  : 'Gagnants imposes',
      value : config.forcedWinners.length
        ? config.forcedWinners.map(id => `<@${id}>`).join(', ')
        : 'Aucun',
      inline: true,
    });
    fields.push({
      name  : 'Serveurs requis',
      value : config.requiredGuildIds.length
        ? config.requiredGuildIds.map(id => {
            const g = client.guilds.cache.get(id);
            return g ? `${g.name}` : `\`${id}\``;
          }).join(', ')
        : 'Aucun',
      inline: true,
    });

    const presetExists = Boolean(db.getGiveawayConfigPreset(guildId, prizeKey));
    if (presetExists) {
      fields.push({ name: 'Preset', value: prize, inline: true });
    }

    return embed.build(guildId, null, {
      title    : 'Param\u00e8tre du giveaway',
      fields,
      footer   : 'Configurez puis cliquez sur Lancer',
      timestamp: false,
    });
  };


  const buildRows = () => [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('gw_select_config')
        .setPlaceholder('Configurer...')
        .addOptions([
          { label: 'Emoji',       value: 'gw_set_emoji',       description: 'Changer l\'emoji du bouton',  emoji: '😄' },
          { label: 'Couleur',     value: 'gw_set_color',       description: 'Couleur de l\'embed',         emoji: '🎨' },
          { label: 'Description', value: 'gw_set_description', description: 'Description du giveaway',    emoji: '📝' },
          { label: 'Image',       value: 'gw_set_image',       description: 'Image principale',           emoji: '🏞️' },
          { label: 'Thumbnail',   value: 'gw_set_thumbnail',   description: 'Miniature',                  emoji: '🖼️' },
          { label: 'Footer',      value: 'gw_set_footer',      description: 'Texte du footer',            emoji: '🔻' },
          { label: 'Mode',        value: 'gw_toggle_mode',     description: 'Bouton ou R\u00e9action',           emoji: '🔀' },
          { label: 'Conditions',  value: 'gw_set_conditions',  description: 'R\u00f4les, vocal, niveau...',       emoji: '⚙️' },
          { label: 'Avance',     value: 'gw_set_advanced',    description: 'Gagnants imposes, serveurs requis', emoji: '🔧' },
        ])
    ),

    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('gw_select_preset')
        .setPlaceholder('Presets & conditions...')
        .addOptions([
          { label: 'Sauvegarder la config',       value: 'gw_save_preset',       emoji: '💾' },
          { label: 'Charger la config',           value: 'gw_reload_preset',     emoji: '📂' },
          { label: 'R\u00e9initialiser conditions', value: 'gw_reset_conditions',  emoji: '🔄' },
          { label: 'Supprimer la config',         value: 'gw_delete_preset',     emoji: '🗑️' },
        ])
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('gw_launch')
        .setLabel('Lancer')
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId('gw_reset')
        .setLabel('Reset')
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId('gw_cancel')
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Danger),
    ),
  ];

  const sent = await message.channel.send({
    embeds    : [buildRecapEmbed()],
    components: buildRows(),
  }).catch(() => null);

  if (!sent) return;

  embed.registerPrivateInteraction(sent, message.author.id, 10 * 60 * 1000);

  const refresh = () => {
    return sent.edit({
      embeds    : [buildRecapEmbed()],
      components: buildRows(),
    }).catch(() => {});
  };


  let busy = false;

  const collector = sent.createMessageComponentCollector({
    filter: i => i.user.id === message.author.id,
    idle  : 120_000,
    time  : 300_000,
  });

  collector.on('collect', async interaction => {
    let id = interaction.customId;
    if (id === 'gw_select_config' || id === 'gw_select_preset') {
      id = interaction.values?.[0];
    }


    if (busy) {
      return interaction.reply({
        content: 'Une modification est déjà en cours.',
        flags  : MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    if (id === 'gw_cancel') {
      collector.stop('cancelled');
      await interaction.deferUpdate().catch(() => {});
      return sent.delete().catch(() => {});
    }

    if (id === 'gw_reset') {
      if (presetSnapshot) {
        Object.assign(config, { ...presetSnapshot });
      } else {
        Object.assign(config, { ...DEFAULT_CONFIG });
      }
      await interaction.deferUpdate().catch(() => {});
      await refresh();
      return;
    }

    if (id === 'gw_toggle_mode') {
      config.entryMode = config.entryMode === 'button' ? 'reaction' : 'button';
      await interaction.deferUpdate().catch(() => {});
      await refresh();
      return;
    }

    if (id === 'gw_launch') {
      collector.stop('launched');
      await interaction.deferUpdate().catch(() => {});

      await sent.edit({
        embeds: [
          embed.build(guildId, 'Giveaway en cours de cr\u00e9ation...', { timestamp: false }),
        ],
        components: [],
      }).catch(() => {});

      await giveaways.start(client, {
        guildId,
        channelId   : channel.id,
        hostId      : message.author.id,
        prize,
        winnerCount,
        durationMs,
        customConfig: { ...config },
        conditions  : (_hasConditions(config) || config.forcedWinners.length) ? { ...config } : null,
      });

      return sent.edit({
        embeds: [
          embed.build(guildId, `Giveaway lanc\u00e9 dans <#${channel.id}> !`, { timestamp: false }),
        ],
      }).catch(() => {});
    }

    if (id === 'gw_reset_conditions') {
      config.requiredRoleId     = null;
      config.deniedRoleId       = null;
      config.soutienRequired    = false;
      config.statusRequired     = false;
      config.tagRequired        = false;
      config.requireBeforeStart = true;
      config.minLevel           = null;
      config.voiceRequired      = false;
      config.minVoiceSeconds    = null;
      config.forcedWinners      = [];
      config.requiredGuildIds   = [];
      await interaction.deferUpdate().catch(() => {});
      await refresh();
      return;
    }

    if (id === 'gw_save_preset') {
      const presetData = {};
      for (const key of _PRESET_KEYS) presetData[key] = config[key] ?? null;
      try {
        db.setGiveawayConfigPreset(guildId, prizeKey, prize, JSON.stringify(presetData));
        presetSnapshot = { ...DEFAULT_CONFIG, ...presetData };
        await interaction.reply({ content: `Configuration sauvegard\u00e9e pour **${prize}**.`, flags: MessageFlags.Ephemeral }).catch(() => {});
      } catch {
        await interaction.reply({ content: 'Erreur lors de la sauvegarde.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      await refresh();
      return;
    }

    if (id === 'gw_delete_preset') {
      const existing = db.getGiveawayConfigPreset(guildId, prizeKey);
      if (!existing) {
        await interaction.reply({ content: `Aucune configuration sauvegard\u00e9e pour **${prize}**.`, flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gw_confirm_delete_preset').setLabel('Confirmer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('gw_cancel_delete_preset').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
      );

      const confirmReply = await interaction.reply({
        content: `Supprimer la configuration sauvegard\u00e9e pour **${prize}** ?`,
        components: [confirmRow],
        flags: MessageFlags.Ephemeral,
        withResponse: true,
      }).catch(() => null);

      const confirmMsg = confirmReply?.resource?.message ?? null;
      if (!confirmMsg) return;

      try {
        const confirm = await confirmMsg.awaitMessageComponent({
          filter: i => i.user.id === message.author.id,
          time: 15_000,
        });
        if (confirm.customId === 'gw_confirm_delete_preset') {
          db.deleteGiveawayConfigPreset(guildId, prizeKey);
          presetSnapshot = null;
          await confirm.update({ content: `Configuration supprim\u00e9e pour **${prize}**.`, components: [] }).catch(() => {});
        } else {
          await confirm.update({ content: 'Suppression annul\u00e9e.', components: [] }).catch(() => {});
        }
      } catch {
        await interaction.editReply({ content: 'Suppression annul\u00e9e (timeout).', components: [] }).catch(() => {});
      }
      await refresh();
      return;
    }

    if (id === 'gw_reload_preset') {
      const saved = db.getGiveawayConfigPreset(guildId, prizeKey);
      if (!saved) {
        await interaction.reply({ content: `Aucune configuration sauvegard\u00e9e pour **${prize}**.`, flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      try {
        const parsed = JSON.parse(saved.configJson);
        Object.assign(config, DEFAULT_CONFIG);
        for (const key of _PRESET_KEYS) {
          if (key in parsed) config[key] = parsed[key];
        }
        presetSnapshot = { ...config };
        await interaction.reply({ content: `Configuration recharg\u00e9e pour **${prize}**.`, flags: MessageFlags.Ephemeral }).catch(() => {});
      } catch {
        await interaction.reply({ content: 'Preset corrompu, impossible de recharger.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      await refresh();
      return;
    }

    if (id === 'gw_set_conditions') {
      busy = true;
      const shown = await interaction.showModal(
        _buildModal('gw_modal_conditions', 'Conditions giveaway', [
          _input('conditions_roles', 'Rôle requis ; Rôle interdit (ID ou @)', TextInputStyle.Short, {
            value: [config.requiredRoleId || '', config.deniedRoleId || ''].filter(Boolean).join(' ; ') || '',
            maxLength: 80, required: false, placeholder: '123456789 ; 987654321 ou @rôle',
          }),
          _input('conditions_soutien', 'soutien/status/tag (oui/non)', TextInputStyle.Short, {
            value: [config.soutienRequired ? 'soutien' : '', config.statusRequired ? 'status' : '', config.tagRequired ? 'tag' : ''].filter(Boolean).join(' ') || '',
            maxLength: 30, required: false, placeholder: 'soutien status tag',
          }),
          _input('conditions_levels', 'Niveau minimum', TextInputStyle.Short, {
            value: config.minLevel ? String(config.minLevel) : '',
            maxLength: 5, required: false, placeholder: '10',
          }),
          _input('conditions_voice', 'Vocal requis ; Temps min (ex: 10m)', TextInputStyle.Short, {
            value: [config.voiceRequired ? 'oui' : '', config.minVoiceSeconds ? String(config.minVoiceSeconds) : ''].filter(Boolean).join(' ; ') || '',
            maxLength: 30, required: false, placeholder: 'oui/voc ; 10m ou 300',
          }),
          _input('conditions_before', 'Requis avant debut? (oui/non)', TextInputStyle.Short, {
            value: config.requireBeforeStart ? 'oui' : 'non',
            maxLength: 5, required: false, placeholder: 'oui',
          }),
        ])
      ).then(() => true).catch(() => false);
      busy = false;
      if (!shown) return;

      const submit = await _awaitOwnModal(interaction, 'gw_modal_conditions');
      if (!submit) { await refresh(); return; }

      busy = true;
      try {

      const rolesRaw   = submit.fields.getTextInputValue('conditions_roles').trim();
      const soutienRaw = submit.fields.getTextInputValue('conditions_soutien').trim().toLowerCase();
      const levelRaw   = submit.fields.getTextInputValue('conditions_levels').trim();
      const voiceRaw   = submit.fields.getTextInputValue('conditions_voice').trim();
      const beforeRaw  = submit.fields.getTextInputValue('conditions_before').trim().toLowerCase();

      const rolesParts = rolesRaw.split(/[;,]/).map(s => _extractRoleId(s.trim()));
      const reqRoleId  = rolesParts[0] || null;
      const denRoleId  = rolesParts[1] || null;

      const guild = message.guild;
      if (reqRoleId && !guild.roles.cache.has(reqRoleId)) {
        await submit.reply({ content: `Role requis introuvable : \`${reqRoleId}\`.`, flags: MessageFlags.Ephemeral }).catch(() => {});
        await refresh(); return;
      }
      if (denRoleId && !guild.roles.cache.has(denRoleId)) {
        await submit.reply({ content: `Role interdit introuvable : \`${denRoleId}\`.`, flags: MessageFlags.Ephemeral }).catch(() => {});
        await refresh(); return;
      }

      config.requiredRoleId = reqRoleId;
      config.deniedRoleId   = denRoleId;
      config.soutienRequired = soutienRaw.includes('soutien');
      config.statusRequired  = soutienRaw.includes('status');
      config.tagRequired     = soutienRaw.includes('tag');

      const lvl = parseInt(levelRaw, 10);
      config.minLevel = (!isNaN(lvl) && lvl > 0) ? lvl : null;

      const _voiceKeywords = ['oui', 'yes', '1', 'true', 'on', 'voc', 'vocal', 'voice'];
      const voiceParts = voiceRaw.split(/[;,]/).map(s => s.trim().toLowerCase());
      const vp0 = voiceParts[0] || '';
      const vp1 = voiceParts[1] || '';

      if (!voiceRaw) {
        config.voiceRequired = false;
        config.minVoiceSeconds = null;
      } else if (_voiceKeywords.includes(vp0)) {
        config.voiceRequired = true;
        if (vp1) {
          const parsed = _parseDuration(vp1);
          if (parsed === null) {
            await submit.reply({ content: 'Temps vocal invalide. Exemples : `300`, `30s`, `10m`, `1h`.', flags: MessageFlags.Ephemeral }).catch(() => {});
            await refresh(); return;
          }
          config.minVoiceSeconds = parsed > 0 ? parsed : null;
        } else {
          config.minVoiceSeconds = null;
        }
      } else {
        const parsed = _parseDuration(vp0);
        if (parsed === null) {
          await submit.reply({ content: 'Temps vocal invalide. Exemples : `oui`, `voc ; 10m`, `1h`.', flags: MessageFlags.Ephemeral }).catch(() => {});
          await refresh(); return;
        }
        config.voiceRequired = true;
        config.minVoiceSeconds = parsed > 0 ? parsed : null;
      }

      config.requireBeforeStart = !['non', 'no', '0', 'false'].includes(beforeRaw);

      await submit.deferUpdate().catch(() => {});
      await refresh();
      return;
      } finally {
        busy = false;
      }
    }

    if (id === 'gw_set_advanced') {
      busy = true;
      const shown = await interaction.showModal(
        _buildModal('gw_modal_advanced', 'Avance', [
          _input('adv_forced', 'Gagnants imposes (mentions ou IDs ; separ.)', TextInputStyle.Paragraph, {
            value: config.forcedWinners.length ? config.forcedWinners.join(' ; ') : '',
            maxLength: 500, required: false, placeholder: '123456789 ; 987654321',
          }),
          _input('adv_guilds', 'Serveurs requis (IDs ; separ.)', TextInputStyle.Short, {
            value: config.requiredGuildIds.length ? config.requiredGuildIds.join(' ; ') : '',
            maxLength: 300, required: false, placeholder: '111111111 ; 222222222',
          }),
        ])
      ).then(() => true).catch(() => false);
      busy = false;
      if (!shown) return;

      const submit = await _awaitOwnModal(interaction, 'gw_modal_advanced');
      if (!submit) { await refresh(); return; }

      busy = true;
      try {

      const forcedRaw = submit.fields.getTextInputValue('adv_forced').trim();
      const forcedIds = forcedRaw
        ? [...new Set(forcedRaw.split(/[;,\s]+/).map(s => _extractUserId(s.trim())).filter(Boolean))]
        : [];


      const guildsRaw = submit.fields.getTextInputValue('adv_guilds').trim();
      const guildIds  = guildsRaw
        ? [...new Set(guildsRaw.split(/[;,\s]+/).map(s => s.replace(/\D/g, '')).filter(s => s.length > 14))]
        : [];

      if (forcedIds.length > winnerCount) {
        await submit.reply({
          content: `Vous avez **${forcedIds.length} gagnants imposes** mais seulement **${winnerCount} gagnant(s)** configure(s). Reduisez l'un ou l'autre.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        }).catch(() => {});
        await refresh();
        return;
      }


      for (const gId of guildIds) {
        if (!client.guilds.cache.get(gId)) {
          await submit.reply({
            content: `Je ne suis pas dans le serveur \`${gId}\`. Ajoutez-moi d'abord ou retirez cet ID.`,
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          await refresh();
          return;
        }
      }

      config.forcedWinners    = forcedIds;
      config.requiredGuildIds = guildIds;

      await submit.deferUpdate().catch(() => {});
      await refresh();
      return;
      } finally {
        busy = false;
      }
    }


    const configModals = {
      gw_set_emoji: {
        modalId: 'gw_modal_emoji',
        title  : 'Emoji du bouton',
        inputs : [
          _input('emoji', 'Emoji (ex: \uD83C\uDF8A ou <:nom:id>)', TextInputStyle.Short, {
            value: config.emoji || '', maxLength: 64, placeholder: '\uD83C\uDF89',
          }),
        ],
        apply: s => {
          const raw = s.fields.getTextInputValue('emoji').trim();
          if (!raw) { config.emoji = '\uD83C\uDF89'; return null; }
          if (!_isValidButtonEmoji(raw)) return 'Emoji invalide.';
          config.emoji = raw;
          return null;
        },
      },
      gw_set_color: {
        modalId: 'gw_modal_color',
        title  : 'Couleur de l\'embed',
        inputs : [
          _input('color', 'Couleur hex (ex: #5865F2)', TextInputStyle.Short, {
            value: config.color || '', maxLength: 7, required: false, placeholder: '#5865F2',
          }),
        ],
        apply: s => {
          const raw = s.fields.getTextInputValue('color').trim();
          if (raw && !/^#?[0-9a-fA-F]{6}$/.test(raw)) return 'Couleur invalide.';
          config.color = raw ? (raw.startsWith('#') ? raw : `#${raw}`) : null;
          return null;
        },
      },
      gw_set_description: {
        modalId: 'gw_modal_desc',
        title  : 'Description',
        inputs : [
          _input('description', 'Description (optionnel)', TextInputStyle.Paragraph, {
            value: config.description || '', maxLength: 1000, required: false,
            placeholder: 'R\u00e9agissez pour tenter de gagner !',
          }),
        ],
        apply: s => {
          config.description = s.fields.getTextInputValue('description').trim() || null;
          return null;
        },
      },
      gw_set_image: {
        modalId: 'gw_modal_image',
        title  : 'Image principale',
        inputs : [
          _input('image', 'URL directe de l\'image ou du GIF', TextInputStyle.Short, {
            value: config.image || '', maxLength: 512, required: false,
            placeholder: 'https://media.tenor.com/.../tenor.gif',
          }),
        ],
        apply: s => {
          const url = s.fields.getTextInputValue('image').trim();
          if (url && !_isValidImageUrl(url)) return 'URL invalide. Lien direct requis (.png, .jpg, .gif, .webp).';
          config.image = url || null;
          return null;
        },
      },
      gw_set_thumbnail: {
        modalId: 'gw_modal_thumb',
        title  : 'Thumbnail',
        inputs : [
          _input('thumbnail', 'URL directe de la miniature', TextInputStyle.Short, {
            value: config.thumbnail || '', maxLength: 512, required: false,
            placeholder: 'https://i.imgur.com/image.png',
          }),
        ],
        apply: s => {
          const url = s.fields.getTextInputValue('thumbnail').trim();
          if (url && !_isValidImageUrl(url)) return 'URL invalide. Lien direct requis.';
          config.thumbnail = url || null;
          return null;
        },
      },
      gw_set_footer: {
        modalId: 'gw_modal_footer',
        title  : 'Footer',
        inputs : [
          _input('footer', 'Texte du footer (optionnel)', TextInputStyle.Short, {
            value: config.footer || '', maxLength: 256, required: false,
            placeholder: 'Organis\u00e9 par le staff',
          }),
        ],
        apply: s => {
          config.footer = s.fields.getTextInputValue('footer').trim() || null;
          return null;
        },
      },
    };

    if (configModals[id]) {
      const def = configModals[id];

      busy = true;
      const shown = await interaction.showModal(
        _buildModal(def.modalId, def.title, def.inputs)
      ).then(() => true).catch(() => false);
      busy = false;
      if (!shown) return;

      const submit = await _awaitOwnModal(interaction, def.modalId);
      if (!submit) { await refresh(); return; }

      busy = true;
      try {
        const err = def.apply(submit);
        if (err) {
          await submit.reply({
            embeds: [embed.build(guildId, err, { color: '#ED4245', timestamp: false })],
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          await refresh();
          return;
        }

        await submit.deferUpdate().catch(() => {});
        await refresh();
        return;
      } finally {
        busy = false;
      }
    }
  });


  collector.on('end', (_, reason) => {
    busy = false;
    embed.clearPrivateInteraction(sent);
    if (!['launched', 'cancelled'].includes(reason)) {
      sent.edit({ components: [] }).catch(() => {});
    }
  });
};


function _buildModal(customId, title, inputs) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title.slice(0, 45));

  modal.addComponents(inputs.map(i =>
    new ActionRowBuilder().addComponents(i)
  ));

  return modal;
}

function _input(customId, label, style, { value, maxLength, required = true, placeholder } = {}) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 45))
    .setStyle(style)
    .setRequired(required);

  if (placeholder) input.setPlaceholder(placeholder.slice(0, 100));
  if (value != null && value !== '') input.setValue(String(value).slice(0, maxLength || 4000));
  if (maxLength) input.setMaxLength(maxLength);

  return input;
}

async function _awaitOwnModal(interaction, customId) {
  try {
    return await interaction.awaitModalSubmit({
      filter: i => i.customId === customId && i.user.id === interaction.user.id,
      time  : 5 * 60 * 1000,
    });
  } catch {
    return null;
  }
}

function _isValidUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function _isValidImageUrl(input) {
  if (!_isValidUrl(input)) return false;
  const value = input.toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp)(\?.*)?$/.test(value)) return true;
  if (
    value.includes('cdn.discordapp.com/attachments/') ||
    value.includes('media.discordapp.net/attachments/') ||
    value.includes('media.tenor.com/') ||
    value.includes('media.giphy.com/') ||
    value.includes('i.imgur.com/')
  ) return true;
  return false;
}

function _isValidButtonEmoji(input) {
  if (typeof input !== 'string') return false;
  const value = input.trim();
  if (!value) return false;
  if (/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/.test(value)) return true;
  if (_looksLikeUnicodeEmoji(value)) return true;
  return false;
}

function _looksLikeUnicodeEmoji(value) {
  const cleaned = value.replace(/\uFE0F/g, '').trim();
  if (!cleaned) return false;
  if (cleaned.length > 8) return false;
  if (/^[a-zA-Z0-9_:-]+$/.test(cleaned)) return false;
  return /\p{Extended_Pictographic}/u.test(cleaned);
}

function _extractRoleId(raw) {
  if (!raw) return null;
  const mentionMatch = raw.match(/^<@&(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];
  if (/^\d+$/.test(raw)) return raw;
  return null;
}

function _parseDuration(raw) {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    return n > 0 ? n : null;
  }
  const match = raw.match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) return null;
  const n    = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (n <= 0) return null;
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * (multipliers[unit] || 1);
}

function _hasConditions(cfg) {
  return Boolean(
    cfg.requiredRoleId ||
    cfg.deniedRoleId ||
    cfg.soutienRequired ||
    cfg.statusRequired ||
    cfg.tagRequired ||
    cfg.minLevel ||
    cfg.voiceRequired ||
    cfg.minVoiceSeconds ||
    (cfg.requiredGuildIds && cfg.requiredGuildIds.length)
  );
}

const _PRESET_KEYS = [
  'emoji', 'color', 'description', 'image', 'thumbnail', 'footer', 'entryMode',
  'requiredRoleId', 'deniedRoleId', 'soutienRequired', 'statusRequired',
  'tagRequired', 'requireBeforeStart', 'minLevel', 'voiceRequired', 'minVoiceSeconds',
  'forcedWinners', 'requiredGuildIds',
];

function _extractUserId(raw) {
  if (!raw) return null;
  const mentionMatch = raw.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];
  if (/^\d+$/.test(raw)) return raw;
  return null;
}

function _normalizePrizeKey(prize) {
  return prize.trim().toLowerCase().replace(/\s+/g, ' ');
}
