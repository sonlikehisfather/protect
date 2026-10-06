'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  ModalBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const db = require('../../core/database');
const embed = require('../../utils/embed');

const {
  COMPONENTS_V2_FLAG,
  canUseFivem,
  getDeletePolicy,
  getModuleConfig,
  setJsonConfig,
  setTextConfig,
  extractRoleIds,
  extractChannelId,
  wrapByMode,
  reply,
  replyError,
} = require('./_shared');

const PANEL_IDLE_MS = 180_000;
const PANEL_TIME_MS = 900_000;
const TOTAL_PAGES = 4;
const DEBUG_FCONFIG = process.env.DEBUG_FCONFIG === 'true';

function _dbg(tag, data = {}) {
  if (!DEBUG_FCONFIG) return;
  try {
    console.log(`[FCONFIG:${tag}]`, JSON.stringify(data));
  } catch {
    console.log(`[FCONFIG:${tag}]`);
  }
}

module.exports = {
  help: {
    name        : 'fconfig',
    description : 'Configurer le systeme FiveM via panneau interactif.',
    usage       : 'fconfig',
    aliases     : ['fiveconfig'],
    category    : 'fivem',
  },

  async run(client, message, args) {
    const guild = message.guild;
    const guildId = guild.id;

    _dbg('RUN', {
      guildId,
      userId: message.author.id,
      args,
    });

    if (!canUseFivem(message, module.exports.help.name)) {
      return replyError(message, "Vous n'avez pas la permission d'utiliser cette commande.", module.exports.help.name);
    }

    const del = getDeletePolicy(guildId);
    if (del.deleteCmd) await message.delete().catch(() => {});

    const action = (args[0] || '').toLowerCase();

    if (action && action !== 'panel' && action !== 'menu') {
      return _handleLegacySubcommand(message, action, args.slice(1));
    }

    const state = {
      page: 0,
      rankBuilder: {
        active: false,
        roles: [],
      },
    };
    const panel = await message.channel.send(_panelPayload(guildId, state, false)).catch(() => null);

    _dbg('PANEL_SENT', {
      guildId,
      userId: message.author.id,
      panelId: panel?.id ?? null,
    });

    if (!panel) {
      return replyError(message, 'Impossible d\'ouvrir le panneau fconfig.', module.exports.help.name);
    }

    embed.registerPrivateInteraction(panel, message.author.id, PANEL_TIME_MS);

    let rankMsgCollector = null;

    const collector = panel.createMessageComponentCollector({
      filter : i => i.user.id === message.author.id && i.message.id === panel.id,
      idle   : PANEL_IDLE_MS,
      time   : PANEL_TIME_MS,
    });

    collector.on('collect', async interaction => {
      const id = interaction.customId;
      _dbg('CLICK', {
        guildId,
        userId: interaction.user.id,
        customId: id,
        page: state.page,
      });

      try {

        if (id === 'fc:close') {
          _dbg('CLOSE', { panelId: panel.id });
          collector.stop('closed');
          await interaction.deferUpdate().catch(() => {});
          await panel.delete().catch(() => {});
          return;
        }

        if (id === 'fc:prev') {
          state.page = (state.page - 1 + TOTAL_PAGES) % TOTAL_PAGES;
          _dbg('PAGE', { page: state.page, direction: 'prev' });
          await interaction.deferUpdate().catch(() => {});
          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          return;
        }

        if (id === 'fc:next') {
          state.page = (state.page + 1) % TOTAL_PAGES;
          _dbg('PAGE', { page: state.page, direction: 'next' });
          await interaction.deferUpdate().catch(() => {});
          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          return;
        }

        if (id === 'fc:mode') {
          await interaction.deferUpdate().catch(() => {});
          _cycleMode(guildId);
          _dbg('MODE_CYCLE', { guildId });
          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          return;
        }

        if (id === 'fc:resetall') {
          await interaction.deferUpdate().catch(() => {});
          _resetAll(guildId);
          _dbg('RESET_ALL', { guildId });
          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          return;
        }

        if (id === 'fc:presencechannel') {
          _dbg('MODAL_OPEN', { key: 'fivemPresenceChannelOpId', customId: id });
        const cfg = getModuleConfig(guildId);
        await _handleTextModal({
          interaction,
          title      : 'Salon OP FiveM',
          inputId    : 'presence_channel',
          value      : cfg.presenceOpChannelId ? `<#${cfg.presenceOpChannelId}>` : '',
          maxLength  : 120,
          style      : TextInputStyle.Short,
          required   : false,
          onSubmit   : raw => {
            const v = String(raw || '').trim();
            if (!v || _isResetValue(v)) {
              setTextConfig(guildId, 'fivemPresenceChannelId', null);
              setTextConfig(guildId, 'fivemPresenceChannelOpId', null);
              return;
            }
            const channelId = extractChannelId(message, v);
            const channel = channelId ? guild.channels.cache.get(channelId) : null;
            if (channelId && channel?.isTextBased?.()) {
              setTextConfig(guildId, 'fivemPresenceChannelId', channelId);
              setTextConfig(guildId, 'fivemPresenceChannelOpId', channelId);
            }
          },
        });

          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          _dbg('MODAL_DONE', { key: 'fivemPresenceChannelOpId', customId: id });
          return;
        }

        if (id === 'fc:mission1channel') {
          _dbg('MODAL_OPEN', { key: 'fivemPresenceChannelMission1Id', customId: id });
        const cfg = getModuleConfig(guildId);
        await _handleTextModal({
          interaction,
          title      : 'Salon Mission 1',
          inputId    : 'mission1_channel',
          value      : cfg.presenceMission1ChannelId ? `<#${cfg.presenceMission1ChannelId}>` : '',
          maxLength  : 120,
          style      : TextInputStyle.Short,
          required   : false,
          onSubmit   : raw => {
            const v = String(raw || '').trim();
            if (!v || _isResetValue(v)) {
              setTextConfig(guildId, 'fivemPresenceChannelMission1Id', null);
              setTextConfig(guildId, 'fivemMission1MessageId', null);
              return;
            }
            const channelId = extractChannelId(message, v);
            const channel = channelId ? guild.channels.cache.get(channelId) : null;
            if (channelId && channel?.isTextBased?.()) {
              setTextConfig(guildId, 'fivemPresenceChannelMission1Id', channelId);
            }
          },
        });

          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          _dbg('MODAL_DONE', { key: 'fivemPresenceChannelMission1Id', customId: id });
          return;
        }

        if (id === 'fc:mission2channel') {
          _dbg('MODAL_OPEN', { key: 'fivemPresenceChannelMission2Id', customId: id });
        const cfg = getModuleConfig(guildId);
        await _handleTextModal({
          interaction,
          title      : 'Salon Mission 2',
          inputId    : 'mission2_channel',
          value      : cfg.presenceMission2ChannelId ? `<#${cfg.presenceMission2ChannelId}>` : '',
          maxLength  : 120,
          style      : TextInputStyle.Short,
          required   : false,
          onSubmit   : raw => {
            const v = String(raw || '').trim();
            if (!v || _isResetValue(v)) {
              setTextConfig(guildId, 'fivemPresenceChannelMission2Id', null);
              return;
            }
            const channelId = extractChannelId(message, v);
            const channel = channelId ? guild.channels.cache.get(channelId) : null;
            if (channelId && channel?.isTextBased?.()) {
              setTextConfig(guildId, 'fivemPresenceChannelMission2Id', channelId);
            }
          },
        });

          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          _dbg('MODAL_DONE', { key: 'fivemPresenceChannelMission2Id', customId: id });
          return;
        }

        if (id === 'fc:promochannel') {
          _dbg('MODAL_OPEN', { key: 'fivemPromotionChannelId', customId: id });
        const cfg = getModuleConfig(guildId);
        await _handleTextModal({
          interaction,
          title      : 'Salon promotions FiveM',
          inputId    : 'promo_channel',
          value      : cfg.promotionChannelId ? `<#${cfg.promotionChannelId}>` : '',
          maxLength  : 120,
          style      : TextInputStyle.Short,
          required   : false,
          onSubmit   : raw => {
            const v = String(raw || '').trim();
            if (!v || _isResetValue(v)) {
              setTextConfig(guildId, 'fivemPromotionChannelId', null);
              setTextConfig(guildId, 'fivemPromotionUpChannelId', null);
              setTextConfig(guildId, 'fivemPromotionDownChannelId', null);
              return;
            }
            const channelId = extractChannelId(message, v);
            const channel = channelId ? guild.channels.cache.get(channelId) : null;
            if (channelId && channel?.isTextBased?.()) {
              setTextConfig(guildId, 'fivemPromotionChannelId', channelId);
              setTextConfig(guildId, 'fivemPromotionUpChannelId', channelId);
              setTextConfig(guildId, 'fivemPromotionDownChannelId', channelId);
            }
          },
        });

          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          _dbg('MODAL_DONE', { key: 'fivemPromotionChannelId', customId: id });
          return;
        }

        if (id === 'fc:promoupchannel') {
          _dbg('MODAL_OPEN', { key: 'fivemPromotionUpChannelId', customId: id });
          const cfg = getModuleConfig(guildId);
          await _handleTextModal({
            interaction,
            title      : 'Salon Rank-Up',
            inputId    : 'promo_up_channel',
            value      : cfg.promotionUpChannelId ? `<#${cfg.promotionUpChannelId}>` : '',
            maxLength  : 120,
            style      : TextInputStyle.Short,
            required   : false,
            placeholder: 'Exemple: promotions-up, 123456789012345678',
            onSubmit   : raw => {
              const v = String(raw || '').trim();
              if (!v || _isResetValue(v)) {
                setTextConfig(guildId, 'fivemPromotionUpChannelId', null);
                return;
              }
              const channelId = extractChannelId(message, v);
              const channel = channelId ? guild.channels.cache.get(channelId) : null;
              if (channelId && channel?.isTextBased?.()) {
                setTextConfig(guildId, 'fivemPromotionUpChannelId', channelId);
              }
            },
          });

          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          _dbg('MODAL_DONE', { key: 'fivemPromotionUpChannelId', customId: id });
          return;
        }

        if (id === 'fc:promodownchannel') {
          _dbg('MODAL_OPEN', { key: 'fivemPromotionDownChannelId', customId: id });
          const cfg = getModuleConfig(guildId);
          await _handleTextModal({
            interaction,
            title      : 'Salon Demot',
            inputId    : 'promo_down_channel',
            value      : cfg.promotionDownChannelId ? `<#${cfg.promotionDownChannelId}>` : '',
            maxLength  : 120,
            style      : TextInputStyle.Short,
            required   : false,
            placeholder: 'Exemple: promotions-down, 123456789012345678',
            onSubmit   : raw => {
              const v = String(raw || '').trim();
              if (!v || _isResetValue(v)) {
                setTextConfig(guildId, 'fivemPromotionDownChannelId', null);
                return;
              }
              const channelId = extractChannelId(message, v);
              const channel = channelId ? guild.channels.cache.get(channelId) : null;
              if (channelId && channel?.isTextBased?.()) {
                setTextConfig(guildId, 'fivemPromotionDownChannelId', channelId);
              }
            },
          });

          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          _dbg('MODAL_DONE', { key: 'fivemPromotionDownChannelId', customId: id });
          return;
        }

        if (id === 'fc:rankhierarchy') {
          await interaction.deferUpdate().catch(() => {});

          if (state.rankBuilder.active) {
            await reply(message, 'Construction de hierarchie deja active. Envoie un role, puis clique Valider quand tu veux.', { timestamp: false }, module.exports.help.name);
            return;
          }

          const cfg = getModuleConfig(guildId);
          state.rankBuilder.active = true;
          state.rankBuilder.roles = [...(cfg.promotionRankHierarchy || [])].slice(0, 15);

          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          await reply(
            message,
            'Mode hierarchie active. Envoie les roles un par un dans ce salon (du plus grand au plus petit). Le bot supprime tes messages et met a jour le panneau.',
            { timestamp: false },
            module.exports.help.name
          );

          rankMsgCollector = message.channel.createMessageCollector({
            filter: m => m.author.id === message.author.id && !m.author.bot,
            idle  : 180_000,
            time  : 900_000,
          });

          rankMsgCollector.on('collect', async m => {
            if (!state.rankBuilder.active) return;

            const raw = String(m.content || '').trim();
            const lc = raw.toLowerCase();

            if (lc === 'reset') {
              state.rankBuilder.roles = [];
              await m.delete().catch(() => {});
              await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
              return;
            }

            if (lc === 'undo') {
              state.rankBuilder.roles.pop();
              await m.delete().catch(() => {});
              await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
              return;
            }

            const ids = extractRoleIds({ ...message, mentions: m.mentions }, raw)
              .filter(roleId => guild.roles.cache.has(roleId));
            const roleId = ids[0] || null;

            if (!roleId) {
              await m.delete().catch(() => {});
              await reply(message, 'Ce message ne contient pas de role valide.', { timestamp: false }, module.exports.help.name);
              return;
            }

            if (state.rankBuilder.roles.includes(roleId)) {
              await m.delete().catch(() => {});
              await reply(message, 'Role deja present dans la hierarchie.', { timestamp: false }, module.exports.help.name);
              return;
            }

            if (state.rankBuilder.roles.length >= 15) {
              await m.delete().catch(() => {});
              await reply(message, 'Limite atteinte: maximum 15 roles.', { timestamp: false }, module.exports.help.name);
              return;
            }

            state.rankBuilder.roles.push(roleId);
            await m.delete().catch(() => {});
            await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          });

          rankMsgCollector.on('end', async () => {
            rankMsgCollector = null;
            if (!state.rankBuilder.active) return;
            state.rankBuilder.active = false;
            await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          });

          return;
        }

        if (id === 'fc:rankvalidate') {
          await interaction.deferUpdate().catch(() => {});

          if (!state.rankBuilder.active) {
            await reply(message, 'Aucune construction active. Clique Hierarchie d\'abord.', { timestamp: false }, module.exports.help.name);
            return;
          }

          if (!state.rankBuilder.roles.length) {
            await reply(message, 'Impossible de valider une hierarchie vide.', { timestamp: false }, module.exports.help.name);
            return;
          }

          setJsonConfig(guildId, 'fivemPromotionRankHierarchy', state.rankBuilder.roles.slice(0, 15));
          state.rankBuilder.active = false;
          if (rankMsgCollector) {
            rankMsgCollector.stop('validated');
            rankMsgCollector = null;
          }

          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          await reply(message, `Hierarchie enregistree (${Math.min(state.rankBuilder.roles.length, 15)}/15).`, { timestamp: false }, module.exports.help.name);
          return;
        }

        if (id === 'fc:rankcancel') {
          await interaction.deferUpdate().catch(() => {});

          state.rankBuilder.active = false;
          state.rankBuilder.roles = [];
          if (rankMsgCollector) {
            rankMsgCollector.stop('cancelled');
            rankMsgCollector = null;
          }

          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          await reply(message, 'Construction de hierarchie annulee.', { timestamp: false }, module.exports.help.name);
          return;
        }

        if (id === 'fc:blacklist') {
          _dbg('MODAL_OPEN', { key: 'fivemBlacklistRoleId', customId: id });
        const cfg = getModuleConfig(guildId);
        await _handleTextModal({
          interaction,
          title      : 'Role blacklist FiveM',
          inputId    : 'blacklist_role',
          value      : cfg.blacklistRoleId ? `<@&${cfg.blacklistRoleId}>` : '',
          maxLength  : 120,
          style      : TextInputStyle.Short,
          required   : false,
          placeholder: 'Exemple: blacklist, 123456789012345678',
          onSubmit   : raw => {
            const v = String(raw || '').trim();
            if (!v || _isResetValue(v)) {
              setTextConfig(guildId, 'fivemBlacklistRoleId', null);
              return;
            }
            const ids = extractRoleIds(message, v);
            const roleId = ids.find(id => guild.roles.cache.has(id));
            if (roleId) setTextConfig(guildId, 'fivemBlacklistRoleId', roleId);
          },
        });

          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          _dbg('MODAL_DONE', { key: 'fivemBlacklistRoleId', customId: id });
          return;
        }

        if (id === 'fc:kpkeep') {
          _dbg('MODAL_OPEN', { key: 'fivemKpKeepRoleId', customId: id });
          const cfg = getModuleConfig(guildId);
          await _handleTextModal({
            interaction,
            title      : 'Role conserve apres KP',
            inputId    : 'kp_keep_role',
            value      : cfg.kpKeepRoleId ? `<@&${cfg.kpKeepRoleId}>` : '',
            maxLength  : 120,
            style      : TextInputStyle.Short,
            required   : false,
            placeholder: 'Exemple: citoyen, @citoyen, 123456789012345678',
            onSubmit   : raw => {
              const v = String(raw || '').trim();
              if (!v || _isResetValue(v)) {
                setTextConfig(guildId, 'fivemKpKeepRoleId', null);
                return;
              }
              const ids = extractRoleIds(message, v);
              const roleId = ids.find(x => guild.roles.cache.has(x));
              if (roleId) setTextConfig(guildId, 'fivemKpKeepRoleId', roleId);
            },
          });

          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          _dbg('MODAL_DONE', { key: 'fivemKpKeepRoleId', customId: id });
          return;
        }

          if (id === 'fc:rc' || id === 'fc:fbl' || id === 'fc:presenceping') {
          _dbg('MODAL_OPEN', { key: _rolesKey(id.replace('fc:', '')), customId: id });
        const key = _rolesKey(id.replace('fc:', ''));
        const cfg = getModuleConfig(guildId);
        const current = _currentRoleList(cfg, key);

        await _handleTextModal({
          interaction,
          title      : _rolesModalTitle(key),
          inputId    : `roles_${key}`,
          value      : current.map(roleId => `<@&${roleId}>`).join(' '),
          maxLength  : 1800,
          style      : TextInputStyle.Paragraph,
          required   : false,
          placeholder: 'roles separes par virgules - exemple: role1, role2, role3',
          onSubmit   : raw => {
            const v = String(raw || '').trim();
            if (!v || _isResetValue(v)) {
              setJsonConfig(guildId, key, []);
              return;
            }
            const ids = extractRoleIds(message, v).filter(roleId => guild.roles.cache.has(roleId));
            setJsonConfig(guildId, key, ids);
          },
        });

          await panel.edit(_panelPayload(guildId, state, false)).catch(() => {});
          _dbg('MODAL_DONE', { key, customId: id });
          return;
        }

        await interaction.deferUpdate().catch(() => {});
      } catch (err) {
        _dbg('COLLECT_ERROR', {
          customId: id,
          error: err?.message || String(err),
        });
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Erreur fconfig. Regarde les logs console.', flags: 64 }).catch(() => {});
        }
      }
    });

    collector.on('end', async (_, reason) => {
      _dbg('COLLECTOR_END', { reason, panelId: panel.id, page: state.page });
      if (rankMsgCollector) {
        rankMsgCollector.stop('panel_end');
        rankMsgCollector = null;
      }
      state.rankBuilder.active = false;
      embed.clearPrivateInteraction(panel);
      if (reason === 'closed') return;
      await panel.edit(_panelPayload(guildId, state, true)).catch(() => {});
      if (del.deleteReply) {
        embed.scheduleDelete(panel, del.deleteDelay);
      }
    });
  },
};

