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
// SLASH COMMAND REGISTER
// ===============================
const commands = [
  new SlashCommandBuilder()
    .setName("log")
    .setDescription("Analisa um log do Warcraft Logs")
    .addStringOption(option =>
      option.setName("link")
        .setDescription("Link do report")
        .setRequired(true)
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Registrando slash command...");

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log("Slash command registrado ✔️");
  } catch (err) {
    console.error(err);
  }
})();

// ===============================
// BOT ONLINE
// ===============================
client.once("ready", () => {
  console.log("Bot online ✔️");
});

// ===============================
// FUNÇÃO DE PROCESSAMENTO
// ===============================
async function processLog(messageOrInteraction, link, replyFn) {
  const match = link.match(/warcraftlogs\.com\/reports\/([a-zA-Z0-9]+)/);

  if (!match) {
    return replyFn("❌ link inválido");
  }

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
      .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
      .slice(0, 5)
      .map(p => `${p.name} — ${Math.round((p.total ?? 0) / 1000)}k`);

    const embed = new EmbedBuilder()
      .setTitle("📊 Resumo do Log")
      .setColor(0x00ff99)
      .addFields(
        { name: "🔥 Kills", value: String(kills), inline: true },
        { name: "💀 Wipes", value: String(wipes), inline: true },
        { name: "⚔️ Fights", value: String(fights.length), inline: true },
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
// SLASH COMMAND (/log)
// ===============================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "log") return;

  const link = interaction.options.getString("link");

  await processLog(
    interaction,
    link,
    (response) => interaction.editReply(response).catch(() => interaction.reply(response))
  );
});

// ===============================
// PREFIX COMMAND (!log)
// ===============================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (!message.content.startsWith("!log")) return;

  const link = message.content.replace("!log", "").trim();

  await processLog(
    message,
    link,
    (response) => message.reply(response)
  );
});

// ===============================
// LOGIN
// ===============================
client.login(process.env.DISCORD_TOKEN);