'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const TIMEOUT_MS = 300_000;

const COOLDOWN_OPTIONS = [
  { label: 'Aucun',    value: 0    },
  { label: '1 min',   value: 60   },
  { label: '5 min',   value: 300  },
  { label: '10 min',  value: 600  },
  { label: '30 min',  value: 1800 },
  { label: '1 heure', value: 3600 },
];

module.exports = {
  help: {
    name        : 'confconfig',
    description : 'Configure le système de confessions anonymes.',
    usage       : 'confconfig',
    aliases     : ['confsetup', 'confset'],
    category    : 'general',
    permissions : ['ManageGuild'],
  },

  async run(client, message) {
    const guildId = message.guild.id;

    const member = message.member;
    if (!member?.permissions?.has('ManageGuild') && message.author.id !== message.guild.ownerId) {
      return message.reply({ content: 'Permission `ManageGuild` requise.', allowedMentions: { parse: [] } }).catch(() => {});
    }

    const guildConfig = db.getGuildConfig(guildId);
    if (Boolean(guildConfig?.autoDeleteInfoCmds)) await message.delete().catch(() => {});

    await openConfigPanel(client, message.channel, message.author, guildId);
  },
};

function buildSelectChannelPayload(guildId, type) {
  const label = type === 'review' ? 'Salon de review' : 'Salon des confessions';
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${label}\nSelectionne le salon dans la liste ci-dessous.`),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`cf:chansel:${type}`)
        .setPlaceholder(`Choisis le ${label.toLowerCase()}`)
        .setChannelTypes(ChannelType.GuildText),
    ),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('cf:cancelsel')
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return { flags: COMPONENTS_V2_FLAG, components: [container], embeds: [], allowedMentions: { parse: [] } };
}

function buildCooldownPayload(guildId) {
  const cfg = db.getConfessionConfig(guildId);
  const current = Number(cfg?.cooldownSeconds ?? 300);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Cooldown entre confessions\nCooldown actuel : **${current === 0 ? 'Aucun' : `${current}s`}**\nChoisis une valeur :`),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  const row1 = COOLDOWN_OPTIONS.slice(0, 3).map(o =>
    new ButtonBuilder()
      .setCustomId(`cf:cd:${o.value}`)
      .setLabel(o.label)
      .setStyle(current === o.value ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
  const row2 = COOLDOWN_OPTIONS.slice(3).map(o =>
    new ButtonBuilder()
      .setCustomId(`cf:cd:${o.value}`)
      .setLabel(o.label)
      .setStyle(current === o.value ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
  container.addActionRowComponents(new ActionRowBuilder().addComponents(...row1));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    ...row2,
    new ButtonBuilder().setCustomId('cf:cancelsel').setLabel('Annuler').setStyle(ButtonStyle.Danger),
  ));
  return { flags: COMPONENTS_V2_FLAG, components: [container], embeds: [], allowedMentions: { parse: [] } };
}

function buildBlacklistPayload(guildId) {
  const cfg = db.getConfessionConfig(guildId);
  const current = cfg?.blacklist ?? '';
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Blacklist de mots\n${current ? `Mots bloques actuels :\n\`${current}\`` : 'Aucun mot bloque actuellement.'}\n\n-# Pour modifier la blacklist, utilise \`+confconfig\` depuis un autre message car les modals ne fonctionnent pas dans les panels V2.\nTu peux effacer la blacklist avec le bouton ci-dessous.`,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cf:blclear').setLabel('Effacer la blacklist').setStyle(ButtonStyle.Danger).setDisabled(!current),
      new ButtonBuilder().setCustomId('cf:cancelsel').setLabel('Retour').setStyle(ButtonStyle.Secondary),
    ),
  );
  return { flags: COMPONENTS_V2_FLAG, components: [container], embeds: [], allowedMentions: { parse: [] } };
}