function _isResetValue(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === 'off' || v === 'none' || v === 'reset' || v === 'clear';
}

function _rolesKey(action) {
  if (action === 'rc') return 'fivemRcRoles';
  if (action === 'fbl') return 'fivemFblRoles';
  return 'fivemPresenceMentionRoles';
}

function _rolesModalTitle(key) {
  if (key === 'fivemRcRoles') return 'Roles RC a ajouter (separes par virgules)';
  if (key === 'fivemFblRoles') return 'Roles FBL a ajouter (separes par virgules)';
  return 'Roles ping presence (separes par virgules)';
}

function _currentRoleList(cfg, key) {
  if (key === 'fivemRcRoles') return cfg.rcRoles;
  if (key === 'fivemFblRoles') return cfg.fblRoles;
  return cfg.presenceMentionRoles;
}

function _cycleMode(guildId) {
  const current = (db.getGuildConfig(guildId)?.fivemEmbedMode || 'v2').toLowerCase();
  const next = current === 'v1' ? 'v2' : current === 'v2' ? 'auto' : 'v1';
  db.setGuildConfig(guildId, 'fivemEmbedMode', next);
}

function _resetAll(guildId) {
  db.setGuildConfig(guildId, 'fivemEmbedMode', 'v2');
  setJsonConfig(guildId, 'fivemKpRoles', []);
  setTextConfig(guildId, 'fivemKpKeepRoleId', null);
  setJsonConfig(guildId, 'fivemRcRoles', []);
  setJsonConfig(guildId, 'fivemFblRoles', []);
  setJsonConfig(guildId, 'fivemPresenceMentionRoles', []);
  setTextConfig(guildId, 'fivemBlacklistRoleId', null);
  setTextConfig(guildId, 'fivemPresenceChannelId', null);
  setTextConfig(guildId, 'fivemPresenceChannelOpId', null);
  setTextConfig(guildId, 'fivemPresenceChannelMission1Id', null);
  setTextConfig(guildId, 'fivemPresenceChannelMission2Id', null);
  setTextConfig(guildId, 'fivemMission1MessageId', null);
  setTextConfig(guildId, 'fivemPromotionChannelId', null);
  setTextConfig(guildId, 'fivemPromotionUpChannelId', null);
  setTextConfig(guildId, 'fivemPromotionDownChannelId', null);
  setJsonConfig(guildId, 'fivemPromotionRankHierarchy', []);
}

