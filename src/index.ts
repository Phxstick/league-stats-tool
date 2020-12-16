const fs = require("fs-extra")
const commandLineArgs = require("command-line-args");
import Paths from "./paths";
import { AccountId, MatchProperty, SummonerInfo } from "./types";
import API from "./api";
import { groupMatches, StatValue } from "./stats";
import Output from "./output";

async function main() {
    const args = commandLineArgs([
        // Paths
        { name: "outputPath", alias: "o", type: String, defaultValue: "summoner-data" },
        { name: "assetsPath", alias: "a", type: String, defaultValue: "assets" },
        { name: "apiKeyPath", alias: "k", type: String, defaultValue: "api-key.txt" },
        { name: "summonerInfoPath", alias: "i", type: String, defaultValue: "summoner-info.json" },

        // Stat options
        // Minimum number of games played for a champion to be included in the stats
        { name: "minGames", alias: "m", type: Number, defaultValue: 5 },
        { name: "sortBy", alias: "s", type: String, multiple: true, defaultValue: [StatValue.NUM_GAMES] }
    ])
    fs.ensureDirSync(args.outputPath)
    fs.ensureDirSync(args.assetsPath)
    const paths = new Paths({
        summonerDataPath: args.outputPath,
        resourcesPath: args.assetsPath
    })
    const summonerInfo = JSON.parse(
        fs.readFileSync(args.summonerInfoPath, { encoding: "utf-8" })) as SummonerInfo
    const apiKey = fs.readFileSync(args.apiKeyPath, { encoding: "utf-8" }).trim();
    const api = new API({
        apiKey,
        paths,
        platform: summonerInfo.platform
    })

    // Determine the account ID
    let accountId: AccountId
    if (summonerInfo.accountId !== undefined) {
        accountId = summonerInfo.accountId
    } else {
        if (summonerInfo.name !== undefined) {
            const summoner = await api.getSummonerInfoByName(summonerInfo.name)
            accountId = summoner.accountId
        } else {
            console.log("Either a summoner name or account ID " +
                        "must be provided in the input.")
            return
        }
    }

    // Download assets (if not downloaded yet or version changed)
    await api.downloadSeasons()
    await api.downloadDataDragon()

    // Download summoner data
    fs.ensureDirSync(paths.summonerData(summonerInfo.platform, accountId))
    const matchList = await api.downloadMatches(accountId)
    const matchDetails = await api.downloadMatchDetails(accountId, matchList)

    // Assemble a list of match details (discard matches where details are unavailable)
    const matchDetailsList = matchList.map(match => matchDetails[match.gameId])
                                      .filter(details => details !== undefined)

    // Validate stats options
    for (const value of args.sortBy) {
        if (!Object.values(StatValue).includes(value)) {
            console.log(`Unknown sorting criterion '${value}'. Possible values are:`)
            console.log(Object.values(StatValue).join(", "))
            return
        }
    }

    // Calculate stats and print them
    const defaultOptions = [
        { groupKeys: [MatchProperty.SEASON] },
        { groupKeys: [MatchProperty.QUEUE] },
        { groupKeys: [MatchProperty.QUEUE, MatchProperty.CHAMPION] }
    ]
    const output = new Output({ minNumGames: args.minGames, paths })
    for (const { groupKeys } of defaultOptions) {
        const stats = groupMatches(matchDetailsList, accountId, groupKeys, {})
        const headerString = "  Win rates by: " + groupKeys.join(" + ") 
        const headerUnderline = "=".repeat(headerString.length + 4)
        console.log()
        console.log(headerString)
        console.log(headerUnderline)
        output.printStats(stats, groupKeys, [args.sortBy])
    }
}

main()
