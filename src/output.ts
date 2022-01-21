const fs = require("fs")
const asciichart = require("asciichart")
import Paths from "./paths";
import { ChampionId, MatchProperty, Platform, SeasonId } from "./types";
import { Statistics, StatValue, StatValues } from "./stats";
import { stat } from "fs-extra";

const platformNames = {
    [Platform.BR1]: "Brazil",
    [Platform.EUN1]: "EU Northeast",
    [Platform.EUW1]: "EU West",
    [Platform.JP1]: "Japan",
    [Platform.KR]: "Korea",
    [Platform.LA1]: "Latin America 1",
    [Platform.LA2]: "Latin America 2",
    [Platform.NA1]: "North America",
    [Platform.OC1]: "Oceania",
    [Platform.TR1]: "Turkey",
    [Platform.RU]: "Russia"
}

function chooseColor(winRate: number) {
    if (winRate < 0.50) {
        if (winRate < 0.47) {
            return 3  // Yellow
        }
        if (winRate < 0.43) {
            return 5  // Red
        }
        if (winRate < 0.38) {
            return 1  // Pink
        }
    } else if (winRate > 0.50) {
        if (winRate > 0.53) {
            return 6  // Turquoise
        }
        if (winRate > 0.57) {
            return 2  // Green
        }
        if (winRate > 0.62) {
            return 4  // Blue
        }
    }
    return undefined
    // if (winRate < 50) {
    //     if (winRate <= 46) {
    //         return 208  // Orange
    //     }
    //     if (winRate <= 42) {
    //         return 9  // Light red
    //     }
    //     if (winRate <= 36) {
    //         return 196  //  Orangeish red
    //     }
    //     if (winRate <= 32) {
    //         return 88  //  Dark red
    //     }
    // } else if (winRate > 50) {
    //     if (winRate >= 54) {
    //         return 14  // Turquoise
    //     }
    //     if (winRate >= 58) {
    //         return 10  // Light green
    //     }
    //     if (winRate >= 62) {
    //         return 2  // Green
    //     }
    //     if (winRate >= 66) {
    //         return 135  // Light purple
    //     }
    // }
    // return undefined
}

function applyColor(color: number, text: string): string {
    return `\u001b[38;5;${color}m${text}\u001b[0m`
}

type ChampionInfos = {
    [key in ChampionId]: {
        name: string
    } 
}

type SeasonNames = {
    [key in SeasonId]: string
}

interface OutputProps {
    minNumGames: number
    paths: Paths
}

export default class Output {
    private minNumGames: number
    private championInfos: ChampionInfos
    private seasonNames: SeasonNames

    constructor({ minNumGames=0, paths }: OutputProps) {
        this.minNumGames = minNumGames

        const championInfosRaw = JSON.parse(
            fs.readFileSync(paths.champions, { encoding: "utf-8" })).data
        this.championInfos = {}
        for (const champ in championInfosRaw) {
            const champInfo = championInfosRaw[champ]
            this.championInfos[champInfo.key] = champInfo
        }

        const seasonsInfoRaw = JSON.parse(
            fs.readFileSync(paths.seasons, { encoding: "utf-8" }))
        this.seasonNames = {}
        for (const seasonInfo of seasonsInfoRaw) {
            this.seasonNames[seasonInfo.id] = seasonInfo.season
        }
    }

    private convertValue(value: string, type: MatchProperty): string {
        if (type === MatchProperty.CHAMPION) {
            return this.championInfos[parseInt(value) as ChampionId].name
        } else if (type === MatchProperty.QUEUE) {
            return value as string
        } else if (type === MatchProperty.SEASON) {
            // Hard coded special case since preseason 11 is counted as part of season 10
            return value === "13.5" ? "PRESEASON 2020" : this.seasonNames[parseInt(value) as SeasonId]
        } else {
            throw Error(`Unknown match property '${type}'`)
        }
    }

    private formatStatValue(key: StatValue, value: number): string {
        if (key === StatValue.WIN_RATIO) {
            const winPercentage = value * 100
            let winPercString = winPercentage.toFixed(2)
            const colorCode = chooseColor(value)
            if (colorCode !== undefined) 
                winPercString = applyColor(colorCode, winPercString)
            return winPercString + "% won"
        }
        if (!Number.isInteger(value)) {
            const percentage = (value * 100).toFixed(2)
            return `${key}: ${percentage}%`
        }
        return `${key}: ${value}`
        // if (value > 1000) {
        //     return Math.round(value / 1000).toString() + "k"
        // }
        return value.toString()
    }

    public printStats(
            stats: Statistics,
            groupKeys: MatchProperty[],
            statKeys: StatValue[]=[StatValue.WIN_RATIO],
            sortBy: StatValue[]=[StatValue.NUM_GAMES],
            recursionLevel=1) {
        const propertyKey = groupKeys[0]
        const remainingGroupKeys = groupKeys.slice(1)
        if (remainingGroupKeys.length > 0) {
            // TODO: sort groups here?
            for (const propertyValue in stats) {
                const subStats = stats[propertyValue] as Statistics
                console.log()
                console.log(propertyValue)
                console.log("-".repeat(propertyValue.length))
                this.printStats(subStats, remainingGroupKeys, statKeys, sortBy, recursionLevel + 1) 
            }
        } else {
            const statValueMap = stats as { [key in string | number]: StatValues }
            const orderedKeys = Object.keys(stats)
            for (let i = sortBy.length - 1; i >= 0; --i) {
                const valueName = sortBy[i]
                // Always assume reverse order (highest first) for now
                orderedKeys.sort((k1, k2) =>
                    statValueMap[k2][valueName] - statValueMap[k1][valueName])

            }
            for (const propertyValue of orderedKeys) {
                const valueString = this.convertValue(propertyValue, propertyKey)
                const statValues = statValueMap[propertyValue]
                const numGames = statValues[StatValue.NUM_GAMES]
                if (numGames < this.minNumGames) continue
                const statStrings: string[] = []
                for (const statKey of statKeys) {
                    if (statValues[statKey] === undefined) continue
                    statStrings.push(this.formatStatValue(statKey, statValues[statKey]))
                }
                console.log(`  ${valueString} (${numGames} games): ` + statStrings.join(", "))
            }
        }
    }

    plotChart(values: number[]) {
        const chart = asciichart.plot(values)
        const chartWidth = chart.indexOf("\n")
        console.log(chart)
        console.log("-".repeat(chartWidth + 5))
    }
}