function _fmtRoleList(arr) {
  return arr.length ? arr.map(id => `<@&${id}>`).join(', ') : '`Aucun`';
}

function _fmtChannel(id) {
  return id ? `<#${id}>` : '`Non defini`';
}

function _panelPayload(guildId, state, disabled) {
  const cfg = getModuleConfig(guildId);
  const mode = (cfg.embedMode || 'v2').toUpperCase();

  const pageTitle = state.page === 0
    ? 'General'
    : state.page === 1
      ? 'Attribution roles'
      : state.page === 2
        ? 'Presence'
        : 'Promotion';

  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      '## Configuration FiveM',
      `-# Page ${state.page + 1}/${TOTAL_PAGES} • ${pageTitle}`,
      '',
      `Mode module FiveM ・ **${mode}**`,
    ].join('\n'))
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  if (state.page === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        '### Parametres principaux',
        `Salon OP ・ ${_fmtChannel(cfg.presenceOpChannelId)}`,
        `Salon Mission 1 ・ ${_fmtChannel(cfg.presenceMission1ChannelId)}`,
        `Salon Mission 2 ・ ${_fmtChannel(cfg.presenceMission2ChannelId)}`,
        `Salon promotions ・ ${_fmtChannel(cfg.promotionChannelId)}`,
        `Role blacklist FiveM ・ ${cfg.blacklistRoleId ? `<@&${cfg.blacklistRoleId}>` : '`Non defini`'}`,
      ].join('\n'))
    );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fc:mode').setLabel('Changer mode').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('fc:presencechannel').setLabel('Salon OP').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      )
    );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fc:mission1channel').setLabel('Salon Mission 1').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('fc:mission2channel').setLabel('Salon Mission 2').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      )
    );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fc:promochannel').setLabel('Salon promotions').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('fc:blacklist').setLabel('Role blacklist').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      )
    );
  }

  if (state.page === 1) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        '### Packs de roles',
        'KP retire tous les roles du membre sauf le role conserve KP',
        'RC ajoute ces roles au membre (refuse si BL)',
        'FBL ajoute ces roles en plus du Role blacklist principal',
        '',
        `Role blacklist principal ・ ${cfg.blacklistRoleId ? `<@&${cfg.blacklistRoleId}>` : '`Non defini`'}`,
        `Role conserve KP ・ ${cfg.kpKeepRoleId ? `<@&${cfg.kpKeepRoleId}>` : '`Aucun`'}`,
        `RC ・ ${_fmtRoleList(cfg.rcRoles)}`,
        `FBL ・ ${_fmtRoleList(cfg.fblRoles)}`,
      ].join('\n'))
    );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fc:kpkeep').setLabel('Role conserve KP').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('fc:rc').setLabel('Editer RC').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('fc:fbl').setLabel('Editer FBL').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      )
    );
  }

  if (state.page === 2) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        '### Presence',
        `Roles ping presence ・ ${_fmtRoleList(cfg.presenceMentionRoles)}`,
      ].join('\n'))
    );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fc:presenceping').setLabel('Editer roles ping').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('fc:resetall').setLabel('Reset module').setStyle(ButtonStyle.Danger).setDisabled(disabled),
      )
    );
  }

  if (state.page === 3) {
    const rankList = (state.rankBuilder?.active
      ? state.rankBuilder.roles
      : (cfg.promotionRankHierarchy || [])
    ).slice(0, 15);
    const rankLines = rankList.length
      ? rankList.map((roleId, idx) => `${idx + 1}. <@&${roleId}>`)
      : ['`Aucune hierarchie`'];

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        '### Promotion auto',
        `Salon Rank-Up ・ ${_fmtChannel(cfg.promotionUpChannelId)}`,
        `Salon Demot ・ ${_fmtChannel(cfg.promotionDownChannelId)}`,
        `Hierarchie ranks ・ ${rankList.length}/15`,
        `Mode edition ・ ${state.rankBuilder?.active ? 'Actif' : 'Inactif'}`,
        'Ordre attendu ・ du plus grand au plus petit',
        '',
        ...rankLines,
      ].join('\n'))
    );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fc:promoupchannel').setLabel('Salon Rank-Up').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('fc:promodownchannel').setLabel('Salon Demot').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('fc:promochannel').setLabel('Salon unique').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('fc:rankhierarchy').setLabel('Hierarchie').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      )
    );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fc:rankvalidate').setLabel('Valider hierarchie').setStyle(ButtonStyle.Success).setDisabled(disabled || !state.rankBuilder?.active),
        new ButtonBuilder().setCustomId('fc:rankcancel').setLabel('Annuler').setStyle(ButtonStyle.Danger).setDisabled(disabled || !state.rankBuilder?.active),
      )
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder());

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('-# Pour reinitialiser une option dans un champ, ecrivez `reset`.')
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('fc:prev').setLabel('←').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('fc:next').setLabel('→').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId('fc:close').setLabel('Fermer').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    )
  );

  const raw = {
    components      : [container],
    flags           : COMPONENTS_V2_FLAG,
    embeds          : [],
    allowedMentions : { parse: [] },
  };

  return wrapByMode(guildId, raw, module.exports.help.name);
}

