'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ComponentType,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  SeparatorBuilder,
  MessageFlags,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');
const TIMEOUTS = require('../../utils/interactionTimeouts');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? null;
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder    === 'function' &&
  typeof TextDisplayBuilder  === 'function' &&
  typeof SectionBuilder      === 'function' &&
  typeof SeparatorBuilder    === 'function'
);

function _hexToInt(hex) {
  if (typeof hex !== 'string') return 0x5865F2;
  const m = hex.replace(/^#/, '').match(/^[0-9a-fA-F]{6}$/);
  return m ? parseInt(m[0], 16) : 0x5865F2;
}

let customCommandsRuntime = null;
try { customCommandsRuntime = require('../../modules/customCommands'); } catch {}

const MAX_CUSTOMS    = 50;
const MAX_BUTTONS    = 5;
const MAX_REACTIONS  = 10;
const MAX_ROLES      = 5;
const MAX_SELECTS    = 1;
const MAX_OPTIONS    = 25;
const KEYWORD_RE     = /^[a-zA-Z0-9_-]{1,32}$/;
const VALID_MODES    = new Set(['replace', 'follow', 'ephemeral']);
const VALID_STYLES   = new Set(['primary', 'secondary', 'success', 'danger']);

const BLOCKED_KEYWORDS = new Set([
  'help', 'settings', 'ban', 'kick', 'mute', 'warn', 'clear',
  'unban', 'unmute', 'timeout', 'purge', 'nuke', 'lock', 'unlock',
  'role', 'rolemenu', 'custom', 'customlist', 'clearcustoms',
  'secur', 'antiraid', 'antiban', 'antibot', 'raidlog', 'whitelist',
  'permissions', 'perm', 'perms', 'prefix', 'color', 'embed',
  'ticket', 'eval', 'exec', 'reload', 'restart', 'shutdown',
  'components', 'delete',
]);

let customComponentsBuilder = null;
try { customComponentsBuilder = require('../../modules/customComponentsBuilder'); } catch {}

module.exports = {
  help: {
    name        : 'custom',
    description : 'Crée ou modifie une custom command.',
    use         : 'custom <mot-cle> | custom delete <mot-cle> | custom components',
    usage       : 'custom <mot-cle> | custom delete <mot-cle> | custom components',
    aliases     : ['customcmd', 'cc'],
    category    : 'configserver',
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


    if (args[0]?.toLowerCase() === 'delete') {
      return _handleDelete(message, args.slice(1), guildId, deleteReply, deleteDelay);
    }


    if (args[0]?.toLowerCase() === 'components') {
      if (!customComponentsBuilder?.openBuilder) {
        return _sendError(
          message,
          'Module builder Components V2 indisponible.',
          deleteReply, deleteDelay,
        );
      }
      return customComponentsBuilder.openBuilder(client, message, guildId);
    }


    const rawArg = args[0];
    let keyword  = rawArg?.toLowerCase();


    if (keyword?.startsWith('+')) {
      keyword = keyword.slice(1);
    }


    if (rawArg && !keyword) {
      return _sendError(
        message,
        'Mot-cle invalide. Utilisez uniquement lettres, chiffres, tiret et underscore (max 32).',
        deleteReply, deleteDelay
      );
    }

    if (!keyword) {
      const sent = await embed.reply(
        message,
        `**Custom commands**\n` +
        `\`+custom <mot-cle>\` - Crée ou modifie une commande\n` +
        `\`+custom delete <mot-cle>\` - Supprime une commande\n` +
        `\`+customlist\` - Liste les commandes\n` +
        `\`+clearcustoms\` - Supprime toutes les commandes`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }


    if (!KEYWORD_RE.test(keyword)) {
      return _sendError(
        message,
        'Mot-cle invalide. Utilisez uniquement lettres, chiffres, tiret et underscore (max 32).',
        deleteReply, deleteDelay
      );
    }

    if (_isBlocked(client, keyword)) {
      return _sendError(
        message,
        'Ce mot-cle est reserve ou correspond a une commande existante.',
        deleteReply, deleteDelay
      );
    }


    let custom = db.getCustomCommand(guildId, keyword);
    let isDraft = false;

    if (!custom) {
      const count = db.countCustomCommands(guildId);

      if (count >= MAX_CUSTOMS) {
        return _sendError(
          message,
          `Limite atteinte (${MAX_CUSTOMS} custom commands par serveur).`,
          deleteReply, deleteDelay
        );
      }

      custom = _makeDraft(guildId, keyword, message.author.id);
      isDraft = true;
    }


    await _openPanel(client, message, guildId, custom, deleteReply, deleteDelay, isDraft);
  },
};


async function _handleDelete(message, args, guildId, deleteReply, deleteDelay) {
  const keyword = args[0]?.toLowerCase();

  if (!keyword) {
    return _sendError(message, 'Precisez le mot-cle a supprimer.', deleteReply, deleteDelay);
  }

  const custom = db.getCustomCommand(guildId, keyword);

  if (!custom) {
    return _sendError(message, `Aucune custom command \`${keyword}\`.`, deleteReply, deleteDelay);
  }

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:custom:confirmdelete')
      .setLabel('Confirmer la suppression')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('local:custom:canceldelete')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
  );

  const confirmMsg = await message.reply({
    embeds: [
      embed.build(guildId, `Supprimer la custom command \`${keyword}\` ?`, { timestamp: false }),
    ],
    components      : [confirmRow],
    allowedMentions : { repliedUser: false, parse: [] },
  }).catch(() => null);

  if (!confirmMsg) return;

  embed.registerPrivateInteraction(confirmMsg, message.author.id, TIMEOUTS.CONFIRM_TIME_MS);

  try {
    const interaction = await confirmMsg.awaitMessageComponent({
      componentType : ComponentType.Button,
      filter        : i => i.user.id === message.author.id,
      time          : TIMEOUTS.CONFIRM_TIME_MS,
    });

    embed.clearPrivateInteraction(confirmMsg);

    if (interaction.customId === 'local:custom:confirmdelete') {
      db.deleteCustomCommand(guildId, keyword);

      await interaction.update({
        embeds     : [embed.build(guildId, `Custom command \`${keyword}\` supprimée.`, { timestamp: false })],
        components : [],
      }).catch(() => {});
    } else {
      await interaction.update({
        embeds     : [embed.build(guildId, 'Suppression annulée.', { timestamp: false })],
        components : [],
      }).catch(() => {});
    }
  } catch {
    embed.clearPrivateInteraction(confirmMsg);
    await confirmMsg.edit({ components: [] }).catch(() => {});
  }
}


function _makeDraft(guildId, name, createdBy) {
  return {
    guildId,
    name,
    createdBy,
    response            : '',
    embedData           : null,
    buttonsJson         : null,
    selectsJson         : null,
    reactionsJson       : null,
    rolesJson           : null,
    enabled             : 1,
    dmResponse          : 0,
    deleteMsg           : 0,
    deleteDelay         : null,
    triggerByMessage    : 1,
    requiredRoleId      : null,
    deniedRoleId        : null,
    cooldown            : 0,
    logEnabled          : 0,
    responseMode        : 'local',
    responseChannelId   : null,
    logChannelId        : null,
    targetMemberEnabled : 0,
    allowedChannelIds   : null,
    blockedChannelIds   : null,
    customPerm          : 'everyone',
    description         : null,
    _isDraft            : true,
  };
}

function _persistDraft(custom) {
  db.createCustomCommand(custom.guildId, custom.name, custom.createdBy);

  const toggleFields = [
    'enabled', 'dmResponse', 'deleteMsg', 'triggerByMessage',
    'logEnabled', 'targetMemberEnabled',
  ];
  for (const field of toggleFields) {
    const value = custom[field];
    if (value === undefined || value === null) continue;
    db.updateCustomCommandField(custom.guildId, custom.name, field, value ? 1 : 0);
  }

  const stringFields = ['responseMode', 'responseChannelId', 'logChannelId', 'allowedChannelIds', 'blockedChannelIds', 'customPerm', 'description'];
  for (const field of stringFields) {
    const value = custom[field];
    if (value === undefined) continue;
    db.updateCustomCommandField(custom.guildId, custom.name, field, value || null);
  }

  custom._isDraft = false;
}

async function _openPanel(client, message, guildId, custom, deleteReply, deleteDelay, isDraft = false) {
  const payload = _buildPanelPayload(guildId, custom, message.guild);
  const panel = await message.channel.send(payload).catch(err => {
    console.error('[+custom] panel send failed:', err?.code || err?.message || err);
    return null;
  });

  if (!panel) {
    return _sendError(message, 'Impossible d\'ouvrir le panel.', deleteReply, deleteDelay);
  }

  embed.registerPrivateInteraction(panel, message.author.id, 5_400_000);

  let busy = false;

  const collector = panel.createMessageComponentCollector({
    filter : i =>
      i.user.id === message.author.id &&
      i.message.id === panel.id,
    idle : 5_400_000,
    time : 5_400_000,
  });

  collector.on('collect', async interaction => {
    const id = interaction.customId;

    if (busy) {
      return _ephemeral(interaction, guildId, 'Une modification est déjà en cours.');
    }


    if (id === 'local:custom:close') {
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);
      await interaction.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      await message.delete().catch(() => {});
      return;
    }

    if (id === 'local:custom:btn:edit') {
      return _openButtonsModal(interaction, panel, guildId, custom);
    }
    if (id === 'local:custom:btn:clear') {
      return _clearButtons(interaction, panel, guildId, custom);
    }
    if (id === 'local:custom:btn:preview') {
      return _handlePreview(interaction, guildId, custom);
    }
    if (id === 'local:custom:btn:back') {
      await interaction.deferUpdate().catch(() => {});
      return _refresh(panel, guildId, custom);
    }

    if (id === 'local:custom:sel:edit') {
      return _openSelectsModal(interaction, panel, guildId, custom);
    }
    if (id === 'local:custom:sel:clear') {
      return _clearSelects(interaction, panel, guildId, custom);
    }
    if (id === 'local:custom:sel:preview') {
      return _handlePreview(interaction, guildId, custom);
    }
    if (id === 'local:custom:sel:back') {
      await interaction.deferUpdate().catch(() => {});
      return _refresh(panel, guildId, custom);
    }

    if (id === 'local:custom:preview') {
      return _handlePreview(interaction, guildId, custom);
    }

    if (id === 'local:custom:toggle') {
      custom.enabled = custom.enabled ? 0 : 1;
      if (!custom._isDraft) {
        db.updateCustomCommandField(guildId, custom.name, 'enabled', custom.enabled);
      }
      await interaction.deferUpdate().catch(() => {});
      return _refresh(panel, guildId, custom);
    }

    if (id === 'local:custom:delete') {
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);

      if (custom._isDraft) {
        await interaction.deferUpdate().catch(() => {});
        await panel.delete().catch(() => {});
        return;
      }

      await interaction.update(_buildConfirmDeletePayload(guildId, custom.name)).catch(() => {});

      try {
        const confirm = await panel.awaitMessageComponent({
          componentType : ComponentType.Button,
          filter        : i => i.user.id === message.author.id,
          time          : 15_000,
        });

        if (confirm.customId === 'local:custom:confirmdelete2') {
          db.deleteCustomCommand(guildId, custom.name);
          await confirm.update(
            _buildClosedPayload(guildId, `Custom command \`${custom.name}\` supprimée.`),
          ).catch(() => {});
        } else {
          await confirm.update(
            _buildClosedPayload(guildId, 'Suppression annulée.'),
          ).catch(() => {});
        }
      } catch {
        await panel.edit(
          _buildClosedPayload(guildId, 'Confirmation expirée.'),
        ).catch(() => {});
      }
      return;
    }


    if (id === 'local:custom:set:keyword') {
      return _handleRenameKeyword(interaction, panel, guildId, custom, client);
    }

    if (id === 'local:custom:set:response') {
      return _handleResponse(interaction, panel, guildId, custom);
    }

    if (id === 'local:custom:mode:local') {
      return _setResponseMode(interaction, panel, guildId, custom, 'local');
    }
    if (id === 'local:custom:mode:dm') {
      return _setResponseMode(interaction, panel, guildId, custom, 'dm');
    }
    if (id === 'local:custom:mode:fixed') {
      return _setResponseMode(interaction, panel, guildId, custom, 'fixed');
    }
    if (id === 'local:custom:mode:remote') {
      return _setResponseMode(interaction, panel, guildId, custom, 'remote');
    }

    if (id === 'local:custom:select:respchan') {
      return _setResponseChannel(interaction, panel, guildId, custom);
    }
    if (id === 'local:custom:select:logchan') {
      return _setLogChannel(interaction, panel, guildId, custom);
    }

    if (id === 'local:custom:select:allowedchans') {
      return _setAllowedChannels(interaction, panel, guildId, custom);
    }
    if (id === 'local:custom:select:blockedchans') {
      return _setBlockedChannels(interaction, panel, guildId, custom);
    }

    if (id === 'local:custom:set:target') {
      return _handleToggleField(interaction, panel, guildId, custom, 'targetMemberEnabled', 'Cibler un autre membre');
    }
    if (id === 'local:custom:set:trigger') {
      return _handleToggleField(interaction, panel, guildId, custom, 'triggerByMessage', 'Déclenchement par messages');
    }
    if (id === 'local:custom:set:delcmd') {
      return _handleToggleField(interaction, panel, guildId, custom, 'deleteMsg', 'Supprimer la commande');
    }
    if (id === 'local:custom:set:delresp') {
      return _handleDeleteDelay(interaction, panel, guildId, custom);
    }


    if (id === 'local:custom:params') {
      const selected = interaction.values?.[0];
      if (!selected) { await interaction.deferUpdate().catch(() => {}); return; }

      if (selected === 'response') {
        return _handleResponse(interaction, panel, guildId, custom, message);
      }
      if (selected === 'dm') {
        return _handleToggleField(interaction, panel, guildId, custom, 'dmResponse', 'Réponse en MP');
      }
      if (selected === 'delete_cmd') {
        return _handleToggleField(interaction, panel, guildId, custom, 'deleteMsg', 'Supprimer la commande');
      }
      if (selected === 'required_role') {
        return _handleRoleField(interaction, panel, guildId, custom, 'requiredRoleId', 'Rôle requis (ID ou vide)');
      }
      if (selected === 'denied_role') {
        return _handleRoleField(interaction, panel, guildId, custom, 'deniedRoleId', 'Rôle interdit (ID ou vide)');
      }
      if (selected === 'cooldown') {
        return _handleCooldown(interaction, panel, guildId, custom);
      }
      if (selected === 'log') {
        return _handleToggleField(interaction, panel, guildId, custom, 'logEnabled', 'Log a chaque utilisation');
      }
      if (selected === 'trigger_msg') {
        return _handleToggleField(interaction, panel, guildId, custom, 'triggerByMessage', 'Declenchee par messages');
      }
      if (selected === 'delete_response') {
        return _handleDeleteDelay(interaction, panel, guildId, custom);
      }

      await interaction.deferUpdate().catch(() => {});
      return;
    }


    if (id === 'local:custom:modules') {
      const selected = interaction.values?.[0];
      if (!selected) { await interaction.deferUpdate().catch(() => {}); return; }


      if (custom.componentsJson && ['message', 'embed', 'buttons', 'selects'].includes(selected)) {
        return _ephemeral(
          interaction, guildId,
          'Components V2 actif sur cette custom : Message/Embed/Boutons/Sélecteur sont désactivés. Retirez d\'abord les Components V2 via le module dédié.',
        );
      }

      if (selected === 'message') {
        return _handleResponse(interaction, panel, guildId, custom);
      }
      if (selected === 'embed') {
        return _handleEmbed(interaction, panel, guildId, custom);
      }
      if (selected === 'buttons') {
        return _handleButtons(interaction, panel, guildId, custom);
      }
      if (selected === 'reactions') {
        return _handleReactions(interaction, panel, guildId, custom);
      }
      if (selected === 'roles') {
        return _handleRoles(interaction, panel, guildId, custom, message);
      }
      if (selected === 'selects') {
        return _handleSelects(interaction, panel, guildId, custom);
      }
      if (selected === 'cooldown') {
        return _handleCooldown(interaction, panel, guildId, custom);
      }
      if (selected === 'rolereq') {
        return _handleRoleField(interaction, panel, guildId, custom, 'requiredRoleId', 'Rôle requis (ID ou vide)');
      }
      if (selected === 'roleden') {
        return _handleRoleField(interaction, panel, guildId, custom, 'deniedRoleId', 'Rôle interdit (ID ou vide)');
      }
      if (selected === 'components') {
        return _handleComponentsModule(interaction, panel, guildId, custom);
      }
      if (selected === 'permission') {
        return _handleCustomPerm(interaction, panel, guildId, custom);
      }
      if (selected === 'description') {
        return _handleDescription(interaction, panel, guildId, custom);
      }
      if (selected === 'restrictions') {
        return _handleRestrictions(interaction, panel, guildId, custom);
      }

      await interaction.deferUpdate().catch(() => {});
      return;
    }

    await interaction.deferUpdate().catch(() => {});
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(panel);
    if (reason === 'closed') return;
    panel.edit(_buildClosedPayload(guildId, 'Session expirée, relance la commande pour reprendre.')).catch(() => {});
  });


  async function _handleResponse(interaction, pnl, gId, cc) {
    busy = true;

    const modalId = `local:cc:resp:${interaction.id}`;
    const shown = await interaction.showModal(
      _buildModal(modalId, 'Réponse', [
        _input('content', 'Contenu', TextInputStyle.Paragraph, {
          value     : cc.response || '',
          required  : false,
          maxLength : 2000,
          placeholder : '{user} {username} {server} {channel} {membercount}',
        }),
      ])
    ).then(() => true).catch(() => false);

    busy = false;
    if (!shown) return;

    const submit = await _awaitModal(interaction, modalId);
    if (!submit) return _refresh(pnl, gId, cc);

    busy = true;
    const content = submit.fields.getTextInputValue('content').trim();


    if (cc._isDraft && !content) {
      cc.response = '';
      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(pnl, gId, cc);
    }

    if (cc._isDraft) _persistDraft(cc);
    db.updateCustomCommandField(gId, cc.name, 'response', content);
    cc.response = content;

    await submit.deferUpdate().catch(() => {});
    busy = false;
    return _refresh(pnl, gId, cc);
  }

  async function _setBoolField(interaction, pnl, gId, cc, field, value) {
    const next = value ? 1 : 0;
    if (Number(cc[field] ? 1 : 0) === next) {
      await interaction.deferUpdate().catch(() => {});
      return _refresh(pnl, gId, cc);
    }

    if (cc._isDraft) {
      cc[field] = next;
      await interaction.deferUpdate().catch(() => {});
      return _refresh(pnl, gId, cc);
    }

    db.updateCustomCommandField(gId, cc.name, field, next);
    cc[field] = next;

    await interaction.deferUpdate().catch(() => {});
    return _refresh(pnl, gId, cc);
  }

  async function _setResponseMode(interaction, pnl, gId, cc, newMode) {
    if (!['local', 'dm', 'fixed', 'remote'].includes(newMode)) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    const current = String(cc.responseMode || (cc.dmResponse ? 'dm' : 'local'));
    if (current === newMode) {
      await interaction.deferUpdate().catch(() => {});
      return _refresh(pnl, gId, cc);
    }

    if (cc._isDraft) {
      cc.responseMode = newMode;
      cc.dmResponse   = newMode === 'dm' ? 1 : 0;
      await interaction.deferUpdate().catch(() => {});
      _warnResponseModeChannel(interaction, gId, cc, newMode);
      return _refresh(pnl, gId, cc);
    }

    db.updateCustomCommandField(gId, cc.name, 'responseMode', newMode);
    db.updateCustomCommandField(gId, cc.name, 'dmResponse', newMode === 'dm' ? 1 : 0);
    cc.responseMode = newMode;
    cc.dmResponse   = newMode === 'dm' ? 1 : 0;

    await interaction.deferUpdate().catch(() => {});
    _warnResponseModeChannel(interaction, gId, cc, newMode);
    return _refresh(pnl, gId, cc);
  }


  function _warnResponseModeChannel(interaction, gId, cc, newMode) {
    if ((newMode !== 'fixed' && newMode !== 'remote') || cc.responseChannelId) return;
    interaction.followUp({
      embeds : [embed.build(gId,
        'Aucun salon de réponse sélectionné. Choisissez-en un ci-dessous, sinon la réponse sera envoyée dans le salon courant.',
        { color: '#FAA61A', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  }

  async function _setResponseChannel(interaction, pnl, gId, cc) {
    const value = interaction.values?.[0] || null;

    if (cc._isDraft) {
      cc.responseChannelId = value;
      await interaction.deferUpdate().catch(() => {});
      return _refresh(pnl, gId, cc);
    }

    db.updateCustomCommandField(gId, cc.name, 'responseChannelId', value);
    cc.responseChannelId = value;

    await interaction.deferUpdate().catch(() => {});
    return _refresh(pnl, gId, cc);
  }

  async function _setAllowedChannels(interaction, pnl, gId, cc) {
    const values = interaction.values || [];
    const json   = values.length > 0 ? JSON.stringify(values) : null;

    if (cc._isDraft) {
      cc.allowedChannelIds = json;
      await interaction.deferUpdate().catch(() => {});
      return _refresh(pnl, gId, cc);
    }

    db.updateCustomCommandField(gId, cc.name, 'allowedChannelIds', json);
    cc.allowedChannelIds = json;

    await interaction.deferUpdate().catch(() => {});
    return _refresh(pnl, gId, cc);
  }

  async function _setBlockedChannels(interaction, pnl, gId, cc) {
    const values = interaction.values || [];
    const json   = values.length > 0 ? JSON.stringify(values) : null;

    if (cc._isDraft) {
      cc.blockedChannelIds = json;
      await interaction.deferUpdate().catch(() => {});
      return _refresh(pnl, gId, cc);
    }

    db.updateCustomCommandField(gId, cc.name, 'blockedChannelIds', json);
    cc.blockedChannelIds = json;

    await interaction.deferUpdate().catch(() => {});
    return _refresh(pnl, gId, cc);
  }

  async function _setLogChannel(interaction, pnl, gId, cc) {
    const value = interaction.values?.[0] || null;

    if (cc._isDraft) {
      cc.logChannelId = value;
      if (value) cc.logEnabled = 1;
      await interaction.deferUpdate().catch(() => {});
      return _refresh(pnl, gId, cc);
    }

    db.updateCustomCommandField(gId, cc.name, 'logChannelId', value);
    cc.logChannelId = value;
    if (value) {
      db.updateCustomCommandField(gId, cc.name, 'logEnabled', 1);
      cc.logEnabled = 1;
    }

    await interaction.deferUpdate().catch(() => {});
    return _refresh(pnl, gId, cc);
  }

  async function _handleRenameKeyword(interaction, pnl, gId, cc, clientRef) {
    if (cc._isDraft) {
      return _ephemeral(
        interaction, gId,
        'Validez d\'abord la création (un module ou la réponse), puis vous pourrez renommer le mot-clé.',
      );
    }

    busy = true;
    const modalId = `local:cc:rename:${interaction.id}`;
    const shown = await interaction.showModal(
      _buildModal(modalId, 'Renommer le mot-cle', [
        _input('keyword', 'Nouveau mot-cle', TextInputStyle.Short, {
          value     : cc.name,
          required  : true,
          maxLength : 32,
        }),
      ]),
    ).then(() => true).catch(() => false);

    busy = false;
    if (!shown) return;

    const submit = await _awaitModal(interaction, modalId);
    if (!submit) return _refresh(pnl, gId, cc);

    busy = true;
    const newName = String(submit.fields.getTextInputValue('keyword') || '').toLowerCase().trim();

    if (!newName) {
      busy = false;
      return _modalError(submit, gId, 'Mot-clé requis.');
    }
    if (newName === cc.name) {
      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(pnl, gId, cc);
    }
    if (!KEYWORD_RE.test(newName)) {
      busy = false;
      return _modalError(submit, gId, 'Mot-clé invalide. Lettres, chiffres, tiret, underscore (max 32).');
    }
    if (_isBlocked(clientRef, newName)) {
      busy = false;
      return _modalError(submit, gId, 'Ce mot-clé est réservé ou correspond à une commande existante.');
    }

    const result = db.renameCustomCommand(gId, cc.name, newName);
    if (!result.ok) {
      const reasonText = {
        same    : 'Identique au mot-clé actuel.',
        exists  : 'Une autre custom utilise déjà ce mot-clé.',
        missing : 'Custom introuvable, rechargez le panel.',
      }[result.reason] || 'Échec du renommage.';
      busy = false;
      return _modalError(submit, gId, reasonText);
    }

    const hadComponents = !!(cc.buttonsJson || cc.selectsJson || cc.componentsJson);
    cc.name = newName;
    await submit.deferUpdate().catch(() => {});

    if (hadComponents) {
      await submit.followUp({
        embeds: [embed.build(gId,
          'Custom renommée.\n' +
          '⚠️ Les anciens messages contenant des boutons ou menus liés à cette custom doivent être renvoyés, ' +
          'car leurs composants utilisent encore l\'ancien nom.',
          { color: '#FAA61A', timestamp: false }
        )],
        flags: 64,
      }).catch(() => {});
    }

    busy = false;
    return _refresh(pnl, gId, cc);
  }

  async function _handleToggleField(interaction, pnl, gId, cc, field, label) {
    const current = cc[field] ? 1 : 0;
    const next = current ? 0 : 1;


    if (cc._isDraft) {
      cc[field] = next;
      await interaction.deferUpdate().catch(() => {});
      return _refresh(pnl, gId, cc);
    }

    db.updateCustomCommandField(gId, cc.name, field, next);
    cc[field] = next;

    await interaction.deferUpdate().catch(() => {});
    return _refresh(pnl, gId, cc);
  }

  async function _handleRoleField(interaction, pnl, gId, cc, field, title) {
    busy = true;

    const modalId = `local:cc:${field}:${interaction.id}`;
    const shown = await interaction.showModal(
      _buildModal(modalId, title, [
        _input('value', 'ID du role (vide pour retirer)', TextInputStyle.Short, {
          value     : cc[field] || '',
          required  : false,
          maxLength : 25,
          placeholder : 'ID du role ou vide',
        }),
      ])
    ).then(() => true).catch(() => false);

    busy = false;
    if (!shown) return;

    const submit = await _awaitModal(interaction, modalId);
    if (!submit) return _refresh(pnl, gId, cc);

    busy = true;
    const raw = submit.fields.getTextInputValue('value').trim().replace(/[<@&>]/g, '');
    const value = /^\d{17,20}$/.test(raw) ? raw : null;


    if (cc._isDraft && !value) {
      cc[field] = null;
      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(pnl, gId, cc);
    }

    if (cc._isDraft) _persistDraft(cc);
    db.updateCustomCommandField(gId, cc.name, field, value);
    cc[field] = value;

    await submit.deferUpdate().catch(() => {});
    busy = false;
    return _refresh(pnl, gId, cc);
  }

  async function _handleComponentsModule(interaction, pnl, gId, cc) {
    if (cc._isDraft) {
      return _ephemeral(
        interaction, gId,
        'Validez d\'abord la création (un module ou la réponse), puis vous pourrez gérer les Components V2.',
      );
    }

    if (!cc.componentsJson) {
      return _ephemeral(
        interaction, gId,
        `Aucun Components V2 lié. Utilisez \`+custom components\` pour ouvrir le builder, puis cliquez \`Lier à une custom\` et entrez \`${cc.name}\`.`,
      );
    }

    let count = 0;
    try { count = (JSON.parse(cc.componentsJson) || []).length; } catch {}

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:custom:cc_clear')
        .setLabel('Retirer les components')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('local:custom:cc_keep')
        .setLabel('Garder')
        .setStyle(ButtonStyle.Secondary),
    );

    let response;
    try {
      response = await interaction.reply({
        embeds : [embed.build(
          gId,
          `**Components V2** liés à \`+${cc.name}\` (${count} component(s)).\n` +
          `Tant qu'ils sont actifs, les modules Message/Embed/Boutons/Sélecteur sont **désactivés**.\n` +
          `Pour modifier, utilisez \`+custom components\` puis re-lier à \`${cc.name}\`.`,
          { timestamp: false },
        )],
        components  : [confirmRow],
        flags       : 64,
        withResponse: true,
      });
    } catch {
      return;
    }

    const followMsg = response?.resource?.message;
    if (!followMsg) return;

    let confirm;
    try {
      confirm = await followMsg.awaitMessageComponent({
        componentType : ComponentType.Button,
        filter        : i => i.user.id === interaction.user.id,
        time          : TIMEOUTS.CONFIRM_TIME_MS,
      });
    } catch {
      return;
    }

    if (confirm.customId === 'local:custom:cc_clear') {
      db.updateCustomCommandField(gId, cc.name, 'componentsJson', null);
      cc.componentsJson = null;
      await confirm.update({
        embeds     : [embed.build(gId, 'Components V2 retirés. Le runtime classique est restauré.', { timestamp: false })],
        components : [],
      }).catch(() => {});
      return _refresh(pnl, gId, cc);
    }

    await confirm.update({
      embeds     : [embed.build(gId, 'Components V2 conservés.', { timestamp: false })],
      components : [],
    }).catch(() => {});
  }

  async function _handleCooldown(interaction, pnl, gId, cc) {
    busy = true;

    const modalId = `local:cc:cd:${interaction.id}`;
    const shown = await interaction.showModal(
      _buildModal(modalId, 'Cooldown', [
        _input('cooldown', 'Cooldown en secondes (0 = aucun)', TextInputStyle.Short, {
          value     : String(cc.cooldown || 0),
          required  : true,
          maxLength : 6,
          placeholder : '0, 10, 60, 3600...',
        }),
      ])
    ).then(() => true).catch(() => false);

    busy = false;
    if (!shown) return;

    const submit = await _awaitModal(interaction, modalId);
    if (!submit) return _refresh(pnl, gId, cc);

    busy = true;
    const raw = submit.fields.getTextInputValue('cooldown').trim();
    const cooldown = Math.max(0, Math.min(86400, Number(raw) || 0));


    if (cc._isDraft && cooldown === 0) {
      cc.cooldown = 0;
      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(pnl, gId, cc);
    }

    if (cc._isDraft) _persistDraft(cc);
    db.updateCustomCommandField(gId, cc.name, 'cooldown', cooldown);
    cc.cooldown = cooldown;

    await submit.deferUpdate().catch(() => {});
    busy = false;
    return _refresh(pnl, gId, cc);
  }

  async function _handleDeleteDelay(interaction, pnl, gId, cc) {
    busy = true;

    const modalId = `local:cc:delresp:${interaction.id}`;
    const shown = await interaction.showModal(
      _buildModal(modalId, 'Supprimer la réponse', [
        _input('delay', 'Délai en secondes (0 = non)', TextInputStyle.Short, {
          value     : String(cc.deleteDelay || 0),
          required  : true,
          maxLength : 4,
          placeholder : '0 = pas de suppression, max 300',
        }),
      ])
    ).then(() => true).catch(() => false);

    busy = false;
    if (!shown) return;

    const submit = await _awaitModal(interaction, modalId);
    if (!submit) return _refresh(pnl, gId, cc);

    busy = true;
    const raw = submit.fields.getTextInputValue('delay').trim();
    const delay = Math.max(0, Math.min(300, Number(raw) || 0));


    if (cc._isDraft && delay === 0) {
      cc.deleteDelay = null;
      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(pnl, gId, cc);
    }

    if (cc._isDraft) _persistDraft(cc);
    db.updateCustomCommandField(gId, cc.name, 'deleteDelay', delay || null);
    cc.deleteDelay = delay || null;

    await submit.deferUpdate().catch(() => {});
    busy = false;
    return _refresh(pnl, gId, cc);
  }

  async function _handleEmbed(interaction, pnl, gId, cc) {
    busy = true;

    let embedObj = {};
    try { embedObj = JSON.parse(cc.embedData || '{}'); } catch {}

    const modalId = `local:cc:embed:${interaction.id}`;
    const shown = await interaction.showModal(
      _buildModal(modalId, 'Embed', [
        _input('title', 'Titre', TextInputStyle.Short, {
          value     : embedObj.title || '',
          required  : false,
          maxLength : 256,
        }),
        _input('description', 'Description', TextInputStyle.Paragraph, {
          value     : embedObj.description || '',
          required  : false,
          maxLength : 4000,
        }),
        _input('color', 'Couleur (#hex)', TextInputStyle.Short, {
          value     : _colorToHex(embedObj.color) || '',
          required  : false,
          maxLength : 7,
          placeholder : '#FF0000',
        }),
        _input('image', 'Image (URL)', TextInputStyle.Short, {
          value     : embedObj.image?.url || '',
          required  : false,
          maxLength : 500,
        }),
        _input('footer', 'Footer', TextInputStyle.Short, {
          value     : embedObj.footer?.text || '',
          required  : false,
          maxLength : 256,
        }),
      ])
    ).then(() => true).catch(() => false);

    busy = false;
    if (!shown) return;

    const submit = await _awaitModal(interaction, modalId);
    if (!submit) return _refresh(pnl, gId, cc);

    busy = true;

    const title       = submit.fields.getTextInputValue('title').trim();
    const description = submit.fields.getTextInputValue('description').trim();
    const color       = submit.fields.getTextInputValue('color').trim();
    const image       = submit.fields.getTextInputValue('image').trim();
    const footer      = submit.fields.getTextInputValue('footer').trim();


    if (cc._isDraft && !title && !description) {
      cc.embedData = null;
      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(pnl, gId, cc);
    }

    if (cc._isDraft) _persistDraft(cc);
    if (!title && !description) {
      db.updateCustomCommandField(gId, cc.name, 'embedData', null);
      cc.embedData = null;
    } else {
      const data = {};
      if (title)       data.title       = title;
      if (description) data.description = description;
      if (color && /^#?[0-9a-f]{6}$/i.test(color)) {
        data.color = parseInt(color.replace('#', ''), 16);
      }
      if (image && /^https?:\/\/.+/i.test(image)) data.image = { url: image };
      if (footer)      data.footer      = { text: footer };

      const json = JSON.stringify(data);
      db.updateCustomCommandField(gId, cc.name, 'embedData', json);
      cc.embedData = json;
    }

    await submit.deferUpdate().catch(() => {});
    busy = false;
    return _refresh(pnl, gId, cc);
  }

  async function _handleButtons(interaction, pnl, gId, cc) {
    return _renderButtonsView(interaction, pnl, gId, cc);
  }

  async function _renderButtonsView(interaction, pnl, gId, cc) {
    await interaction.update(_buildButtonsPayload(gId, cc)).catch(() => {});
  }

  async function _openButtonsModal(interaction, pnl, gId, cc) {
    busy = true;

    let existing = [];
    try { existing = JSON.parse(cc.buttonsJson || '[]'); } catch {}

    const display = existing.map(b => {
      if (!b) return '';
      const type = b.type || (b.url ? 'link' : null);
      if (type === 'link' && b.url) return `${b.label} | ${b.url}`;
      if (type === 'custom' && b.target && b.mode) {
        const tail = b.style ? ` | ${b.style}` : '';
        return `${b.label} | custom:${b.target} | ${b.mode}${tail}`;
      }
      return '';
    }).filter(Boolean).join('\n');

    const modalId = `local:cc:btn:${interaction.id}`;
    const shown = await interaction.showModal(
      _buildModal(modalId, 'Boutons (lien + action)', [
        _input('buttons', 'Une ligne par bouton', TextInputStyle.Paragraph, {
          value     : display,
          required  : false,
          maxLength : 2000,
          placeholder : 'Site | https://example.com\nValider | custom:test | follow',
        }),
      ])
    ).then(() => true).catch(() => false);

    busy = false;
    if (!shown) return;

    const submit = await _awaitModal(interaction, modalId);
    if (!submit) return _renderButtonsView_afterModal(pnl, gId, cc);

    busy = true;

    const raw = submit.fields.getTextInputValue('buttons').trim();
    const parsed = raw ? _parseButtonsLines(raw) : { valid: [], ignored: 0, truncated: 0 };
    const isExplicitReset = !raw;

    if (cc._isDraft && parsed.valid.length === 0 && isExplicitReset) {
      cc.buttonsJson = null;
      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _renderButtonsView_afterModal(pnl, gId, cc);
    }

    if (parsed.valid.length === 0 && !isExplicitReset) {

      await _modalError(submit, gId, 'Aucune ligne valide. Configuration inchangee.');
      busy = false;
      return _renderButtonsView_afterModal(pnl, gId, cc);
    }

    if (cc._isDraft) _persistDraft(cc);

    if (parsed.valid.length === 0) {
      db.updateCustomCommandField(gId, cc.name, 'buttonsJson', null);
      cc.buttonsJson = null;
    } else {
      const json = JSON.stringify(parsed.valid);
      db.updateCustomCommandField(gId, cc.name, 'buttonsJson', json);
      cc.buttonsJson = json;
    }

    const report = _buildParseReport(parsed);
    if (report) {
      await submit.reply({
        embeds : [embed.build(gId, `Configuration enregistree. ${report}`, { color: '#FAA61A', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
    } else {
      await submit.deferUpdate().catch(() => {});
    }

    busy = false;
    return _renderButtonsView_afterModal(pnl, gId, cc);
  }

  async function _renderButtonsView_afterModal(pnl, gId, cc) {
    if (!cc._isDraft) {
      const fresh = db.getCustomCommand(gId, cc.name);
      if (fresh) Object.assign(cc, fresh);
    }
    return pnl.edit(_buildButtonsPayload(gId, cc)).catch(() => {});
  }

  async function _clearButtons(interaction, pnl, gId, cc) {
    if (!cc.buttonsJson) {
      return _ephemeral(interaction, gId, 'Aucun bouton a retirer.');
    }

    if (cc._isDraft) _persistDraft(cc);
    db.updateCustomCommandField(gId, cc.name, 'buttonsJson', null);
    cc.buttonsJson = null;

    await interaction.update(_buildButtonsPayload(gId, cc)).catch(() => {});
  }

  async function _handleSelects(interaction, pnl, gId, cc) {
    return _renderSelectsView(interaction, pnl, gId, cc);
  }

  async function _renderSelectsView(interaction, pnl, gId, cc) {
    await interaction.update(_buildSelectsPayload(gId, cc)).catch(() => {});
  }

  async function _openSelectsModal(interaction, pnl, gId, cc) {
    busy = true;

    let existing = [];
    try { existing = JSON.parse(cc.selectsJson || '[]'); } catch {}

    const first = Array.isArray(existing) && existing[0] ? existing[0] : null;

    const placeholderValue = first?.placeholder || '';
    const optionsDisplay = first?.options
      ? first.options
        .filter(o => o && o.label && o.target && o.mode)
        .map(o => `${o.label} | custom:${o.target} | ${o.mode}`)
        .join('\n')
      : '';

    const modalId = `local:cc:sel:${interaction.id}`;
    const shown = await interaction.showModal(
      _buildModal(modalId, 'Selecteur action', [
        _input('placeholder', 'Texte du menu', TextInputStyle.Short, {
          value     : placeholderValue,
          required  : false,
          maxLength : 100,
          placeholder : 'Choisir une action',
        }),
        _input('options', 'Options', TextInputStyle.Paragraph, {
          value     : optionsDisplay,
          required  : false,
          maxLength : 2000,
          placeholder : 'Voir | custom:profil | follow\nAcheter | custom:shop | ephemeral',
        }),
      ])
    ).then(() => true).catch(() => false);

    busy = false;
    if (!shown) return;

    const submit = await _awaitModal(interaction, modalId);
    if (!submit) return _renderSelectsView_afterModal(pnl, gId, cc);

    busy = true;

    const placeholder = submit.fields.getTextInputValue('placeholder').trim();
    const rawOptions  = submit.fields.getTextInputValue('options').trim();
    const isExplicitReset = !rawOptions;

    const parsed = rawOptions ? _parseSelectOptionsLines(rawOptions) : { valid: [], ignored: 0, truncated: 0 };

    if (cc._isDraft && parsed.valid.length === 0 && isExplicitReset) {
      cc.selectsJson = null;
      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _renderSelectsView_afterModal(pnl, gId, cc);
    }

    if (parsed.valid.length === 0 && !isExplicitReset) {
      await _modalError(submit, gId, 'Aucune option valide. Configuration inchangee.');
      busy = false;
      return _renderSelectsView_afterModal(pnl, gId, cc);
    }

    if (cc._isDraft) _persistDraft(cc);

    if (parsed.valid.length === 0) {
      db.updateCustomCommandField(gId, cc.name, 'selectsJson', null);
      cc.selectsJson = null;
    } else {
      const select = {
        placeholder: placeholder || 'Choisir une action',
        minValues  : 1,
        maxValues  : 1,
        options    : parsed.valid,
      };
      const json = JSON.stringify([select]);
      db.updateCustomCommandField(gId, cc.name, 'selectsJson', json);
      cc.selectsJson = json;
    }

    const report = _buildParseReport(parsed);
    if (report) {
      await submit.reply({
        embeds : [embed.build(gId, `Configuration enregistree. ${report}`, { color: '#FAA61A', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
    } else {
      await submit.deferUpdate().catch(() => {});
    }

    busy = false;
    return _renderSelectsView_afterModal(pnl, gId, cc);
  }

  async function _renderSelectsView_afterModal(pnl, gId, cc) {
    if (!cc._isDraft) {
      const fresh = db.getCustomCommand(gId, cc.name);
      if (fresh) Object.assign(cc, fresh);
    }
    return pnl.edit(_buildSelectsPayload(gId, cc)).catch(() => {});
  }

  async function _clearSelects(interaction, pnl, gId, cc) {
    if (!cc.selectsJson) {
      return _ephemeral(interaction, gId, 'Aucun selecteur a retirer.');
    }

    if (cc._isDraft) _persistDraft(cc);
    db.updateCustomCommandField(gId, cc.name, 'selectsJson', null);
    cc.selectsJson = null;

    await interaction.update(_buildSelectsPayload(gId, cc)).catch(() => {});
  }

  async function _handlePreview(interaction, gId, cc) {
    let preview;
    try {
      preview = customCommandsRuntime?.buildPreviewPayload?.(
        cc,
        {
          author : interaction.user,
          member : interaction.member,
          guild  : interaction.guild,
          channel: interaction.channel,
        },
        gId
      );
    } catch {
      preview = null;
    }

    if (!preview) {
      return _ephemeral(interaction, gId, 'Rien a previsualiser.');
    }

    preview.allowedMentions = { parse: [] };


    await interaction.deferUpdate().catch(() => {});

    try {
      await interaction.channel.send(preview);
    } catch {

      await interaction.followUp({
        embeds : [embed.build(gId, 'Impossible d\'afficher l\'apercu ici.', { color: '#ED4245', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
    }
  }

  async function _handleReactions(interaction, pnl, gId, cc) {
    busy = true;

    let existing = [];
    try { existing = JSON.parse(cc.reactionsJson || '[]'); } catch {}

    const modalId = `local:cc:react:${interaction.id}`;
    const shown = await interaction.showModal(
      _buildModal(modalId, 'Reactions', [
        _input('reactions', 'Emojis separes par espace', TextInputStyle.Paragraph, {
          value     : existing.join(' '),
          required  : false,
          maxLength : 500,
          placeholder : '\uD83D\uDC4D \uD83D\uDC4E \uD83C\uDF89',
        }),
      ])
    ).then(() => true).catch(() => false);

    busy = false;
    if (!shown) return;

    const submit = await _awaitModal(interaction, modalId);
    if (!submit) return _refresh(pnl, gId, cc);

    busy = true;

    const raw = submit.fields.getTextInputValue('reactions').trim();
    const emojis = raw ? raw.split(/\s+/).filter(Boolean).slice(0, MAX_REACTIONS) : [];


    if (cc._isDraft && emojis.length === 0) {
      cc.reactionsJson = null;
      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(pnl, gId, cc);
    }

    if (cc._isDraft) _persistDraft(cc);
    if (emojis.length === 0) {
      db.updateCustomCommandField(gId, cc.name, 'reactionsJson', null);
      cc.reactionsJson = null;
    } else {
      const json = JSON.stringify(emojis);
      db.updateCustomCommandField(gId, cc.name, 'reactionsJson', json);
      cc.reactionsJson = json;
    }

    await submit.deferUpdate().catch(() => {});
    busy = false;
    return _refresh(pnl, gId, cc);
  }

  async function _handleRoles(interaction, pnl, gId, cc) {
    busy = true;

    let existing = [];
    try { existing = JSON.parse(cc.rolesJson || '[]'); } catch {}

    const display = existing.map(r => `${r.roleId} ${r.action}`).join('\n');

    const modalId = `local:cc:roles:${interaction.id}`;
    const shown = await interaction.showModal(
      _buildModal(modalId, 'Roles', [
        _input('roles', 'Un par ligne : ID action', TextInputStyle.Paragraph, {
          value     : display,
          required  : false,
          maxLength : 1000,
          placeholder : '123456789012345678 add\n123456789012345679 toggle',
        }),
      ])
    ).then(() => true).catch(() => false);

    busy = false;
    if (!shown) return;

    const submit = await _awaitModal(interaction, modalId);
    if (!submit) return _refresh(pnl, gId, cc);

    busy = true;

    const raw = submit.fields.getTextInputValue('roles').trim();

    const roles  = [];
    const errors = [];

    if (raw) {
      const guild = message.guild;
      const me    = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

      for (const line of raw.split('\n').slice(0, MAX_ROLES)) {
        const parts  = line.trim().split(/\s+/);
        const rawId  = parts[0]?.replace(/[<@&>]/g, '');
        const action = parts[1]?.toLowerCase();

        if (!rawId || !['add', 'remove', 'toggle'].includes(action)) {
          errors.push(`Ligne ignoree : \`${_truncate(line, 40)}\``);
          continue;
        }

        const role = guild.roles.cache.get(rawId);

        if (!role || role.managed || role.id === guild.id) {
          errors.push(`Role introuvable ou non utilisable : \`${rawId}\``);
          continue;
        }

        if (me && role.position >= me.roles.highest.position) {
          errors.push(`Role trop haut : ${role.name}`);
          continue;
        }

        roles.push({ roleId: role.id, action });
      }
    }


    if (cc._isDraft && roles.length === 0) {
      cc.rolesJson = null;
      if (errors.length > 0) {
        await _modalError(submit, gId, errors.join('\n').slice(0, 1000));
        busy = false;
        return _refresh(pnl, gId, cc);
      }
      await submit.deferUpdate().catch(() => {});
      busy = false;
      return _refresh(pnl, gId, cc);
    }

    if (cc._isDraft) _persistDraft(cc);
    if (roles.length > 0) {
      const json = JSON.stringify(roles);
      db.updateCustomCommandField(gId, cc.name, 'rolesJson', json);
      cc.rolesJson = json;
    } else {
      db.updateCustomCommandField(gId, cc.name, 'rolesJson', null);
      cc.rolesJson = null;
    }

    if (errors.length > 0) {
      await _modalError(submit, gId, errors.join('\n').slice(0, 1000));
      busy = false;
      return _refresh(pnl, gId, cc);
    }

    await submit.deferUpdate().catch(() => {});
    busy = false;
    return _refresh(pnl, gId, cc);
  }

  async function _handleCustomPerm(interaction, pnl, gId, cc) {
    const current = cc.customPerm || 'everyone';
    const options = [
      { label: 'Tout le monde', value: 'everyone', description: 'Aucune restriction',  emoji: '👥' },
      { label: 'Niveau 1',  value: 'perm1',    description: 'Perm 1+',              emoji: '1️⃣' },
      { label: 'Niveau 2',  value: 'perm2',    description: 'Perm 2+',              emoji: '2️⃣' },
      { label: 'Niveau 3',  value: 'perm3',    description: 'Perm 3+',              emoji: '3️⃣' },
      { label: 'Niveau 4',  value: 'perm4',    description: 'Perm 4+',              emoji: '4️⃣' },
      { label: 'Niveau 5',  value: 'perm5',    description: 'Perm 5+',              emoji: '5️⃣' },
      { label: 'Niveau 6',  value: 'perm6',    description: 'Perm 6+',              emoji: '6️⃣' },
      { label: 'Niveau 7',  value: 'perm7',    description: 'Perm 7+',              emoji: '7️⃣' },
      { label: 'Niveau 8',  value: 'perm8',    description: 'Perm 8+',              emoji: '8️⃣' },
      { label: 'Niveau 9',  value: 'perm9',    description: 'Perm 9+',              emoji: '9️⃣' },
      { label: 'Owner',     value: 'owner',    description: 'Owners globaux',       emoji: '👑' },
      { label: 'Buyer',     value: 'buyer',    description: 'Buyer uniquement',     emoji: '💎' },
    ].map(o => ({ ...o, default: o.value === current }));

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('local:custom:select:perm')
        .setPlaceholder(`Permission actuelle : ${perms.permLabel(current)}`)
        .addOptions(options),
    );

    let response;
    try {
      response = await interaction.reply({
        embeds       : [embed.build(gId, 'Choisissez la permission requise pour utiliser cette custom.', { timestamp: false })],
        components   : [row],
        flags        : 64,
        withResponse : true,
      });
    } catch { return; }

    const permMsg = response?.resource?.message;
    if (!permMsg) return;

    let sub;
    try {
      sub = await permMsg.awaitMessageComponent({
        componentType : ComponentType.StringSelect,
        filter        : i => i.user.id === interaction.user.id,
        time          : TIMEOUTS.CONFIRM_TIME_MS,
      });
    } catch { return; }

    const value = sub.values?.[0] || 'everyone';
    if (cc._isDraft) _persistDraft(cc);
    db.updateCustomCommandField(gId, cc.name, 'customPerm', value);
    cc.customPerm = value;

    await sub.update({
      embeds     : [embed.build(gId, `Permission mise a jour : **${perms.permLabel(value)}**`, { timestamp: false })],
      components : [],
    }).catch(() => {});
    _refresh(pnl, gId, cc);
  }

  async function _handleRestrictions(interaction, pnl, gId, cc) {
    const logChan    = cc.logChannelId || null;
    const _allowedIds = (() => {
      try { return JSON.parse(cc.allowedChannelIds || 'null') || []; } catch { return []; }
    })();
    const _blockedIds = (() => {
      try { return JSON.parse(cc.blockedChannelIds || 'null') || []; } catch { return []; }
    })();

    const logChanSelect = new ChannelSelectMenuBuilder()
      .setCustomId('local:custom:restr:logchan')
      .setPlaceholder(logChan ? 'Salon de logs configure' : 'Salon de logs')
      .setMinValues(0)
      .setMaxValues(1)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
    if (logChan) {
      try { logChanSelect.setDefaultChannels(logChan); } catch {}
    }

    const allowedChanSelect = new ChannelSelectMenuBuilder()
      .setCustomId('local:custom:restr:allowedchans')
      .setPlaceholder(_allowedIds.length > 0
        ? `Salons autorises · ${_allowedIds.length} configure(s)`
        : 'Salons autorises · tous (aucun filtre)')
      .setMinValues(0)
      .setMaxValues(25)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum);
    if (_allowedIds.length > 0) {
      try { allowedChanSelect.setDefaultChannels(_allowedIds); } catch {}
    }

    const blockedChanSelect = new ChannelSelectMenuBuilder()
      .setCustomId('local:custom:restr:blockedchans')
      .setPlaceholder(_blockedIds.length > 0
        ? `Salons interdits · ${_blockedIds.length} bloque(s)`
        : 'Salons interdits · aucun')
      .setMinValues(0)
      .setMaxValues(25)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum);
    if (_blockedIds.length > 0) {
      try { blockedChanSelect.setDefaultChannels(_blockedIds); } catch {}
    }

    let response;
    try {
      response = await interaction.reply({
        embeds : [embed.build(gId, '**Restrictions**\nSalon de logs, salons autorises et salons interdits.\nChaque modification est sauvegardee immediatement.', { timestamp: false })],
        components : [
          new ActionRowBuilder().addComponents(logChanSelect),
          new ActionRowBuilder().addComponents(allowedChanSelect),
          new ActionRowBuilder().addComponents(blockedChanSelect),
        ],
        flags        : 64,
        withResponse : true,
      });
    } catch { return; }

    const restrMsg = response?.resource?.message;
    if (!restrMsg) return;

    const restrCollector = restrMsg.createMessageComponentCollector({
      filter : i => i.user.id === interaction.user.id,
      idle   : 5_400_000,
      time   : 5_400_000,
    });

    restrCollector.on('collect', async sub => {
      const sid = sub.customId;
      if (sid === 'local:custom:restr:logchan') {
        const val = sub.values?.[0] || null;
        if (cc._isDraft) _persistDraft(cc);
        db.updateCustomCommandField(gId, cc.name, 'logChannelId', val);
        cc.logChannelId = val;
        if (val) {
          db.updateCustomCommandField(gId, cc.name, 'logEnabled', 1);
          cc.logEnabled = 1;
        }
      } else if (sid === 'local:custom:restr:allowedchans') {
        const vals = sub.values || [];
        const json = vals.length > 0 ? JSON.stringify(vals) : null;
        if (cc._isDraft) _persistDraft(cc);
        db.updateCustomCommandField(gId, cc.name, 'allowedChannelIds', json);
        cc.allowedChannelIds = json;
      } else if (sid === 'local:custom:restr:blockedchans') {
        const vals = sub.values || [];
        const json = vals.length > 0 ? JSON.stringify(vals) : null;
        if (cc._isDraft) _persistDraft(cc);
        db.updateCustomCommandField(gId, cc.name, 'blockedChannelIds', json);
        cc.blockedChannelIds = json;
      }
      await sub.deferUpdate().catch(() => {});
      _refresh(pnl, gId, cc);
    });
  }

  async function _handleDescription(interaction, pnl, gId, cc) {
    busy = true;

    const modalId = `local:cc:desc:${interaction.id}`;
    const shown = await interaction.showModal(
      _buildModal(modalId, 'Description help', [
        _input('desc', 'Description (vide = reset)', TextInputStyle.Short, {
          value     : cc.description || '',
          required  : false,
          maxLength : 150,
          placeholder: 'Ex: Affiche les regles du serveur',
        }),
      ]),
    ).then(() => true).catch(() => false);

    busy = false;
    if (!shown) return;

    const submit = await _awaitModal(interaction, modalId);
    if (!submit) return _refresh(pnl, gId, cc);

    const desc = (submit.fields.getTextInputValue('desc') || '').trim() || null;

    if (cc._isDraft) _persistDraft(cc);
    db.updateCustomCommandField(gId, cc.name, 'description', desc);
    cc.description = desc;

    await submit.deferUpdate().catch(() => {});
    busy = false;
    return _refresh(pnl, gId, cc);
  }
}


function _buildPanelPayload(guildId, custom, guild) {
  if (V2_AVAILABLE) {
    try {
      const accent = _hexToInt(embed.getGuildColor(guildId));
      const container = new ContainerBuilder().setAccentColor(accent);
      _appendMainV2(container, custom, guild);
      return {
        flags           : COMPONENTS_V2_FLAG,
        embeds          : [],
        components      : [container],
        allowedMentions : { parse: [] },
      };
    } catch {}
  }
  return {
    embeds          : [_buildPanelEmbed(guildId, custom)],
    components      : _buildRows(false),
    allowedMentions : { parse: [] },
  };
}

function _appendMainV2(container, custom, guild) {


  const isDraft   = !!custom._isDraft;
  const enabled   = !!Number(custom.enabled);
  const trigger   = !!Number(custom.triggerByMessage);
  const delcmd    = !!Number(custom.deleteMsg);
  const dresp     = Number(custom.deleteDelay || 0);
  const targetOn  = !!Number(custom.targetMemberEnabled);


  const mode = String(
    custom.responseMode || (custom.dmResponse ? 'dm' : 'local')
  ).toLowerCase();

  const respChan = custom.responseChannelId || null;
  const logChan  = custom.logChannelId      || null;

  const styleOf      = on => (on ? ButtonStyle.Success : ButtonStyle.Secondary);
  const toggleAccess = (cid, on) => new ButtonBuilder()
    .setCustomId(cid)
    .setEmoji(on ? '' : '')
    .setStyle(styleOf(on));

  const headerLines = ['## Paramètre de la commande custom'];
  if (isDraft) headerLines.push('_Brouillon non enregistré. Configurez puis validez._');
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(headerLines.join('\n')),
  );

  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**Mot-clé**\n+${custom.name}`),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId('local:custom:set:keyword')
          .setLabel('Modifier le mot-clé')
          .setEmoji('✏️')
          .setStyle(ButtonStyle.Secondary),
      ),
  );

  const respShort = custom.response && String(custom.response).trim()
    ? _truncate(String(custom.response), 80)
    : 'Aucune réponse configurée';
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**Réponse**\n${respShort}`),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId('local:custom:set:response')
          .setEmoji('✏️')
          .setStyle(ButtonStyle.Secondary),
      ),
  );


  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:custom:mode:local')
        .setLabel('Ici')
        .setStyle(mode === 'local' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('local:custom:mode:dm')
        .setLabel('Message privé')
        .setStyle(mode === 'dm' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('local:custom:mode:fixed')
        .setLabel('Salon fixé')
        .setStyle(mode === 'fixed' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('local:custom:mode:remote')
        .setLabel('Salon distant')
        .setStyle(mode === 'remote' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      '-# Fixé : strict si le salon est inaccessible. Distant : revient au salon courant.',
    ),
  );

  const respChanSelect = new ChannelSelectMenuBuilder()
    .setCustomId('local:custom:select:respchan')
    .setPlaceholder('Salon de réponse · pour mode fixé/distant')
    .setMinValues(0)
    .setMaxValues(1)
    .addChannelTypes(
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
    );
  if (respChan) {
    try { respChanSelect.setDefaultChannels(respChan); } catch {}
  }
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(respChanSelect),
  );


  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('**Cibler sur un autre membre**\nUtilise la mention/ID après le mot-clé. Variables {Target*}.'),
      )
      .setButtonAccessory(toggleAccess('local:custom:set:target', targetOn)),
  );

  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('**Peut être déclenchée par messages**\nRéagit quand un message commence par le préfixe + mot-clé.'),
      )
      .setButtonAccessory(toggleAccess('local:custom:set:trigger', trigger)),
  );

  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('**Supprimer la commande**\nEfface le message déclencheur après exécution.'),
      )
      .setButtonAccessory(toggleAccess('local:custom:set:delcmd', delcmd)),
  );

  const drespBtn = new ButtonBuilder().setCustomId('local:custom:set:delresp');
  if (dresp > 0) {
    drespBtn.setLabel(`${dresp}s`).setEmoji('⏱️').setStyle(ButtonStyle.Success);
  } else {
    drespBtn.setEmoji('').setStyle(ButtonStyle.Secondary);
  }
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('**Supprimer la réponse**\nEfface la réponse du bot après le délai.'),
      )
      .setButtonAccessory(drespBtn),
  );


  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**Modules**\n${_buildModulesSummary(custom)}`),
  );


  const ccActive = !!custom.componentsJson;
  const moduleOptions = [
    { label: 'Message',         value: 'message',    description: 'Texte de la réponse',                emoji: '💬', hidden: ccActive },
    { label: 'Embed',           value: 'embed',      description: 'Embed de réponse',                   emoji: '📦', hidden: ccActive },
    { label: 'Boutons',         value: 'buttons',    description: 'Boutons lien ou action',             emoji: '🔘', hidden: ccActive },
    { label: 'Sélecteur',       value: 'selects',    description: 'Menu d\'actions vers d\'autres customs', emoji: '📋', hidden: ccActive },
    { label: 'Réactions',       value: 'reactions',  description: 'Emojis ajoutés à la réponse',              emoji: '😄' },
    { label: 'Rôles',           value: 'roles',      description: 'Rôles ajoutés ou retirés',                 emoji: '🎭' },
    { label: 'Cooldown',        value: 'cooldown',   description: 'Délai entre deux exécutions',            emoji: '⏳' },
    { label: 'Rôle requis',     value: 'rolereq',    description: 'Restreindre à un rôle',                  emoji: '🔒' },
    { label: 'Rôle interdit',   value: 'roleden',    description: 'Bloquer un rôle',                     emoji: '🚫' },
    { label: 'Components V2',   value: 'components', description: 'Builder avancé · voir / retirer',        emoji: '🧩' },
    { label: 'Permission',       value: 'permission', description: 'Niveau requis pour utiliser',         emoji: '🔑' },
    { label: 'Description help', value: 'description', description: 'Texte affiché dans +help',            emoji: '📝' },
    { label: 'Restrictions',     value: 'restrictions', description: 'Logs, salons autorises/interdits',  emoji: '⛔' },
  ].filter(o => !o.hidden).map(({ hidden, ...rest }) => rest);

  const modulesSelect = new StringSelectMenuBuilder()
    .setCustomId('local:custom:modules')
    .setPlaceholder(ccActive
      ? 'Gérer les modules · Message/Embed/Boutons/Sélecteur masqués'
      : 'Gérer les modules')
    .addOptions(moduleOptions);
  container.addActionRowComponents(new ActionRowBuilder().addComponents(modulesSelect));

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:custom:preview')
        .setLabel('Aperçu')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('local:custom:toggle')
        .setLabel(enabled ? 'Activée' : 'Désactivée')
        .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('local:custom:delete')
        .setLabel('Supprimer')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('local:custom:close')
        .setLabel('Fermer')
        .setStyle(ButtonStyle.Secondary),
    ),
  );
}

function _buildModulesSummary(custom) {


  if (custom.componentsJson) {
    let count = 0;
    try { count = (JSON.parse(custom.componentsJson) || []).length; } catch {}
    const _fmt = (l, v) => `\`${l}\` ${v}`;
    const _perm = perms.permLabel(custom.customPerm || 'everyone');
    const _logOn = !!Number(custom.logEnabled);
    const _logLabel = !_logOn ? 'désactivé' : (custom.logChannelId ? 'salon configuré' : 'modlog');
    return [
      `\`Components V2\` actif (${count} component(s)) · Message/Embed/Boutons/Sélecteur désactivés`,
      _fmt('Permission', _perm),
      _fmt('Logs', _logLabel),
    ].join(' · ');
  }

  let buttons = [];
  try { buttons = JSON.parse(custom.buttonsJson || '[]'); } catch {}
  let reactions = [];
  try { reactions = JSON.parse(custom.reactionsJson || '[]'); } catch {}
  let roles = [];
  try { roles = JSON.parse(custom.rolesJson || '[]'); } catch {}
  let selects = [];
  try { selects = JSON.parse(custom.selectsJson || '[]'); } catch {}

  const hasMessage = !!(custom.response && String(custom.response).trim());
  let hasEmbed = false;
  try { hasEmbed = !!custom.embedData && Object.keys(JSON.parse(custom.embedData)).length > 0; } catch {}

  const selectOpts = selects[0]?.options?.length ?? 0;

  const fmt = (label, value) => `\`${label}\` ${value}`;

  const permLabel = perms.permLabel(custom.customPerm || 'everyone');
  const descShort  = custom.description ? _truncate(custom.description, 40) : 'Aucune';

  return [
    fmt('Message',  hasMessage ? 'configuré' : 'aucun'),
    fmt('Embed',    hasEmbed ? 'configuré' : 'aucun'),
    fmt('Boutons',  `${buttons.length}/${MAX_BUTTONS}`),
    fmt('Sélecteur', selectOpts > 0 ? `${selectOpts} option(s)` : 'aucun'),
    fmt('Réactions', `${reactions.length}/${MAX_REACTIONS}`),
    fmt('Rôles',    `${roles.length}/${MAX_ROLES}`),
    fmt('Permission', permLabel),
    fmt('Description', descShort),
    fmt('Logs', (() => {
      const on = !!Number(custom.logEnabled);
      if (!on) return 'désactivé';
      return custom.logChannelId ? 'salon configuré' : 'modlog (fallback)';
    })()),
    fmt('Restrictions', (() => {
      let a = 0, b = 0;
      try { a = (JSON.parse(custom.allowedChannelIds || 'null') || []).length; } catch {}
      try { b = (JSON.parse(custom.blockedChannelIds || 'null') || []).length; } catch {}
      if (a > 0 || b > 0) return `${a} autorise(s), ${b} interdit(s)`;
      return 'aucune';
    })()),
  ].join(' · ');
}


function _buildButtonsPayload(guildId, custom) {
  if (V2_AVAILABLE) {
    try {
      const container = new ContainerBuilder().setAccentColor(_hexToInt(embed.getGuildColor(guildId)));
      _appendButtonsV2(container, custom);
      return {
        flags           : COMPONENTS_V2_FLAG,
        embeds          : [],
        components      : [container],
        allowedMentions : { parse: [] },
      };
    } catch {}
  }
  return {
    embeds          : [_buildButtonsViewEmbed(guildId, custom)],
    components      : _buildButtonsViewRows(custom),
    allowedMentions : { parse: [] },
  };
}

function _appendButtonsV2(container, custom) {
  let buttons = [];
  try { buttons = JSON.parse(custom.buttonsJson || '[]'); } catch {}

  const hasButtons = !!custom.buttonsJson && buttons.length > 0;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Boutons : ${custom.name}`),
    new TextDisplayBuilder().setContent(`Liste · ${buttons.length}/${MAX_BUTTONS}`),
  );

  try { container.addSeparatorComponents(new SeparatorBuilder().setDivider(true)); } catch {}

  const lines = buttons.map((b, i) => {
    if (!b) return null;
    const type = b.type || (b.url ? 'link' : null);
    if (type === 'link' && b.url) {
      return `\`${i + 1}.\` 🔗 **${_truncate(b.label, 40)}** → ${_truncate(b.url, 60)}`;
    }
    if (type === 'custom' && b.target && b.mode) {
      const styleTag = b.style ? ` \`${b.style}\`` : '';
      return `\`${i + 1}.\` 🎯 **${_truncate(b.label, 40)}** → \`${b.target}\` (${b.mode})${styleTag}`;
    }
    return null;
  }).filter(Boolean);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.length ? lines.join('\n') : '_Aucun bouton configuré._'),
  );

  try { container.addSeparatorComponents(new SeparatorBuilder().setDivider(true)); } catch {}

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        '**Format** une ligne par bouton.',
        '· `Texte | https://...` (lien)',
        '· `Texte | custom:nom | mode [| style]` (action)',
        '· modes : `replace` / `follow` / `ephemeral`',
        '· styles : `primary` / `secondary` / `success` / `danger`',
      ].join('\n'),
    ),
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('local:custom:btn:edit').setLabel('Éditer').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('local:custom:btn:clear').setLabel('Vider').setStyle(ButtonStyle.Danger).setDisabled(!hasButtons),
      new ButtonBuilder().setCustomId('local:custom:btn:preview').setLabel('Aperçu').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('local:custom:btn:back').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
    ),
  );
}


