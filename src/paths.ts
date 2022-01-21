import { AccountId, Platform, Region, SeasonId } from "types"

const path = require("path")

interface PathsProps {
    summonerDataPath: string,
    resourcesPath: string
}

export default class Paths {
    // Base paths
    private readonly summonerDataBase: string
    private readonly resources: string 

    // Match data (match v5)
    public readonly summonerData: (region: Region, accountId: AccountId) => string
    public readonly matchList: (region: Region, accountId: AccountId) => string
    public readonly matchDetails: (region: Region, accountId: AccountId) => string

    // Old match data (match v4)
    public readonly oldSummonerData: (platform: Platform, accountId: AccountId) => string
    public readonly oldMatchList: (platform: Platform, accountId: AccountId) => string
    public readonly oldMatchDetails: (platform: Platform, accountId: AccountId, seasonId: SeasonId) => string

    // Resources
    public readonly dragon: string
    public readonly seasons: string
    public readonly champions: string
    public readonly runes: string
    public readonly dragonManifest: string
    public readonly tempDownloads: string

    constructor(props: PathsProps) {
        this.summonerDataBase = props.summonerDataPath
        this.resources = props.resourcesPath

        this.summonerData = (region, accountId) =>
            path.join(this.summonerDataBase, region, accountId)
        this.matchList = (region, accountId) =>
            path.join(this.summonerData(region, accountId), "matches.json")
        this.matchDetails = (region, accountId) =>
            path.join(this.summonerData(region, accountId), `match-details.json`)

        this.oldSummonerData = (platform, accountId) =>
            path.join(this.summonerDataBase, platform, accountId)
        this.oldMatchList = (platform, accountId) =>
            path.join(this.oldSummonerData(platform, accountId), "old-matches.json")
        this.oldMatchDetails = (platform, accountId, seasonId) =>
            path.join(this.oldSummonerData(platform, accountId),
                `match-details-${seasonId}.json`)

        this.seasons = path.join(this.resources, "seasons.json")
        this.dragon = path.join(this.resources, "dragontail")
        this.dragonManifest = path.join(this.dragon, "manifest.json")
        const dragonData = path.join(this.dragon, "data", "en_US")
        this.champions = path.join(dragonData, "champion.json")
        this.runes = path.join(dragonData, "runesReforged.json")
        this.tempDownloads = path.join(this.resources, "downloads")
    }
}