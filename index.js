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
            keystoneLevel
            keystoneBonus
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
    const keyLevel = targetFight.keystoneLevel ? `+${targetFight.keystoneLevel}` : null;

    // Lógica de cores dinâmicas (v45 - Lógica Rigorosa Baseada em Estrelas)
    let embedColor = "#FFFF00"; // Amarelo (Padrão)
    let statusText = isKill ? "✅ Morto/Concluído" : `❌ ${wipePercent}`;

    if (keyLevel) {
      if (!isKill) {
        embedColor = "#FF0000";
        statusText = `❌ ${wipePercent}`;
      } else {
        if (targetFight.keystoneBonus && targetFight.keystoneBonus > 0) {
          embedColor = "#00FF00";
          statusText = "✅ Concluída no Tempo";
        } else {
          embedColor = "#FFFF00";
          statusText = "⚠️ Concluída fora do Tempo";
        }
      }
    } else {
      embedColor = isKill ? "#00FF00" : "#FF0000";
      statusText = isKill ? "✅ Morto" : `❌ ${wipePercent}`;
    }

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
              id: p.id,
              className: p.type,
              spec: specName,
              role: role,
              ilvl: p.minItemLevel || 0
            };
          });
        }
      });
    }

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

    // Cálculo de ilvl baseado nos jogadores que REALMENTE participaram da luta
    let totalIlvl = 0;
    let playerCount = 0;
    const seenPlayers = new Set();
    const allEntries = [
      ...(tableDamage?.entries || []),
      ...(tableHealing?.entries || []),
      ...(tableTank?.entries || [])
    ];

    allEntries.forEach(entry => {
      if (entry.name && !seenPlayers.has(entry.name)) {
        const info = playerInfoMap[entry.name];
        if (info && info.ilvl > 0) {
          totalIlvl += info.ilvl;
          playerCount++;
          seenPlayers.add(entry.name);
        }
      }
    });

    const avgIlvl = playerCount > 0 ? (totalIlvl / playerCount).toFixed(1) : "N/A";

    const extract = (data) => {
      const entries = data?.entries || [];

      return entries
        .map(p => {
          const info = playerInfoMap[p.name];
          const className = info ? info.className : (p.type || "Unknown");
          let spec = info ? info.spec : "Unknown";
          
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
            spec: spec
          };
        })
        .filter(p => p.name !== "Unknown" && p.total > 0)
        .sort((a, b) => b.total - a.total);
    };

    const dps = extract(tableDamage);
    const heal = extract(tableHealing);
    const tank = extract(tableTank);

    const formatValue = (val) => {
      if (val >= 1000000) return (val / 1000000).toFixed(1) + "M";
      if (val >= 1000) return (val / 1000).toFixed(1) + "k";
      return val.toString();
    };

    // v45: Função de formatação com limites e offset para numeração
    const format = (arr, startIdx = 0, limit = 10) => {
      if (!arr.length || startIdx >= arr.length) return null;
      let result = "";
      const endIdx = Math.min(arr.length, startIdx + limit);
      
      for (let i = startIdx; i < endIdx; i++) {
        const p = arr[i];
        const specDisplay = (p.spec && p.spec !== "Unknown" && p.spec !== p.className) ? p.spec : "N/A";
        const perSec = (p.total / durationSecTotal);
        const line = `**${i + 1}.** ${p.name} (${p.className} - ${specDisplay}) — **${formatValue(p.total)}** (${formatValue(perSec)})\n`;
        
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
      .setColor(embedColor)
      .addFields(
        { name: "⚔ Boss/Dungeon", value: boss, inline: true },
        { name: "⏱ Duração", value: durationStr, inline: true },
        { name: "📉 Status", value: statusText, inline: true },
        { name: "🎒 Média ilvl", value: `${avgIlvl}`, inline: true }
      );

    if (keyLevel) {
      embed.addFields({ name: "🔑 Nv. da Pedra", value: keyLevel, inline: true });
    }

    // v45: Divisão de DPS em dois campos (1-10 e 11-20)
    const dps1 = format(dps, 0, 10);
    const dps2 = format(dps, 10, 10);
    const healList = format(heal, 0, 10);
    const tankList = format(tank, 0, 10);

    if (dps1) embed.addFields({ name: "💥 DPS", value: dps1 });
    // Título invisível (\u200B) para o segundo campo de DPS
    if (dps2) embed.addFields({ name: "\u200B", value: dps2 });
    
    if (healList) embed.addFields({ name: "💚 HEALERS", value: healList });
    if (tankList) embed.addFields({ name: "🛡 TANKS", value: tankList });

    embed.setFooter({ text: "StressLogs Bot • Warcraft Logs API v2" })
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