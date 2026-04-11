const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");

// ❌ NÃO precisa de dotenv no Railway
// require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

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

client.once("ready", () => {
  console.log("Bot online ✔️");
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const match = message.content.match(/warcraftlogs\.com\/reports\/([a-zA-Z0-9]+)/);
  if (!match) return;

  const reportId = match[1];

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
      .slice(0, 3)
      .map(p => ({
        name: p.name,
        dps: Math.round((p.total ?? 0) / 1000)
      }));

    let reply =
`📊 RESUMO DA RAID\n` +
`Kills: ${kills} | Wipes: ${wipes} | Fights: ${fights.length}\n\n` +
`💥 TOP DPS\n`;

    if (topDps.length === 0) {
      reply += "Sem dados de DPS disponíveis 😢";
    } else {
      topDps.forEach((p, i) => {
        reply += `${i + 1}. ${p.name} – ${p.dps}k\n`;
      });
    }

    message.reply(reply);

  } catch (err) {
    console.error(err);
    message.reply("Erro ao analisar o log 😢");
  }
});

client.login(process.env.DISCORD_TOKEN);