function _buildSelectsPayload(guildId, custom) {
  if (V2_AVAILABLE) {
    try {
      const container = new ContainerBuilder().setAccentColor(_hexToInt(embed.getGuildColor(guildId)));
      _appendSelectsV2(container, custom);
      return {
        flags           : COMPONENTS_V2_FLAG,
        embeds          : [],
        components      : [container],
        allowedMentions : { parse: [] },
      };
    } catch {}
  }
  return {
    embeds          : [_buildSelectsViewEmbed(guildId, custom)],
    components      : _buildSelectsViewRows(custom),
    allowedMentions : { parse: [] },
  };
}

function _appendSelectsV2(container, custom) {
  let selects = [];
  try { selects = JSON.parse(custom.selectsJson || '[]'); } catch {}

  const first   = selects[0] || null;
  const options = first?.options || [];
  const hasSelects = !!custom.selectsJson && options.length > 0;
  const placeholder = first?.placeholder ? _truncate(String(first.placeholder), 100) : '_(non défini)_';

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Sélecteur : ${custom.name}`),
    new TextDisplayBuilder().setContent(`Texte du menu · ${placeholder}`),
    new TextDisplayBuilder().setContent(`Options · ${options.length}/${MAX_OPTIONS}`),
  );

  try { container.addSeparatorComponents(new SeparatorBuilder().setDivider(true)); } catch {}

  const lines = options.map((o, i) => {
    if (!o || !o.label || !o.target || !o.mode) return null;
    return `\`${i + 1}.\` **${_truncate(o.label, 40)}** → \`${o.target}\` (${o.mode})`;
  }).filter(Boolean);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.length ? lines.join('\n') : '_Aucune option configurée._'),
  );

  try { container.addSeparatorComponents(new SeparatorBuilder().setDivider(true)); } catch {}

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        '**Format** une ligne par option.',
        '· `Texte | custom:nom | mode`',
        '· modes : `replace` / `follow` / `ephemeral`',
        `· max ${MAX_OPTIONS} options.`,
      ].join('\n'),
    ),
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('local:custom:sel:edit').setLabel('Éditer').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('local:custom:sel:clear').setLabel('Vider').setStyle(ButtonStyle.Danger).setDisabled(!hasSelects),
      new ButtonBuilder().setCustomId('local:custom:sel:preview').setLabel('Aperçu').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('local:custom:sel:back').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
    ),
  );
}


