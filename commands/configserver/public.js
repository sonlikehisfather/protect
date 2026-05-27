'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name        : 'public',
  description : 'Gerer les salons ou les commandes publiques sont autorisees.',
  usage       : 'public <on|off|allow|deny|reset|list|config> [salon|all]',
};

exports.run = async (client, message, args) => {

  if (!perms.check(message, exports.help.name)) return;

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
    return _error(message, deleteReply, deleteDelay,
      'Utilisez `public on`, `public off`, `public allow`, `public deny`, `public reset`, `public list` ou `public config`.'
    );
  }


  if (sub === 'on') {
    if (config?.publicEnabled) {
      return _error(message, deleteReply, deleteDelay,
        'Le mode public global est deja active.'
      );
    }
    db.setGuildConfig(guildId, 'publicEnabled', 1);
    return _success(message, deleteReply, deleteDelay,
      'Mode public global active - les commandes publiques sont autorisees partout.'
    );
  }

  if (sub === 'off') {
    if (!config?.publicEnabled) {
      return _error(message, deleteReply, deleteDelay,
        'Le mode public global est deja desactive.'
      );
    }
    db.setGuildConfig(guildId, 'publicEnabled', 0);
    return _success(message, deleteReply, deleteDelay,
      'Mode public global desactive - seuls les salons configures autorisent les commandes publiques.'
    );
  }


  if (sub === 'list') {
    return _showList(message, guildId, config, deleteReply, deleteDelay);
  }


  if (sub === 'config') {
    return _openConfigPanel(message, guildId);
  }


  if (sub === 'reset') {
    if (args[1]?.toLowerCase() === 'all' || !args[1]) {
      const channels = db.getPublicChannels(guildId);
      if (!channels.length) {
        return _error(message, deleteReply, deleteDelay,
          'Aucun salon public configure.'
        );
      }
      db.clearPublicChannels(guildId);
      return _success(message, deleteReply, deleteDelay,
        `${channels.length} salon(s) retire(s) de la liste publique.`
      );
    }

    const channel = _resolveChannel(message, args[1]);
    if (!channel) {
      return _error(message, deleteReply, deleteDelay,
        'Salon invalide. Mentionnez un salon textuel.'
      );
    }

    const existing = db.getPublicChannels(guildId);
    if (!existing.includes(channel.id)) {
      return _error(message, deleteReply, deleteDelay,
        `Ce salon n'est pas configure comme public.`
      );
    }

    db.removePublicChannel(guildId, channel.id);
    return _success(message, deleteReply, deleteDelay,
      `Les commandes publiques sont maintenant interdites dans <#${channel.id}>.`
    );
  }

  if (!['allow', 'deny'].includes(sub)) {
    return _error(message, deleteReply, deleteDelay,
      'Action invalide. Utilisez `on`, `off`, `allow`, `deny`, `reset`, `list` ou `config`.'
    );
  }


  if (args[1]?.toLowerCase() === 'all') {

    const textChannels = message.guild.channels.cache
      .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
      .map(c => c.id);

    const existing = db.getPublicChannels(guildId);

    if (sub === 'allow') {
      const toAdd = textChannels.filter(id => !existing.includes(id));
      if (!toAdd.length) {
        return _error(message, deleteReply, deleteDelay,
          'Tous les salons sont deja publics.'
        );
      }
      for (const id of toAdd) db.addPublicChannel(guildId, id);
      return _success(message, deleteReply, deleteDelay,
        `${toAdd.length} salon(s) ajoute(s) a la liste publique.`
      );
    }

    if (!existing.length) {
      return _error(message, deleteReply, deleteDelay,
        'Aucun salon public configure.'
      );
    }
    db.clearPublicChannels(guildId);
    return _success(message, deleteReply, deleteDelay,
      `${existing.length} salon(s) retire(s) de la liste publique.`
    );
  }


  const channel = _resolveChannel(message, args[1]);

  if (!channel) {
    return _error(message, deleteReply, deleteDelay,
      'Salon invalide. Mentionnez un salon textuel.'
    );
  }

  const current = db.getPublicChannels(guildId).includes(channel.id);


  if (sub === 'allow') {
    if (current) {
      return _error(message, deleteReply, deleteDelay,
        `Les commandes publiques sont deja autorisees dans <#${channel.id}>.`
      );
    }

    db.addPublicChannel(guildId, channel.id);

    return _success(message, deleteReply, deleteDelay,
      `Les commandes publiques sont maintenant autorisees dans <#${channel.id}>.`
    );
  }


  if (sub === 'deny') {
    if (!current) {
      return _error(message, deleteReply, deleteDelay,
        `Ce salon n'est pas configure comme public.`
      );
    }

    db.removePublicChannel(guildId, channel.id);

    return _success(message, deleteReply, deleteDelay,
      `Les commandes publiques sont maintenant interdites dans <#${channel.id}>.`
    );
  }

};


