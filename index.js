const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder
} = require("discord.js");

const axios = require("axios");

// ===============================
// CLIENT
// ===============================
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
// MEMORY
// ===============================
let logs = [];
let playerStats = {};

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
    .setDescription("Ranking PRO da guilda"),

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
// BOT ONLINE
// ===============================
client.once("ready", () => {
  console.log("Bot online ✔️");
});

// ===============================
// PROCESS LOG (PRO VERSION)
// ===============================
async function processLog(link, replyFn) {
  const match = link.match(/reports\/([a-zA-Z0-9]+)/);
  if (!match) return replyFn("❌ link inválido");

  const reportId = match[1];

  await replyFn("📊 analisando combate...");

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
      .map(p => `${p.name} — ${(p.total / 1000).toFixed(1)}k DPS`);

    const boss = fights.find(f => f.name)?.name || "Unknown Boss";

    // ===============================
    // WIPE ANALYSIS
    // ===============================
    let wipeAnalysis = "normal";

    if (wipes > kills) wipeAnalysis = "muitos wipes (provável mecânica)";
    if (kills === 0) wipeAnalysis = "wipe total";
    if (kills > wipes) wipeAnalysis = "progressão estável";

    // ===============================
    // DPS ANALYSIS
    // ===============================
    const avg =
      sorted.reduce((a, b) => a + (b.total || 0), 0) /
      (sorted.length || 1);

    let dpsState = "normal";
    if (avg < 3000000) dpsState = "baixo";
    if (avg > 8000000) dpsState = "alto";

    // ===============================
    // SAVE STATS
    // ===============================
    sorted.forEach(p => {
      if (!playerStats[p.name]) {
        playerStats[p.name] = { total: 0, fights: 0 };
      }

      playerStats[p.name].total += p.total;
      playerStats[p.name].fights += 1;
    });

    logs.push({ boss, reportId });

    const embed = new EmbedBuilder()
      .setTitle("📊 RAID ANALYSIS PRO")
      .setColor(0x00ff99)
      .addFields(
        { name: "⚔ Boss", value: boss, inline: true },
        { name: "🔥 Kills", value: String(kills), inline: true },
        { name: "💀 Wipes", value: String(wipes), inline: true },

        { name: "🧠 Raid State", value: wipeAnalysis },
        { name: "📊 DPS State", value: dpsState },

        { name: "💥 Top DPS", value: top5.join("\n") || "sem dados" }
      )
      .setFooter({ text: "StressLogs PRO • Warcraft Logs" });

    return replyFn({ embeds: [embed] });

  } catch (err) {
    console.error(err);
    return replyFn("❌ erro na análise PRO");
  }
}

// ===============================
// COMMAND HANDLER
// ===============================
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "log") {
    await i.reply("📊 analisando...");
    return processLog(i.options.getString("link"), (m) => i.editReply(m));
  }

  if (i.commandName === "ranking") {
    const ranking = Object.entries(playerStats)
      .map(([name, d]) => ({
        name,
        avg: d.total / d.fights
      }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 10)
      .map(p => `${p.name} — ${(p.avg / 1000).toFixed(1)}k avg`);

    return i.reply({
      content: "🏆 RANKING PRO:\n\n" + (ranking.join("\n") || "sem dados")
    });
  }

  if (i.commandName === "lastlogs") {
    const list = logs.slice(-10).reverse()
      .map(l => `⚔ ${l.boss}`)
      .join("\n");

    return i.reply("📜 Últimos logs:\n\n" + list);
  }
});

// ===============================
// MESSAGE SYSTEM
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