function _buildClosedPayload(guildId, text, isError = false) {
  if (V2_AVAILABLE) {
    try {
      const accent = isError ? 0xED4245 : _hexToInt(embed.getGuildColor(guildId));
      const c = new ContainerBuilder().setAccentColor(accent);
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
      return {
        flags           : COMPONENTS_V2_FLAG,
        embeds          : [],
        components      : [c],
        allowedMentions : { parse: [] },
      };
    } catch {}
  }
  return {
    embeds     : [embed.build(guildId, text, { color: isError ? '#ED4245' : null, timestamp: false })],
    components : [],
    allowedMentions : { parse: [] },
  };
}


function _buildConfirmDeletePayload(guildId, name) {
  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:custom:confirmdelete2')
      .setLabel('Confirmer la suppression')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('local:custom:canceldelete2')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary),
  );

  if (V2_AVAILABLE) {
    try {
      const accent = _hexToInt(embed.getGuildColor(guildId));
      const c = new ContainerBuilder().setAccentColor(accent);
      c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## Supprimer la custom command\n\`+${name}\` sera retirée définitivement.`),
      );
      c.addActionRowComponents(confirmRow);
      return {
        flags           : COMPONENTS_V2_FLAG,
        embeds          : [],
        components      : [c],
        allowedMentions : { parse: [] },
      };
    } catch {}
  }

  return {
    embeds     : [embed.build(guildId, `Supprimer la custom command \`${name}\` ?`, { timestamp: false })],
    components : [confirmRow],
    allowedMentions : { parse: [] },
  };
}