async function _showList(message, guildId, config, deleteReply, deleteDelay) {
  const channels   = db.getPublicChannels(guildId);
  const globalMode = config?.publicEnabled ? 'Active' : 'Desactive';

  const validChannels = channels.filter(id => message.guild.channels.cache.has(id));

  const sent = await embed.reply(
    message,
    null,
    {
      title  : 'Configuration publique',
      fields : [
        {
          name   : 'Mode global',
          value  : globalMode,
          inline : true,
        },
        {
          name   : `${validChannels.length} salon(s) autorise(s)`,
          value  : validChannels.length
            ? validChannels.map(id => `<#${id}>`).join('\n').slice(0, 1024)
            : 'Aucun salon public configure.',
          inline : false,
        },
      ],
      timestamp: false,
    }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}


async function _openConfigPanel(message, guildId) {
  const guild = message.guild;

  function _buildPayload() {
    const config   = db.getGuildConfig(guildId);
    const channels = db.getPublicChannels(guildId);
    const valid    = channels.filter(id => guild.channels.cache.has(id));
    const global   = config?.publicEnabled ? 'Active' : 'Desactive';

    const description = [
      `**Mode global :** ${global}`,
      `**Salons autorises :** ${valid.length}`,
      valid.length
        ? valid.map(id => `<#${id}>`).join(', ').slice(0, 500)
        : 'Aucun',
    ].join('\n');

    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId('pc:channels')
      .setPlaceholder('Salons autorises')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(25);

    if (valid.length && typeof channelSelect.setDefaultChannels === 'function') {
      try { channelSelect.setDefaultChannels(valid.slice(0, 25)); } catch {}
    }

    const toggleLabel = config?.publicEnabled
      ? 'Desactiver le mode global'
      : 'Activer le mode global';

    const toggleStyle = config?.publicEnabled
      ? ButtonStyle.Danger
      : ButtonStyle.Success;

    return {
      embeds : [embed.build(guildId, description, { title: 'Configuration publique', timestamp: false })],
      components : [
        new ActionRowBuilder().addComponents(channelSelect),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('pc:toggle').setLabel(toggleLabel).setStyle(toggleStyle),
          new ButtonBuilder().setCustomId('pc:reset').setLabel('Reset salons').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('pc:close').setLabel('Fermer').setStyle(ButtonStyle.Secondary),
        ),
      ],
      allowedMentions : { parse: [] },
    };
  }

  const panel = await message.reply(_buildPayload()).catch(() => null);
  if (!panel) return;

  embed.registerPrivateInteraction(panel, message.author.id, 3_600_000);

  async function refresh() {
    await panel.edit(_buildPayload()).catch(() => {});
  }

  const collector = panel.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id && i.message.id === panel.id,
    time   : 3_600_000,
  });

  collector.on('collect', async interaction => {
    const id = interaction.customId;

    if (id === 'pc:close') {
      collector.stop('closed');
      embed.clearPrivateInteraction(panel);
      await interaction.deferUpdate().catch(() => {});
      await panel.delete().catch(() => {});
      return;
    }

    if (id === 'pc:toggle') {
      const config = db.getGuildConfig(guildId);
      const next   = config?.publicEnabled ? 0 : 1;
      db.setGuildConfig(guildId, 'publicEnabled', next);
      await interaction.deferUpdate().catch(() => {});
      return refresh();
    }

    if (id === 'pc:reset') {
      db.clearPublicChannels(guildId);
      await interaction.deferUpdate().catch(() => {});
      return refresh();
    }

    if (id === 'pc:channels' && interaction.isChannelSelectMenu?.()) {
      const selected = interaction.values ?? [];


      const existing = db.getPublicChannels(guildId);

      for (const cid of existing) {
        if (!selected.includes(cid)) {
          db.removePublicChannel(guildId, cid);
        }
      }

      for (const cid of selected) {
        if (!existing.includes(cid)) {
          db.addPublicChannel(guildId, cid);
        }
      }

      await interaction.deferUpdate().catch(() => {});
      return refresh();
    }

    await interaction.deferUpdate().catch(() => {});
  });

  collector.on('end', async (_, reason) => {
    embed.clearPrivateInteraction(panel);
    if (reason === 'closed') return;
    await panel.edit({
      embeds     : [embed.build(guildId, 'Session expiree, relance la commande pour reprendre.', { timestamp: false })],
      components : [],
      allowedMentions : { parse: [] },
    }).catch(() => {});
  });
}


function _resolveChannel(message, raw) {
  const ref = message.mentions.channels.first()
    ?? (raw
      ? message.guild.channels.cache.get(raw.replace(/[<#>]/g, ''))
      : message.channel);

  if (!ref) return null;
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ref.type)) return null;
  return ref;
}

async function _error(message, deleteReply, deleteDelay, text) {
  const sent = await embed.replyError(message, text).catch(() => null);
  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _success(message, deleteReply, deleteDelay, text) {
  const sent = await embed.reply(message, text).catch(() => null);
  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
