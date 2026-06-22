'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} = require('discord.js');

const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' &&
                     typeof SectionBuilder === 'function' &&
                     typeof SeparatorBuilder === 'function' &&
                     typeof TextDisplayBuilder === 'function';

const LOG_DOCS = {
  general: [
    {
      id: 'modlog',
      name: 'Modération',
      description: 'Enregistre les actions de modération : bans, unbans, timeouts, warns, mutes.',
      events: ['Ban', 'Unban', 'Timeout', 'Warn', 'Mute'],
    },
    {
      id: 'messagelog',
      name: 'Message',
      description: 'Log les messages supprimés et modifiés.',
      events: ['Message supprimé', 'Message édité', 'Suppression en masse'],
    },
    {
      id: 'raidlog',
      name: 'Raid',
      description: 'Alertes anti-raid : détection de joins massifs, tokens suspects.',
      events: ['Joins massifs', 'Token suspect', 'Raid détecté'],
    },
    {
      id: 'boostlog',
      name: 'Boost',
      description: 'Notifications de boost serveur.',
      events: ['Nouveau boost', 'Boost retiré'],
    },
  ],
  members: [
    {
      id: 'joinlog',
      name: 'Arrivée',
      description: 'Log les nouveaux membres qui rejoignent le serveur.',
      events: ['Membre rejoint'],
    },
    {
      id: 'leavelog',
      name: 'Départ',
      description: 'Log les membres qui quittent le serveur.',
      events: ['Membre quitte'],
    },
    {
      id: 'invitelog',
      name: 'Invite',
      description: 'Log la création et suppression des invitations.',
      events: ['Invitation créée', 'Invitation supprimée'],
    },
    {
      id: 'levellog',
      name: 'Level',
      description: 'Log les montées de niveau des membres.',
      events: ['Niveau gagné'],
    },
  ],
  structure: [
    {
      id: 'channellog',
      name: 'Salon',
      description: 'Log les modifications de salons.',
      events: ['Salon créé', 'Salon supprimé', 'Salon renommé', 'Permissions modifiées', 'Fil créé', 'Fil supprimé'],
    },
    {
      id: 'rolelog',
      name: 'Rôle',
      description: 'Log les modifications de rôles.',
      events: ['Rôle créé', 'Rôle supprimé', 'Rôle modifié', 'Rôles membres'],
    },
    {
      id: 'serverlog',
      name: 'Serveur',
      description: 'Log les modifications du serveur.',
      events: ['Nom changé', 'Icône changée', 'Bannière changée', 'Événement créé', 'Événement supprimé'],
    },
    {
      id: 'emojilog',
      name: 'Emoji',
      description: 'Log les modifications des emojis.',
      events: ['Emoji ajouté', 'Emoji supprimé', 'Emoji renommé'],
    },
    {
      id: 'voicelog',
      name: 'Vocal',
      description: 'Log les connexions et déconnexions vocales.',
      events: ['Connexion vocale', 'Déconnexion vocale', 'Changement de salon'],
    },
  ],
  ticket: [
    {
      id: 'ticketlog',
      name: 'Ticket',
      description: 'Log des tickets : création, fermeture, claim, transcripts.',
      events: ['Ticket créé', 'Ticket fermé', 'Ticket claim', 'Transcript'],
    },
  ],
  error: [
    {
      id: 'errorlog',
      name: 'Erreur',
      description: 'Log les erreurs techniques du bot.',
      events: ['Erreur de commande', 'Erreur système'],
    },
  ],
};

exports.help = {
  name: 'logs doc',
  description: 'Documentation des logs disponibles.',
  Usage : 'logs doc',
  category: 'logs',
};

exports.run = async (client, message, args) => {
  if (!perms.check(message, 'logs')) {
    return embed.replyError(message, "Tu n'as pas la permission d'utiliser cette commande.", { timestamp: false });
  }

  const guildId = message.guild.id;

  const state = {
    category: 'general',
    page: 0,
  };

  const payload = V2_AVAILABLE
    ? _buildV2Doc(state, guildId)
    : _buildClassicDoc(state, guildId);

  const msg = await message.channel.send(payload).catch(() => null);

  if (!msg) return;

  const collector = msg.createMessageComponentCollector({
    filter: (i) => i.user.id === message.author.id,
    idle: 120_000,
    time: 300_000,
  });

  collector.on('collect', async (interaction) => {
    const id = interaction.customId;

    if (id === 'logsdoc:close') {
      collector.stop('closed');
      await interaction.deferUpdate().catch(() => {});
      await msg.delete().catch(() => {});
      await message.delete().catch(() => {});
      return;
    }

    if (id === 'logsdoc:category') {
      const value = interaction.values?.[0];
      if (value && LOG_DOCS[value]) {
        state.category = value;
        state.page = 0;
      }
      await interaction.deferUpdate().catch(() => {});
      await msg
        .edit(
          V2_AVAILABLE
            ? _buildV2Doc(state, guildId)
            : _buildClassicDoc(state, guildId)
        )
        .catch(() => {});
      return;
    }

    if (id === 'logsdoc:page:prev') {
      state.page = Math.max(0, state.page - 1);
      await interaction.deferUpdate().catch(() => {});
      await msg
        .edit(
          V2_AVAILABLE
            ? _buildV2Doc(state, guildId)
            : _buildClassicDoc(state, guildId)
        )
        .catch(() => {});
      return;
    }

    if (id === 'logsdoc:page:next') {
      const maxPage = Math.max(
        0,
        Math.ceil(LOG_DOCS[state.category].length / 4) - 1
      );
      state.page = Math.min(maxPage, state.page + 1);
      await interaction.deferUpdate().catch(() => {});
      await msg
        .edit(
          V2_AVAILABLE
            ? _buildV2Doc(state, guildId)
            : _buildClassicDoc(state, guildId)
        )
        .catch(() => {});
      return;
    }

    await interaction.deferUpdate().catch(() => {});
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'closed') return;
    await msg.edit({ components: [] }).catch(() => {});
  });
};

