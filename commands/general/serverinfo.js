'use strict';


const { ChannelType } = require('discord.js');
const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

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
    defaultPermission: 'everyone',
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

    const sections = [
      {
        header: '### \u200b',
        body: [
          `ID \u203a \`${guild.id}\``,
          `Propri\u00e9taire \u203a ${owner ? `<@${owner.id}>` : 'Inconnu'}`,
          `Cr\u00e9\u00e9 le \u203a <t:${createdAt}:F>`,
          `<t:${createdAt}:R>`,
        ],
      },
      {
        header: '### Membres',
        body: [
          `**Total** \u203a ${membersTotal}`,
          `Humains \u203a ${humansCount}`,
          `Bots \u203a ${botsCount}`,
        ],
      },
      {
        header: '### Salons',
        body: [
          `**Total** \u203a ${totalChannels}`,
          `Textuels \u203a ${textCount} \u2022 Vocaux \u203a ${voiceCount}`,
          `Cat\u00e9gories \u203a ${categoryCount} \u2022 Forums \u203a ${forumCount}`,
          `Threads \u203a ${threadCount}`,
        ],
      },
      {
        header: '### Boosts & Assets',
        body: [
          `Niveau \u203a ${guild.premiumTier ?? 0} \u2022 Nombre \u203a ${guild.premiumSubscriptionCount ?? 0}`,
          `R\u00f4les \u203a ${Math.max(0, roles.size - 1)} \u2022 \u00c9mojis \u203a ${emojiCount}`,
          `Stickers \u203a ${stickerCount}`,
        ],
      },
      {
        header: '### S\u00e9curit\u00e9',
        body: [
          `V\u00e9rification \u203a ${VERIFICATION_LABELS[guild.verificationLevel] ?? guild.verificationLevel}`,
          `NSFW \u203a ${NSFW_LABELS[guild.nsfwLevel] ?? guild.nsfwLevel}`,
        ],
      },
    ];

    if (guild.description) {
      sections.splice(1, 0, {
        header: '### Description',
        body: [guild.description.slice(0, 1024)],
      });
    }

    {
      const FEATURE_LABELS = {
        ROLE_ICONS                : 'Ic\u00f4nes de r\u00f4les',
        BANNER                    : 'Banni\u00e8re',
        ANIMATED_ICON             : 'Ic\u00f4ne anim\u00e9e',
        INVITE_SPLASH             : 'Splash invite',
        VANITY_URL                : 'Vanity URL',
        COMMUNITY                 : 'Community',
        DISCOVERABLE              : 'D\u00e9couvrable',
        PARTNERED                 : 'Partenaire',
        VERIFIED                  : 'V\u00e9rifi\u00e9',
        MONETIZATION_ENABLED      : 'Mon\u00e9tisation',
        TICKETED_EVENTS_ENABLED   : '\u00c9v\u00e9nements',
      };

      const features = (guild.features ?? [])
        .filter(f => FEATURE_LABELS[f])
        .map(f => FEATURE_LABELS[f]);

      if (features.length) {
        sections.push({
          header: '### Fonctionnalit\u00e9s',
          body: features.map(f => `\u2022 ${f}`),
        });
      }
    }

    let sent = null;

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${guild.name}`)
        );
        for (const section of sections) {
          container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(section.header + '\n' + section.body.join('\n'))
          );
        }
        sent = await message.channel.send({
          components      : [container],
          flags           : COMPONENTS_V2_FLAG,
          allowedMentions : { parse: [] },
        }).catch(() => null);
      } catch {}
    }

    if (!sent) {
      sent = await message.channel.send({
        embeds: [
          embed.build(guildId, null, {
            title     : 'Informations du serveur',
            authorIcon: guild.iconURL({ dynamic: true, size: 512 }) ?? undefined,
            thumbnail : guild.iconURL({ dynamic: true, size: 512 }) ?? undefined,
            image     : guild.bannerURL({ dynamic: true, size: 1024 }) ?? undefined,
            fields,
            timestamp : false,
          }),
        ],
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }

    if (sent && deleteReply) {

      embed.scheduleDelete(sent, deleteDelay);

    }

  },
};
