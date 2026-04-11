const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const axios = require("axios");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ===============================
// WCL TOKEN
// ===============================
async function getWCLToken() {
  const res = await axios.post(
    "https://www.warcraftlogs.com/oauth/token",
    new URLSearchParams({ grant_type: "client_credentials" }),
    {
      auth: {
        username: process.env.WCL_CLIENT_ID,
        password: process.env.WCL_CLIENT_SECRET
      }
    }
  );
  return res.data.access_token;
}

// ===============================
// CORE FUNCTION
// ===============================
async function processLog(link, send) {
  const reportId = link.match(/reports\/([a-zA-Z0-9]+)/)?.[1];
  if (!reportId) return send("❌ link inválido");

  try {
    const token = await getWCLToken();

    const query = `
    {
      reportData {
        report(code: "${reportId}") {
          fights { name kill }
          table(dataType: DamageDone)
        }
      }
    }`;

    const res = await axios.post(
      "https://www.warcraftlogs.com/api/v2/client",
      { query },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const report = res.data?.data?.reportData?.report;

    const fights = report?.fights || [];
    const boss = fights[0]?.name || "Unknown";
    const kills = fights.filter(f => f.kill).length;
    const wipes = fights.length - kills;

    const entries =
      report?.table?.data?.entries ||
      report?.table?.data?.data?.entries ||
      [];

    const players = entries
      .map(p => ({
        name: p.name,
        total: p.total || 0
      }))
      .filter(p => p.name && p.total > 0)
      .sort((a, b) => b.total - a.total);

    if (!players.length) {
      return send("❌ sem DPS nesse report");
    }

    const top = players.slice(0, 5)
      .map(p => `${p.name} - ${(p.total / 1000).toFixed(1)}k`);

    return send(
      `👑 RAID ANALYSIS\n` +
      `⚔ Boss: ${boss}\n` +
      `🔥 Kills: ${kills}\n` +
      `💀 Wipes: ${wipes}\n\n` +
      `💥 TOP DPS:\n${top.join("\n")}`
    );

  } catch (e) {
    console.error(e);
    return send("❌ erro ao analisar log");
  }
}

// ===============================
// SLASH COMMAND
// ===============================
const commands = [
  new SlashCommandBuilder()
    .setName("log")
    .setDescription("analisa log")
    .addStringOption(opt =>
      opt.setName("link").setRequired(true)
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
})();

// ===============================
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "log") {
    await i.deferReply();
    return processLog(i.options.getString("link"), (m) => i.editReply(m));
  }
});

// ===============================
// 🔥 ISSO AQUI É O QUE VOCÊ TAVA PERDENDO
// ===============================
client.on("messageCreate", async m => {
  if (m.author.bot) return;

  const match = m.content.match(
    /https:\/\/www\.warcraftlogs\.com\/reports\/[a-zA-Z0-9]+(\?fight=\d+)?/
  );

  if (!match) return;

  await m.reply("📊 analisando log...");
  return processLog(match[0], (r) => m.reply(r));
});

// ===============================
client.login(process.env.DISCORD_TOKEN);