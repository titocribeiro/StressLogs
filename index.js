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
// COMMANDS
// ===============================
const commands = [
  new SlashCommandBuilder()
    .setName("log")
    .setDescription("Analisa log do Warcraft Logs")
    .addStringOption(opt =>
      opt.setName("link")
        .setDescription("Link do report")
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
  console.log("Bot online ✔️");
});

// ===============================
// PROCESS LOG (VERSÃO ESTÁVEL REAL)
// ===============================
async function processLog(link, replyFn) {
  const match = link.match(/reports\/([a-zA-Z0-9]+)/);
  if (!match) return replyFn("❌ link inválido");

  const reportId = match[1];

  await replyFn("📊 analisando log...");

  try {
    const token = await getWCLToken();

    // 🔥 QUERY ESTÁVEL (SEM fight filter, SEM rankings)
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

    // ===============================
    // FIGHTS
    // ===============================
    const fights = report?.fights || [];

    const boss = fights.find(f => f.name)?.name || "Unknown Boss";
    const kills = fights.filter(f => f.kill).length;
    const wipes = fights.length - kills;

    // ===============================
    // 💥 DPS PARSER ULTRA ESTÁVEL
    // ===============================
    const table = report?.table;

    const entries =
      table?.data?.entries ||
      table?.data?.data?.entries ||
      [];

    const players = entries
      .map(p => ({
        name: p.name || p.character || p.label || "Unknown",
        total: p.total || p.amount || p.dps || p.value || 0
      }))
      .filter(p => p.name !== "Unknown" && p.total > 0)
      .sort((a, b) => b.total - a.total);

    // ===============================
    // FALLBACK REAL (IMPORTANTE)
    // ===============================
    if (players.length === 0) {
      return replyFn("❌ esse log não retornou DPS (WCL variou estrutura desse report)");
    }

    const top5 = players.slice(0, 5)
      .map(p => `${p.name} — ${(p.total / 1000).toFixed(1)}k DPS`);

    const best = players[0];
    const worst = players[players.length - 1];

    const avg =
      players.reduce((a, b) => a + b.total, 0) /
      players.length;

    // ===============================
    // RAID STATE
    // ===============================
    let state = "⚖ equilibrado";
    if (wipes > kills * 2) state = "🔥 wipe crítico";
    else if (kills === 0) state = "💀 wipe total";
    else if (wipes < kills) state = "📈 progressão boa";

    // ===============================
    // EMBED FINAL
    // ===============================
    const embed = new EmbedBuilder()
      .setTitle("👑 RAID ANALYSIS FINAL STABLE")
      .setColor(0x00ff99)
      .addFields(
        { name: "⚔ Boss", value: boss, inline: true },
        { name: "🔥 Kills", value: String(kills), inline: true },
        { name: "💀 Wipes", value: String(wipes), inline: true },

        { name: "🧠 Estado da Raid", value: state },

        {
          name: "💥 TOP DPS",
          value: top5.join("\n")
        },

        {
          name: "📋 Resumo",
          value:
            `🔥 Melhor: ${best?.name || "?"}\n` +
            `💀 Pior: ${worst?.name || "?"}\n` +
            `📊 Players: ${players.length}\n` +
            `📈 DPS médio: ${(avg / 1000).toFixed(1)}k`
        }
      )
      .setFooter({ text: "Discord Only • Stable Version" });

    return replyFn({ embeds: [embed] });

  } catch (err) {
    console.error(err);
    return replyFn("❌ erro ao analisar log");
  }
}

// ===============================
// INTERACTION
// ===============================
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "log") {
    await i.reply("📊 processando...");
    return processLog(i.options.getString("link"), (m) => i.editReply(m));
  }
});

// ===============================
client.login(process.env.DISCORD_TOKEN);