async function _handleTextModal({ interaction, title, inputId, value, maxLength, style, required, placeholder, onSubmit }) {
  const modalId = `fc:modal:${inputId}:${interaction.id}`;
  _dbg('MODAL_BUILD', {
    modalId,
    inputId,
    userId: interaction.user.id,
  });

  const input = new TextInputBuilder()
    .setCustomId(inputId)
    .setLabel(title.slice(0, 45))
    .setStyle(style || TextInputStyle.Short)
    .setRequired(Boolean(required))
    .setMaxLength(maxLength || 500);

  if (placeholder) {
    input.setPlaceholder(String(placeholder).slice(0, 100));
  }

  const initialValue = String(value || '').slice(0, maxLength || 500);
  if (initialValue) input.setValue(initialValue);

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(title.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(input));

  const shown = await interaction.showModal(modal).then(() => true).catch(() => false);
  if (!shown) {
    _dbg('MODAL_SHOW_FAIL', { modalId, inputId, userId: interaction.user.id });
    return false;
  }

  _dbg('MODAL_SHOWN', { modalId, inputId, userId: interaction.user.id });

  const submit = await interaction.awaitModalSubmit({
    filter : i => i.customId === modalId && i.user.id === interaction.user.id,
    time   : 120_000,
  }).catch(() => null);

  if (!submit) {
    _dbg('MODAL_TIMEOUT', { modalId, inputId, userId: interaction.user.id });
    return false;
  }

  const raw = submit.fields.getTextInputValue(inputId).trim();
  _dbg('MODAL_SUBMIT', {
    modalId,
    inputId,
    userId: interaction.user.id,
    length: raw.length,
  });
  onSubmit(raw);
  await submit.deferUpdate().catch(() => {});
  return true;
}

