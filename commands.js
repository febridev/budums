import { SlashCommandBuilder } from 'discord.js';
import { getChannelConfig, setChannelConfig } from './channels.js';
import { handleReceiptCommand } from './receipt.js';

export const slashCommands = [
  new SlashCommandBuilder()
    .setName('receipt')
    .setDescription('Scan a receipt image and save spending to Google Sheet')
    .addAttachmentOption((opt) =>
      opt
        .setName('image')
        .setDescription('Receipt image (JPG, PNG, WebP)')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('category')
        .setDescription('Optional category override (e.g. jajan, makan, belanja)')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('item')
        .setDescription('Optional item description override')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('set-sheet')
    .setDescription('Configure and remember the Google Sheet for this channel')
    .addStringOption((opt) =>
      opt
        .setName('sheet')
        .setDescription('Google Sheet URL or Spreadsheet ID')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('tab')
        .setDescription('Tab name (default: Sheet1)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('current-sheet')
    .setDescription('Show which Google Sheet is configured for this channel'),
];

export async function handleInteraction(interaction, { appendSpend, aiClient } = {}) {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'set-sheet') {
    const sheetInput = interaction.options.getString('sheet', true);
    const tabInput = interaction.options.getString('tab') || 'Sheet1';

    try {
      const saved = setChannelConfig(interaction.channelId, sheetInput, tabInput);
      await interaction.reply({
        content:
          `✅ **Google Sheet configured for this channel!**\n` +
          `• **Spreadsheet ID:** \`${saved.spreadsheetId}\`\n` +
          `• **Tab:** \`${saved.tab}\`\n\n` +
          `You can now use \`/receipt\` or post text spends here!`,
      });
    } catch (err) {
      await interaction.reply({
        content: `❌ Could not set sheet: ${err.message}`,
        ephemeral: true,
      });
    }
    return;
  }

  if (commandName === 'current-sheet') {
    const config = getChannelConfig(interaction.channelId);
    if (!config) {
      await interaction.reply({
        content:
          `⚠️ **No Google Sheet is configured for this channel yet.**\n` +
          `Use \`/set-sheet sheet:<Google Sheet URL or ID> tab:<Tab Name>\` to set one.`,
      });
      return;
    }

    await interaction.reply({
      content:
        `📊 **Current Google Sheet for this channel:**\n` +
        `• **Spreadsheet ID:** \`${config.spreadsheetId}\`\n` +
        `• **Tab:** \`${config.tab}\``,
    });
    return;
  }

  if (commandName === 'receipt') {
    const config = getChannelConfig(interaction.channelId);
    if (!config) {
      await interaction.reply({
        content:
          `⚠️ **No Google Sheet is configured for this channel yet.**\n` +
          `Please configure this channel first with:\n` +
          `\`/set-sheet sheet:<Google Sheet URL or ID> tab:<Tab Name>\``,
      });
      return;
    }

    const attachment = interaction.options.getAttachment('image', true);
    if (!attachment.contentType?.startsWith('image/')) {
      await interaction.reply({
        content: '❌ Please upload a valid image file (JPG, PNG, WebP).',
        ephemeral: true,
      });
      return;
    }

    const customCategory = interaction.options.getString('category');
    const customItem = interaction.options.getString('item');

    await interaction.deferReply();

    const reply = await handleReceiptCommand({
      imageUrl: attachment.url,
      createdAt: interaction.createdAt,
      channelConfig: config,
      appendSpend,
      customCategory,
      customItem,
      aiClient,
    });

    await interaction.editReply(reply);
  }
}
