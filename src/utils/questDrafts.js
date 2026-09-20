/**
 * In-memory & cached Quest Presets / Drafts storage for Cohesion.
 * Allows admins to quickly apply complex quest filters with 1 click.
 */
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';

const guildDrafts = new Map();

// Built-in default presets
export const DEFAULT_PRESETS = [
  {
    name: 'standard_raid',
    description: 'Standard raid: 50 CP, 24h duration, Like + Retweet + Reply.',
    points: 50,
    duration: '24h',
    buttons: 'like, rt, comment',
    leadEngagersBonus: 10,
    verifiedOnly: false,
    requireFollow: false,
    minCharacters: 5,
    keyword: '',
  },
  {
    name: 'high_priority',
    description: 'High priority raid: 100 CP, 6h duration, 2x Lead Engagers bonus.',
    points: 100,
    duration: '6h',
    buttons: 'like, rt, comment',
    leadEngagersBonus: 25,
    verifiedOnly: false,
    requireFollow: true,
    minCharacters: 15,
    keyword: '#Cohesion',
  },
  {
    name: 'verified_only',
    description: 'Exclusive raid: 150 CP, 12h, Twitter Blue / X Premium verified only.',
    points: 150,
    duration: '12h',
    buttons: 'like, rt',
    leadEngagersBonus: 30,
    verifiedOnly: true,
    requireFollow: true,
    minCharacters: 0,
    keyword: '',
  },
];

/**
 * Gets all available drafts for a guild.
 * @param {string} guildId 
 * @returns {Array<Object>}
 */
export function getGuildDrafts(guildId) {
  const custom = guildDrafts.get(guildId) || [];
  return [...DEFAULT_PRESETS, ...custom];
}

/**
 * Saves a new custom draft for a guild.
 * @param {string} guildId 
 * @param {Object} draft 
 */
export function saveGuildDraft(guildId, draft) {
  if (!guildDrafts.has(guildId)) {
    guildDrafts.set(guildId, []);
  }
  const list = guildDrafts.get(guildId);
  const existingIndex = list.findIndex((d) => d.name.toLowerCase() === draft.name.toLowerCase());
  if (existingIndex >= 0) {
    list[existingIndex] = draft;
  } else {
    list.push(draft);
  }
}

/**
 * Deletes a custom draft from a guild.
 * @param {string} guildId 
 * @param {string} draftName 
 */
export function deleteGuildDraft(guildId, draftName) {
  if (!guildDrafts.has(guildId)) return false;
  const list = guildDrafts.get(guildId);
  const filtered = list.filter((d) => d.name.toLowerCase() !== draftName.toLowerCase());
  guildDrafts.set(guildId, filtered);
  return true;
}

/**
 * Builds the interactive 100% UI Quest Drafts & Presets Dashboard.
 * Includes a Select Menu to 1-click launch any draft, plus buttons to create/manage presets.
 * @param {string} guildId 
 */
export function buildQuestDraftsDashboard(guildId) {
  const drafts = getGuildDrafts(guildId);
  const customDrafts = guildDrafts.get(guildId) || [];

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📝 Cohesion Quest Presets & Drafts Engine')
    .setDescription(
      `Save and launch recurring quest formats in **1-click** without repeatedly typing points, buttons, and duration filters.\n\n` +
      `**Active Drafts & Presets:**\n\n` +
      drafts
        .map(
          (d, i) =>
            `**${i + 1}. \`${d.name}\`** ${DEFAULT_PRESETS.some((dp) => dp.name === d.name) ? '*(Built-in)*' : '*(Custom)*'}\n` +
            `↳ ${d.description}\n` +
            `↳ Points: **${d.points} CP** • Duration: **${d.duration}** • Buttons: \`${d.buttons || 'like, rt'}\``
        )
        .join('\n\n')
    )
    .setFooter({ text: 'Select a draft below to quick-launch, or create a new custom preset' })
    .setTimestamp();

  // Select menu to launch a quest using a draft
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_launch_draft')
    .setPlaceholder('🚀 Select a Draft to Quick-Launch...')
    .addOptions(
      drafts.slice(0, 25).map((d) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(d.name)
          .setValue(d.name)
          .setDescription(`${d.points} CP • ${d.duration} • ${(d.description || '').slice(0, 50)}`)
          .setEmoji('🚀')
      )
    );

  const row1 = new ActionRowBuilder().addComponents(selectMenu);

  const actionButtons = [
    new ButtonBuilder()
      .setCustomId('btn_create_quest_draft')
      .setLabel('Create Custom Draft')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Success),
  ];

  if (customDrafts.length > 0) {
    actionButtons.push(
      new ButtonBuilder()
        .setCustomId('btn_delete_quest_draft')
        .setLabel('Delete Custom Draft')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger)
    );
  }

  actionButtons.push(
    new ButtonBuilder()
      .setCustomId('admin_back_to_main')
      .setLabel('Back to Admin Console')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(actionButtons);

  return {
    embeds: [embed],
    components: [row1, row2],
  };
}
