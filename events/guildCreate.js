'use strict';


const db    = require('../core/database');
const perms = require('../utils/permissions');

module.exports = {
  name : 'guildCreate',
  once : false,

  async execute(client, guild) {
    try {


      try { db.unmarkGuildPendingPurge(guild?.id); } catch {}


      if (db.getBotSetting('securInvite') !== '1') return;

      const ownerId = guild.ownerId;

      if (ownerId && (perms.isBuyer(ownerId) || perms.isGlobalOwner(ownerId))) {
        console.log(`[SecurInvite] Serveur autorisé : ${guild.name} (${guild.id}) - owner autorisé (${ownerId})`);
        return;
      }


      const globalOwnerIds = db.getGlobalOwners();
      const buyerId        = perms.getBuyerId();

      const trustedIds = new Set(globalOwnerIds);
      if (buyerId) trustedIds.add(buyerId);


      let found = false;

      for (const id of trustedIds) {
        if (guild.members.cache.has(id)) {
          found = true;
          break;
        }
      }


      if (!found && trustedIds.size > 0) {
        for (const id of trustedIds) {
          const member = await guild.members.fetch(id).catch(() => null);
          if (member) {
            found = true;
            break;
          }
        }
      }

      if (found) {
        console.log(`[SecurInvite] Serveur autorisé : ${guild.name} (${guild.id}) - membre autorisé présent`);
        return;
      }

      console.log(`[SecurInvite] Serveur non autorisé : ${guild.name} (${guild.id}) - leave`);


      try {
        const channel = guild.channels.cache.find(ch =>
          ch.isTextBased() &&
          !ch.isThread() &&
          ch.permissionsFor(guild.members.me)?.has('SendMessages')
        );

        if (channel) {
          await channel.send({
            content         : '⚠️ Ce serveur n\'est pas autorisé. Le bot quitte automatiquement.',
            allowedMentions : { parse: [] },
          }).catch(() => {});
        }
      } catch {
      }

      await guild.leave().catch(() => {});
    } catch (err) {
      console.error(`[SecurInvite] Erreur sur ${guild?.name ?? '?'} (${guild?.id ?? '?'}) :`, err.message);
    }
  },
};