async function _handleLegacySubcommand(message, action, restArgs) {
  const guildId = message.guild.id;

  if (['show', 'list', 'settings', 'config'].includes(action)) {
    return reply(message, _legacySummary(guildId), {
      title          : 'Configuration FiveM',
      timestamp      : false,
      allowedMentions: { parse: [] },
    }, module.exports.help.name);
  }

  if (action === 'mode') {
    const raw = (restArgs[0] || '').toLowerCase();
    if (!['v1', 'v2', 'auto'].includes(raw)) {
      return replyError(message, 'Utilisation : `fconfig mode <v1|v2|auto>`', module.exports.help.name);
    }
    db.setGuildConfig(guildId, 'fivemEmbedMode', raw);
    return reply(message, `Mode d'affichage FiveM defini sur **${raw.toUpperCase()}**.`, { timestamp: false }, module.exports.help.name);
  }

  if (action === 'blacklist') {
    const raw = restArgs.join(' ').trim();
    if (!raw || _isResetValue(raw)) {
      setTextConfig(guildId, 'fivemBlacklistRoleId', null);
      return reply(message, 'Role blacklist FiveM retire.', { timestamp: false }, module.exports.help.name);
    }

    const roleId = extractRoleIds(message, raw)[0] || null;
    if (!roleId) return replyError(message, 'Role invalide.', module.exports.help.name);

    setTextConfig(guildId, 'fivemBlacklistRoleId', roleId);
    return reply(message, `Role blacklist FiveM defini sur <@&${roleId}>.`, { timestamp: false }, module.exports.help.name);
  }

  if (action === 'kp' || action === 'kpkeep') {
    const raw = restArgs.join(' ').trim();
    if (!raw || _isResetValue(raw)) {
      setTextConfig(guildId, 'fivemKpKeepRoleId', null);
      return reply(message, 'Role conserve KP retire.', { timestamp: false }, module.exports.help.name);
    }

    const roleId = extractRoleIds(message, raw)[0] || null;
    if (!roleId) return replyError(message, 'Role invalide.', module.exports.help.name);

    setTextConfig(guildId, 'fivemKpKeepRoleId', roleId);
    return reply(message, `Role conserve KP defini sur <@&${roleId}>.`, { timestamp: false }, module.exports.help.name);
  }

  if (action === 'rankhierarchy' || action === 'promoranks' || action === 'ranks') {
    const raw = restArgs.join(' ').trim();
    if (!raw || _isResetValue(raw)) {
      setJsonConfig(guildId, 'fivemPromotionRankHierarchy', []);
      return reply(message, 'Hierarchie de ranks promotion retiree.', { timestamp: false }, module.exports.help.name);
    }

    const roles = extractRoleIds(message, raw).slice(0, 15);
    if (!roles.length) return replyError(message, 'Aucun role valide detecte.', module.exports.help.name);

    setJsonConfig(guildId, 'fivemPromotionRankHierarchy', roles);
    return reply(message, `Hierarchie promotion enregistree (${roles.length}/15).`, { timestamp: false }, module.exports.help.name);
  }

  if (['rc', 'fbl', 'presenceping'].includes(action)) {
    const raw = restArgs.join(' ').trim();
    if (!raw || _isResetValue(raw)) {
      const key = _rolesKey(action);
      setJsonConfig(guildId, key, []);
      return reply(message, `Roles ${action.toUpperCase()} retires.`, { timestamp: false }, module.exports.help.name);
    }

    const roles = extractRoleIds(message, raw);
    if (!roles.length) return replyError(message, 'Aucun role valide detecte.', module.exports.help.name);

    setJsonConfig(guildId, _rolesKey(action), roles);
    return reply(message, `Roles ${action.toUpperCase()} configures: ${roles.map(id => `<@&${id}>`).join(', ')}`, { timestamp: false }, module.exports.help.name);
  }

  if (
    action === 'presencechannel' ||
    action === 'opchannel' ||
    action === 'mission1channel' ||
    action === 'mission2channel' ||
    action === 'promoupchannel' ||
    action === 'demotchannel' ||
    action === 'promochannel'
  ) {
    const raw = restArgs.join(' ').trim();

    const key = action === 'promochannel'
      ? 'fivemPromotionChannelId'
      : action === 'promoupchannel'
        ? 'fivemPromotionUpChannelId'
        : action === 'demotchannel'
          ? 'fivemPromotionDownChannelId'
      : action === 'mission1channel'
        ? 'fivemPresenceChannelMission1Id'
        : action === 'mission2channel'
          ? 'fivemPresenceChannelMission2Id'
          : 'fivemPresenceChannelOpId';

    if (!raw || _isResetValue(raw)) {
      setTextConfig(guildId, key, null);
      if (key === 'fivemPresenceChannelMission1Id') {
        setTextConfig(guildId, 'fivemMission1MessageId', null);
      }
      if (key === 'fivemPresenceChannelOpId') {
        setTextConfig(guildId, 'fivemPresenceChannelId', null);
      }
      return reply(message, `${action} retire.`, { timestamp: false }, module.exports.help.name);
    }

    const channelId = extractChannelId(message, raw);
    if (!channelId) return replyError(message, 'Salon invalide.', module.exports.help.name);

    setTextConfig(guildId, key, channelId);
    if (key === 'fivemPresenceChannelOpId') {
      setTextConfig(guildId, 'fivemPresenceChannelId', channelId);
    }
    if (key === 'fivemPromotionChannelId') {
      setTextConfig(guildId, 'fivemPromotionUpChannelId', channelId);
      setTextConfig(guildId, 'fivemPromotionDownChannelId', channelId);
    }
    return reply(message, `${action} defini sur <#${channelId}>.`, { timestamp: false }, module.exports.help.name);
  }

  return replyError(
    message,
    'Sous-commande inconnue. Utilise `fconfig` pour ouvrir le panneau.',
    module.exports.help.name
  );
}

