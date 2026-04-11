const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const axios = require("axios");

// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

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
// DETECTA TIPO DO REPORT
// ===============================
function detectReportType(report) {
  const hasFights = report?.fights?.length > 0;
  const hasDamage = (report?.table?.data?.entries || []).length > 0;

  if (!hasFights) return "INVALID";
  if (!hasDamage) return "SUMMARY_ONLY";

  return "FULL";
}

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
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const report = res.data?.data?.reportData?.report;

    if (!report) return reply("❌ report não encontrado");

    // ===============================
    // DETECÇÃO INTELIGENTE
    // ===============================
    const type = detectReportType(report);

    const fights = report.fights || [];
    const boss = fights[0]?.name || "Unknown Boss";
    const kills = fights.filter(f => f.kill).length;
    const wipes = fights.length - kills;

    // ===============================
    // DPS EXTRACTION SEGURA
    // ===============================
    const entries =
      report?.table?.data?.entries ||
      report?.table?.data?.data?.entries ||
      [];

    const players = entries
      .map(p => ({
        name: p.name,
        total: p.total || 0
      }))
      .filter(p => p.name && p.total > 0)
      .sort((a, b) => b.total - a.total);

    // ===============================
    // OUTPUT INTELIGENTE
    // ===============================
    let dpsText = "";

    if (type === "INVALID") {
      dpsText = "❌ Report inválido ou sem fights";
    } 
    else if (type === "SUMMARY_ONLY") {
      dpsText = "⚠ Esse report é SUMMARY_ONLY (sem DPS detalhado na API)";
    } 
    else {
      dpsText =
        players.length > 0
          ? players.slice(0, 10).map(p =>
              `• ${p.name} — ${(p.total / 1000).toFixed(1)}k`
            ).join("\n")
          : "❌ DPS não encontrado";
    }

    return reply(
      `👑 SMART RAID ANALYSIS\n\n` +
      `⚔ Boss: ${boss}\n` +
      `🔥 Kills: ${kills}\n` +
      `💀 Wipes: ${wipes}\n\n` +
      `📊 TYPE: ${type}\n\n` +
      `💥 DPS:\n${dpsText}`
    );

  } catch (e) {
    console.error(e);
    return reply("❌ erro na API");
  }
}

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
client.on("messageCreate", async m => {
  if (m.author.bot) return;

  const match = m.content.match(
    /https:\/\/www\.warcraftlogs\.com\/reports\/[a-zA-Z0-9]+(\?fight=\d+|&fight=\d+|&fight=last)?/
  );

  if (!match) return;

  await m.reply("📊 analisando log...");
  return processLog(match[0], r => m.reply(r));
});

// ===============================
client.login(process.env.DISCORD_TOKEN);