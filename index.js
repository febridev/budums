import { Client, Events, GatewayIntentBits } from 'discord.js';
import { handleSpend } from './handle.js';
import { appendSpend } from './sheet.js';

const required = ['DISCORD_TOKEN', 'CHANNEL_ID', 'SPREADSHEET_ID', 'SHEET_TAB', 'GOOGLE_APPLICATION_CREDENTIALS'];
const missing = required.filter((name) => !process.env[name]);
for (const name of missing) console.error(`Missing env var: ${name}`);
if (missing.length) process.exit(1);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once(Events.ClientReady, (c) => console.log(`Logged in as ${c.user.tag}`));

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.channelId !== process.env.CHANNEL_ID) return;
  try {
    const reply = await handleSpend(message.content, message.createdAt, appendSpend);
    if (reply !== null) await message.reply(reply);
  } catch (err) {
    console.error('reply failed:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