function _legacySummary(guildId) {
  const cfg = getModuleConfig(guildId);

  return [
    `Mode ・ \`${(cfg.embedMode || 'v2').toUpperCase()}\``,
    `Salon OP ・ ${cfg.presenceOpChannelId ? `<#${cfg.presenceOpChannelId}>` : '`Non defini`'}`,
    `Salon Mission 1 ・ ${cfg.presenceMission1ChannelId ? `<#${cfg.presenceMission1ChannelId}>` : '`Non defini`'}`,
    `Salon Mission 2 ・ ${cfg.presenceMission2ChannelId ? `<#${cfg.presenceMission2ChannelId}>` : '`Non defini`'}`,
    `Salon promotions (unique) ・ ${cfg.promotionChannelId ? `<#${cfg.promotionChannelId}>` : '`Non defini`'}`,
    `Salon Rank-Up ・ ${cfg.promotionUpChannelId ? `<#${cfg.promotionUpChannelId}>` : '`Non defini`'}`,
    `Salon Demot ・ ${cfg.promotionDownChannelId ? `<#${cfg.promotionDownChannelId}>` : '`Non defini`'}`,
    `Role blacklist ・ ${cfg.blacklistRoleId ? `<@&${cfg.blacklistRoleId}>` : '`Non defini`'}`,
    `Role conserve KP ・ ${cfg.kpKeepRoleId ? `<@&${cfg.kpKeepRoleId}>` : '`Aucun`'}`,
    `Roles RC ・ ${cfg.rcRoles.length ? cfg.rcRoles.map(id => `<@&${id}>`).join(', ') : '`Aucun`'}`,
    `Roles FBL ・ ${cfg.fblRoles.length ? cfg.fblRoles.map(id => `<@&${id}>`).join(', ') : '`Aucun`'}`,
    `Roles ping presence ・ ${cfg.presenceMentionRoles.length ? cfg.presenceMentionRoles.map(id => `<@&${id}>`).join(', ') : '`Aucun`'}`,
    `Hierarchie promotion ・ ${cfg.promotionRankHierarchy.length ? cfg.promotionRankHierarchy.map(id => `<@&${id}>`).join(' > ') : '`Aucune`'}`,
  ].join('\n');
}
