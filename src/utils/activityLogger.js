import { EmbedBuilder } from 'discord.js';

/**
 * Sends a structured audit embed to the server's designated log channel (#cohesion-logs or configured log channel).
 *
 * @param {import('discord.js').Guild} guild - Discord guild instance
 * @param {Object} options
 * @param {string} options.title - Embed title
 * @param {string} options.description - Detailed description
 * @param {number} [options.color] - Hex color code (default: 0x5865f2)
 * @param {Array<{name: string, value: string, inline?: boolean}>} [options.fields] - Embed fields
 * @param {string} [options.footer] - Footer text
 */
export async function logActivity(guild, { title, description, color = 0x5865f2, fields = [], footer = 'Cohesion Activity Logger' }) {
  if (!guild) return;

  try {
    // Look for channel named 'cohesion-logs' or 'activity-logs'
    const logChannel = guild.channels.cache.find(
      (c) => c.isTextBased() && (c.name.includes('cohesion-logs') || c.name.includes('activity-logs') || c.name.includes('engage-logs'))
    );

    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: footer })
      .setTimestamp();

    if (fields && fields.length > 0) {
      embed.addFields(fields);
    }

    await logChannel.send({ embeds: [embed] }).catch(() => null);
  } catch (err) {
    console.warn('[ACTIVITY LOG ERROR]:', err.message);
  }
}
