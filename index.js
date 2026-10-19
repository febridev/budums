import { Client, Events, GatewayIntentBits, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { handleSpend } from './handle.js';
import { handleReceipt } from './handleReceipt.js';
import { readReceipt } from './receipt.js';
import { appendSpend, appendReceipt } from './sheet.js';

const required = [
  'DISCORD_TOKEN', 'CHANNEL_ID', 'SPREADSHEET_ID', 'SHEET_TAB', 'GOOGLE_APPLICATION_CREDENTIALS',
  'RECEIPT_CHANNEL_ID', 'RECEIPT_SPREADSHEET_ID', 'RECEIPT_SHEET_TAB', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL',
];
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
    // guild command: available instantly, and the channel tells us the guild
    const ch = await c.channels.fetch(process.env.RECEIPT_CHANNEL_ID);
    await ch.guild.commands.set([struck]);
  } catch (err) {
    console.error('command registration failed:', err);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.channelId !== process.env.CHANNEL_ID) return;
  try {
    const reply = await handleSpend(message.content, message.createdAt, appendSpend);
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
