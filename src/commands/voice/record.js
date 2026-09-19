import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import {
  startRecording,
  stopRecording,
  getRecordingStatus,
} from '../../utils/audioRecorder.js';
import { getActiveAiProvider } from '../../utils/callTranscriber.js';

export default {
  data: new SlashCommandBuilder()
    .setName('record')
    .setDescription('🎙️ Multi-track voice recorder with isolated speaker stems & AI transcription')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Start recording a voice channel in multi-track mode')
        .addStringOption((opt) =>
          opt
            .setName('mode')
            .setDescription('Select recording output mode')
            .setRequired(false)
            .addChoices(
              {
                name: 'Both (Audio Stems + Master MP3 + Dialogue Script + Notes)',
                value: 'both',
              },
              {
                name: 'Audio Only (Multi-track stems + Master MP3, 0 AI)',
                value: 'audio',
              },
              {
                name: 'Script & Notes Only (AI Transcription + Summary, deletes audio)',
                value: 'script',
              }
            )
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Voice channel to record (defaults to your current channel)')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('stop')
        .setDescription('Stop the current recording session and generate deliverables')
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Check active recording duration and active speakers')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    // Check permissions
    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild) &&
      !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({
        content: '⛔ **Access Denied**: You need `Manage Server` or `Administrator` permissions to control recordings.',
        ephemeral: true,
      });
    }

    // ==========================================
    // 1. SUBCOMMAND: START
    // ==========================================
    if (subcommand === 'start') {
      const mode = interaction.options.getString('mode') || 'both';
      let targetChannel = interaction.options.getChannel('channel');

      if (!targetChannel) {
        const memberVoiceState = interaction.member.voice;
        if (!memberVoiceState?.channel) {
          return interaction.reply({
            content: '⚠️ Please either join a voice channel first or specify one in the `/record start channel:` option.',
            ephemeral: true,
          });
        }
        targetChannel = memberVoiceState.channel;
      }

      // Verify bot permissions in voice channel
      const permissions = targetChannel.permissionsFor(interaction.client.user);
      if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions?.has(PermissionFlagsBits.Speak)) {
        return interaction.reply({
          content: `❌ I do not have permission to **Connect** or **Speak** in <#${targetChannel.id}>. Please check my server permissions!`,
          ephemeral: true,
        });
      }

      await interaction.deferReply();

      try {
        const session = await startRecording({
          voiceChannel: targetChannel,
          client: interaction.client,
          mode,
          initiatedBy: interaction.user,
        });

        const aiProvider = getActiveAiProvider();
        let aiProviderLabel = 'None (0 AI calls)';
        if (mode !== 'audio') {
          if (aiProvider === 'groq') aiProviderLabel = '🟢 Groq Cloud (Free Whisper Turbo + LLaMA 3.3)';
          else if (aiProvider === 'gemini') aiProviderLabel = '🟢 Google Gemini 1.5 Flash (Free)';
          else if (aiProvider === 'openai') aiProviderLabel = '🟡 OpenAI Whisper';
          else aiProviderLabel = '⚠️ No AI key set (will fallback to Audio Only)';
        }

        const modeDisplay = {
          both: '🎙️ **Both** (Audio Stems + Master MP3 + Dialogue Script + Notes)',
          audio: '🎵 **Audio Only** (Isolated Stems + Master MP3, No AI)',
          script: '📝 **Script & Notes Only** (AI Transcription, Audio deleted)',
        }[mode];

        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🔴 Multi-Track Voice Recording Active')
          .setDescription(
            `Questify is now listening in **<#${targetChannel.id}>**!\n\n` +
            `• **Output Mode:** ${modeDisplay}\n` +
            `• **AI Transcription Engine:** ${aiProviderLabel}\n` +
            `• **Started By:** <@${interaction.user.id}>\n` +
            `• **Stem Synchronization:** Timeline-aligned from \`00:00\`\n\n` +
            `*Each member who speaks will be recorded to their own isolated audio track. When finished, click **Stop Recording** or use \`/record stop\`.*`
          )
          .setFooter({ text: `Session ID: ${session.sessionId} • Questify Podcast Engine` })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('record_stop')
            .setLabel('Stop & Process Deliverables')
            .setEmoji('⏹️')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('record_status')
            .setLabel('Session Status')
            .setEmoji('ℹ️')
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
      } catch (err) {
        console.error('[RECORD START ERROR]:', err);
        return interaction.editReply({
          content: `❌ Could not start recording: ${err.message}`,
        });
      }
    }

    // ==========================================
    // 2. SUBCOMMAND: STOP
    // ==========================================
    if (subcommand === 'stop') {
      const activeStatus = getRecordingStatus(guildId);
      if (!activeStatus) {
        return interaction.reply({
          content: '⚠️ There is no active recording session currently running in this server.',
          ephemeral: true,
        });
      }

      await interaction.deferReply();

      await interaction.editReply({
        content: '⏳ **Concluding session and processing multi-track audio...**\n*Mixing master track, aligning speaker stems, and generating AI meeting notes. This may take 10-30 seconds depending on duration.*',
      });

      try {
        const deliverables = await stopRecording(guildId);
        const { sessionMeta } = deliverables;

        const embed = new EmbedBuilder()
          .setColor(0x06d6a0)
          .setTitle('🎙️ Podcast & Call Production Ready!')
          .setDescription(
            `**Channel:** <#${sessionMeta.channelId}>\n` +
            `**Total Duration:** \`${sessionMeta.durationFormatted}\`\n` +
            `**Recorded Speakers (${sessionMeta.speakers.length}):** ${sessionMeta.speakers.map((s) => `\`${s}\``).join(', ') || '*None detected*'}\n` +
            `**Mode:** \`${sessionMeta.mode.toUpperCase()}\``
          )
          .setTimestamp();

        // If meeting notes / AI summary was generated, extract preview
        if (deliverables.meetingNotesMarkdown && deliverables.meetingNotesMarkdown.length > 50) {
          const previewText = deliverables.meetingNotesMarkdown
            .replace(/^#+ [^\n]+/gm, '')
            .trim()
            .slice(0, 1000);

          embed.addFields({
            name: '📋 Executive Briefing Preview',
            value: previewText + (deliverables.meetingNotesMarkdown.length > 1000 ? '\n\n*(Full briefing attached below)*' : ''),
          });
        }

        // List deliverables attached
        const filesList = [];
        if (deliverables.masterMp3Path) filesList.push('🎵 `Master_Podcast_Mix.mp3` (Combined Master Audio)');
        if (deliverables.stemsZipPath) filesList.push('🗂️ `MultiTrack_Stems.zip` (Isolated Speaker Stems for DAWs)');
        if (deliverables.scriptPath) filesList.push('📝 `Script_Transcript.md` (Full Chronological Dialogue Script)');
        if (deliverables.notesPath) filesList.push('📋 `Meeting_Notes.md` (Action Items & Timestamped Timeline)');

        if (filesList.length > 0) {
          embed.addFields({
            name: '📦 Deliverables Attached',
            value: filesList.join('\n'),
          });
        } else {
          embed.addFields({
            name: 'ℹ️ Deliverables',
            value: 'No audio chunks were captured from speakers during this session.',
          });
        }

        return interaction.editReply({
          content: `✅ Recording session concluded! Here are your production deliverables:`,
          embeds: [embed],
          files: deliverables.filesToAttach,
        });
      } catch (err) {
        console.error('[RECORD STOP ERROR]:', err);
        return interaction.editReply({
          content: `❌ Error finalizing recording: ${err.message}`,
        });
      }
    }

    // ==========================================
    // 3. SUBCOMMAND: STATUS
    // ==========================================
    if (subcommand === 'status') {
      const status = getRecordingStatus(guildId);
      if (!status) {
        return interaction.reply({
          content: 'ℹ️ No active recording session in this server.',
          ephemeral: true,
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x118ab2)
        .setTitle('🎙️ Active Recording Session Status')
        .setDescription(
          `• **Voice Channel:** <#${status.channelId}>\n` +
          `• **Elapsed Duration:** \`${status.durationFormatted}\`\n` +
          `• **Active Speakers (${status.speakersCount}):** ${status.speakers.map((s) => `\`${s}\``).join(', ') || '*Listening for voices...*'}\n` +
          `• **Output Mode:** \`${status.mode.toUpperCase()}\`\n` +
          `• **Initiated By:** ${status.initiatedBy}`
        )
        .setFooter({ text: `Session ID: ${status.sessionId}` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
