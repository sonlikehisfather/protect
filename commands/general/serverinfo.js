'use strict';


const { ChannelType } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');

const VERIFICATION_LABELS = {
  0: 'Aucune',
  1: 'Faible',
  2: 'Moyenne',
  3: 'Élevée',
  4: 'Très élevée',
};

const NSFW_LABELS = {
  0: 'Par défaut',
  1: 'Explicite',
  2: 'Sûr',
  3: 'Restreint par âge',
};

module.exports = {
  help: {
    name        : 'serverinfo',
    description : 'Affiche les informations du serveur.',
    usage       : 'serverinfo',
    aliases     : ['guildinfo', 'si'],
  },

  async run(client, message) {

    const guild   = message.guild;
    const guildId = guild.id;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const owner = await guild.fetchOwner().catch(() => null);

    if (guild.members.cache.size < guild.memberCount) {
      await guild.members.fetch().catch(() => null);
    }

    const channels = guild.channels.cache;
    const roles    = guild.roles.cache;

    const totalChannels = channels.size;

    const textCount = channels.filter(c =>
      c.type === ChannelType.GuildText ||
      c.type === ChannelType.GuildAnnouncement
    ).size;

    const voiceCount = channels.filter(c =>
      c.type === ChannelType.GuildVoice ||
      c.type === ChannelType.GuildStageVoice
    ).size;

    const threadCount = channels.filter(c =>
      c.type === ChannelType.PublicThread ||
      c.type === ChannelType.PrivateThread ||
      c.type === ChannelType.AnnouncementThread
    ).size;

    const categoryCount = channels.filter(c =>
      c.type === ChannelType.GuildCategory
    ).size;

    const forumCount = channels.filter(c =>
      c.type === ChannelType.GuildForum
    ).size;

    const membersTotal =
  guild.memberCount ||
  guild.members.cache.size;

    const humansCount =
      guild.members.cache.filter(m => !m.user.bot).size;

    const botsCount =
      guild.members.cache.filter(m => m.user.bot).size;

    const createdAt = Math.floor(guild.createdTimestamp / 1000);

    const emojiCount   = guild.emojis.cache.size;
    const stickerCount = guild.stickers.cache.size;


    const fields = [

      {
        name  : 'Nom',
        value : guild.name,
        inline: true,
      },

      {
        name  : 'ID',
        value : guild.id,
        inline: true,
      },

      {
        name  : 'Propriétaire',
        value : owner ? `<@${owner.id}>` : 'Inconnu',
        inline: true,
      },

      {
        name  : 'Créé le',
        value : `<t:${createdAt}:F>\n<t:${createdAt}:R>`,
        inline: true,
      },

      {
        name  : 'Membres',
        value :
          `Total : **${membersTotal}**\n` +
          `Humains : **${humansCount}**\n` +
          `Bots : **${botsCount}**`,
        inline: true,
      },

      {
        name  : 'Boosts',
        value :
          `Niveau : **${guild.premiumTier ?? 0}**\n` +
          `Nombre : **${guild.premiumSubscriptionCount ?? 0}**`,
        inline: true,
      },

      {
        name  : 'Salons',
        value :
          `Total : **${totalChannels}**\n` +
          `Textuels : **${textCount}**\n` +
          `Vocaux : **${voiceCount}**\n` +
          `Threads : **${threadCount}**\n` +
          `Catégories : **${categoryCount}**\n` +
          `Forums : **${forumCount}**`,
        inline: true,
      },

      {
        name  : 'Assets',
        value :
          `Rôles : **${Math.max(0, roles.size - 1)}**\n` +
          `Émojis : **${emojiCount}**\n` +
          `Stickers : **${stickerCount}**`,
        inline: true,
      },

      {
        name  : 'Sécurité',
        value : `Vérification : **${VERIFICATION_LABELS[guild.verificationLevel] ?? guild.verificationLevel}** · NSFW : **${NSFW_LABELS[guild.nsfwLevel] ?? guild.nsfwLevel}**`,
        inline: false,
      },

    ];

    if (guild.description) {

      fields.push({
        name  : 'Description',
        value : guild.description.slice(0, 1024),
        inline: false,
      });

    }

    {
      const FEATURE_LABELS = {
        ROLE_ICONS                : '🎭 Icônes de rôles',
        BANNER                    : '🖼️ Bannière',
        ANIMATED_ICON             : '✨ Icône animée',
        INVITE_SPLASH             : '🎊 Splash invite',
        VANITY_URL                : '🔗 Vanity URL',
        COMMUNITY                 : '👥 Community',
        DISCOVERABLE              : '🔍 Découvrable',
        PARTNERED                 : '🤝 Partenaire',
        VERIFIED                  : ' Vérifié',
        MONETIZATION_ENABLED      : '💰 Monétisation',
        TICKETED_EVENTS_ENABLED   : '🎟️ Événements',
      };

      const summary = (guild.features ?? [])
        .filter(f => FEATURE_LABELS[f])
        .map(f => FEATURE_LABELS[f])
        .join(' · ');

      fields.push({
        name  : 'Fonctionnalités',
        value : (summary || 'Aucune').slice(0, 1024),
        inline: false,
      });
    }

    const sent = await message.channel.send({

      embeds: [

        embed.build(
          guildId,
          null,
          {
            title     : 'Informations du serveur',
            authorIcon: guild.iconURL({ dynamic: true, size: 512 }) ?? undefined,
            thumbnail : guild.iconURL({ dynamic: true, size: 512 }) ?? undefined,
            image     : guild.bannerURL({ dynamic: true, size: 1024 }) ?? undefined,
            fields,
            timestamp : false,
          }
        ),

      ],

      allowedMentions: { parse: [] },

    }).catch(() => null);

    if (sent && deleteReply) {

      embed.scheduleDelete(sent, deleteDelay);

    }

  },
};
