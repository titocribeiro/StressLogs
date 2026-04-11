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
// REPORT DATA
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
// MEMÓRIA LOCAL (SIMPLES)
// ===============================
let logs = [];
let players = {};

// ===============================
// COMMANDS
// ===============================
const commands = [
  new SlashCommandBuilder()
    .setName("log")
    .setDescription("Analisa um log do Warcraft Logs")
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
    .setDescription("Últimos logs analisados")
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

  console.log("Slash commands registrados ✔️");
})();

// ===============================
// BOT ONLINE
// ===============================
client.once("ready", () => {
  console.log("Bot online ✔️");
});

// ===============================
// PROCESS LOG (SUPREMO)
// ===============================
async function processLog(link, replyFn) {
  const match = link.match(/reports\/([a-zA-Z0-9]+)/);
  if (!match) return replyFn("❌ link inválido");

  const reportId = match[1];

  await replyFn("📊 analisando raid...");

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
    let raidState = "⚖ equilibrado";

    if (wipes > kills * 2) raidState = "🔥 wipe crítico";
    else if (kills === 0) raidState = "💀 wipe total";
    else if (wipes < kills) raidState = "📈 progressão boa";

    // ===============================
    // DPS MÉDIO
    // ===============================
    const avg =
      sorted.reduce((a, b) => a + (b.total || 0), 0) /
      (sorted.length || 1);

    let dpsState = "normal";
    if (avg < 3000000) dpsState = "baixo";
    if (avg > 8000000) dpsState = "alto";

    // ===============================
    // STATS POR PLAYER
    // ===============================
    sorted.forEach(p => {
      if (!players[p.name]) {
        players[p.name] = { total: 0, fights: 0 };
      }

      players[p.name].total += p.total;
      players[p.name].fights += 1;
    });

    logs.push({ boss, reportId });

    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    const embed = new EmbedBuilder()
      .setTitle("👑 RAID ANALYSIS SUPREMA")
      .setColor(0x00ff99)
      .addFields(
        { name: "⚔ Boss", value: boss, inline: true },
        { name: "🔥 Kills", value: String(kills), inline: true },
        { name: "💀 Wipes", value: String(wipes), inline: true },

        { name: "🧠 Estado da Raid", value: raidState },
        { name: "📊 DPS State", value: dpsState },

        { name: "💥 Top DPS", value: top5.join("\n") || "sem dados" },

        {
          name: "📋 Resumo",
          value:
            `🔥 Melhor: ${best?.name || "?"}\n` +
            `💀 Pior: ${worst?.name || "?"}\n` +
            `📊 Players: ${sorted.length}`
        }
      )
      .setFooter({ text: "StressLogs SUPREMO • Discord Only" });

    return replyFn({ embeds: [embed] });

  } catch (err) {
    console.error(err);
    return replyFn("❌ erro na análise");
  }
}

// ===============================
// INTERACTIONS
// ===============================
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  // /log
  if (i.commandName === "log") {
    await i.reply("📊 processando...");
    return processLog(i.options.getString("link"), (m) => i.editReply(m));
  }

  // /ranking
  if (i.commandName === "ranking") {
    const ranking = Object.entries(players)
      .map(([name, d]) => ({
        name,
        avg: d.total / d.fights
      }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 10)
      .map(p => `🏆 ${p.name} — ${(p.avg / 1000).toFixed(1)}k`);

    return i.reply({
      content: "👑 RANKING DA GUILDA:\n\n" + (ranking.join("\n") || "sem dados")
    });
  }

  // /lastlogs
  if (i.commandName === "lastlogs") {
    const list = logs.slice(-10).reverse()
      .map(l => `⚔ ${l.boss}`)
      .join("\n");

    return i.reply("📜 ÚLTIMOS LOGS:\n\n" + list);
  }
});

// ===============================
// MESSAGE SUPPORT
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