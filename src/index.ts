const fs = require("fs-extra")
const commandLineArgs = require("command-line-args");
import Paths from "./paths";
import { AccountId, MatchInfo, MatchInfoMap, MatchId, MatchProperty, OldMatchInfo, Puuid, Queue, MatchDetailsMap, SeasonId, SummonerInfo, GameId, Runes } from "./types";
import API from "./api";
import Stats, { Filters, PlotStatValue, StatValue } from "./stats";
import Output from "./output";

// TODO: inconsistent match order in API functions?

// const queueToIds: { [key in Queue]: QueueId[] } = {
//     [Queue.TwistedTreeline]: [8, 460],
//     [Queue.CrystalScar]: [16],
//     [Queue.HowlingAbyss]: [65, 450],
//     [Queue.SummonersRift]: [400, 430],
//     [Queue.UltraRapidFire]: [900],
//     [Queue.OneForAll]: [1020],
//     [Queue.NexusBlitz]: [1200, 1300]
// }

async function main() {
    const args = commandLineArgs([
        // Whether to use old data from Match API v4
        { name: "v4", type: Boolean, defaultValue: false },

        // Paths
        { name: "configPath", alias: "c", type: String, defaultValue: "stats-config.json" },
        { name: "dataPath", alias: "d", type: String, defaultValue: "summoner-data" },
        { name: "assetsPath", alias: "a", type: String, defaultValue: "assets" },
        { name: "apiKeyPath", alias: "k", type: String, defaultValue: "api-key.txt" },
        { name: "summonerInfoPath", alias: "i", type: String, defaultValue: "summoner-info.json" },

        // Stat options
        // Minimum number of games played for a champion to be included in the stats
        { name: "minGames", alias: "m", type: Number, defaultValue: 5 },
        { name: "sortBy", alias: "s", type: String, multiple: true, defaultValue: [StatValue.NUM_GAMES] }
    ])
    fs.ensureDirSync(args.dataPath)
    fs.ensureDirSync(args.assetsPath)
    const paths = new Paths({
        summonerDataPath: args.dataPath,
        resourcesPath: args.assetsPath
    })
    const useMatchV4 = args.v4
    const summonerInfo = JSON.parse(
        fs.readFileSync(args.summonerInfoPath, { encoding: "utf-8" })) as SummonerInfo
    const apiKey = fs.readFileSync(args.apiKeyPath, { encoding: "utf-8" }).trim();
    const api = new API({
        apiKey,
        paths,
        region: summonerInfo.region,
        platform: summonerInfo.platform
    })

    // Create reverse mappings to determine IDs from season/champion/rune names
    const seasonNameToId: { [key in string]: number } = {
        "PRESEASON 2020": 13.5
    }
    const seasonsInfoRaw = JSON.parse(
        fs.readFileSync(paths.seasons, { encoding: "utf-8" }))
    for (const seasonInfo of seasonsInfoRaw) {
        seasonNameToId[seasonInfo.season] = seasonInfo.id
    }
    const championInfosRaw = JSON.parse(
        fs.readFileSync(paths.champions, { encoding: "utf-8" })).data
    const championNameToId: { [key in string]: number } = {}
    for (const champ in championInfosRaw) {
        const champInfo = championInfosRaw[champ]
        championNameToId[champInfo.name.toLowerCase()] = parseInt(champInfo.key)
        championNameToId[champInfo.id.toLowerCase()] = parseInt(champInfo.key)
    }
    const runeInfosRaw = JSON.parse(
        fs.readFileSync(paths.runes, { encoding: "utf-8" })) as Runes
    const runeIdToName: { [key in number]: string } = {}
    const runeNameToId: { [key in string]: number } = {}
    for (const runeStyle of runeInfosRaw) {
        for (const runeSlot of runeStyle.slots) {
            for (const rune of runeSlot.runes) {
                runeNameToId[rune.name] = rune.id
                runeIdToName[rune.id] = rune.name
            }
        }
    }

    // Determine the account ID and puuid
    let accountId: AccountId
    let puuid: Puuid
    if (summonerInfo.accountId !== undefined) {
        accountId = summonerInfo.accountId
        puuid = summonerInfo.puuid
    } else {
        if (summonerInfo.name !== undefined) {
            const summoner = await api.getSummonerInfoByName(summonerInfo.name)
            accountId = summoner.accountId
            puuid = summoner.puuid
        } else {
            console.log("Either a summoner name or account ID " +
                        "must be provided in the input.")
            return
        }
    }

    // Download assets (if not downloaded yet or version changed)
    await api.downloadSeasons()
    await api.downloadDataDragon()

    // Load summoner data
    let matchInfoList: MatchInfo[] = []
    if (useMatchV4) {
        const matchListPath = paths.oldMatchList(summonerInfo.platform, accountId)
        if (!fs.existsSync(matchListPath)) {
            console.log("Couldn't find data from Match API v4.")
            return
        }
        const oldMatchList: OldMatchInfo[] = JSON.parse(fs.readFileSync(matchListPath, { encoding: "utf-8" }))
        const matchDetailsPerSeason: { [key in SeasonId]: MatchInfoMap } = {}

        // Load match details
        for (const matchInfo of oldMatchList) {
            const seasonId = matchInfo.season

            // Get existing match details for this season (if any exist)
            if (!matchDetailsPerSeason.hasOwnProperty(seasonId)) {
                const filePath = paths.oldMatchDetails(
                    summonerInfo.platform, accountId, seasonId)
                if (fs.existsSync(filePath)) {
                    const existingData = JSON.parse(
                        fs.readFileSync(filePath, { encoding: "utf-8" }))
                    matchDetailsPerSeason[seasonId] = existingData
                } else {
                    matchDetailsPerSeason[seasonId] = {}
                }
            }
        }
        const matchInfoMap: MatchInfoMap = Object.assign({}, ...Object.values(matchDetailsPerSeason))

        // Assemble a list of match details (discard matches where details are unavailable)
        matchInfoList = oldMatchList.map(match => matchInfoMap[match.gameId])
                                    .filter(details => details !== undefined)
    } else {
        fs.ensureDirSync(paths.summonerData(summonerInfo.region, accountId))
        // Load match data from disk
        let matchIds: MatchId[] = []
        const matchIdsPath = paths.matchList(summonerInfo.region, accountId)
        if (fs.existsSync(matchIdsPath)) {
            matchIds = JSON.parse(fs.readFileSync(matchIdsPath, { encoding: "utf-8" }))
        }
        let matchDetails: MatchDetailsMap = {}
        const matchDetailsPath = paths.matchDetails(summonerInfo.region, accountId)
        if (fs.existsSync(matchDetailsPath)) {
            matchDetails = JSON.parse(fs.readFileSync(matchDetailsPath, { encoding: "utf-8" }))
        }
        
        // Download missing match details first (in order to get timestamp of
        // last match in list of matchIds), then get new matches and their details too
        matchDetails = await api.downloadMatchDetails(accountId, matchIds, matchDetails)
        const lastMatchTime = matchIds.length === 0 ? undefined :
            Math.floor(matchDetails[matchIds[0]].info.gameEndTimestamp / 1000) + 1
        matchIds = await api.downloadMatches(matchIds, accountId, puuid, lastMatchTime)
        matchDetails = await api.downloadMatchDetails(accountId, matchIds, matchDetails)

        // Extract match infos in to a list
        matchInfoList = matchIds.map(matchId => matchDetails[matchId])
                                .filter(details => details !== undefined)
                                .map(details => details.info)
    }

    // Validate stats options
    for (const value of args.sortBy) {
        if (!Object.values(StatValue).includes(value)) {
            console.log(`Unknown sorting criterion '${value}'. Possible values are:`)
            console.log(Object.values(StatValue).join(", "))
            return
        }
    }

    // Parse config
    interface Options {
        groupKeys?: MatchProperty[]
        statKeys?: StatValue[]
        sortKeys?: StatValue[]
        plotKey?: PlotStatValue
        filters?: {
            seasons?: string[]
            queues?: string[]
            champions?: string[]
        }
    }
    const statCalc = new Stats(useMatchV4 ? accountId : puuid, championNameToId, runeIdToName)
    const statsConfig = JSON.parse(
        fs.readFileSync(args.configPath, { encoding: "utf-8" })) as Options[]
    const output = new Output({ minNumGames: args.minGames, paths })
    for (const { filters, groupKeys, sortKeys, plotKey, statKeys } of statsConfig) {
        const mappedFilters: Filters = {}
        let filteredMatches = matchInfoList
        let filtersString = ""
        if (filters !== undefined) {
            const filterStringParts: string[] = []
            if (filters.seasons !== undefined) {
                const seasonIds: Set<number> = new Set()
                for (const seasonName of filters.seasons) {
                    seasonIds.add(seasonNameToId[seasonName.toUpperCase()])
                }
                mappedFilters.seasons = seasonIds
                filterStringParts.push("seasons: " + filters.seasons.join(", "))
            }
            if (filters.queues !== undefined) {
                filterStringParts.push("modes: " + filters.queues.join(", "))
                //     const queueIds: Set<Queue> = new Set()
                //     for (const queueName of filters.queues) {
                //         queueToIds[queueName as Queue].forEach(qId => queueIds.add(qId))
                //     }
                mappedFilters.queues = new Set(filters.queues) as Set<Queue>
            }
            if (filters.champions !== undefined) {
                const champIds: Set<number> = new Set()
                for (const champName of filters.champions) {
                    champIds.add(championNameToId[champName.toLowerCase()])
                }
                mappedFilters.champions = champIds
                filterStringParts.push("champions: " + filters.champions.join(", "))
            }
            filteredMatches = statCalc.filterMatches(matchInfoList, mappedFilters)
            filtersString = "(" +  filterStringParts.join(" | ") + ")"
        }
        let headerString
        if (groupKeys !== undefined) {
            const stats = statCalc.groupMatches(filteredMatches,  groupKeys)
            headerString = "   Stats grouped by " + groupKeys.join(" + ")
            headerString += " " + filtersString
            const headerUnderline = "=".repeat(headerString.length + 4)
            console.log()
            console.log(headerString)
            console.log(headerUnderline)
            output.printStats(stats, groupKeys, statKeys, sortKeys || args.sortBy)
            console.log()
        }
        if (plotKey !== undefined) {
            headerString = "   " + plotKey + " over time " + filtersString
            const headerUnderline = "=".repeat(headerString.length + 4)
            console.log()
            console.log(headerString)
            console.log(headerUnderline)
            const plotValues = statCalc.getPlotValues(filteredMatches, plotKey)
            let i = 0
            const reversed = [...plotValues].reverse()
            while (i < reversed.length) {
                output.plotChart(reversed.slice(i, i + 160))
                i += 160
            }
        }
    }
}

main()