function _buildPanelEmbed(guildId, custom) {
  let buttons = [];
  try { buttons = JSON.parse(custom.buttonsJson || '[]'); } catch {}

  let reactions = [];
  try { reactions = JSON.parse(custom.reactionsJson || '[]'); } catch {}

  let roles = [];
  try { roles = JSON.parse(custom.rolesJson || '[]'); } catch {}

  let selects = [];
  try { selects = JSON.parse(custom.selectsJson || '[]'); } catch {}

  const buttonsLink   = buttons.filter(b => b && (b.type === 'link' || (b.url && !b.type))).length;
  const buttonsAction = buttons.filter(b => b && b.type === 'custom').length;
  const selectOptions = selects[0]?.options?.length ?? 0;

  let hasEmbed = false;
  try { hasEmbed = !!custom.embedData && Object.keys(JSON.parse(custom.embedData)).length > 0; } catch {}

  const title = custom._isDraft
    ? `Custom command : ${custom.name} (Brouillon)`
    : `Custom command : ${custom.name}`;

  const status = custom.enabled ? '\u2705' : '\u274C';

  const delResp = custom.deleteDelay && Number(custom.deleteDelay) > 0
    ? `${custom.deleteDelay}s` : 'Non';
  const trigMsg = (custom.triggerByMessage === 0 || custom.triggerByMessage === '0') ? 'Non' : 'Oui';

  const hasResponse = !!(custom.response && String(custom.response).trim());

  const params =
    `\u{1F4DD} **Mot-cle** : \`${custom.name}\`\n` +
    `\uD83D\uDCC8 **État** : ${status}\n` +
    `\u{1F4AC} **Réponse texte** : ${hasResponse ? 'Configurée' : 'Non'}\n` +
    `\uD83D\uDCAC **Réponse** : ${custom.response ? `\`${_truncate(custom.response, 50)}\`` : '`Vide`'}\n` +
    `\uD83D\uDCE8 **MP** : ${custom.dmResponse ? 'Oui' : 'Non'}\n` +
    `\uD83D\uDCAD **Déclenchée par messages** : ${trigMsg}\n` +
    `\uD83D\uDDD1\uFE0F **Supprimer commande** : ${custom.deleteMsg ? 'Oui' : 'Non'}\n` +
    `\u23F3 **Supprimer réponse** : ${delResp}\n` +
    `\uD83D\uDD12 **Role requis** : ${custom.requiredRoleId ? `<@&${custom.requiredRoleId}>` : 'Aucun'}\n` +
    `\uD83D\uDEAB **Role interdit** : ${custom.deniedRoleId ? `<@&${custom.deniedRoleId}>` : 'Aucun'}\n` +
    `\u23F1\uFE0F **Cooldown** : ${custom.cooldown ? `${custom.cooldown}s` : 'Non'}\n` +
    `\uD83D\uDCCB **Log** : ${custom.logEnabled ? 'Oui' : 'Non'}`;

  const modules =
    `\uD83D\uDCC4 **Embed** : ${hasEmbed ? 'Configure' : 'Non'}\n` +
    `\uD83D\uDD17 **Boutons** : ${buttons.length}/${MAX_BUTTONS}` +
    (buttonsAction > 0 ? ` (lien ${buttonsLink}, action ${buttonsAction})` : '') + `\n` +
    `\uD83D\uDCDC **Sélecteur** : ${selects.length > 0 ? `${selectOptions} option(s)` : 'Non'}\n` +
    `\uD83C\uDFAD **Reactions** : ${reactions.length}/${MAX_REACTIONS}\n` +
    `\uD83C\uDFAD **Roles** : ${roles.length}/${MAX_ROLES}` +
    (roles.length > 0 ? `\n${roles.map(r => `  <@&${r.roleId}> \`${r.action}\``).join('\n')}` : '');

  return embed.build(guildId, null, {
    title,
    fields: [
      { name: 'Parametres', value: params, inline: false },
      { name: 'Modules',    value: modules, inline: false },
    ],
    timestamp: false,
  });
}

function _buildRows(disabled = false) {
  const paramsSelect = new StringSelectMenuBuilder()
    .setCustomId('local:custom:params')
    .setPlaceholder('Configurer les paramètres...')
    .setDisabled(disabled)
    .addOptions([
      { label: 'Réponse',          value: 'response',      description: 'Modifier le texte de réponse',                  emoji: '💬' },
      { label: 'Réponse en MP',    value: 'dm',            description: 'Activer/désactiver la réponse en MP',           emoji: '📩' },
      { label: 'Déclenchée par messages', value: 'trigger_msg', description: 'Activer/désactiver le déclenchement par message', emoji: '💡' },
      { label: 'Supprimer commande', value: 'delete_cmd', description: 'Supprimer le message déclencheur',               emoji: '🗑️' },
      { label: 'Supprimer réponse',  value: 'delete_response', description: 'Supprimer la réponse après un délai',       emoji: '⏱️' },
      { label: 'Rôle requis',      value: 'required_role', description: 'Rôle nécessaire pour utiliser',                  emoji: '🔒' },
      { label: 'Rôle interdit',    value: 'denied_role',   description: 'Rôle qui bloque l\'utilisation',                 emoji: '🚫' },
      { label: 'Cooldown',         value: 'cooldown',      description: 'Délai entre utilisations',                       emoji: '⏳' },
      { label: 'Log',              value: 'log',           description: 'Activer/désactiver les logs',                    emoji: '📋' },
    ]);

  const modulesSelect = new StringSelectMenuBuilder()
    .setCustomId('local:custom:modules')
    .setPlaceholder('Gérer les modules...')
    .setDisabled(disabled)
    .addOptions([
      { label: 'Embed',      value: 'embed',     description: 'Configurer l\'embed de réponse',                         emoji: '📦' },
      { label: 'Boutons',    value: 'buttons',   description: 'Boutons lien ou action (replace/follow/ephemeral)',       emoji: '🔘' },
      { label: 'Sélecteur',  value: 'selects',   description: 'Menu déroulant d\'actions vers d\'autres customs',         emoji: '📋' },
      { label: 'Réactions',  value: 'reactions', description: 'Emojis ajoutés à la réponse',                             emoji: '😄' },
      { label: 'Rôles',      value: 'roles',     description: 'Rôles ajoutés/retirés au membre',                         emoji: '🎭' },
    ]);

  return [
    new ActionRowBuilder().addComponents(paramsSelect),
    new ActionRowBuilder().addComponents(modulesSelect),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:custom:toggle')
        .setLabel('On/Off')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('local:custom:preview')
        .setLabel('Apercu')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('local:custom:delete')
        .setEmoji('\uD83D\uDDD1\uFE0F')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('local:custom:close')
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    ),
  ];
}


function _buildButtonsViewEmbed(guildId, custom) {
  let buttons = [];
  try { buttons = JSON.parse(custom.buttonsJson || '[]'); } catch {}

  const lines = buttons.map((b, i) => {
    if (!b) return null;
    const type = b.type || (b.url ? 'link' : null);

    if (type === 'link' && b.url) {
      return `\`${i + 1}.\` \uD83D\uDD17 **${_truncate(b.label, 40)}** \u2192 ${_truncate(b.url, 60)}`;
    }

    if (type === 'custom' && b.target && b.mode) {
      const styleTag = b.style ? ` \`${b.style}\`` : '';
      return `\`${i + 1}.\` \uD83C\uDFAF **${_truncate(b.label, 40)}** \u2192 \`${b.target}\` (${b.mode})${styleTag}`;
    }

    return null;
  }).filter(Boolean);

  const body = lines.length > 0
    ? lines.join('\n')
    : '_Aucun bouton configure._';

  const help =
    '\n\n**Format Editer :** une ligne par bouton.\n' +
    '\u2022 `Texte | https://...` (lien)\n' +
    '\u2022 `Texte | custom:nom | mode [| style]` (action)\n' +
    '\u2022 modes : `replace` / `follow` / `ephemeral`\n' +
    '\u2022 styles : `primary` / `secondary` / `success` / `danger`';

  return embed.build(guildId, null, {
    title  : `Boutons : ${custom.name}`,
    fields : [
      { name: `Liste (${buttons.length}/${MAX_BUTTONS})`, value: body, inline: false },
      { name: 'Aide',                                     value: help, inline: false },
    ],
    timestamp: false,
  });
}

