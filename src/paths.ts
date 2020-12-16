import { AccountId, Platform, SeasonId } from "types"
import { runInThisContext } from "vm"

const path = require("path")

interface PathsProps {
    summonerDataPath: string,
    resourcesPath: string
}

export default class Paths {
    // Base paths
    private readonly summonerDataBase: string
    private readonly resources: string 

    // Summoner Data
    public readonly summonerData: (platform: Platform, accountId: AccountId) => string
    public readonly matchList: (platform: Platform, accountId: AccountId) => string
    public readonly matchDetails: (platform: Platform, accountId: AccountId, seasonId: SeasonId) => string

    // Resources
    public readonly dragon: string
    public readonly seasons: string
    public readonly champions: string
    public readonly dragonManifest: string
    public readonly tempDownloads: string

    constructor(props: PathsProps) {
        this.summonerDataBase = props.summonerDataPath
        this.resources = props.resourcesPath

        this.summonerData = (platform: Platform, accountId: AccountId) => {
            return path.join(this.summonerDataBase, platform, accountId)
        }
        this.matchList = (platform, accountId) =>
            path.join(this.summonerData(platform, accountId), "matches.json")
        this.matchDetails = (platform, accountId, seasonId) =>
            path.join(this.summonerData(platform, accountId),
                `match-details-${seasonId}.json`)

        this.seasons = path.join(this.resources, "seasons.json")
        this.dragon = path.join(this.resources, "dragontail")
        this.dragonManifest = path.join(this.dragon, "manifest.json")
        const dragonData = path.join(this.dragon, "data", "en_US")
        this.champions = path.join(dragonData, "champion.json")
        this.tempDownloads = path.join(this.resources, "downloads")
    }
}