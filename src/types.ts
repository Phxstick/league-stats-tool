
export type Puuid = string
export type AccountId = string
export type SeasonId = number
export type MatchId = string
export type GameId = number
export type QueueId = number
export type ChampionId = number
export type ItemId = number

export enum Platform {
    BR1 = "BR1",
    EUN1 = "EUN1",
    EUW1 = "EUW1",
    JP1 = "JP1",
    KR = "KR",
    LA1 = "LA1",
    LA2 = "LA2",
    NA1 = "NA1",
    OC1 = "OC1",
    TR1 = "TR1",
    RU = "RU"
}

export enum Region {
    EUROPE = "EUROPE",
    AMERICAS = "AMERICAS",
    ASIA = "ASIA"
}

export enum Queue {
    CrystalScar = "Crystal Scar",
    TwistedTreeline = "Twisted Treeline",
    HowlingAbyss = "Howling Abyss",
    NexusBlitz = "Nexus Blitz",
    SummonersRift = "Summoner's Rift",
    OneForAll = "One For All",
    UltraRapidFire = "Ultra Rapid Fire",
    UltimateSpellbook = "Ultimate Spellbook",
}

export enum Role {
    Solo = "SOLO",
    Duo = "DUO",
    Carry = "DUO_CARRY",
    Support = "DUO_SUPPORT"
}

export enum Lane {
    Top = "TOP",
    Mid = "MID",
    Jungle = "JUNGLE",
    Bottom = "BOTTOM"
}

export interface Summoner {
    name: string
    id: string
    accountId: AccountId
    puuid: Puuid
    summonerLevel: number
}

export interface SummonerInfo {
    platform: Platform
    region: Region
    accountId?: AccountId
    puuid: Puuid
    id?: string
    name?: string
}

interface TeamInfo {
    teamId: number
    bans: { championId: ChampionId }[]
    // Boolean in v5, "Win" | "Fail" in v4
    win: boolean | string
}

interface Perk {
    perk: number
    var1: number
    var2: number
    var3: number
}

interface PlayerStyles {
    description: "primaryStyle" | "subStyle"
    selections: Perk[]
    style: number
}

export interface ParticipantStats {
    win: boolean
    item0: ItemId
    item1: ItemId
    item2: ItemId
    item3: ItemId
    item4: ItemId
    item5: ItemId
    item6: ItemId
    kills: number
    deaths: number
    assists: number
    largestKillingSpree: number
    largestMultiKill: number
    longestTimeSpentLiving: number
    doubleKills: number
    tripleKills: number
    quadraKills: number
    pentaKills: number
    totalDamageDealt: number
    magicDamageDealt: number
    physicalDamageDealt: number
    trueDamageDealt: number
    totalDamageDealtToChampions: number
    magicDamageDealtToChampions: number
    physicalDamageDealtToChampions: number
    trueDamageDealtToChampions: number
    totalHeal: number
    totalDamageTaken: number
    magicalDamageTaken: number
    physicalDamageTaken: number
    trueDamageTaken: number
    goldEarned: number
    totalMinionsKilled: number
    champLevel: number

    // Rune stats
    perks: {
        statPerks: {
            defense: number
            flex: number
            offense: number
        }
        styles: PlayerStyles[]
    }

    // New in v5
    puuid: Puuid
    // ChampionId might be invalid prior to patch 11.4, use championName field instead
    championName: string

    // All of the following fields were previously directly on Participant object
    participantId: number,
    teamId: number,
    championId: ChampionId
}

export interface Participant extends ParticipantStats {
    // Stats in v5 are are now part of this object, keep this for backward compatibility
    stats?: ParticipantStats
}

export interface MatchInfo {
    gameId: GameId
    gameCreation: number
    gameDuration: number
    gameEndTimestamp: number
    queueId: QueueId
    teams: [TeamInfo, TeamInfo]
    participants: Participant[]

    // No longer used in version 5 of the match API
    participantIdentities?: ParticipantIdentity[]
    seasonId: SeasonId
}

export interface MatchDetails {
    metadata: {
        dataVersion: string
        matchId: MatchId
        participants: Puuid[]
    }
    info: MatchInfo
}

export type MatchDetailsMap = {
    [key in MatchId]: MatchDetails
}

export enum MatchProperty {
    CHAMPION = "champion",
    SEASON = "season",
    QUEUE = "queue"
}

export type MatchInfoMap = {
    [key in GameId]: MatchInfo
}

// The following is no longer used in the new V5 version of Riot's match API,
// now a match is just an ID (not the game ID, but a new match ID)
export interface OldMatchInfo {
    platformId: Platform
    gameId: GameId
    champion: ChampionId
    queue: QueueId
    season: SeasonId
    timestamp: number
    role: Role
    lane: Lane
}

// No longer used in version 5 of the match API
interface ParticipantIdentity {
    participantId: number,
    player: {
        accountId: string,
        summonerName: string
        summonerId: string
    }
}

type RuneStyleKey = "Precision" | "Domination" | "Sorcery" | "Resolve" | "Inspiration"

interface Rune {
    id: number
    key: string
    name: string
    shortDesc: string
    longDesc: string
}

interface RuneSlot {
    runes: Rune[]
}

interface RuneStyle {
    id: number
    key: RuneStyleKey
    name: RuneStyleKey
    slots: RuneSlot[]
}

export type Runes = RuneStyle[]