function _buildButtonsViewRows(custom) {
  const hasButtons = !!custom.buttonsJson;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:custom:btn:edit')
        .setLabel('Editer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('local:custom:btn:clear')
        .setLabel('Vider')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!hasButtons),
      new ButtonBuilder()
        .setCustomId('local:custom:btn:preview')
        .setLabel('Apercu')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('local:custom:btn:back')
        .setLabel('Retour')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}


function _buildSelectsViewEmbed(guildId, custom) {
  let selects = [];
  try { selects = JSON.parse(custom.selectsJson || '[]'); } catch {}

  const first = selects[0] || null;
  const options = first?.options || [];

  const placeholder = first?.placeholder || '_(non defini)_';

  const lines = options.map((o, i) => {
    if (!o || !o.label || !o.target || !o.mode) return null;
    return `\`${i + 1}.\` **${_truncate(o.label, 40)}** \u2192 \`${o.target}\` (${o.mode})`;
  }).filter(Boolean);

  const body = lines.length > 0
    ? lines.join('\n')
    : '_Aucune option configuree._';

  const help =
    '\n\n**Format Editer :** une ligne par option.\n' +
    '\u2022 `Texte | custom:nom | mode`\n' +
    '\u2022 modes : `replace` / `follow` / `ephemeral`\n' +
    `\u2022 max ${MAX_OPTIONS} options.`;

  return embed.build(guildId, null, {
    title  : `Selecteur : ${custom.name}`,
    fields : [
      { name: 'Placeholder',                       value: placeholder,    inline: false },
      { name: `Options (${options.length}/${MAX_OPTIONS})`, value: body, inline: false },
      { name: 'Aide',                              value: help,           inline: false },
    ],
    timestamp: false,
  });
}

