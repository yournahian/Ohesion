import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  AttachmentBuilder,
} from 'discord.js';

// Cache of active open tickets: `${guildId}:${userId}` => channelId
const activeTickets = new Map();

/**
 * Builds the interactive Modal for opening a Support Ticket.
 */
export function buildTicketModal() {
  const modal = new ModalBuilder()
    .setCustomId('modal_create_ticket')
    .setTitle('🎫 Open Support Ticket');

  const subjectInput = new TextInputBuilder()
    .setCustomId('input_ticket_subject')
    .setLabel('Subject / Reason')
    .setPlaceholder('e.g. Missing Points, Quest Verification, General Inquiry')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(80)
    .setRequired(true);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('input_ticket_desc')
    .setLabel('Detailed Explanation')
    .setPlaceholder('Please describe your issue or question in detail...')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(subjectInput),
    new ActionRowBuilder().addComponents(descriptionInput)
  );

  return modal;
}

/**
 * Creates a private Support Ticket channel for a member.
 * @param {import('discord.js').Guild} guild 
 * @param {import('discord.js').User} user 
 * @param {{ subject: string, description: string }} data 
 */
export async function createTicketChannel(guild, user, { subject, description }) {
  const ticketKey = `${guild.id}:${user.id}`;
  const existingChannelId = activeTickets.get(ticketKey);

  if (existingChannelId) {
    const existingCh = guild.channels.cache.get(existingChannelId);
    if (existingCh) {
      return {
        success: false,
        message: `⚠️ You already have an active support ticket open in <#${existingChannelId}>! Please use your existing ticket.`,
        channel: existingCh,
      };
    }
    activeTickets.delete(ticketKey);
  }

  // 1. Locate or create "🎫 SUPPORT TICKETS" Category
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && /support|tickets/i.test(c.name)
  );

  if (!category) {
    try {
      category = await guild.channels.create({
        name: '🎫 SUPPORT TICKETS',
        type: ChannelType.GuildCategory,
      });
    } catch (_) {
      category = null;
    }
  }

  const cleanName = user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 14) || 'member';
  const randomPin = Math.floor(100 + Math.random() * 900);
  const channelName = `ticket-${cleanName}-${randomPin}`;

  // 2. Permission Overwrites
  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];

  if (guild.members.me) {
    permissionOverwrites.push({
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }

  // 3. Create the Channel
  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category?.id || undefined,
    topic: `Cohesion Support Ticket for ${user.tag} (${user.id}) • Subject: ${subject}`,
    permissionOverwrites,
  });

  activeTickets.set(ticketKey, ticketChannel.id);

  // 4. Send the Initial Control Card into the Ticket
  const embed = new EmbedBuilder()
    .setColor(0x06d6a0)
    .setTitle(`🎫 Support Ticket: ${subject}`)
    .setDescription(
      `Hello <@${user.id}>! Thank you for reaching out to **${guild.name}** Support.\n\n` +
      `📌 **Subject:** \`${subject}\`\n\n` +
      `📝 **Issue Description:**\n> ${description.replace(/\n/g, '\n> ')}\n\n` +
      `*A server administrator or staff member will review your inquiry shortly. Feel free to provide screenshots or additional context below!*`
    )
    .addFields(
      { name: '👤 Ticket Creator', value: `<@${user.id}> (\`${user.id}\`)`, inline: true },
      { name: '⏰ Created At', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
    )
    .setFooter({ text: 'Cohesion Support Ticket Engine • Click buttons below to manage' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_close_${ticketChannel.id}`)
      .setLabel('Close Ticket (Staff Only)')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ticket_transcript_${ticketChannel.id}`)
      .setLabel('Save Transcript')
      .setEmoji('📄')
      .setStyle(ButtonStyle.Secondary)
  );

  await ticketChannel.send({
    content: `👋 Welcome <@${user.id}>! Staff has been notified of your support request.`,
    embeds: [embed],
    components: [row],
  });

  return {
    success: true,
    channel: ticketChannel,
  };
}

/**
 * Generates an exportable text transcript of all messages in a ticket channel.
 * @param {import('discord.js').TextChannel} channel 
 */
export async function generateTicketTranscript(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const sorted = Array.from(messages.values()).reverse();

    let transcript = `====================================================\n`;
    transcript += `COHESION SUPPORT TICKET TRANSCRIPT\n`;
    transcript += `Channel: #${channel.name} (${channel.id})\n`;
    transcript += `Server: ${channel.guild.name} (${channel.guild.id})\n`;
    transcript += `Exported: ${new Date().toISOString()}\n`;
    transcript += `====================================================\n\n`;

    for (const msg of sorted) {
      const time = msg.createdAt.toISOString().replace('T', ' ').slice(0, 19);
      const author = msg.author.tag || msg.author.username;
      transcript += `[${time}] ${author}: ${msg.content || '[Embed/Attachment]'}\n`;
      if (msg.attachments.size > 0) {
        msg.attachments.forEach(att => {
          transcript += `   -> Attachment: ${att.url}\n`;
        });
      }
    }

    return new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), {
      name: `${channel.name}-transcript.txt`,
    });
  } catch (err) {
    return null;
  }
}

/**
 * Closes an active ticket channel, locking permissions and archiving it.
 * @param {import('discord.js').TextChannel} channel 
 * @param {import('discord.js').User} closedByUser 
 */
export async function closeTicket(channel, closedByUser) {
  // Find creator ID from topic
  const topicMatch = channel.topic?.match(/\((\d{17,20})\)/);
  const creatorId = topicMatch ? topicMatch[1] : null;

  if (creatorId) {
    activeTickets.delete(`${channel.guild.id}:${creatorId}`);
    // Lock creator from sending messages
    await channel.permissionOverwrites.edit(creatorId, {
      SendMessages: false,
    }).catch(() => null);
  }

  const transcript = await generateTicketTranscript(channel);

  const closedEmbed = new EmbedBuilder()
    .setColor(0xe63946)
    .setTitle('🔒 Ticket Closed')
    .setDescription(
      `This ticket was closed by <@${closedByUser.id}>.\n\n` +
      `The channel is now archived and view-only. You can download the transcript below or permanently delete this channel.`
    )
    .setFooter({ text: 'Cohesion Support Ticket System' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_transcript_${channel.id}`)
      .setLabel('Download Transcript')
      .setEmoji('📄')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ticket_delete_${channel.id}`)
      .setLabel('Delete Channel')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
  );

  const files = transcript ? [transcript] : [];
  await channel.send({ embeds: [closedEmbed], components: [row], files });
}
