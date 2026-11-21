import { Client, Events, GatewayIntentBits, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { handleSpend } from './handle.js';
import { appendSpend } from './sheet.js';
import { getChannelConfig } from './channels.js';
import { slashCommands, handleInteraction } from './commands.js';
import { handleBankCommand } from './bank.js';

const required = ['DISCORD_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS', 'GEMINI_API_KEY'];
const missing = required.filter((name) => !process.env[name]);
for (const name of missing) console.error(`Missing env var: ${name}`);
if (missing.length) process.exit(1);

const struck = new SlashCommandBuilder()
  .setName('struck')
  .setDescription('Save a shopping receipt')
  .addAttachmentOption((o) => o.setName('image').setDescription('Receipt photo').setRequired(true));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    await client.application.commands.set(slashCommands);
    console.log('Registered slash commands (/receipt, /receipt-daily, /bank, /set-sheet, /current-sheet)');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await handleInteraction(interaction, { appendSpend });
  } catch (err) {
    console.error('interaction failed:', err);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const config = getChannelConfig(message.channelId);
  // Only process if channel has a configured Google Sheet
  if (!config) return;

  if (message.content.trim().toLowerCase().startsWith('/bank')) {
    const parts = message.content.trim().split(/\s+/);
    const bankName = parts[1];
    if (!bankName) {
      await message.reply('⚠️ Please specify a bank name, e.g. `/bank bca` with an attached PDF.');
      return;
    }
    const attachment = message.attachments.first();
    if (!attachment) {
      await message.reply('⚠️ Please attach a bank statement PDF or image with your `/bank` message.');
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
      await message.reply('❌ Please attach a valid PDF or image file (PDF, PNG, JPG).');
      return;
    }

    try {
      const reply = await handleBankCommand({
        fileUrl: attachment.url,
        fileName: attachment.name,
        fileContentType: attachment.contentType,
        bank: bankName,
        createdAt: message.createdAt,
        channelConfig: config,
        appendSpend,
      });
      await message.reply(reply);
    } catch (err) {
      console.error('bank statement failed:', err);
      await message.reply(`❌ Could not process bank statement: ${err.message}`);
    }
    return;
  }

  try {
    const reply = await handleSpend(message.content, message.createdAt, appendSpend, {
      spreadsheetId: config.spreadsheetId,
      tab: config.tab,
    });
    if (reply !== null) await message.reply(reply);
  } catch (err) {
    console.error('reply failed:', err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'struck') return;
  try {
    if (interaction.channelId !== process.env.RECEIPT_CHANNEL_ID) {
      await interaction.reply({ content: `Use /struck in <#${process.env.RECEIPT_CHANNEL_ID}>`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply(); // reading takes longer than Discord's 3-second reply window
    const image = interaction.options.getAttachment('image', true);
    await interaction.editReply(await handleReceipt(image, interaction.createdAt, readReceipt, appendReceipt));
  } catch (err) {
    console.error('interaction failed:', err);
    // otherwise the user is left with "thinking…" forever
    if (interaction.deferred) await interaction.editReply('❌ something went wrong').catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