function buildConfigPayload(guildId, page = 0, status = null, disabled = false) {
  let cfg;
  try { cfg = db.getConfessionConfig(guildId); } catch(e) { console.error('[confconfig] buildConfigPayload DB error:', e.message); throw e; }

  const on  = (v) => v ? 'Oui' : 'Non';
  const ch  = (id) => id ? `<#${id}>` : '`Non défini`';
  const fmt = (s) => {
    if (!s || Number(s) === 0) return '`Aucun`';
    const opt = COOLDOWN_OPTIONS.find(o => o.value === Number(s));
    return opt ? `\`${opt.label}\`` : `\`${s}s\``;
  };

  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Configuration ・ Confessions anonymes\n` +
      `-# Page ${page + 1} /2`,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  if (page === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Système** ・ ${cfg.enabled ? 'Actif' : 'Inactif'}\n` +
        `**Salon confessions** ・ ${ch(cfg.channelId)}\n` +
        `**Salon de review** ・ ${ch(cfg.reviewChannelId)}`,
      ),
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    if (status) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${status}`));
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('cf:toggle')
          .setLabel(cfg.enabled ? 'Désactiver' : 'Activer')
          .setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('cf:setchannel')
          .setLabel('Salon confessions')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('cf:setreview')
          .setLabel('Salon review')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('cf:postbutton')
          .setLabel('Poster le bouton')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || !cfg.channelId),
      ),
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Modération review** ・ ${on(cfg.reviewEnabled)}\n` +
        `**Réactions** ・ ${on(cfg.reactionsEnabled)}\n` +
        `**Réponse anonyme** ・ ${on(cfg.replyEnabled)}\n` +
        `**Révélation auteur** ・ ${on(cfg.revealAllowed)}\n` +
        `**Cooldown** ・ ${fmt(cfg.cooldownSeconds)}\n` +
        `**Blacklist** ・ ${cfg.blacklist ? `\`${cfg.blacklist.split(',').length} mot(s)\`` : '`Aucune`'}`,
      ),
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    if (status) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${status}`));
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('cf:togglereview')
          .setLabel(`Review ${on(cfg.reviewEnabled)}`)
          .setStyle(cfg.reviewEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('cf:togglereact')
          .setLabel(`Réact ${on(cfg.reactionsEnabled)}`)
          .setStyle(cfg.reactionsEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('cf:togglereply')
          .setLabel(`Réponse ${on(cfg.replyEnabled)}`)
          .setStyle(cfg.replyEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('cf:togglereveal')
          .setLabel(`Révélation ${on(cfg.revealAllowed)}`)
          .setStyle(cfg.revealAllowed ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(disabled),
      ),
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('cf:setcooldown')
          .setLabel('Cooldown')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('cf:setblacklist')
          .setLabel('Blacklist')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
      ),
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('cf:prev')
        .setLabel('◄')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || page === 0),
      new ButtonBuilder()
        .setCustomId('cf:next')
        .setLabel('►')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || page === 1),
      new ButtonBuilder()
        .setCustomId('cf:close')
        .setLabel('✖')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    ),
  );

  return { flags: COMPONENTS_V2_FLAG, components: [container], embeds: [], allowedMentions: { parse: [] } };
}

