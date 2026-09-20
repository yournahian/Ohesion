import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { getGuildInflation } from '../workers/inflationWorker.js';

/**
 * Builds the visual interactive Inflation & Economic Decay UI Dashboard.
 * 100% UI-driven: Toggle ON/OFF with 1 click, choose preset rates, or customize.
 * @param {string} guildId 
 * @param {string} guildName 
 */
export function buildInflationDashboard(guildId, guildName = 'Server') {
  const current = getGuildInflation(guildId);
  const isEnabled = Boolean(current.enabled && current.rate > 0);
  const burnPct = Math.round((current.rate || 0.05) * 100);

  const embed = new EmbedBuilder()
    .setColor(isEnabled ? 0xff4757 : 0x747d8c)
    .setTitle('🔥 Cohesion Economy • Weekly Point Inflation & Decay')
    .setDescription(
      `Control the automated weekly deflationary engine for **${guildName}**.\n` +
      `Weekly decay prevents point hoarding, maintains a healthy auction/shop ecosystem, and ensures new members can compete fairly.`
    )
    .addFields(
      {
        name: '⚙️ Current Engine Status',
        value: isEnabled
          ? `🟢 **ACTIVE / ON** (\`${burnPct}%\` weekly point burn)`
          : `🔴 **DISABLED / OFF** (No points are burned)`,
        inline: true,
      },
      {
        name: '⏰ Execution Schedule',
        value: isEnabled ? '`Every Sunday at Midnight UTC`' : '`Paused`',
        inline: true,
      },
      {
        name: '🛡️ Protected Currencies',
        value: '`XP, Leveling, and Tier Roles are 100% exempt from decay`',
        inline: false,
      }
    )
    .setFooter({
      text: 'Cohesion 100% Native Discord UI • Click buttons below to toggle or adjust',
    })
    .setTimestamp();

  // Row 1: 1-Click Toggle ON/OFF + Custom Rate
  const row1 = new ActionRowBuilder().addComponents(
    isEnabled
      ? new ButtonBuilder()
          .setCustomId('inflation_toggle_off')
          .setLabel('🔴 Turn OFF Inflation')
          .setEmoji('⏹️')
          .setStyle(ButtonStyle.Danger)
      : new ButtonBuilder()
          .setCustomId('inflation_toggle_on')
          .setLabel('🟢 Turn ON Inflation (5% Default)')
          .setEmoji('▶️')
          .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('inflation_btn_custom')
      .setLabel('✏️ Set Custom %')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Primary)
  );

  // Row 2: 1-Click Rate Presets
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('inflation_preset_3')
      .setLabel('3% Mild')
      .setEmoji('🌱')
      .setStyle(burnPct === 3 && isEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('inflation_preset_5')
      .setLabel('5% Standard')
      .setEmoji('⚖️')
      .setStyle(burnPct === 5 && isEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('inflation_preset_10')
      .setLabel('10% Dynamic')
      .setEmoji('🔥')
      .setStyle(burnPct === 10 && isEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('inflation_preset_15')
      .setLabel('15% Fast Burn')
      .setEmoji('⚡')
      .setStyle(burnPct === 15 && isEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  // Row 3: Return to Admin Console
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_back_to_main')
      .setLabel('Back to Admin Console')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row1, row2, row3],
  };
}
