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
// CORE LOGIC
// ===============================
async function processLog(link, replyFn) {
  const match = link.match(/reports\/([a-zA-Z0-9]+)/);
  if (!match) return replyFn("❌ link inválido");

  const reportId = match[1];

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

    if (!report) {
      return replyFn("❌ report não encontrado");
    }

    // ===============================
    // FIGHTS
    // ===============================
    const fights = report?.fights || [];

    const boss = fights.find(f => f.name)?.name || "Unknown Boss";
    const kills = fights.filter(f => f.kill).length;
    const wipes = fights.length - kills;

    // ===============================
    // DPS PARSER
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

    // fallback
    if (players.length === 0) {
      return replyFn("❌ esse log não expõe DPS via API");
    }

    const top5 = players.slice(0, 5)
      .map(p => `${p.name} — ${(p.total / 1000).toFixed(1)}k DPS`);

    const best = players[0];

    const avg =
      players.reduce((a, b) => a + b.total, 0) /
      players.length;

    let state = "⚖ equilibrado";
    if (kills === 0) state = "💀 wipe total";
    else if (wipes > kills * 2) state = "🔥 wipe crítico";
    else if (wipes < kills) state = "📈 progressão boa";

    const embed = new EmbedBuilder()
      .setTitle("👑 RAID ANALYSIS FULL MODE")
      .setColor(0x00ff99)
      .addFields(
        { name: "⚔ Boss", value: boss, inline: true },
        { name: "🔥 Kills", value: String(kills), inline: true },
        { name: "💀 Wipes", value: String(wipes), inline: true },

        { name: "🧠 Estado", value: state },

        { name: "💥 TOP DPS", value: top5.join("\n") },

        {
          name: "📊 Stats",
          value:
            `🔥 Melhor: ${best?.name || "?"}\n` +
            `📈 Média: ${(avg / 1000).toFixed(1)}k\n` +
            `👥 Players: ${players.length}`
        }
      )
      .setFooter({ text: "Full Mode • Discord + Link Support" });

    return replyFn({ embeds: [embed] });

  } catch (err) {
    console.error(err);
    return replyFn("❌ erro ao analisar log");
  }
}

// ===============================
// SLASH COMMAND
// ===============================
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "log") {
    await i.deferReply();
    return processLog(i.options.getString("link"), (m) => i.editReply(m));
  }
});

// ===============================
// MESSAGE SUPPORT (!log + link puro)
// ===============================
client.on("messageCreate", async (m) => {
  if (m.author.bot) return;

  const content = m.content;

  const match = content.match(
    /https:\/\/www\.warcraftlogs\.com\/reports\/[a-zA-Z0-9]+(\?fight=\d+)?/
  );

  if (!match) return;

  try {
    await m.reply("📊 analisando log...");
    return processLog(match[0], (r) => m.reply(r));
  } catch (e) {
    console.error(e);
    return m.reply("❌ erro ao analisar log");
  }
});

// ===============================
client.login(process.env.DISCORD_TOKEN);