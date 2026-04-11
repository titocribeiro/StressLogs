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
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  return res.data;
}

// ===============================
// SLASH COMMAND (/log)
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
    .setDescription("Mostra ranking simples da guilda (últimos logs salvos)")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log("Slash commands registrados ✔️");
  } catch (err) {
    console.error(err);
  }
})();

// ===============================
// MEMÓRIA SIMPLES (ranking básico)
// ===============================
let guildLogs = [];

// ===============================
// BOT ONLINE
// ===============================
client.once("ready", () => {
  console.log("Bot online ✔️");
});

// ===============================
// PROCESSAR LOG
// ===============================
async function processLog(link, replyFn) {
  const match = link.match(/warcraftlogs\.com\/reports\/([a-zA-Z0-9]+)/);
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

    const topDps = entries
      .filter(p => p?.name && p?.total)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map(p => `${p.name} — ${(p.total / 1000).toFixed(1)}k DPS`);

    const bossName = fights.find(f => f.name)?.name || "Unknown Boss";

    // salva no ranking simples
    guildLogs.push({
      reportId,
      bossName,
      top: topDps[0] || "N/A"
    });

    const embed = new EmbedBuilder()
      .setTitle("📊 Resumo do Log")
      .setColor(0x00ff99)
      .addFields(
        { name: "⚔ Boss", value: bossName, inline: true },
        { name: "🔥 Kills", value: String(kills), inline: true },
        { name: "💀 Wipes", value: String(wipes), inline: true },
        { name: "💥 Top DPS", value: topDps.join("\n") || "Sem dados" }
      )
      .setFooter({ text: "StressLogs • Warcraft Logs" });

    return replyFn({ embeds: [embed] });

  } catch (err) {
    console.error(err);
    return replyFn("❌ erro ao analisar log");
  }
}

// ===============================
// SLASH INTERACTIONS
// ===============================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // /log
  if (interaction.commandName === "log") {
    const link = interaction.options.getString("link");

    await interaction.reply("📊 Analisando log...");

    return processLog(link, (msg) =>
      interaction.editReply(msg)
    );
  }

  // /ranking
  if (interaction.commandName === "ranking") {
    if (guildLogs.length === 0) {
      return interaction.reply("Ainda não tem logs salvos 😢");
    }

    const top = guildLogs.slice(-10).reverse();

    const text = top
      .map(l => `⚔ ${l.bossName} — ${l.top}`)
      .join("\n");

    return interaction.reply({
      content: `🏆 Últimos logs da guilda:\n\n${text}`
    });
  }
});

// ===============================
// PREFIX + AUTO LINK
// ===============================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content;

  if (content.startsWith("!log")) {
    const link = content.replace("!log", "").trim();
    return processLog(link, (msg) => message.reply(msg));
  }

  if (content.includes("warcraftlogs.com/reports/")) {
    return processLog(content.trim(), (msg) => message.reply(msg));
  }
});

// ===============================
// LOGIN
// ===============================
client.login(process.env.DISCORD_TOKEN);