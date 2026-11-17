import { Client, Events, GatewayIntentBits } from 'discord.js';
import { handleSpend } from './handle.js';
import { appendSpend } from './sheet.js';
import { getChannelConfig } from './channels.js';
import { slashCommands, handleInteraction } from './commands.js';

const required = ['DISCORD_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS', 'GEMINI_API_KEY'];
const missing = required.filter((name) => !process.env[name]);
for (const name of missing) console.error(`Missing env var: ${name}`);
if (missing.length) process.exit(1);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    await client.application.commands.set(slashCommands);
    console.log('Registered slash commands (/receipt, /set-sheet, /current-sheet)');
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

client.login(process.env.DISCORD_TOKEN);
