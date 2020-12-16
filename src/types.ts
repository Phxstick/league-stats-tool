
export type AccountId = string
export type SeasonId = number
export type MatchId = number
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

export enum Queue {
    CrystalScar = "Crystal Scar",
    TwistedTreeline = "Twisted Treeline",
    HowlingAbyss = "Howling Abyss",
    NexusBlitz = "Nexus Blitz",
    SummonersRift = "Summoners Rift",
    OneForAll = "One For All",
    UltraRapidFire = "Ultra Rapid Fire"
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
    summonerLevel: number
}

export interface SummonerInfo {
    platform: Platform
    accountId?: AccountId
    id?: string
    name?: string
}

export interface MatchInfo {
    platformId: Platform
    gameId: MatchId
    champion: ChampionId
    queue: QueueId
    season: SeasonId
    timestamp: number
    role: Role
    lane: Lane
}

interface TeamInfo {
    teamId: number
    win: "Win" | "Fail"
}

interface ParticipantStats {
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
}

export interface Participant {
    participantId: number,
    teamId: number,
    championId: ChampionId,
    spell1Id: number,
    spell2Id: number,
    stats: ParticipantStats
}

interface ParticipantIdentity {
    participantId: number,
    player: {
        accountId: string,
        summonerName: string
        summonerId: string
    }
}

export interface MatchDetails {
    gameId: MatchId
    gameCreation: number
    gameDuration: number
    queueId: QueueId
    seasonId: SeasonId
    teams: [TeamInfo, TeamInfo]
    participants: Participant[]
    participantIdentities: ParticipantIdentity[]
}

export type MatchDetailsMap = {
    [key in MatchId]: MatchDetails
}

export type MatchDetailsBySeason = {
    [key in SeasonId]: MatchDetailsMap
}

export enum MatchProperty {
    CHAMPION = "champion",
    SEASON = "season",
    QUEUE = "queue"
}