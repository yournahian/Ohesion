import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { supabase } from '../../lib/supabase.js';

/**
 * Builds the comprehensive 5-Row Admin Control Center payload.
 * Fully UI-driven, reusable by both /admin command and UI buttons (like hub_open_admin).
 * @param {import('discord.js').Guild} guild 
 */
export async function getAdminPanelPayload(guild) {
  const guildId = guild.id;

  // Fetch quick stats
  const { count: totalMembersTracked } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('guild_id', guildId);

  const { count: activeRafflesCount } = await supabase
    .from('raffles')
    .select('*', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .eq('is_active', true);

  const { count: activeQuestsCount } = await supabase
    .from('tweet_quests')
    .select('*', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .gte('expires_at', new Date().toISOString());

  const adminEmbed = new EmbedBuilder()
    .setColor(0x06d6a0) // Emerald Green
    .setAuthor({
      name: `${guild.name} • Cohesion Admin Control Center`,
      iconURL: guild.iconURL({ dynamic: true }),
    })
    .setTitle('🛠️ 100% Visual Management Dashboard')
    .setDescription(
      'Manage your community gamification without typing long slash commands or memorizing syntax!\n\n' +
      'Click any button below to open an interactive modal form or selection menu.'
    )
    .addFields(
      { name: '👥 Tracked Members', value: `**${totalMembersTracked || 0}**`, inline: true },
      { name: '📢 Active Quests', value: `**${activeQuestsCount || 0}**`, inline: true },
      { name: '🎟️ Active Raffles', value: `**${activeRafflesCount || 0}**`, inline: true }
    )
    .setFooter({ text: 'Cohesion Admin Panel • 100% UI Control Deck' })
    .setTimestamp();

  // Row 1: Core Quests & Giveaways
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_post_tweet')
      .setLabel('Tweet Quest')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('admin_post_multi')
      .setLabel('CMC & Video Quests')
      .setEmoji('🌐')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('admin_quest_drafts')
      .setLabel('Quest Drafts')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('admin_create_raffle')
      .setLabel('Create Raffle')
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('admin_create_auction')
      .setLabel('Create Auction')
      .setEmoji('🔨')
      .setStyle(ButtonStyle.Success)
  );

  // Row 2: Economy, Rewards & Attendance
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_vc_snapshot')
      .setLabel('VC Snapshot')
      .setEmoji('🎙️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('admin_reward_member')
      .setLabel('Reward Member / Role')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('admin_add_shop')
      .setLabel('Add Shop Item')
      .setEmoji('🛒')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('admin_view_purchases')
      .setLabel('Shop Orders')
      .setEmoji('🧾')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('admin_draw_raffle')
      .setLabel('Draw Winner')
      .setEmoji('🎲')
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 3: Automated Growth & Twitter Feeds
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_track_twitter')
      .setLabel('Auto-Track X Feeds')
      .setEmoji('🤖')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('admin_announcement_reactions')
      .setLabel('Announcement Reacts')
      .setEmoji('⚡')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('admin_tier_roles')
      .setLabel('5-Tier Milestone Roles')
      .setEmoji('🎖️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('admin_economy_settings')
      .setLabel('Weekly Inflation / Decay')
      .setEmoji('🔥')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('admin_top_engagers')
      .setLabel('Top Engagers')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 4: Community Activities, Games & Quizzes
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_create_quiz')
      .setLabel('Create Quiz')
      .setEmoji('🧠')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('admin_create_live_quiz')
      .setLabel('Live Quiz Show')
      .setEmoji('⚡')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('admin_create_poll')
      .setLabel('Create Poll')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('admin_create_battle')
      .setLabel('Chaos Clash')
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('admin_record_vc')
      .setLabel('Voice Studio Notes')
      .setEmoji('🎙️')
      .setStyle(ButtonStyle.Primary)
  );

  // Row 5: Server Architecture, Modes, Data Export, AutoMod & Season Reset
  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_server_mode')
      .setLabel('Server Mode & Modules')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('admin_export_users')
      .setLabel('Export Userlist / CSV')
      .setEmoji('📥')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('admin_automod')
      .setLabel('AutoMod & Shield')
      .setEmoji('🛡️')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('admin_season_wipe')
      .setLabel('Season Reset')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Danger)
  );

  return {
    embeds: [adminEmbed],
    components: [row1, row2, row3, row4, row5],
  };
}

export default {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Open the visual Cohesion Admin Control Center to manage quests, economy, and settings.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild) &&
      !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({
        content: '⛔ You need `Manage Server` permissions to access the Cohesion Admin Control Center.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    const guild =
      interaction.guild ||
      (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);

    if (!guild) {
      return interaction.editReply({
        content: `⚠️ Cohesion is not added to this server as a bot. Please invite Cohesion to this server with Administrator permissions.`,
      });
    }

    const payload = await getAdminPanelPayload(guild);
    return interaction.editReply(payload);
  },
};
