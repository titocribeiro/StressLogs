const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  Partials
} = require("discord.js");

const axios = require("axios");

// ===============================
// CLIENT - DECLARAÇÃO DE INTENTS
// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message]
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
    .setDescription("Analisa log da raid ou dungeon")
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

  const fightMatch = link.match(/[?&]fight=(\d+|last)/);
  let fightId = fightMatch ? fightMatch[1] : null;

  try {
    const token = await getWCLToken();

    const metaQuery = `
    {
      reportData {
        report(code: "${reportId}") {
          startTime
          endTime
          fights {
            id
            name
            kill
            startTime
            endTime
            fightPercentage
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

    const fights = reportMeta.fights || [];
    let targetFight = null;
    
    if (fightId === "last") {
      targetFight = fights[fights.length - 1];
    } else if (fightId) {
      targetFight = fights.find(f => f.id == fightId);
    } else {
      targetFight = fights[fights.length - 1];
    }

    if (!targetFight) return reply({ content: "❌ luta não encontrada no log" });

    const boss = targetFight.name;
    const isKill = targetFight.kill;
    const fightDurationMs = targetFight.endTime - targetFight.startTime;
    const durationSecTotal = Math.max(1, Math.floor(fightDurationMs / 1000));
    const durationMin = Math.floor(durationSecTotal / 60);
    const durationSec = durationSecTotal % 60;
    const durationStr = `${durationMin}m ${durationSec}s`;
    const wipePercent = isKill ? "0%" : `${(targetFight.fightPercentage / 100).toFixed(1)}%`;

    const playerInfoMap = {};
    const details = reportMeta.playerDetails?.data?.playerDetails;
    let totalIlvl = 0;
    let playerCount = 0;

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
              id: p.id,
              className: p.type,
              spec: specName,
              role: role,
              minIlvl: p.minItemLevel || 0
            };
            if (p.minItemLevel) {
              totalIlvl += p.minItemLevel;
              playerCount++;
            }
          });
        }
      });
    }

    const avgIlvl = playerCount > 0 ? (totalIlvl / playerCount).toFixed(1) : "N/A";

    const fetchTable = async (dataType) => {
      const query = `
      {
        reportData {
          report(code: "${reportId}") {
            table(dataType: ${dataType}, startTime: ${targetFight.startTime}, endTime: ${targetFight.endTime})
          }
        }
      }`;
      try {
        const res = await axios.post(
          "https://www.warcraftlogs.com/api/v2/client",
          { query },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        return res.data?.data?.reportData?.report?.table?.data;
      } catch (e) {
        console.error(`Erro ao buscar tabela ${dataType}:`, e.message);
        return null;
      }
    };

    const tableDamage = await fetchTable("DamageDone");
    const tableHealing = await fetchTable("Healing");
    const tableTank = await fetchTable("DamageTaken");

    const extract = (data, targetRole) => {
      const entries = data?.entries || [];

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
        .filter(p => p.name !== "Unknown" && p.total > 0 && p.role === targetRole)
        .sort((a, b) => b.total - a.total);
    };

    const dps = extract(tableDamage, "dps");
    const heal = extract(tableHealing, "healers");
    const tank = extract(tableTank, "tanks");

    const formatValue = (val) => {
      if (val >= 1000000) return (val / 1000000).toFixed(1) + "M";
      if (val >= 1000) return (val / 1000).toFixed(1) + "k";
      return val.toString();
    };

    const format = (arr, label) => {
      if (!arr.length) return "❌ sem dados";
      let result = "";
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        const specDisplay = (p.spec && p.spec !== "Unknown" && p.spec !== p.className) ? p.spec : "N/A";
        const perSec = (p.total / durationSecTotal);
        const line = `**${i + 1}.** ${p.name} (${p.className} - ${specDisplay}) — **${formatValue(p.total)}** (${formatValue(perSec)} ${label})\n`;
        
        if ((result + line).length > 1000) {
          result += "... e mais jogadores";
          break;
        }
        result += line;
      }
      return result;
    };

    const embed = new EmbedBuilder()
      .setTitle(`👑 FULL RAID ROSTER — ${boss}`)
      .setURL(link)
      .setColor(isKill ? "#00FF00" : "#FF0000")
      .addFields(
        { name: "⚔ Boss/Dungeon", value: boss, inline: true },
        { name: "⏱ Duração", value: durationStr, inline: true },
        { name: "📉 Status", value: isKill ? "✅ Morto/Concluído" : `❌ ${wipePercent}`, inline: true },
        { name: "🎒 Média ilvl", value: `${avgIlvl}`, inline: true },
        { name: "💥 DPS", value: format(dps, "DPS") },
        { name: "💚 HEALERS", value: format(heal, "HPS") },
        { name: "🛡 TANKS", value: format(tank, "DTPS") }
      )
      .setFooter({ text: "StressLogs Bot • Warcraft Logs API v2" })
      .setTimestamp();

    return reply({ embeds: [embed] });

  } catch (e) {
    console.error("Erro geral no processLog:", e.message);
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

  if (m.content.includes("warcraftlogs.com/reports/")) {
    const words = m.content.split(/\s+/);
    const link = words.find(w => w.includes("warcraftlogs.com/reports/"));
    
    if (!link) return;

    try {
      const loadingMsg = await m.reply("📊 analisando log...");
      return processLog(link, r => loadingMsg.edit(r));
    } catch (e) {
      console.error("Erro ao processar link direto:", e);
      return m.reply("❌ erro ao analisar log");
    }
  }
});

// ===============================
client.login(process.env.DISCORD_TOKEN);