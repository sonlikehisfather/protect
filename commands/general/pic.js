'use strict';


const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'pic',
    description : "Affiche la photo de profil d'un utilisateur.",
    usage       : 'pic [membre]',
    aliases     : ['avatar', 'pp'],
  },

  async run(client, message, args) {

    const guildId = message.guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const { user, member } = await resolveTarget(client, message, args);

    if (!user) {
      const sent = await embed.replyError(
        message,
        `Aucun membre trouvé pour : \`${args.join(' ') || 'inconnu'}\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const fetchedUser = await client.users
      .fetch(user.id, { force: true })
      .catch(() => user);

    const displayName = fetchedUser.globalName ?? fetchedUser.username;

    const globalAvatar = fetchedUser.displayAvatarURL({ dynamic: true, size: 1024 });


    let serverAvatar = null;
    if (member) {
      const fetchedMember = await message.guild.members
        .fetch({ user: user.id, force: true })
        .catch(() => member);

      const avatarHash = fetchedMember.avatar ?? null;
      if (avatarHash) {
        const ext    = avatarHash.startsWith('a_') ? 'gif' : 'png';
        serverAvatar = `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${avatarHash}.${ext}?size=1024`;
      }
    }

    const hasDiff = Boolean(serverAvatar && serverAvatar !== globalAvatar);

    const buildEmbed = (url, type) => {
      const options = {
        title    : displayName,
        image    : url,
        timestamp: false,
      };

      if (hasDiff) {
        options.footer = type === 'global' ? 'Avatar global' : 'Avatar serveur';
      }

      return embed.build(guildId, null, options);
    };

    const buildRow = (active) =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('pic_global')
          .setLabel('Avatar global')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(active === 'global'),
        new ButtonBuilder()
          .setCustomId('pic_server')
          .setLabel('Avatar serveur')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(active === 'server'),
      );

    const sent = await message.channel.send({
      embeds    : [buildEmbed(globalAvatar, 'global')],
      components: hasDiff ? [buildRow('global')] : [],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (!sent) return;

if (hasDiff) {
  embed.registerPrivateInteraction(sent, message.author.id, 900_000);
}

if (deleteReply) {
  embed.scheduleDelete(sent, deleteDelay);
}

if (!hasDiff) return;

    const collector = sent.createMessageComponentCollector({
      filter: i => i.user.id === message.author.id,
      idle  : 300_000,
      time  : 900_000,
    });

    collector.on('collect', async i => {
      const isGlobal = i.customId === 'pic_global';
      const url      = isGlobal ? globalAvatar : serverAvatar;
      const type     = isGlobal ? 'global' : 'server';

      await i.update({
        embeds    : [buildEmbed(url, type)],
        components: [buildRow(type)],
      }).catch(err => {
        if (err?.code !== 10062 && err?.code !== 40060) {
          console.error('[pic] update error:', err.message);
        }
      });
    });

    collector.on('end', () => {
      embed.clearPrivateInteraction(sent);
      sent.edit({ components: [] }).catch(() => {});
    });

  },
};


async function resolveTarget(client, message, args) {

  if (message.reference?.messageId) {
    const replied = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);

    if (replied?.author) {
      const member = message.guild.members.cache.get(replied.author.id) ?? null;
      return { user: replied.author, member };
    }
  }

  const mention = message.mentions.users.first();
  if (mention) {
    const member = message.guild.members.cache.get(mention.id) ?? null;
    return { user: mention, member };
  }

  const raw = args.join(' ').trim();

  if (!raw) {
    const member = message.guild.members.cache.get(message.author.id) ?? null;
    return { user: message.author, member };
  }

  const cleaned = raw.replace(/[<@!>]/g, '').trim();

  if (/^\d{17,20}$/.test(cleaned)) {
    const user = await client.users.fetch(cleaned).catch(() => null);
    if (user) {
      const member = message.guild.members.cache.get(user.id) ?? null;
      return { user, member };
    }
    return { user: null, member: null };
  }

  const lowered = raw.toLowerCase();


  let member = message.guild.members.cache.find(m =>
    m.user.username.toLowerCase()  === lowered ||
    (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
    m.displayName.toLowerCase()    === lowered
  );

  if (member) return { user: member.user, member };


  member = message.guild.members.cache.find(m =>
    m.user.username.toLowerCase().includes(lowered) ||
    (m.user.globalName && m.user.globalName.toLowerCase().includes(lowered)) ||
    m.displayName.toLowerCase().includes(lowered)
  );

  if (member) return { user: member.user, member };

  const all = await message.guild.members.fetch().catch(() => null);

  if (all) {
    member = all.find(m =>
      m.user.username.toLowerCase()  === lowered ||
      (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
      m.displayName.toLowerCase()    === lowered
    );

    if (member) return { user: member.user, member };

    member = all.find(m =>
      m.user.username.toLowerCase().includes(lowered) ||
      (m.user.globalName && m.user.globalName.toLowerCase().includes(lowered)) ||
      m.displayName.toLowerCase().includes(lowered)
    );

    if (member) return { user: member.user, member };
  }

  return { user: null, member: null };
}
