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
  if (!reportId) return reply({ content: "❌ link inválido" });

  try {
    const token = await getWCLToken();

    // Passo 1: buscar metadados e playerDetails (para pegar as specs e ROLES reais)
    const metaQuery = `
    {
      reportData {
        report(code: "${reportId}") {
          startTime
          endTime
          fights {
            name
            kill
          }
          playerDetails(startTime: 0, endTime: 9999999999)
        }
      }
    }`;

    const metaRes = await axios.post(
      "https://www.warcraftlogs.com/api/v2/client",
      { query: metaQuery },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const reportMeta = metaRes.data?.data?.reportData?.report;
    if (!reportMeta) return reply({ content: "❌ report não encontrado" });

    // Mapear specs e roles dos jogadores de forma robusta
    const playerInfoMap = {};
    const details = reportMeta.playerDetails?.data?.playerDetails;
    if (details) {
      ["dps", "healers", "tanks"].forEach(role => {
        if (details[role] && Array.isArray(details[role])) {
          details[role].forEach(p => {
            let specName = "Unknown";
            if (p.specs && p.specs.length > 0) {
              const firstSpec = p.specs[0];
              specName = typeof firstSpec === 'object' ? (firstSpec.spec || firstSpec.name || "Unknown") : firstSpec;
            }
            playerInfoMap[p.name] = {
              className: p.type,
              spec: specName,
              role: role // 'dps', 'healers' ou 'tanks'
            };
          });
        }
      });
    }

    const fights = reportMeta.fights || [];
    const boss = fights[0]?.name || "Unknown Boss";
    const kills = fights.filter(f => f.kill).length;
    const wipes = fights.length - kills;

    const reportStart = reportMeta.startTime;
    const reportEnd = reportMeta.endTime;
    const startTime = 0;
    const endTime = reportEnd - reportStart;

    // Passo 2: buscar tabelas de performance
    const tableQuery = `
    {
      reportData {
        report(code: "${reportId}") {
          table(dataType: DamageDone, startTime: ${startTime}, endTime: ${endTime})
          tableHealing: table(dataType: Healing, startTime: ${startTime}, endTime: ${endTime})
          tableTank: table(dataType: DamageTaken, startTime: ${startTime}, endTime: ${endTime})
        }
      }
    }`;

    const tableRes = await axios.post(
      "https://www.warcraftlogs.com/api/v2/client",
      { query: tableQuery },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const report = tableRes.data?.data?.reportData?.report;
    if (!report) return reply({ content: "❌ erro ao buscar tabelas" });

    // ===============================
    // GENERIC EXTRACTOR COM FILTRO DE ROLE
    // ===============================
    const extract = (table, targetRole) => {
      const raw = table?.data;
      const entries = raw?.entries || [];

      return entries
        .map(p => {
          const info = playerInfoMap[p.name];
          const className = info ? info.className : (p.type || "Unknown");
          let spec = info ? info.spec : "Unknown";
          const role = info ? info.role : "Unknown";
          
          if ((spec === "Unknown" || spec === className) && p.icon) {
            const iconParts = p.icon.split("-");
            if (iconParts[0] && iconParts[0] !== className) {
              spec = iconParts[0];
            }
          }

          return {
            name: p.name || "Unknown",
            total: p.total || 0,
            className: className,
            spec: spec,
            role: role
          };
        })
        // FILTRO: Só entra na lista se a role do log bater com a lista que estamos montando
        .filter(p => p.name !== "Unknown" && p.total > 0 && p.role === targetRole)
        .sort((a, b) => b.total - a.total);
    };

    const dps = extract(report.table, "dps");
    const heal = extract(report.tableHealing, "healers");
    const tank = extract(report.tableTank, "tanks");

    const format = (arr) => {
      if (!arr.length) return "❌ sem dados";
      
      let result = "";
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        const specDisplay = (p.spec && p.spec !== "Unknown" && p.spec !== p.className) ? p.spec : "N/A";
        const line = `**${i + 1}.** ${p.name} (${p.className} - ${specDisplay}) — **${(p.total / 1000).toFixed(1)}k**\n`;
        
        if ((result + line).length > 1000) {
          result += "... e mais jogadores";
          break;
        }
        result += line;
      }
      return result;
    };

    // ===============================
    // EMBED RESPONSE
    // ===============================
    const embed = new EmbedBuilder()
      .setTitle(`👑 FULL RAID ROSTER — ${boss}`)
      .setURL(link)
      .setColor("#FFD700")
      .addFields(
        { name: "⚔ Boss", value: boss, inline: true },
        { name: "🔥 Kills", value: `${kills}`, inline: true },
        { name: "💀 Wipes", value: `${wipes}`, inline: true },
        { name: "💥 DPS", value: format(dps) },
        { name: "💚 HEALERS", value: format(heal) },
        { name: "🛡 TANKS", value: format(tank) }
      )
      .setFooter({ text: "StressLogs Bot • Warcraft Logs API v2" })
      .setTimestamp();

    return reply({ embeds: [embed] });

  } catch (e) {
    console.error(e?.response?.data || e);
    return reply({ content: "❌ erro ao analisar log" });
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