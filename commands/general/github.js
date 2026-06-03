'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'github',
    description : 'Affiche les informations d\'un compte GitHub.',
    usage       : 'github <pseudo>',
    aliases     : ['gh', 'git'],
    category    : 'general',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const username = args[0];

    if (!username) {
      const prefix = config?.prefix || '+';
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${prefix}github <pseudo>\``,
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    let data;
    try {
      const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
        headers: { 'User-Agent': 'DiscordBot' },
      });

      if (res.status === 404) {
        const sent = await embed.replyError(
          message,
          `Compte GitHub \`${username}\` introuvable.`,
          { timestamp: false }
        ).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch {
      const sent = await embed.replyError(
        message,
        'Impossible de contacter l\'API GitHub. Réessaie plus tard.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const createdAt = data.created_at
      ? `<t:${Math.floor(new Date(data.created_at).getTime() / 1000)}:D>`
      : 'Inconnue';

    const updatedAt = data.updated_at
      ? `<t:${Math.floor(new Date(data.updated_at).getTime() / 1000)}:R>`
      : 'Inconnue';

    const fields = [
      { name: 'Pseudo',      value: `[\`${data.login}\`](${data.html_url})`,          inline: true },
      { name: 'Type',        value: data.type === 'Organization' ? 'Organisation' : 'Utilisateur', inline: true },
      { name: 'Repos',       value: `${data.public_repos ?? 0}`,                      inline: true },
      { name: 'Followers',   value: `${data.followers ?? 0}`,                         inline: true },
      { name: 'Following',   value: `${data.following ?? 0}`,                         inline: true },
      { name: 'Gists',       value: `${data.public_gists ?? 0}`,                      inline: true },
      { name: 'Créé le',     value: createdAt,                                         inline: true },
      { name: 'Mis à jour',  value: updatedAt,                                         inline: true },
    ];

    if (data.company)  fields.push({ name: 'Entreprise', value: data.company,  inline: true });
    if (data.location) fields.push({ name: 'Localisation', value: data.location, inline: true });
    if (data.blog)     fields.push({ name: 'Site',        value: data.blog,     inline: true });
    if (data.twitter_username) {
      fields.push({ name: 'Twitter', value: `[@${data.twitter_username}](https://twitter.com/${data.twitter_username})`, inline: true });
    }

    const sent = await message.reply({
      embeds: [
        embed.build(guildId, data.bio || null, {
          title     : data.name ? `${data.name} (${data.login})` : data.login,
          url       : data.html_url,
          thumbnail : data.avatar_url,
          fields,
          timestamp : false,
        }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};
