const { Client, GatewayIntentBits } = require("discord.js");
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
    new URLSearchParams({
      grant_type: "client_credentials"
    }),
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
// BOT ONLINE
// ===============================
client.once("ready", () => {
  console.log("Bot online ✔️");
});

// ===============================
// COMANDO !log
// ===============================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (!message.content.startsWith("!log")) return;

  const link = message.content.replace("!log", "").trim();

  if (!link) {
    return message.reply("manda o link do Warcraft Logs 🙂");
  }

  const match = link.match(/warcraftlogs\.com\/reports\/([a-zA-Z0-9]+)/);

  if (!match) {
    return message.reply("esse link não parece um report válido 😢");
  }

  const reportId = match[1];

  await message.reply("📊 Analisando log...");

  try {
    const token = await getWCLToken();
    const data = await getReportData(reportId, token);

    const report = data?.data?.reportData?.report;

    const fights = report?.fights || [];
    const kills = fights.filter(f => f.kill).length;
    const wipes = fights.filter(f => !f.kill).length;

    const table = report?.table;

    const entries =
      table?.data?.data?.entries ||
      table?.data?.entries ||
      [];

    const topDps = entries
      .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
      .slice(0, 5)
      .map(p => ({
        name: p.name,
        dps: Math.round((p.total ?? 0) / 1000)
      }));

    let dpsText = "";

    if (topDps.length === 0) {
      dpsText = "Sem dados de DPS 😢";
    } else {
      topDps.forEach((p, i) => {
        dpsText += `\n${i + 1}. ${p.name} — ${p.dps}k DPS`;
      });
    }

    message.reply(
`📊 **RESUMO DO LOG**

🔥 Kills: ${kills}
💀 Wipes: ${wipes}
⚔️ Fights: ${fights.length}

💥 **TOP DPS**
${dpsText}
`
    );

  } catch (err) {
    console.error(err);
    message.reply("deu erro ao analisar o log 😢");
  }
});

// ===============================
// LOGIN BOT
// ===============================
client.login(process.env.DISCORD_TOKEN);