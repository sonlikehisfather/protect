'use strict';

const { PermissionsBitField } = require('discord.js');

const db                = require('../../core/database');
const embed             = require('../../utils/embed');
const perms             = require('../../utils/permissions');
const { resolveMember } = require('../../utils/memberResolver');

module.exports = {
  help: {
    name        : 'underank',
    description : 'Restaure les rôles retirés par un derank antiraid.',
    usage       : 'underank <membre>',
    aliases     : [],
    category    : 'moderation',
  },

  async run(client, message, args) {
    if (!perms.check(message, 'underank')) return;

    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    const done = async (text, error = false) => {
      const sent = error
        ? await embed.replyError(message, text, { timestamp: false }).catch(() => null)
        : await embed.sendEmbed(message.channel, guildId, text, { timestamp: false, allowedMentions: { parse: [] } });
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    };

    if (deleteCmd) await message.delete().catch(() => {});

    const member = await resolveMember(message, args);
    if (!member) return done('Membre introuvable.', true);

    const backup = db.getFivemRoleBackup(guildId, member.id, 'derank');
    if (!backup) return done(`Aucune sauvegarde de derank pour <@${member.id}>.`, true);

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return done('Je n’ai pas la permission de gérer les rôles.', true);
    }

    const privileged = perms.isBuyer(message.author.id) || perms.isOwner(guildId, message.author.id);
    const ceiling    = privileged ? Infinity : (message.member?.roles.highest.position ?? 0);

    let restored = 0;
    let skipped  = 0;

    for (const roleId of backup.roles) {
      const role = guild.roles.cache.get(roleId);
      if (!role || role.managed || role.position >= me.roles.highest.position || role.position >= ceiling) {
        skipped++;
        continue;
      }
      if (member.roles.cache.has(roleId)) continue;
      await member.roles.add(roleId, `Underank par ${message.author.tag}`)
        .then(() => { restored++; })
        .catch(() => { skipped++; });
    }

    db.deleteFivemRoleBackup(guildId, member.id, 'derank');

    return done(`Underank terminé pour <@${member.id}>.\nRôles restaurés : **${restored}**\nIgnorés : **${skipped}**`);
  },
};