function _buildSelectsViewRows(custom) {
  const hasSelects = !!custom.selectsJson;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:custom:sel:edit')
        .setLabel('Editer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('local:custom:sel:clear')
        .setLabel('Vider')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!hasSelects),
      new ButtonBuilder()
        .setCustomId('local:custom:sel:preview')
        .setLabel('Apercu')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('local:custom:sel:back')
        .setLabel('Retour')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}


function _isBlocked(client, keyword) {
  if (BLOCKED_KEYWORDS.has(keyword)) return true;
  if (client.commands?.has(keyword)) return true;
  if (client.commandAliases?.has(keyword)) return true;


  if (client.commands && typeof client.commands.values === 'function') {
    for (const cmd of client.commands.values()) {
      const aliases = cmd?.help?.aliases;
      if (Array.isArray(aliases) && aliases.includes(keyword)) return true;
    }
  }

  return false;
}

function _parseBool(value) {
  const v = String(value || '').toLowerCase().trim();
  return v === 'oui' || v === 'yes' || v === '1' || v === 'true' || v === 'on';
}


function _parseButtonsLines(raw) {
  const lines    = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const valid    = [];
  let   ignored  = 0;

  for (const line of lines) {
    const parts = line.split('|').map(p => p.trim());
    const label = parts[0];

    if (!label) { ignored++; continue; }

    const second = parts[1] || '';

    if (/^https?:\/\/.+/i.test(second)) {
      valid.push({ type: 'link', label: label.slice(0, 80), url: second });
      continue;
    }

    const customMatch = second.match(/^custom:([a-zA-Z0-9_-]{1,32})$/i);
    if (customMatch) {
      const mode = String(parts[2] || '').toLowerCase();
      if (!VALID_MODES.has(mode)) { ignored++; continue; }

      const target   = customMatch[1].toLowerCase();
      const styleRaw = String(parts[3] || '').toLowerCase();
      const style    = VALID_STYLES.has(styleRaw) ? styleRaw : null;

      const btn = { type: 'custom', label: label.slice(0, 80), target, mode };
      if (style) btn.style = style;
      valid.push(btn);
      continue;
    }

    ignored++;
  }

  const truncated = Math.max(0, valid.length - MAX_BUTTONS);
  return { valid: valid.slice(0, MAX_BUTTONS), ignored, truncated };
}


