import { AccountId, ChampionId, MatchInfo, QueueId, Queue, SeasonId, MatchProperty, Puuid, ParticipantStats, Participant } from "./types";

const idToQueue: { [key in QueueId]: Queue } = {
    8: Queue.TwistedTreeline,
    16: Queue.CrystalScar,
    65: Queue.HowlingAbyss,
    400: Queue.SummonersRift,
    430: Queue.SummonersRift,
    450: Queue.HowlingAbyss,
    460: Queue.TwistedTreeline,
    900: Queue.UltraRapidFire,
    1020: Queue.OneForAll,
    1200: Queue.NexusBlitz,
    1300: Queue.NexusBlitz,
    1400: Queue.UltimateSpellbook
}

export enum StatValue {
    NUM_GAMES = "numGames",
    WIN_RATIO = "winRate",
    DAMAGE_DEALT = "damageDealt",
    RUNES = "runes"
}

export enum PlotStatValue {
    WIN_DELTA = "winDelta"
}

export interface Filters {
    champions?: Set<ChampionId>
    seasons?: Set<SeasonId>
    queues?: Set<Queue>
}

export interface PropertyValues {
    [MatchProperty.SEASON]: SeasonId
    [MatchProperty.QUEUE]: Queue
    [MatchProperty.CHAMPION]: ChampionId
}

type PropertyKey<P extends MatchProperty> =
    (m: MatchInfo, p: ParticipantStats) => PropertyValues[P]

type PropertyKeys = {
    [property in MatchProperty]: PropertyKey<property>
}

const season10EndTime = (new Date(2020, 10, 10, 0, 0, 0)).getTime()  // November 10th, 2020

export type StatValues = {
    [key in StatValue]: number
}

export type PlotStatValues = {
    [key in PlotStatValue]: number
}

export type Statistics = {
    [key in string | number]: Statistics | StatValues
}

type PlayerId = AccountId | Puuid

type ChampionMap = { [key in string]: ChampionId }
type RuneMap = { [key in number]: string }

function getPlayerInfo(accountId: PlayerId, matchDetails: MatchInfo): ParticipantStats {
    let participant: Participant
    if (matchDetails.participantIdentities) {
        let ownParticipantId: number | undefined;
        for (const participant of matchDetails.participantIdentities) {
            if (participant.player.accountId === accountId) {
                ownParticipantId = participant.participantId
            }
        }
        if (ownParticipantId === undefined) {
            throw new Error("Couldn't find participant with given ID.")
        }
        participant = matchDetails.participants.filter(
            info => info.participantId === ownParticipantId)[0]
        participant.stats!.championId = participant.championId
        participant.stats!.participantId = participant.participantId
        participant.stats!.teamId = participant.teamId
    } else {
        let puuid: Puuid | undefined
        for (const participant of matchDetails.participants) {
            if (participant.puuid === accountId) {
                puuid = participant.puuid
            }
        }
        if (puuid === undefined) {
            throw new Error("Couldn't find participant with given ID.")
        }
        participant = matchDetails.participants.filter(info => info.puuid === puuid)[0]
    }
    return participant.stats ? participant.stats : participant
}

export default class Stats {
    private playerId: PlayerId
    private championNameToId: ChampionMap
    private runeMap: RuneMap

    private propertyKeys: PropertyKeys = {
        [MatchProperty.SEASON]: (m, p) => m.seasonId === 13 && m.gameCreation > season10EndTime ? 13.5 : m.seasonId,
        // Hard coded special case since preseason 11 is counted as part of season 10
        [MatchProperty.QUEUE]: (m, p) => idToQueue[m.queueId],
        [MatchProperty.CHAMPION]: (m, p) => !p.championName ?
            p.championId : this.championNameToId[p.championName.toLowerCase()]
    }

    constructor(playerId: PlayerId, championMap: ChampionMap, runeMap: RuneMap) {
        this.playerId = playerId
        this.championNameToId = championMap
        this.runeMap = runeMap
    }

