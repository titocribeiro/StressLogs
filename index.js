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
// CLIENT (IMPORTANTE INTENT)
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
// SAFE COMMANDS (ANTI CRASH)
// ===============================
const commands = [
  new SlashCommandBuilder()
    .setName("log")
    .setDescription("Analisa logs do Warcraft Logs")
    .addStringOption(opt =>
      opt
        .setName("link")
        .setDescription("Cole o link do report")
        .setRequired(true)
    )
].map(cmd => cmd.toJSON());

// ===============================
// REGISTER COMMANDS
// ===============================
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
    console.error("Erro ao registrar comandos:", err);
  }
})();

// ===============================
// READY
// ===============================
client.once("ready", () => {
  console.log("Bot online ✔️");
});

// ===============================
// CORE ANALYSIS
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

    const report = res.data?.data?.reportData?.report;

    if (!report) return reply("❌ report não encontrado");

    // ===============================
    // FIGHTS
    // ===============================
    const fights = report?.fights || [];

    const boss = fights[0]?.name || "Unknown Boss";
    const kills = fights.filter(f => f.kill).length;
    const wipes = fights.length - kills;

    // ===============================
    // DPS SAFE PARSER
    // ===============================
    const table = report?.table;

    const entries =
      table?.data?.entries ||
      table?.data?.data?.entries ||
      table?.series ||
      [];

    const players = (entries || [])
      .map(p => ({
        name: p.name || p.character || "Unknown",
        total: p.total ?? p.amount ?? p.value ?? 0
      }))
      .filter(p => p.name !== "Unknown" && p.total > 0)
      .sort((a, b) => b.total - a.total);

    let dpsText = "❌ DPS não disponível nesse report";

    if (players.length > 0) {
      const top = players.slice(0, 5)
        .map(p => `${p.name} - ${(p.total / 1000).toFixed(1)}k`);

      dpsText = top.join("\n");
    }

    // ===============================
    // EMBED FINAL
    // ===============================
    const embed = new EmbedBuilder()
      .setTitle("👑 RAID ANALYSIS SAFE MODE")
      .setColor(0x00ff99)
      .addFields(
        { name: "⚔ Boss", value: boss, inline: true },
        { name: "🔥 Kills", value: String(kills), inline: true },
        { name: "💀 Wipes", value: String(wipes), inline: true },

        { name: "💥 TOP DPS", value: dpsText },

        {
          name: "📊 Players",
          value: String(players.length)
        }
      )
      .setFooter({ text: "Stable Mode • No Crash Build" });

    return reply({ embeds: [embed] });

  } catch (err) {
    console.error(err);
    return reply("❌ erro ao analisar log");
  }
}

// ===============================
// SLASH COMMAND HANDLER
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
// LINK DIRETO (SÓ COLAR)
// ===============================
client.on("messageCreate", async m => {
  if (m.author.bot) return;

  const match = m.content.match(
    /https:\/\/www\.warcraftlogs\.com\/reports\/[a-zA-Z0-9]+(\?fight=\d+)?/
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