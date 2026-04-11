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
// SLASH COMMAND (SAFE)
// ===============================
const commands = [
  new SlashCommandBuilder()
    .setName("log")
    .setDescription("Analisa log do Warcraft Logs")
    .addStringOption(opt =>
      opt
        .setName("link")
        .setDescription("Cole o link do report")
        .setRequired(true)
    )
].map(cmd => cmd.toJSON());

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
// CORE LOGIC
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

          damageCharacters {
            name
            total
          }

          healingCharacters {
            name
            total
          }

          tankCharacters {
            name
            total
          }

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

    if (!report) {
      return reply("❌ report não encontrado ou privado");
    }

    // ===============================
    // FIGHTS
    // ===============================
    const fights = report.fights || [];

    const boss = fights[0]?.name || "Unknown Boss";
    const kills = fights.filter(f => f.kill).length;
    const wipes = fights.length - kills;

    // ===============================
    // FORMAT LIST
    // ===============================
    const formatList = (arr) => {
      if (!arr || !arr.length) return "❌ sem dados";

      return arr
        .sort((a, b) => (b.total || 0) - (a.total || 0))
        .map(p => `• ${p.name} — ${(p.total / 1000).toFixed(1)}k`)
        .join("\n");
    };

    const dps = formatList(report.damageCharacters);
    const heal = formatList(report.healingCharacters);
    const tank = formatList(report.tankCharacters);

    const dpsCount = report.damageCharacters?.length || 0;
    const healCount = report.healingCharacters?.length || 0;
    const tankCount = report.tankCharacters?.length || 0;

    return reply(
      `👑 RAID DEBUG MODE\n\n` +

      `⚔ Boss: ${boss}\n` +
      `🔥 Kills: ${kills}\n` +
      `💀 Wipes: ${wipes}\n\n` +

      `💥 DPS:\n${dps}\n\n` +
      `💚 HEALERS:\n${heal}\n\n` +
      `🛡 TANKS:\n${tank}\n\n` +

      `📊 DEBUG:\n` +
      `DPS: ${dpsCount}\n` +
      `HEAL: ${healCount}\n` +
      `TANK: ${tankCount}`
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
// LINK DIRETO (COLAR LINK)
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