    private calculateStats(matchList: MatchInfo[]): StatValues {
        let numWins = 0
        let damageDealt = 0
        let runeStats: { [key in string]: [number, number, number] } = {}
        let runeStatsPerDmg: { [key in string]: [number, number, number] } = {}
        const perkCount: { [key in string]: number } = {}
        for (const matchDetails of matchList) {
            const playerInfo = getPlayerInfo(this.playerId, matchDetails)
            if (playerInfo.win) numWins += 1
            const totalDamage = playerInfo.totalDamageDealtToChampions
            damageDealt += totalDamage
            for (const style of playerInfo.perks.styles) {
                for (const perk of style.selections) {
                    const runeName = this.runeMap[perk.perk]
                    if (runeStats[runeName] === undefined) {
                        runeStats[runeName] = [0, 0, 0]
                        runeStatsPerDmg[runeName] = [0, 0, 0]
                        perkCount[runeName] = 0
                    }
                    runeStats[runeName][0] += perk.var1
                    runeStats[runeName][1] += perk.var2
                    runeStats[runeName][2] += perk.var3
                    runeStatsPerDmg[runeName][0] += perk.var1 / totalDamage
                    runeStatsPerDmg[runeName][1] += perk.var2 / totalDamage
                    runeStatsPerDmg[runeName][2] += perk.var3 / totalDamage
                    perkCount[runeName] += 1
                }
            }
        }
        const stats: any = {
            numGames: matchList.length,
            winRate: numWins / matchList.length,
            damageDealt: damageDealt / matchList.length
        }
        for (const rune in runeStats) {
            stats[rune] = runeStats[rune][0] / perkCount[rune]
            stats[rune + " 2"] = runeStats[rune][1] / perkCount[rune]
            stats[rune + " 3"] = runeStats[rune][2] / perkCount[rune]
            stats[rune + " / dmg"] = runeStatsPerDmg[rune][0] / perkCount[rune]
            stats[rune + " 2 / dmg"] = runeStatsPerDmg[rune][1] / perkCount[rune]
            stats[rune + " 3 / dmg"] = runeStatsPerDmg[rune][2] / perkCount[rune]
        }
        return stats
    }

    filterMatches(matchList: MatchInfo[], filters: Filters={}) {
        const filteredMatches = []
        for (const matchDetails of matchList) {
            const playerInfo = getPlayerInfo(this.playerId, matchDetails)
            if (filters.champions && filters.champions.size > 0) {
                const championKey = this.propertyKeys[MatchProperty.CHAMPION]
                const championId = championKey(matchDetails, playerInfo)
                if (!filters.champions.has(championId)) continue
            }
            if (filters.queues && filters.queues.size > 0) {
                const queueKey = this.propertyKeys[MatchProperty.QUEUE]
                const queue = queueKey(matchDetails, playerInfo)
                if (!filters.queues.has(queue)) continue
            }
            if (filters.seasons && filters.seasons.size > 0) {
                const seasonKey = this.propertyKeys[MatchProperty.SEASON]
                const seasonId = seasonKey(matchDetails, playerInfo)
                if (!filters.seasons.has(seasonId)) continue
            }
            filteredMatches.push(matchDetails)
        }
        return filteredMatches
    }

    groupMatches(matchList: MatchInfo[], properties: MatchProperty[]): Statistics {
        const currentProperty = properties[0]
        const remainingProperties = properties.slice(1)
        const propertyKey = this.propertyKeys[currentProperty]
        const groups: { [key in string | number]: MatchInfo[] } = {}
        for (const matchDetails of matchList) {
            const playerInfo = getPlayerInfo(this.playerId, matchDetails)
            // Add match details to list of matches with this property value
            const propertyValue = propertyKey(matchDetails, playerInfo)
            if (groups[propertyValue] === undefined) {
                groups[propertyValue] = []
            }
            groups[propertyValue].push(matchDetails)
        }
        const stats: Statistics = {}
        for (const propertyValue in groups) {
            if (propertyValue === "undefined") continue
            if (remainingProperties.length > 0) {
                stats[propertyValue] = this.groupMatches(
                    groups[propertyValue],  remainingProperties)
            } else {
                stats[propertyValue] = this.calculateStats(groups[propertyValue])
            }
        }
        return stats
    }

    getPlotValues(matchList: MatchInfo[], valueType: PlotStatValue): number[] {
        const initialValues = {
            [PlotStatValue.WIN_DELTA]: 0
        }
        const valuesList: PlotStatValues[] = [initialValues]
        const reversed = [...matchList.reverse()]  // Older matches come first now
        for (const matchDetails of reversed) {
            const values = { ...valuesList[valuesList.length - 1] }
            const playerInfo = getPlayerInfo(this.playerId, matchDetails)
            values[PlotStatValue.WIN_DELTA] += playerInfo.win ? 1 : -1 
            valuesList.push(values)
        }
        return valuesList.map(values => values[valueType])
    }
}