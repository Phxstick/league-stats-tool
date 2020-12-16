import { AccountId, ChampionId, MatchDetails, QueueId, Queue, Participant, SeasonId, MatchProperty } from "./types";

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
    1300: Queue.NexusBlitz
}

export enum StatValue {
    NUM_GAMES = "numGames",
    WIN_RATIO = "winRate"
}

interface Filters {
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
    (m: MatchDetails, p: Participant) => PropertyValues[P]

type PropertyKeys = {
    [property in MatchProperty]: PropertyKey<property>
}

const propertyKeys: PropertyKeys = {
    [MatchProperty.SEASON]: (m, p) => m.seasonId,
    [MatchProperty.QUEUE]: (m, p) => idToQueue[m.queueId],
    [MatchProperty.CHAMPION]: (m, p) => p.championId
}

export type StatValues = {
    [key in StatValue]: number
}

export type Statistics = {
    [key in string | number]: Statistics | StatValues
}

function getPlayerInfo(accountId: AccountId, matchDetails: MatchDetails) {
    let ownParticipantId: number | undefined;
    for (const participant of matchDetails.participantIdentities) {
        if (participant.player.accountId === accountId) {
            ownParticipantId = participant.participantId
        }
    }
    if (ownParticipantId === undefined) {
        throw new Error("Couldn't find participant with given ID.")
    }
    return matchDetails.participants.filter(
        info => info.participantId === ownParticipantId)[0]
}

function calculateStats(
        matchList: MatchDetails[],
        accountId: AccountId): StatValues {
    let numWins = 0
    for (const matchDetails of matchList) {
        const playerInfo = getPlayerInfo(accountId, matchDetails)
        if (playerInfo.stats.win) numWins += 1
    }
    return {
        numGames: matchList.length,
        winRate: numWins / matchList.length
    }
}

export function groupMatches(
        matchList: MatchDetails[],
        accountId: AccountId,
        properties: MatchProperty[],
        filters: Filters={}): Statistics {
    const currentProperty = properties[0]
    const remainingProperties = properties.slice(1)
    const propertyKey = propertyKeys[currentProperty]
    const groups: { [key in string | number]: MatchDetails[] } = {}
    for (const matchDetails of matchList) {
        const playerInfo = getPlayerInfo(accountId, matchDetails)
        // Skip game if it doesn't match the filters
        if (filters.champions && filters.champions.size > 0) {
            const championKey = propertyKeys[MatchProperty.CHAMPION]
            const championId = championKey(matchDetails, playerInfo)
            if (!filters.champions.has(championId)) continue
        }
        if (filters.queues && filters.queues.size > 0) {
            const queueKey = propertyKeys[MatchProperty.QUEUE]
            const queue = queueKey(matchDetails, playerInfo)
            if (!filters.queues.has(queue)) continue
        }
        if (filters.seasons && filters.seasons.size > 0) {
            const seasonKey = propertyKeys[MatchProperty.SEASON]
            const seasonId = seasonKey(matchDetails, playerInfo)
            if (!filters.seasons.has(seasonId)) continue
        }
        // Add match details to list of matches with this property value
        const propertyValue = propertyKey(matchDetails, playerInfo)
        if (groups[propertyValue] === undefined) {
            groups[propertyValue] = []
        }
        groups[propertyValue].push(matchDetails)
    }
    const stats: Statistics = {}
    for (const propertyValue in groups) {
        if (remainingProperties.length > 0) {
            stats[propertyValue] = groupMatches(
                groups[propertyValue], accountId,
                remainingProperties, filters
            )
        } else {
            stats[propertyValue] = calculateStats(
                groups[propertyValue], accountId
            )
        }
    }
    return stats
}