function _parseSelectOptionsLines(raw) {
  const lines   = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const valid   = [];
  let   ignored = 0;

  for (const line of lines) {
    const parts = line.split('|').map(p => p.trim());
    const label = parts[0];

    if (!label) { ignored++; continue; }

    const second      = parts[1] || '';
    const customMatch = second.match(/^custom:([a-zA-Z0-9_-]{1,32})$/i);
    if (!customMatch) { ignored++; continue; }

    const mode = String(parts[2] || '').toLowerCase();
    if (!VALID_MODES.has(mode)) { ignored++; continue; }

    valid.push({
      label : label.slice(0, 100),
      target: customMatch[1].toLowerCase(),
      mode,
    });
  }

  const truncated = Math.max(0, valid.length - MAX_OPTIONS);
  return { valid: valid.slice(0, MAX_OPTIONS), ignored, truncated };
}


function _buildParseReport({ ignored, truncated }) {
  const parts = [];
  if (ignored > 0)   parts.push(`${ignored} ligne(s) ignoree(s)`);
  if (truncated > 0) parts.push(`${truncated} entree(s) tronquee(s)`);
  if (parts.length === 0) return null;
  return parts.join(', ') + '.';
}

function _colorToHex(color) {
  if (typeof color === 'string') return color;
  if (typeof color === 'number') return `#${color.toString(16).padStart(6, '0')}`;
  return '';
}

