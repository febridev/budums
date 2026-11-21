import { SlashCommandBuilder } from 'discord.js';
import { getChannelConfig, setChannelConfig } from './channels.js';
import { handleReceiptCommand, handleReceiptDailyCommand } from './receipt.js';
import { handleBankCommand } from './bank.js';

export const slashCommands = [
  new SlashCommandBuilder()
    .setName('receipt')
    .setDescription('Scan a receipt image and save spending to a specific sheet')
    .addAttachmentOption((opt) =>
      opt
        .setName('image')
        .setDescription('Receipt image (JPG, PNG, WebP)')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('sheet_name')
        .setDescription('Optional sheet/tab name inside the file (e.g. Food, Transport, Nov2026)')
        .setRequired(false)
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
    .setName('receipt-daily')
    .setDescription('Scan a receipt image and save spending in daily layout (Tanggal, Keterangan, Kategori, Jumlah Uang)')
    .addAttachmentOption((opt) =>
      opt
        .setName('image')
        .setDescription('Receipt image (JPG, PNG, WebP)')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('sheet_name')
        .setDescription('Optional sheet/tab name inside the file (e.g. Daily, Food, Nov2026)')
        .setRequired(false)
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
    .setName('bank')
    .setDescription('Extract bank statement transactions and save to Google Sheet')
    .addStringOption((opt) =>
      opt
        .setName('bank')
        .setDescription('Bank name (e.g. bca, mandiri, bri, bni)')
        .setRequired(true)
    )
    .addAttachmentOption((opt) =>
      opt
        .setName('file')
        .setDescription('Bank statement PDF or image file')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('sheet_name')
        .setDescription('Optional sheet/tab name inside the file (e.g. BCA, Bank, Nov2026)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('set-sheet')
    .setDescription('Configure which Google Sheet and sheet/tab name to use for this channel')
    .addStringOption((opt) =>
      opt
        .setName('sheet_name')
        .setDescription('Name of the sheet/tab inside your spreadsheet (e.g. Food, Nov2026, Sheet1)')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('url')
        .setDescription('Google Sheet URL or Spreadsheet ID (optional if set in .env)')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('sheet')
        .setDescription('Alias for Google Sheet URL or ID')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('tab')
        .setDescription('Alias for sheet_name')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('current-sheet')
    .setDescription('Show which Google Sheet and sheet/tab name is configured for this channel'),
];

export async function handleInteraction(interaction, { appendSpend, aiClient } = {}) {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'set-sheet') {
    const sheetInput = interaction.options.getString('url') || interaction.options.getString('sheet');
    const tabInput =
      interaction.options.getString('sheet_name') ||
      interaction.options.getString('tab') ||
      'Sheet1';

    try {
      const saved = setChannelConfig(interaction.channelId, sheetInput, tabInput);
      await interaction.reply({
        content:
          `✅ **Google Sheet configured for this channel!**\n` +
          `• **Spreadsheet ID:** \`${saved.spreadsheetId}\`\n` +
          `• **Sheet Name (Tab):** \`${saved.tab}\`\n\n` +
          `Receipts and spends in this channel will now be saved to the **${saved.tab}** sheet!`,
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
          `Use \`/set-sheet sheet_name:<Sheet Name> [url:<Google Sheet URL>]\` to set one.`,
      });
      return;
    }

    await interaction.reply({
      content:
        `📊 **Current Google Sheet for this channel:**\n` +
        `• **Spreadsheet ID:** \`${config.spreadsheetId}\`\n` +
        `• **Sheet Name (Tab):** \`${config.tab}\``,
    });
    return;
  }

  if (commandName === 'receipt' || commandName === 'receipt-daily') {
    const config = getChannelConfig(interaction.channelId);
    if (!config) {
      await interaction.reply({
        content:
          `⚠️ **No Google Sheet is configured for this channel yet.**\n` +
          `Please configure this channel first with:\n` +
          `\`/set-sheet sheet_name:<Sheet Name> [url:<Google Sheet URL>]\``,
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

    const customTab = interaction.options.getString('sheet_name');
    const customCategory = interaction.options.getString('category');
    const customItem = interaction.options.getString('item');

    await interaction.deferReply();

    const isDaily = commandName === 'receipt-daily';
    const handler = isDaily ? handleReceiptDailyCommand : handleReceiptCommand;

    const reply = await handler({
      imageUrl: attachment.url,
      createdAt: interaction.createdAt,
      channelConfig: config,
      appendSpend,
      customTab,
      customCategory,
      customItem,
      aiClient,
    });

    await interaction.editReply(reply);
    return;
  }

  if (commandName === 'bank') {
    const config = getChannelConfig(interaction.channelId);
    if (!config) {
      await interaction.reply({
        content:
          `⚠️ **No Google Sheet is configured for this channel yet.**\n` +
          `Please configure this channel first with:\n` +
          `\`/set-sheet sheet_name:<Sheet Name> [url:<Google Sheet URL>]\``,
      });
      return;
    }

    const attachment =
      interaction.options.getAttachment('file') ||
      interaction.options.getAttachment('pdf');

    if (!attachment) {
      await interaction.reply({
        content: '❌ Please upload a bank statement PDF or image file.',
        ephemeral: true,
      });
      return;
    }

    const isPdf =
      attachment.contentType === 'application/pdf' ||
      attachment.contentType === 'application/x-pdf' ||
      attachment.name?.toLowerCase().endsWith('.pdf');
    const isImage =
      attachment.contentType?.startsWith('image/') ||
      /\.(png|jpe?g|webp)$/i.test(attachment.name || '');

    if (!isPdf && !isImage) {
      await interaction.reply({
        content: '❌ Please upload a valid PDF or image file (PDF, PNG, JPG).',
        ephemeral: true,
      });
      return;
    }

    const bank = interaction.options.getString('bank', true);
    const customTab = interaction.options.getString('sheet_name');

    await interaction.deferReply();

    const reply = await handleBankCommand({
      fileUrl: attachment.url,
      fileName: attachment.name,
      fileContentType: attachment.contentType,
      bank,
      createdAt: interaction.createdAt,
      channelConfig: config,
      appendSpend,
      customTab,
      aiClient,
    });

    await interaction.editReply(reply);
    return;
  }
}
