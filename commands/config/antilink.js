'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name        : 'antilink',
  description : 'Configurer l’antilink.',
  usage       : 'antilink <on|off|invite|all|settings|punish|soft|whitelist|medialink|allowchannel|allowcategory|imagerole|mediadomain>',
};

exports.run = async (client, message, args) => {
  if (!perms.check(message, exports.help.name)) return;

  const guildId = message.guild.id;
  const arg     = args[0]?.toLowerCase();
  const config  = db.getGuildConfig(guildId);

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  if (arg === 'on') {
    const current = Number(db.getAntiraidConfig(guildId)?.antilinkEnabled ?? 0);
    if (current === 1) {
      const sent = await embed.replyError(
        message,
        'Antilink est déjà activé.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.setAntiraidConfig(guildId, 'antilinkEnabled', 1);

    const antiraid = db.getAntiraidConfig(guildId);

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Antilink activé.\nMode actuel : **${_formatMode(antiraid.antilinkMode)}**.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (arg === 'off') {
    const current = Number(db.getAntiraidConfig(guildId)?.antilinkEnabled ?? 0);
    if (current === 0) {
      const sent = await embed.replyError(
        message,
        'Antilink est déjà désactivé.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.setAntiraidConfig(guildId, 'antilinkEnabled', 0);

    const antiraid = db.getAntiraidConfig(guildId);

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Antilink désactivé.\nMode actuel : **${_formatMode(antiraid.antilinkMode)}**.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (arg === 'invite') {
    const currentMode = String(db.getAntiraidConfig(guildId)?.antilinkMode ?? '');
    if (currentMode === 'invite') {
      const sent = await embed.replyError(
        message,
        'Antilink est déjà en mode **Invitations Discord uniquement**.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.setAntiraidConfig(guildId, 'antilinkMode', 'invite');

    const antiraid = db.getAntiraidConfig(guildId);

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Antilink configuré : **${antiraid.antilinkEnabled ? 'Activé' : 'Désactivé'}** - mode **Invitations Discord uniquement**.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (arg === 'all') {
    const currentMode = String(db.getAntiraidConfig(guildId)?.antilinkMode ?? '');
    if (currentMode === 'all') {
      const sent = await embed.replyError(
        message,
        'Antilink est déjà en mode **Tous les liens**.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.setAntiraidConfig(guildId, 'antilinkMode', 'all');

    const antiraid = db.getAntiraidConfig(guildId);

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Antilink configuré : **${antiraid.antilinkEnabled ? 'Activé' : 'Désactivé'}** - mode **Tous les liens**.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (arg === 'whitelist') {
    const antiraid = db.getAntiraidConfig(guildId);
    const list     = _readWhitelist(antiraid?.antilinkWhitelist);
    const sub      = args[1]?.toLowerCase();
    const rawInput = args.slice(2).join(' ').trim();
    const domain   = _normalizeDomain(rawInput);

    if (sub === 'add') {
      if (!domain) {
        const sent = await embed.replyError(
          message,
          'Précisez un domaine valide. Exemple : `youtube.com`',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) {
          embed.scheduleDelete(sent, deleteDelay);
        }
        return;
      }


      const inviteCode = _extractInviteCode(rawInput);
      if (inviteCode) {
        const isOwn = await _isOwnGuildInvite(client, message.guild, inviteCode);
        if (isOwn) {
          const sent = await message.channel.send({
            embeds: [
              embed.build(
                guildId,
                'Cette invitation appartient déjà au serveur actuel, elle est donc autorisée automatiquement.',
                { timestamp: false }
              )
            ],
            allowedMentions: { repliedUser: false },
          }).catch(() => null);
          if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
          return;
        }
      }

      if (list.includes(domain)) {
        const sent = await embed.replyError(
          message,
          `\`${domain}\` est déjà dans la whitelist antilink.`,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) {
          embed.scheduleDelete(sent, deleteDelay);
        }
        return;
      }

      list.push(domain);
      db.setAntiraidConfig(guildId, 'antilinkWhitelist', JSON.stringify(list));

      const sent = await message.channel.send({
        embeds: [
          embed.build(
            guildId,
            `\`${domain}\` a été ajouté à la whitelist antilink.`,
            { timestamp: false }
          )
        ],
        allowedMentions: { repliedUser: false },
      }).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    if (sub === 'del') {
      if (!domain) {
        const sent = await embed.replyError(
          message,
          'Précisez un domaine valide à retirer.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) {
          embed.scheduleDelete(sent, deleteDelay);
        }
        return;
      }

      const idx = list.indexOf(domain);
      if (idx === -1) {
        const sent = await embed.replyError(
          message,
          `\`${domain}\` n’est pas présent dans la whitelist antilink.`,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) {
          embed.scheduleDelete(sent, deleteDelay);
        }
        return;
      }

      list.splice(idx, 1);
      db.setAntiraidConfig(guildId, 'antilinkWhitelist', JSON.stringify(list));

      const sent = await message.channel.send({
        embeds: [
          embed.build(
            guildId,
            `\`${domain}\` a été retiré de la whitelist antilink.`,
            { timestamp: false }
          )
        ],
        allowedMentions: { repliedUser: false },
      }).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    if (sub === 'list') {
      const sent = await message.channel.send({
        embeds: [
          embed.build(
            guildId,
            null,
            {
              title : 'Whitelist antilink',
              fields: [
                {
                  name   : `${list.length} domaine(s)`,
                  value  : list.length
                    ? list.map(d => `\`${d}\``).join('\n').slice(0, 1024)
                    : 'Aucun domaine autorisé.',
                  inline : false,
                },
              ],
              timestamp: false,
            }
          )
        ],
        allowedMentions: { repliedUser: false },
      }).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    const sent = await embed.replyError(
      message,
      'Utilisez `antilink whitelist add <domaine>`, `antilink whitelist del <domaine>` ou `antilink whitelist list`.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (arg === 'medialink') {
    const antiraid = db.getAntiraidConfig(guildId);
    const list     = _readJsonArray(antiraid?.antilinkMediaWhitelist);
    const sub      = args[1]?.toLowerCase();
    const rawInput = args.slice(2).join(' ').trim();
    const domain   = _normalizeDomain(rawInput);

    if (sub === 'add') {
      if (!domain) {
        const sent = await embed.replyError(message, 'Lien ou domaine invalide. Exemple : `youtube.com`', { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }


      const inviteCode = _extractInviteCode(rawInput);
      if (inviteCode) {
        const isOwn = await _isOwnGuildInvite(client, message.guild, inviteCode);
        if (isOwn) {
          const sent = await message.channel.send({ embeds: [embed.build(guildId, 'Cette invitation appartient déjà au serveur actuel, elle est donc autorisée automatiquement.', { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
          if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
          return;
        }
      }

      if (list.includes(domain)) {
        const sent = await embed.replyError(message, `\`${domain}\` est déjà dans la whitelist média.`, { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      list.push(domain);
      db.setAntiraidConfig(guildId, 'antilinkMediaWhitelist', JSON.stringify(list));
      const sent = await message.channel.send({ embeds: [embed.build(guildId, `\`${domain}\` ajouté à la whitelist média (autorisé dans salons/catégories média).`, { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'del' || sub === 'remove') {
      if (!domain) {
        const sent = await embed.replyError(message, 'Précisez un domaine valide à retirer.', { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      const idx = list.indexOf(domain);
      if (idx === -1) {
        const sent = await embed.replyError(message, `\`${domain}\` n'est pas dans la whitelist média.`, { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      list.splice(idx, 1);
      db.setAntiraidConfig(guildId, 'antilinkMediaWhitelist', JSON.stringify(list));
      const sent = await message.channel.send({ embeds: [embed.build(guildId, `\`${domain}\` retiré de la whitelist média.`, { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'list') {
      const display = list.length ? list.map(d => `\`${d}\``).join('\n').slice(0, 1024) : 'Aucun domaine média autorisé.';
      const sent = await message.channel.send({ embeds: [embed.build(guildId, null, { title: 'Whitelist média antilink', fields: [{ name: `${list.length} domaine(s)`, value: display, inline: false }], timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'clear') {
      db.setAntiraidConfig(guildId, 'antilinkMediaWhitelist', JSON.stringify([]));
      const sent = await message.channel.send({ embeds: [embed.build(guildId, 'Whitelist média vidée.', { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await embed.replyError(message, 'Utilisez `antilink medialink add <domaine>`, `del <domaine>`, `list` ou `clear`.', { timestamp: false }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (arg === 'allowchannel') {
    const sub = args[1]?.toLowerCase();
    const antiraid = db.getAntiraidConfig(guildId);
    const list = _readJsonArray(antiraid?.antilinkAllowedChannels);

    if (sub === 'add') {
      const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[2]);
      if (!channel) {
        const sent = await embed.replyError(message, 'Mentionnez un salon valide.', { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      if (list.includes(channel.id)) {
        const sent = await embed.replyError(message, `${channel} est déjà dans les salons autorisés.`, { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      list.push(channel.id);
      db.setAntiraidConfig(guildId, 'antilinkAllowedChannels', JSON.stringify(list));
      const sent = await message.channel.send({ embeds: [embed.build(guildId, `${channel} ajouté aux salons autorisés antilink.`, { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'remove' || sub === 'del') {
      const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[2]);
      if (!channel) {
        const sent = await embed.replyError(message, 'Mentionnez un salon valide.', { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      const idx = list.indexOf(channel.id);
      if (idx === -1) {
        const sent = await embed.replyError(message, `${channel} n'est pas dans les salons autorisés.`, { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      list.splice(idx, 1);
      db.setAntiraidConfig(guildId, 'antilinkAllowedChannels', JSON.stringify(list));
      const sent = await message.channel.send({ embeds: [embed.build(guildId, `${channel} retiré des salons autorisés antilink.`, { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'list') {
      const display = list.length ? list.map(id => `<#${id}>`).join('\n') : 'Aucun salon autorisé.';
      const sent = await message.channel.send({ embeds: [embed.build(guildId, null, { title: 'Salons autorisés antilink', fields: [{ name: `${list.length} salon(s)`, value: display.slice(0, 1024), inline: false }], timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await embed.replyError(message, 'Utilisez `antilink allowchannel add #salon`, `del #salon` ou `list`.', { timestamp: false }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (arg === 'allowcategory') {
    const sub = args[1]?.toLowerCase();
    const antiraid = db.getAntiraidConfig(guildId);
    const list = _readJsonArray(antiraid?.antilinkAllowedCategories);

    if (sub === 'add') {
      const catId = args[2];
      const category = message.guild.channels.cache.get(catId);
      if (!category || category.type !== 4) {
        const sent = await embed.replyError(message, 'ID de catégorie invalide.', { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      if (list.includes(category.id)) {
        const sent = await embed.replyError(message, `\`${category.name}\` est déjà dans les catégories autorisées.`, { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      list.push(category.id);
      db.setAntiraidConfig(guildId, 'antilinkAllowedCategories', JSON.stringify(list));
      const sent = await message.channel.send({ embeds: [embed.build(guildId, `Catégorie \`${category.name}\` ajoutée aux catégories autorisées antilink.`, { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'remove' || sub === 'del') {
      const catId = args[2];
      const idx = list.indexOf(catId);
      if (idx === -1) {
        const sent = await embed.replyError(message, 'Cette catégorie n\'est pas dans les catégories autorisées.', { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      list.splice(idx, 1);
      db.setAntiraidConfig(guildId, 'antilinkAllowedCategories', JSON.stringify(list));
      const sent = await message.channel.send({ embeds: [embed.build(guildId, 'Catégorie retirée des catégories autorisées antilink.', { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'list') {
      const display = list.length
        ? list.map(id => { const c = message.guild.channels.cache.get(id); return c ? `\`${c.name}\` (${id})` : `\`${id}\``; }).join('\n')
        : 'Aucune catégorie autorisée.';
      const sent = await message.channel.send({ embeds: [embed.build(guildId, null, { title: 'Catégories autorisées antilink', fields: [{ name: `${list.length} catégorie(s)`, value: display.slice(0, 1024), inline: false }], timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await embed.replyError(message, 'Utilisez `antilink allowcategory add <id>`, `del <id>` ou `list`.', { timestamp: false }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (arg === 'imagerole') {
    const sub = args[1]?.toLowerCase();
    const antiraid = db.getAntiraidConfig(guildId);
    const list = _readJsonArray(antiraid?.antilinkImageRoles);

    if (sub === 'add') {
      const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[2]);
      if (!role) {
        const sent = await embed.replyError(message, 'Mentionnez un rôle valide.', { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      if (list.includes(role.id)) {
        const sent = await embed.replyError(message, `${role} est déjà un rôle image autorisé.`, { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      list.push(role.id);
      db.setAntiraidConfig(guildId, 'antilinkImageRoles', JSON.stringify(list));
      const sent = await message.channel.send({ embeds: [embed.build(guildId, `${role} ajouté aux rôles image/média antilink.`, { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'remove' || sub === 'del') {
      const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[2]);
      if (!role) {
        const sent = await embed.replyError(message, 'Mentionnez un rôle valide.', { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      const idx = list.indexOf(role.id);
      if (idx === -1) {
        const sent = await embed.replyError(message, `${role} n'est pas un rôle image autorisé.`, { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      list.splice(idx, 1);
      db.setAntiraidConfig(guildId, 'antilinkImageRoles', JSON.stringify(list));
      const sent = await message.channel.send({ embeds: [embed.build(guildId, `${role} retiré des rôles image/média antilink.`, { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'list') {
      const display = list.length ? list.map(id => `<@&${id}>`).join('\n') : 'Aucun rôle image configuré.';
      const sent = await message.channel.send({ embeds: [embed.build(guildId, null, { title: 'Rôles image/média antilink', fields: [{ name: `${list.length} rôle(s)`, value: display.slice(0, 1024), inline: false }], timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await embed.replyError(message, 'Utilisez `antilink imagerole add @role`, `del @role` ou `list`.', { timestamp: false }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (arg === 'mediadomain') {
    const sub = args[1]?.toLowerCase();
    const antiraid = db.getAntiraidConfig(guildId);
    const list = _readJsonArray(antiraid?.antilinkMediaDomains);
    const rawInput = args.slice(2).join(' ').trim();
    const domain = _normalizeDomain(rawInput);

    if (sub === 'add') {
      if (!domain) {
        const sent = await embed.replyError(message, 'Précisez un domaine valide. Exemple : `pbs.twimg.com`', { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      if (list.includes(domain)) {
        const sent = await embed.replyError(message, `\`${domain}\` est déjà dans les domaines médias.`, { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      list.push(domain);
      db.setAntiraidConfig(guildId, 'antilinkMediaDomains', JSON.stringify(list));
      const sent = await message.channel.send({ embeds: [embed.build(guildId, `\`${domain}\` ajouté aux domaines médias (rôle image).`, { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'remove' || sub === 'del') {
      if (!domain) {
        const sent = await embed.replyError(message, 'Précisez un domaine valide à retirer.', { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      const idx = list.indexOf(domain);
      if (idx === -1) {
        const sent = await embed.replyError(message, `\`${domain}\` n'est pas dans les domaines médias.`, { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      list.splice(idx, 1);
      db.setAntiraidConfig(guildId, 'antilinkMediaDomains', JSON.stringify(list));
      const sent = await message.channel.send({ embeds: [embed.build(guildId, `\`${domain}\` retiré des domaines médias.`, { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'list') {
      const display = list.length ? list.map(d => `\`${d}\``).join('\n').slice(0, 1024) : 'Aucun domaine média custom.';
      const sent = await message.channel.send({ embeds: [embed.build(guildId, null, { title: 'Domaines médias custom (rôle image)', fields: [{ name: `${list.length} domaine(s)`, value: display, inline: false }], timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await embed.replyError(message, 'Utilisez `antilink mediadomain add <domaine>`, `del <domaine>` ou `list`.', { timestamp: false }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (arg === 'punish') {
    const VALID_PUNISH = ['delete', 'warn', 'mute', 'kick', 'ban'];
    const value = args[1]?.toLowerCase();

    if (!value || !VALID_PUNISH.includes(value)) {
      const antiraid = db.getAntiraidConfig(guildId);
      const current  = antiraid?.antilinkPunish || 'warn';
      const sent = await embed.replyError(
        message,
        `Sanction actuelle : **${current}**\nUtilisation : \`antilink punish <${VALID_PUNISH.join('|')}>\``,
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.setAntiraidConfig(guildId, 'antilinkPunish', value);

    const antiraid = db.getAntiraidConfig(guildId);
    const softOn   = Number(antiraid?.antilinkSoftEnabled ?? 1) === 1;

    let desc = `Sanction antilink configuree : **${value}**.`;

    if (softOn && value === 'delete') {
      desc += '\nNote : avec le soft active, la sanction delete ne fait qu\'une suppression finale. Utilisez warn ou mute pour une vraie escalade.';
    }

    const sent = await message.channel.send({
      embeds: [embed.build(guildId, desc, { timestamp: false })],
      allowedMentions: { parse: [] },
    }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (arg === 'soft') {
    const sub = args[1]?.toLowerCase();
    const antiraid = db.getAntiraidConfig(guildId);

    if (sub === 'on') {
      db.setAntiraidConfig(guildId, 'antilinkSoftEnabled', 1);
      const sent = await message.channel.send({ embeds: [embed.build(guildId, 'Antilink **soft mode** activé. Les premières infractions donneront un rappel avant sanction.', { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'off') {
      db.setAntiraidConfig(guildId, 'antilinkSoftEnabled', 0);
      const sent = await message.channel.send({ embeds: [embed.build(guildId, 'Antilink **soft mode** désactivé. Toute infraction applique directement la sanction.', { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'threshold') {
      const val = parseInt(args[2], 10);
      if (!val || val < 1 || val > 20) {
        const sent = await embed.replyError(message, 'Seuil invalide (1-20).', { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      db.setAntiraidConfig(guildId, 'antilinkSoftThreshold', val);
      const sent = await message.channel.send({ embeds: [embed.build(guildId, `Seuil soft antilink : **${val}** infraction(s) avant sanction.`, { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (sub === 'window') {
      const val = parseInt(args[2], 10);
      if (!val || val < 30 || val > 3600) {
        const sent = await embed.replyError(message, 'Fenêtre invalide (30-3600 secondes).', { timestamp: false }).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }
      db.setAntiraidConfig(guildId, 'antilinkSoftWindow', val);
      const sent = await message.channel.send({ embeds: [embed.build(guildId, `Fenêtre soft antilink : **${val}** secondes.`, { timestamp: false })], allowedMentions: { parse: [] } }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }


    const softOn    = Number(antiraid?.antilinkSoftEnabled ?? 1) === 1;
    const threshold = Number(antiraid?.antilinkSoftThreshold) || 3;
    const window    = Number(antiraid?.antilinkSoftWindow) || 600;
    const punish    = antiraid?.antilinkPunish || 'warn';
    let desc = `Soft antilink : **${softOn ? 'Activé' : 'Désactivé'}**\nSeuil : **${threshold}** lien(s) / **${window}s**`;
    if (softOn && punish === 'delete') {
      desc += '\n\nNote : avec le soft activé, la sanction delete ne fait qu\'une suppression finale. Utilise warn ou timeout pour une vraie escalade.';
    }
    desc += '\n\n\`antilink soft on/off\` - \`antilink soft threshold <n>\` - \`antilink soft window <s>\`';
    const sent = await message.channel.send({
      embeds: [embed.build(guildId, desc, { timestamp: false })],
      allowedMentions: { parse: [] },
    }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  if (arg === 'settings') {
    const antiraid       = db.getAntiraidConfig(guildId);
    const imgRoles       = _readJsonArray(antiraid?.antilinkImageRoles);
    const mediaDomains   = _readJsonArray(antiraid?.antilinkMediaDomains);
    const whitelist      = _readWhitelist(antiraid?.antilinkWhitelist);
    const mediaWl        = _readJsonArray(antiraid?.antilinkMediaWhitelist);
    const allowCh        = _readJsonArray(antiraid?.antilinkAllowedChannels);
    const allowCat       = _readJsonArray(antiraid?.antilinkAllowedCategories);

    const softOn    = Number(antiraid?.antilinkSoftEnabled ?? 1) === 1;
    const threshold  = Number(antiraid?.antilinkSoftThreshold) || 3;
    const windowSec  = Number(antiraid?.antilinkSoftWindow) || 600;

    const currentPunish = antiraid?.antilinkPunish || 'warn';

    const fields = [
      {
        name   : 'Mode',
        value  : `${Number(antiraid?.antilinkEnabled) === 1 ? 'Activé' : 'Désactivé'} - **${_formatMode(antiraid?.antilinkMode)}**`,
        inline : false,
      },
      {
        name   : 'Sanction',
        value  : `**${currentPunish}** (\`antilink punish <delete|warn|mute|kick|ban>\`)`,
        inline : false,
      },
      {
        name   : 'Soft mode',
        value  : softOn && (antiraid?.antilinkPunish || 'warn') === 'delete'
          ? `Activé - **${threshold}** lien(s) / **${windowSec}s**\nNote : la sanction delete ne fait qu'une suppression finale. Utilise warn ou timeout pour une vraie escalade.`
          : `${softOn ? 'Activé' : 'Désactivé'} - **${threshold}** lien(s) / **${windowSec}s**`,
        inline : false,
      },
      {
        name   : `Rôles image (${imgRoles.length})`,
        value  : imgRoles.length ? imgRoles.map(id => `<@&${id}>`).join(', ').slice(0, 1024) : '`Aucun`',
        inline : true,
      },
      {
        name   : `Domaines médias custom (${mediaDomains.length})`,
        value  : mediaDomains.length ? mediaDomains.map(d => `\`${d}\``).join(', ').slice(0, 1024) : '`Aucun`',
        inline : true,
      },
      {
        name   : `Whitelist domaines (${whitelist.length})`,
        value  : whitelist.length ? whitelist.map(d => `\`${d}\``).join(', ').slice(0, 1024) : '`Aucun`',
        inline : true,
      },
      {
        name   : `Whitelist média salons (${mediaWl.length})`,
        value  : mediaWl.length ? mediaWl.map(d => `\`${d}\``).join(', ').slice(0, 1024) : '`Aucun`',
        inline : true,
      },
      {
        name   : `Salons autorisés (${allowCh.length})`,
        value  : allowCh.length ? allowCh.map(id => `<#${id}>`).join(', ').slice(0, 1024) : '`Aucun`',
        inline : true,
      },
      {
        name   : `Catégories autorisées (${allowCat.length})`,
        value  : allowCat.length
          ? allowCat.map(id => { const c = message.guild.channels.cache.get(id); return c ? `\`${c.name}\`` : `\`${id}\``; }).join(', ').slice(0, 1024)
          : '`Aucun`',
        inline : true,
      },
    ];

    const sent = await message.channel.send({
      embeds          : [embed.build(guildId, null, { title: 'Antilink - Configuration', fields, timestamp: false })],
      allowedMentions : { parse: [] },
    }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const antiraid = db.getAntiraidConfig(guildId);

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `Antilink : **${Number(antiraid?.antilinkEnabled) === 1 ? 'Activé' : 'Désactivé'}** - mode **${_formatMode(antiraid?.antilinkMode)}**.`,
        { timestamp: false }
      )
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};

function _readWhitelist(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function _normalizeDomain(input) {
  if (!input) return null;

  const domain = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\s+/g, '');

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return null;
  }

  return domain;
}

function _formatMode(mode) {
  if (mode === 'invite') return 'Invitations Discord uniquement';
  return 'Tous les liens';
}

function _readJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

const INVITE_CODE_REGEX =
  /(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]+)/i;

function _extractInviteCode(input) {
  if (!input) return null;
  const m = INVITE_CODE_REGEX.exec(input);
  return m ? m[1] : null;
}

const inviteGuildCache = new Map();

async function _isOwnGuildInvite(client, guild, code) {
  const cleanCode = String(code || '').trim();
  if (!cleanCode || !guild) return false;

  const vanity = guild.vanityURLCode || null;
  if (vanity && cleanCode.toLowerCase() === vanity.toLowerCase()) {
    return true;
  }

  const cacheKey = cleanCode.toLowerCase();
  const cached   = inviteGuildCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.guildId === guild.id;
  }

  const invite  = await client.fetchInvite(cleanCode).catch(() => null);
  const gId     = invite?.guild?.id ?? null;

  inviteGuildCache.set(cacheKey, {
    guildId   : gId,
    expiresAt : Date.now() + 10 * 60 * 1000,
  });

  return gId === guild.id;
}