function _buildV2Doc(state, guildId) {
  const category = state.category;
  const logs = LOG_DOCS[category] || [];
  const perPage = 4;
  const totalPages = Math.max(1, Math.ceil(logs.length / perPage));
  const currentPage = Math.min(state.page, totalPages - 1);
  const visible = logs.slice(
    currentPage * perPage,
    currentPage * perPage + perPage
  );

  const accent = 0x2f3136;
  const container = new ContainerBuilder().setAccentColor(accent);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## 📚 Documentation des Logs'),
  );

  const categories = [
    { id: 'general', label: 'Général', emoji: '📁' },
    { id: 'members', label: 'Membres', emoji: '👥' },
    { id: 'structure', label: 'Structure', emoji: '#️⃣' },
    { id: 'ticket', label: 'Ticket', emoji: '🎫' },
    { id: 'error', label: 'Erreur', emoji: '⚑' },
  ];

  const categoryRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('logsdoc:category')
      .setPlaceholder('Choisir une catégorie')
      .addOptions(
        categories.map((c) => ({
          label: c.label,
          value: c.id,
          emoji: c.emoji,
          default: c.id === category,
        }))
      )
  );

  container.addActionRowComponents(categoryRow);

  const sectionNames = {
    general: 'Général',
    members: 'Membres',
    structure: 'Structure',
    ticket: 'Ticket',
    error: 'Erreur',
  };

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**Section:** ${sectionNames[category]}\n**Page:** ${currentPage + 1}/${totalPages}`
    ),
  );

  container.addSeparatorComponents({ divider: true });

  for (const log of visible) {
    const content = `**${log.name}**\n🏷️ ${log.description}\n📋 Événements: ${log.events.join(', ')}`;

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content)
    );

    if (visible.indexOf(log) < visible.length - 1) {
      container.addSeparatorComponents({ divider: true });
    }
  }

  if (totalPages > 1) {
    container.addSeparatorComponents({ divider: true });

    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('logsdoc:page:prev')
        .setLabel('\u2190')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId('logsdoc:page:next')
        .setLabel('\u2192')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId('logsdoc:close')
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Danger)
    );

    container.addActionRowComponents(navRow);
  } else {
    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('logsdoc:close')
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Danger)
    );

    container.addActionRowComponents(closeRow);
  }

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [container],
    allowedMentions: { parse: [] },
  };
}

function _buildClassicDoc(state, guildId) {
  const category = state.category;
  const logs = LOG_DOCS[category] || [];
  const perPage = 4;
  const totalPages = Math.max(1, Math.ceil(logs.length / perPage));
  const currentPage = Math.min(state.page, totalPages - 1);
  const visible = logs.slice(
    currentPage * perPage,
    currentPage * perPage + perPage
  );

  const categories = [
    { id: 'general', label: 'Général', emoji: '📁' },
    { id: 'members', label: 'Membres', emoji: '👥' },
    { id: 'structure', label: 'Structure', emoji: '#️⃣' },
    { id: 'ticket', label: 'Ticket', emoji: '🎫' },
    { id: 'error', label: 'Erreur', emoji: '⚑' },
  ];

  const categoryRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('logsdoc:category')
      .setPlaceholder('Choisir une catégorie')
      .addOptions(
        categories.map((c) => ({
          label: c.label,
          value: c.id,
          emoji: c.emoji,
          default: c.id === category,
        }))
      )
  );

  const fields = visible.map((log) => ({
    name: `${log.name}`,
    value: `${log.description}\n📋 Événements : ${log.events.join(', ')}`,
    inline: false,
  }));

  const e = embed.build(guildId, null, {
    title: 'Documentation des Logs',
    description: `Utilisez le menu déroulant pour changer de catégorie.\nPage ${currentPage + 1}/${totalPages}`,
    color: '#2B2D31',
    fields,
    timestamp: false,
  });

  const components = [categoryRow];

  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('logsdoc:page:prev')
          .setLabel('\u2190')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId('logsdoc:page:next')
          .setLabel('\u2192')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage >= totalPages - 1),
        new ButtonBuilder()
          .setCustomId('logsdoc:close')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger)
      )
    );
  } else {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('logsdoc:close')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger)
      )
    );
  }

  return {
    embeds: [e],
    components,
    allowedMentions: { parse: [] },
  };
}
