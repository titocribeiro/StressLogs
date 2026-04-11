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
// COMMANDS
// ===============================
const commands = [
  new SlashCommandBuilder()
    .setName("log")
    .setDescription("Análise profissional de log")
    .addStringOption(opt =>
      opt.setName("link")
        .setDescription("Link do Warcraft Logs")
        .setRequired(true)
    )
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
// READY
// ===============================
client.once("ready", () => {
  console.log("Mini WCL Bot online ✔️");
});

// ===============================
// CORE ANALYSIS ENGINE
// ===============================
async function processLog(link, replyFn) {
  const reportId = link.match(/reports\/([a-zA-Z0-9]+)/)?.[1];

  if (!reportId) {
    return replyFn("❌ link inválido");
  }

  try {
    const token = await getWCLToken();

    // ===============================
    // QUERY UNIVERSAL (SAFE)
    // ===============================
    const query = `
    {
      reportData {
        report(code: "${reportId}") {

          fights {
            id
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

    if (!report) {
      return replyFn("❌ report não encontrado ou privado");
    }

    // ===============================
    // FIGHTS ANALYSIS
    // ===============================
    const fights = report?.fights || [];

    const boss =
      fights.find(f => f.name)?.name || "Unknown Encounter";

    const kills = fights.filter(f => f.kill).length;
    const wipes = fights.length - kills;

    // ===============================
    // DPS ENGINE (ROBUSTO)
    // ===============================
    const table = report?.table;

    const raw =
      table?.data?.entries ||
      table?.data?.data?.entries ||
      table?.data?.series ||
      table?.series ||
      [];

    const players = (raw || [])
      .map(p => ({
        name: p.name || p.character || p.label || "Unknown",
        total: p.total ?? p.amount ?? p.value ?? 0
      }))
      .filter(p => p.name !== "Unknown" && p.total > 0)
      .sort((a, b) => b.total - a.total);

    // ===============================
    // SMART FALLBACK ENGINE
    // ===============================
    let dpsBlock = "❌ DPS não disponível neste tipo de report";

    if (players.length > 0) {
      const top5 = players.slice(0, 5)
        .map(p => `${p.name} — ${(p.total / 1000).toFixed(1)}k DPS`)
        .join("\n");

      const best = players[0];
      const avg =
        players.reduce((a, b) => a + b.total, 0) / players.length;

      dpsBlock =
        `💥 TOP DPS:\n${top5}\n\n` +
        `🔥 Melhor: ${best.name}\n` +
        `📊 Média: ${(avg / 1000).toFixed(1)}k`;
    }

    // ===============================
    // RAID STATE ENGINE
    // ===============================
    let state = "⚖ equilibrado";

    if (kills === 0) state = "💀 wipe total";
    else if (wipes > kills * 2) state = "🔥 wipe crítico";
    else if (wipes < kills) state = "📈 progressão boa";

    // ===============================
    // FINAL RESPONSE (NEVER FAILS)
    // ===============================
    const embed = new EmbedBuilder()
      .setTitle("👑 MINI WARCRAFT LOGS ANALYSIS")
      .setColor(0x00ff99)
      .addFields(
        { name: "⚔ Boss / Encounter", value: boss, inline: false },
        { name: "🔥 Kills", value: String(kills), inline: true },
        { name: "💀 Wipes", value: String(wipes), inline: true },
        { name: "🧠 Estado", value: state, inline: false },
        { name: "📊 DPS ANALYSIS", value: dpsBlock, inline: false },
        { name: "📌 Players Detectados", value: String(players.length), inline: true }
      )
      .setFooter({ text: "Pro Mode • Smart Analysis Engine" });

    return replyFn({ embeds: [embed] });

  } catch (err) {
    console.error(err);
    return replyFn("❌ erro interno na análise do log");
  }
}

// ===============================
// INTERACTION HANDLER (NO TIMEOUT ISSUES)
// ===============================
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "log") {
    await i.deferReply(); // 🔥 evita "app not responding"
    return processLog(i.options.getString("link"), (m) => i.editReply(m));
  }
});

// ===============================
client.login(process.env.DISCORD_TOKEN);