async function openConfigPanel(client, channel, author, guildId) {
  let page = 0;
  const msg = await channel.send(buildConfigPayload(guildId, page)).catch(() => null);
  if (!msg) return null;

  embed.registerPrivateInteraction(msg, author.id, TIMEOUT_MS);

  const collector = msg.createMessageComponentCollector({
    filter : i => i.user.id === author.id,
    time   : TIMEOUT_MS,
  });

  const refresh = (status = null) => msg.edit(buildConfigPayload(guildId, page, status)).catch(() => {});

  collector.on('collect', async i => {
    try {
      await i.deferUpdate().catch(() => {});

      if (i.customId === 'cf:close') {
        embed.clearPrivateInteraction(msg);
        collector.stop('closed');
        return msg.delete().catch(() => {});
      }

      if (i.customId === 'cf:prev') { page = 0; return refresh(); }
      if (i.customId === 'cf:next') { page = 1; return refresh(); }

      if (i.customId === 'cf:toggle') {
        const cfg = db.getConfessionConfig(guildId);
        db.saveConfessionConfig(guildId, { enabled: cfg.enabled ? 0 : 1 });
        return refresh(`Système ${cfg.enabled ? 'désactivé' : 'activé'}.`);
      }

      if (i.customId === 'cf:togglereview') {
        const cfg = db.getConfessionConfig(guildId);
        db.saveConfessionConfig(guildId, { reviewEnabled: cfg.reviewEnabled ? 0 : 1 });
        return refresh();
      }

      if (i.customId === 'cf:togglereact') {
        const cfg = db.getConfessionConfig(guildId);
        db.saveConfessionConfig(guildId, { reactionsEnabled: cfg.reactionsEnabled ? 0 : 1 });
        return refresh();
      }

      if (i.customId === 'cf:togglereply') {
        const cfg = db.getConfessionConfig(guildId);
        db.saveConfessionConfig(guildId, { replyEnabled: cfg.replyEnabled ? 0 : 1 });
        return refresh();
      }

      if (i.customId === 'cf:togglereveal') {
        const cfg = db.getConfessionConfig(guildId);
        db.saveConfessionConfig(guildId, { revealAllowed: cfg.revealAllowed ? 0 : 1 });
        return refresh();
      }

      if (i.customId === 'cf:cancelsel') return refresh();

      if (i.customId === 'cf:setchannel')
        return msg.edit(buildSelectChannelPayload(guildId, 'confession')).catch(() => {});

      if (i.customId === 'cf:setreview')
        return msg.edit(buildSelectChannelPayload(guildId, 'review')).catch(() => {});

      if (i.customId === 'cf:chansel:confession' || i.customId === 'cf:chansel:review') {
        const isReview = i.customId === 'cf:chansel:review';
        const chId = i.values?.[0];
        if (!chId) return refresh('Aucun salon sélectionné.');
        db.saveConfessionConfig(guildId, isReview ? { reviewChannelId: chId } : { channelId: chId });
        return refresh(`Salon ${isReview ? 'de review' : 'des confessions'} mis à jour.`);
      }

      if (i.customId === 'cf:setcooldown')
        return msg.edit(buildCooldownPayload(guildId)).catch(() => {});

      if (i.customId.startsWith('cf:cd:')) {
        const val = Number(i.customId.split(':')[2]);
        db.saveConfessionConfig(guildId, { cooldownSeconds: val });
        return refresh(`Cooldown : ${val === 0 ? 'désactivé' : `${val}s`}.`);
      }

      if (i.customId === 'cf:blclear') {
        db.saveConfessionConfig(guildId, { blacklist: '' });
        return refresh('Blacklist effacée.');
      }

      if (i.customId === 'cf:postbutton') {
        const cfg = db.getConfessionConfig(guildId);
        const confCh = cfg.channelId ? channel.guild?.channels?.cache?.get(cfg.channelId) : null;
        if (!confCh) return refresh('Salon introuvable.');
        const confMod = require('./confession');
        const btnMsg = await confMod.postSubmitButton(confCh).catch(() => null);
        if (btnMsg) {
          db.saveConfessionConfig(guildId, { buttonMsgId: btnMsg.id });
          return refresh('Bouton posté dans le salon.');
        }
        return refresh('Erreur lors du post du bouton.');
      }

    } catch (err) {
      console.error('[confconfig] collect error | customId:', i.customId, '| code:', err?.code, '|', err.message);
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(msg);
    if (reason === 'closed') return;
    msg.edit(buildConfigPayload(guildId, page, null, true)).catch(() => {});
  });

  return msg;
}

async function handleModalSubmit(interaction) {
  const parts  = interaction.customId.split(':');
  const action = parts[2];
  const guildId = interaction.guild?.id;
  console.log('[confconfig] modal action:', action, '| guild:', guildId);

  await interaction.deferUpdate().catch((e) => console.error('[confconfig] deferUpdate error:', e.message));

  const msgId = parts[3];
  const msg   = interaction.message ?? await interaction.channel?.messages?.fetch(msgId).catch(() => null);

  if (action === 'channel') {
    const raw = interaction.fields.getTextInputValue('channelId').trim().replace(/[<#>]/g, '');
    const ch  = interaction.guild?.channels?.cache?.get(raw);
    if (!ch || !ch.isTextBased()) {
      return msg?.edit(buildConfigPayload(guildId, 'Salon introuvable ou invalide.')).catch(() => {});
    }
    db.saveConfessionConfig(guildId, { channelId: ch.id });
    return msg?.edit(buildConfigPayload(guildId, `Salon des confessions : <#${ch.id}>.`)).catch(() => {});
  }

  if (action === 'reviewch') {
    const raw = interaction.fields.getTextInputValue('channelId').trim().replace(/[<#>]/g, '');
    const ch  = interaction.guild?.channels?.cache?.get(raw);
    if (!ch || !ch.isTextBased()) {
      return msg?.edit(buildConfigPayload(guildId, 'Salon introuvable ou invalide.')).catch(() => {});
    }
    db.saveConfessionConfig(guildId, { reviewChannelId: ch.id });
    return msg?.edit(buildConfigPayload(guildId, `Salon de review : <#${ch.id}>.`)).catch(() => {});
  }

  if (action === 'cooldown') {
    const val = parseInt(interaction.fields.getTextInputValue('cooldown').trim(), 10);
    if (isNaN(val) || val < 0) {
      return msg?.edit(buildConfigPayload(guildId, 'Valeur invalide.')).catch(() => {});
    }
    db.saveConfessionConfig(guildId, { cooldownSeconds: val });
    return msg?.edit(buildConfigPayload(guildId, `Cooldown : ${val === 0 ? 'desactive' : `${val}s`}.`)).catch(() => {});
  }

  if (action === 'blacklist') {
    const val = interaction.fields.getTextInputValue('blacklist').trim();
    db.saveConfessionConfig(guildId, { blacklist: val });
    return msg?.edit(buildConfigPayload(guildId, 'Blacklist mise a jour.')).catch(() => {});
  }
}

module.exports.openConfigPanel  = openConfigPanel;
module.exports.handleModalSubmit = handleModalSubmit;
