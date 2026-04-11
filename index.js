const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder
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
// WCL REPORT
// ===============================
async function getReportData(reportId, token) {
  const query = `
  {
    reportData {
      report(code: "${reportId}") {
        fights {
          name
          kill
        }
        table(dataType: DamageDone)
      }
    }
  }`;

  const res = await axios.post(
    "https://www.warcraftlogs.com/api/v2/client",
    { query },
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );

  return res.data;
}

// ===============================
// SLASH COMMANDS
// ===============================
const commands = [
  new SlashCommandBuilder()
    .setName("log")
    .setDescription("Analisa log do Warcraft Logs")
    .addStringOption(opt =>
      opt.setName("link")
        .setDescription("Link do report")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ranking")
    .setDescription("Ranking da guilda"),

  new SlashCommandBuilder()
    .setName("lastlogs")
    .setDescription("Últimos logs da guilda")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),
    { body: commands }
  );

  console.log("Slash commands OK ✔️");
})();

// ===============================
// MEMÓRIA SIMPLES
// ===============================
let logs = [];
let playerStats = {};

// ===============================
// PROCESSAR LOG
// ===============================
async function processLog(link, replyFn) {
  const match = link.match(/reports\/([a-zA-Z0-9]+)/);
  if (!match) return replyFn("❌ link inválido");

  const reportId = match[1];

  await replyFn("📊 Analisando log...");

  try {
    const token = await getWCLToken();
    const data = await getReportData(reportId, token);

    const report = data?.data?.reportData?.report;
    const fights = report?.fights || [];

    const kills = fights.filter(f => f.kill).length;
    const wipes = fights.length - kills;

    const table = report?.table;
    const entries =
      table?.data?.data?.entries ||
      table?.data?.entries ||
      [];

    const sorted = entries
      .filter(p => p?.name && p?.total)
      .sort((a, b) => b.total - a.total);

    const top5 = sorted.slice(0, 5)
      .map(p => `${p.name} — ${(p.total / 1000).toFixed(1)}k`);

    const boss = fights.find(f => f.name)?.name || "Unknown";

    // ===============================
    // STATS POR PLAYER (RANKING)
    // ===============================
    sorted.forEach(p => {
      if (!playerStats[p.name]) {
        playerStats[p.name] = { total: 0, fights: 0 };
      }

      playerStats[p.name].total += p.total;
      playerStats[p.name].fights += 1;
    });

    logs.push({ reportId, boss });

    const embed = new EmbedBuilder()
      .setTitle("📊 Log Analisado")
      .setColor(0x00ff99)
      .addFields(
        { name: "⚔ Boss", value: boss, inline: true },
        { name: "🔥 Kills", value: String(kills), inline: true },
        { name: "💀 Wipes", value: String(wipes), inline: true },
        { name: "💥 Top DPS", value: top5.join("\n") }
      );

    return replyFn({ embeds: [embed] });

  } catch (err) {
    console.error(err);
    return replyFn("❌ erro ao analisar log");
  }
}

// ===============================
// BOT
// ===============================
client.once("ready", () => {
  console.log("Bot online ✔️");
});

// ===============================
// COMMANDS
// ===============================
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  // /log
  if (i.commandName === "log") {
    await i.reply("📊 analisando...");
    return processLog(i.options.getString("link"), (m) => i.editReply(m));
  }

  // /ranking
  if (i.commandName === "ranking") {
    const top = Object.entries(playerStats)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([name, data]) =>
        `${name} — ${(data.total / 1000).toFixed(1)}k avg`
      )
      .join("\n");

    return i.reply("🏆 Ranking da guilda:\n\n" + (top || "sem dados"));
  }

  // /lastlogs
  if (i.commandName === "lastlogs") {
    const list = logs.slice(-10).reverse()
      .map(l => `⚔ ${l.boss}`)
      .join("\n");

    return i.reply("📜 Últimos logs:\n\n" + list);
  }
});

// ===============================
// MESSAGE
// ===============================
client.on("messageCreate", async (m) => {
  if (m.author.bot) return;

  if (m.content.startsWith("!log")) {
    return processLog(m.content.replace("!log", ""), (r) => m.reply(r));
  }

  if (m.content.includes("warcraftlogs.com/reports/")) {
    return processLog(m.content, (r) => m.reply(r));
  }
});

// ===============================
client.login(process.env.DISCORD_TOKEN);