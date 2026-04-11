const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes
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
// TOKEN WCL
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
// SAFE REGISTER COMMANDS
// ===============================
const commands = [
  new SlashCommandBuilder()
    .setName("log")
    .setDescription("Analisa log da raid")
    .addStringOption(opt =>
      opt
        .setName("link")
        .setDescription("Link do Warcraft Logs")
        .setRequired(true)
    )
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

    console.log("Slash commands OK ✔️");
  } catch (e) {
    console.error("Erro slash commands:", e);
  }
})();

// ===============================
// CORE ANALYSIS FUNCTION
// ===============================
async function processLog(link, reply) {
  const reportId = link.match(/reports\/([a-zA-Z0-9]+)/)?.[1];
  if (!reportId) return reply("❌ link inválido");

  try {
    const token = await getWCLToken();

    const query = `
    {
      reportData {
        report(code: "${reportId}") {

          fights {
            name
            kill
          }

          table(dataType: DamageDone)
          tableHealing: table(dataType: Healing)
          tableTank: table(dataType: DamageTaken)

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

    const report = res.data?.data?.reportData?.report;

    if (!report) return reply("❌ report não encontrado");

    // ===============================
    // FIGHTS
    // ===============================
    const fights = report.fights || [];

    const boss = fights[0]?.name || "Unknown Boss";
    const kills = fights.filter(f => f.kill).length;
    const wipes = fights.length - kills;

    // ===============================
    // GENERIC EXTRACTOR
    // ===============================
    const extract = (table) => {
      const entries =
        table?.data?.entries ||
        table?.data?.data?.entries ||
        [];

      return entries
        .map(p => ({
          name: p.name || "Unknown",
          total: p.total || 0
        }))
        .filter(p => p.name !== "Unknown" && p.total > 0)
        .sort((a, b) => b.total - a.total);
    };

    // ===============================
    // LISTS
    // ===============================
    const dps = extract(report.table);
    const heal = extract(report.tableHealing);
    const tank = extract(report.tableTank);

    const format = (arr) =>
      arr.length
        ? arr.map(p => `• ${p.name} — ${(p.total / 1000).toFixed(1)}k`).join("\n")
        : "❌ sem dados";

    // ===============================
    // RESPONSE
    // ===============================
    return reply(
      `👑 FULL RAID ROSTER\n\n` +

      `⚔ Boss: ${boss}\n` +
      `🔥 Kills: ${kills}\n` +
      `💀 Wipes: ${wipes}\n\n` +

      `💥 DPS (ordenado):\n${format(dps)}\n\n` +
      `💚 HEALERS (ordenado):\n${format(heal)}\n\n` +
      `🛡 TANKS (ordenado):\n${format(tank)}`
    );

  } catch (e) {
    console.error(e);
    return reply("❌ erro ao analisar log");
  }
}

// ===============================
// SLASH HANDLER
// ===============================
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "log") {
    await i.deferReply();
    return processLog(i.options.getString("link"), m =>
      i.editReply(m)
    );
  }
});

// ===============================
// LINK COLADO DIRETO
// ===============================
client.on("messageCreate", async m => {
  if (m.author.bot) return;

  const match = m.content.match(
    /https:\/\/www\.warcraftlogs\.com\/reports\/[a-zA-Z0-9]+(\?fight=\d+|&fight=\d+|&fight=last)?/
  );

  if (!match) return;

  try {
    await m.reply("📊 analisando log...");
    return processLog(match[0], r => m.reply(r));
  } catch (e) {
    console.error(e);
    return m.reply("❌ erro ao analisar log");
  }
});

// ===============================
client.login(process.env.DISCORD_TOKEN);