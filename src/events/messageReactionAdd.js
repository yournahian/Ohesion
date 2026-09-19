import { getActiveMatch, joinBattleMatch, buildLobbyPayload } from '../modules/battle/battleEngine.js';

export default {
  name: 'messageReactionAdd',
  once: false,
  async execute(reaction, user, client) {
    if (user.bot) return;

    // Handle partial reactions/messages
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (_) {
        return;
      }
    }

    const emojiName = reaction.emoji?.name;
    if (emojiName !== '⚔️') return;

    const message = reaction.message;
    const guildId = message.guildId;
    if (!guildId) return;

    const match = getActiveMatch(guildId);
    if (!match || match.messageId !== message.id || match.status !== 'signup') {
      return;
    }

    // Attempt to join the user
    const result = await joinBattleMatch(guildId, user);
    if (!result.success) {
      // Send error as DM if possible
      try {
        await user.send(`⚠️ **Chaos Clash:** ${result.message}`);
      } catch (_) {}
      return;
    }

    // Refresh lobby message embed with new participant count
    const payload = buildLobbyPayload(result.match);
    await message.edit(payload).catch(() => null);

    // Calculate remaining seconds
    const remainingSec = Math.max(
      1,
      Math.round((match.createdAt + match.signupDurationSec * 1000 - Date.now()) / 1000)
    );

    const confirmation =
      match.mode === 'interactive'
        ? `⚔️ Welcome to the Arena! You have entered Chaos Clash (${result.totalJoined} fighters currently registered). 🛡️ Click Choose Archetype on the lobby message if you want to switch from default Tactician to Berserker, Medic, or Thief!\nStarting in ${remainingSec} seconds.`
        : `⚔️ Welcome to the Arena! You have entered Chaos Clash (${result.totalJoined} fighters currently registered).\nStarting in ${remainingSec} seconds.`;

    try {
      await user.send(confirmation);
    } catch (_) {}
  },
};
