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

  const fightMatch = link.match(/[?&]fight=(\d+|last)/);
  let fightId = fightMatch ? fightMatch[1] : null;

  try {
    const token = await getWCLToken();

    // Passo 1: buscar metadados, playerDetails e fights
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
    const durationMin = Math.floor(fightDurationMs / 60000);
    const durationSec = Math.floor((fightDurationMs % 60000) / 1000);
    const durationStr = `${durationMin}m ${durationSec}s`;
    const wipePercent = isKill ? "0%" : `${(targetFight.fightPercentage / 100).toFixed(1)}%`;

    // Mapear specs e roles dos jogadores
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

    // Passo 2: buscar tabelas de performance e AURAS (para consumíveis)
    const tableQuery = `
    {
      reportData {
        report(code: "${reportId}") {
          table(dataType: DamageDone, startTime: ${targetFight.startTime}, endTime: ${targetFight.endTime})
          tableHealing: table(dataType: Healing, startTime: ${targetFight.startTime}, endTime: ${targetFight.endTime})
          tableTank: table(dataType: DamageTaken, startTime: ${targetFight.startTime}, endTime: ${targetFight.endTime})
          tableDeaths: table(dataType: Deaths, startTime: ${targetFight.startTime}, endTime: ${targetFight.endTime})
          # Usamos auras para pegar buffs que já estavam ativos no início
          tableAuras: table(dataType: Buffs, startTime: ${targetFight.startTime}, endTime: ${targetFight.endTime})
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

    const deaths = report.tableDeaths?.data?.entries || [];
    let firstDeathStr = "Ninguém morreu! 🎉";
    if (deaths.length > 0) {
      const first = deaths[0];
      firstDeathStr = `💀 **${first.name}** (${first.ability?.name || "Dano desconhecido"})`;
    }

    // ===============================
    // CONTAGEM DE CONSUMÍVEIS (v19 - Lógica de Auras)
    // ===============================
    const auras = report.tableAuras?.data?.entries || [];
    const playersWithFlask = new Set();
    const playersWithFood = new Set();

    auras.forEach(p => {
      if (p.abilities && Array.isArray(p.abilities)) {
        p.abilities.forEach(ability => {
          const name = ability.name.toLowerCase();
          // Verifica se o buff é um Flask/Phial ou Food
          // Incluímos termos em inglês e português para garantir
          if (name.includes("flask") || name.includes("phial") || name.includes("frasco") || name.includes("fíala")) {
            playersWithFlask.add(p.name);
          }
          if (name.includes("well fed") || name.includes("food") || name.includes("comida") || name.includes("alimentado") || name.includes("saciedade")) {
            playersWithFood.add(p.name);
          }
        });
      }
    });

    const hasFlask = playersWithFlask.size;
    const hasFood = playersWithFood.size;

    // ===============================
    // GENERIC EXTRACTOR
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
      .setColor(isKill ? "#00FF00" : "#FF0000")
      .addFields(
        { name: "⚔ Boss", value: `${boss} (${isKill ? "KILL" : "WIPE"})`, inline: true },
        { name: "⏱ Duração", value: durationStr, inline: true },
        { name: "📉 Status", value: isKill ? "✅ Morto" : `❌ ${wipePercent}`, inline: true },
        { name: "🎒 Média ilvl", value: `${avgIlvl}`, inline: true },
        { name: "💀 Primeira Morte", value: firstDeathStr, inline: true },
        { name: "🧪 Consumíveis", value: `🧪 Flasks: ${hasFlask}/${playerCount} | 🍗 Food: ${hasFood}/${playerCount}`, inline: true },
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
    const loadingMsg = await m.reply("📊 analisando log...");
    return processLog(match[0], r => loadingMsg.edit(r));
  } catch (e) {
    console.error("Erro ao processar link direto:", e);
    return m.reply("❌ erro ao analisar log");
  }
});

// ===============================
client.login(process.env.DISCORD_TOKEN);