function _truncate(value, max) {
  const text = String(value || '');
  const cut  = text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
  return embed.breakLongTokens(cut);
}

async function _refresh(panel, guildId, custom) {
  if (!custom._isDraft) {
    const fresh = db.getCustomCommand(guildId, custom.name);
    if (fresh) Object.assign(custom, fresh);
  }

  return panel.edit(_buildPanelPayload(guildId, custom, panel.guild)).catch(() => {});
}

function _buildModal(customId, title, inputs) {
  const modal = new ModalBuilder()
    .setCustomId(customId.slice(0, 100))
    .setTitle(title.slice(0, 45));

  modal.addComponents(inputs.map(input =>
    new ActionRowBuilder().addComponents(input)
  ));

  return modal;
}

function _input(customId, label, style, options = {}) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 45))
    .setStyle(style)
    .setRequired(Boolean(options.required));

  if (options.value) {
    input.setValue(String(options.value).slice(0, options.maxLength || 4000));
  }

  if (options.placeholder) {
    input.setPlaceholder(options.placeholder.slice(0, 100));
  }

  if (options.maxLength) {
    input.setMaxLength(options.maxLength);
  }

  return input;
}

async function _awaitModal(interaction, customId) {
  try {
    return await interaction.awaitModalSubmit({
      filter : i => i.customId === customId && i.user.id === interaction.user.id,
      time   : 120_000,
    });
  } catch {
    return null;
  }
}

async function _ephemeral(interaction, guildId, content) {
  return interaction.reply({
    embeds : [embed.build(guildId, content, { color: '#ED4245', timestamp: false })],
    flags  : 64,
  }).catch(() => {});
}

async function _modalError(submit, guildId, content) {
  return submit.reply({
    embeds : [embed.build(guildId, content, { color: '#ED4245', timestamp: false })],
    flags  : 64,
  }).catch(() => {});
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
