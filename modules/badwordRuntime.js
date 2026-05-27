'use strict';


const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');
const punishSteps  = require('./punishSteps');
const { applyMute } = require('../utils/applyMute');

async function check(client, message, config, guildId) {
  try {
    if (!config?.badwordList) {
      return false;
    }

    const list = _readBadwords(config.badwordList);
    if (!list.length) {
      return false;
    }

    const content = (message.content || '').toLowerCase().trim();
    if (!content) {
      return false;
    }

    const found = list.find(word =>
      typeof word === 'string' &&
      word.trim() &&
      content.includes(word.toLowerCase().trim())
    );

    if (!found) {
      return false;
    }

    const { member, channel, guild } = message;

    let punishment = config.antibadwordPunish ?? 'warn';

    const weight = _computeStrikeWeight(member, guildId, 'badword');

    punishment = punishSteps.getPunishment(
      guildId,
      member.id,
      punishment,
      'badword',
      weight
    );

    punishSteps.decay(
      guildId,
      member.id,
      undefined,
      'badword'
    );

    await message.delete().catch(() => {});

    const _feedbackCfg   = db.getGuildConfig(guildId);
    const _feedbackDelay = _feedbackCfg?.autoDeleteDelay ?? 5;

    switch (punishment) {
      case 'delete':
        break;

      case 'warn':
        db.addSanction(
          guildId,
          member.id,
          client.user.id,
          'warn',
          `Automod -badword (${found})`
        );

        await channel.send({
          embeds: [
            embed.build(
              guildId,
              `<@${member.id}> a reçu un avertissement automatique. (\`${found}\`)`
            ),
          ],
          allowedMentions: { parse: [] },
        }).then(m =>
          embed.scheduleDelete(m, _feedbackDelay)
        ).catch(() => {});

        break;

      case 'mute': {


        const guildCfg = db.getGuildConfig(guildId);
        const result = await applyMute({
          guild     : guild,
          member,
          config    : guildCfg,
          durationMs: 10 * 60 * 1000,
          reason    : `Automod -badword (${found})`,
          source    : 'badword',
        });

        if (!result.applied) {
          db.addSanction(
            guildId,
            member.id,
            client.user.id,
            'warn',
            `Automod -badword (${found}) [mute impossible: ${result.reason ?? 'inconnu'}]`
          );

          punishment = 'warn';
          break;
        }

        db.addSanction(
          guildId,
          member.id,
          client.user.id,
          'mute',
          `Automod -badword (${found})`,
          600
        );

        break;
      }

      case 'kick':
        await member.kick(
          `Automod -badword (${found})`
        ).catch(() => {});

        db.addSanction(
          guildId,
          member.id,
          client.user.id,
          'kick',
          `Automod -badword (${found})`
        );

        break;

      case 'ban':
        await guild.members.ban(
          member.id,
          { reason: `Automod -badword (${found})` }
        ).catch(() => {});

        db.addSanction(
          guildId,
          member.id,
          client.user.id,
          'ban',
          `Automod -badword (${found})`
        );

        break;

      case 'derank': {
        const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        const keepRoles = new Set(db.getNoderankRoles(guildId));
        const rolesToRemove = member.roles.cache
          .filter(role => role.id !== guild.id && !keepRoles.has(role.id) && !role.managed && (!me || me.roles.highest.comparePositionTo(role) > 0))
          .map(role => role.id);

        if (rolesToRemove.length) {
          const deranked = await member.roles
            .remove(rolesToRemove, `Automod -badword (${found})`)
            .then(() => true)
            .catch(() => false);

          if (deranked) {
            db.addSanction(
              guildId,
              member.id,
              client.user.id,
              'derank',
              `Automod -badword (${found})`
            );
          } else {
            db.addSanction(
              guildId,
              member.id,
              client.user.id,
              'warn',
              `Automod -badword (${found}) [derank échoué]`
            );
            punishment = 'warn';
          }
        } else {
          db.addSanction(
            guildId,
            member.id,
            client.user.id,
            'warn',
            `Automod -badword (${found}) [aucun rôle retirable]`
          );
          punishment = 'warn';
        }

        await channel.send({
          embeds: [
            embed.build(
              guildId,
              `<@${member.id}> a été sanctionné automatiquement. (\`${found}\`)`
            ),
          ],
          allowedMentions: { parse: [] },
        }).then(m =>
          embed.scheduleDelete(m, _feedbackDelay)
        ).catch(() => {});

        break;
      }

      default:
        db.addSanction(
          guildId,
          member.id,
          client.user.id,
          'warn',
          `Automod -badword (${found})`
        );

        await channel.send({
          embeds: [
            embed.build(
              guildId,
              `<@${member.id}> a reçu un avertissement automatique. (\`${found}\`)`
            ),
          ],
          allowedMentions: { parse: [] },
        }).then(m =>
          embed.scheduleDelete(m, _feedbackDelay)
        ).catch(() => {});

        punishment = 'warn';
        break;
    }

    const e = embed.log(
      guildId,
      'Automod -badword',
      [
        {
          name   : 'Membre',
          value  : `<@${member.id}> (${member.user.tag}) \`${member.id}\``,
          inline : true,
        },
        {
          name   : 'Mot détecté',
          value  : `\`${found}\``,
          inline : true,
        },
        {
          name   : 'Action',
          value  : punishment,
          inline : true,
        },
        {
          name   : 'Salon',
          value  : `<#${channel.id}>`,
          inline : true,
        },
      ]
    );

    await logger.send(
      client,
      guildId,
      'raidlog',
      e
    );

    return true;
  } catch (err) {
    errorHandler.handle(err, {
      source : 'badwordRuntime',
      guildId,
    });
  }

  return false;
}

function _computeStrikeWeight(member, guildId, trigger) {
  if (!trigger) return 1;

  try {
    const guildConfig    = db.getGuildConfig(guildId);
    const ancienDuration = Number(guildConfig?.ancienDuration ?? 604800);
    const ancienMs       = ancienDuration * 1000;

    const isAncien = Boolean(
      member?.joinedTimestamp &&
      Date.now() - member.joinedTimestamp >= ancienMs
    );

    const cfg = db.getStrikeTrigger(guildId, trigger);

    if (!cfg) return 1;

    const raw = isAncien ? cfg.ancienStr : cfg.strikes;
    const n   = Number(raw);

    if (!Number.isFinite(n) || n < 1) return 1;
    if (n > 20) return 20;

    return Math.floor(n);
  } catch {
    return 1;
  }
}

function _readBadwords(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = { check };
