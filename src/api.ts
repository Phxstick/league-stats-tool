import axios from "axios"
const path = require("path")
const zlib = require("zlib")
const tar = require("tar")
const fs = require("fs-extra")
import Paths from "./paths"
import { Summoner, Platform, MatchInfo, MatchDetails, AccountId, MatchDetailsBySeason, MatchDetailsMap } from "./types"

enum Endpoint {
    Summoner = "summoner",
    MatchHistory = "matchHistory",
    MatchDetails = "matchDetails"
}

interface PathParams {
    [Endpoint.Summoner]: {
        summonerName: string
    },
    [Endpoint.MatchHistory]: {
        encryptedAccountId: string
    },
    [Endpoint.MatchDetails]: {
        matchId: number
    }
}

interface QueryParams {
    [Endpoint.Summoner]: {
    },
    [Endpoint.MatchHistory]: {
        beginTime?: number,
        endTime?: number,
        beginIndex?: number,
        endIndex?: number
    },
    [Endpoint.MatchDetails]: {
    }
}

interface ApiResponse {
    [Endpoint.Summoner]: Summoner
    [Endpoint.MatchHistory]: { matches: MatchInfo[] }
    [Endpoint.MatchDetails]: MatchDetails
}

const endpoints = {
    [Endpoint.Summoner]: "/lol/summoner/v4/summoners/by-name/{summonerName}",
    [Endpoint.MatchHistory]: "/lol/match/v4/matchlists/by-account/{encryptedAccountId}",
    [Endpoint.MatchDetails]: "/lol/match/v4/matches/{matchId}"
}

/**
 *  Utility function to prevent exceeding the request rate
 */
function sleep(time: number) {
    return new Promise(resolve => setTimeout(resolve, time))
}

interface DownloadOptions {
    paths: Paths
    apiKey: string
    platform: Platform
    requestInterval?: number
}

export default class API {
    private requestInterval
    private platform
    private paths
    private apiKey
    
    constructor({ requestInterval=1500, paths, platform, apiKey }: DownloadOptions) {
        // Personal API key: at most 20 requests per second, 100 requests per 2 minutes
        this.requestInterval = requestInterval
        this.platform = platform
        this.paths = paths
        this.apiKey = apiKey
    }

    public async downloadDataDragon() {
        const dragonVersionsUrl = "https://ddragon.leagueoflegends.com/api/versions.json"
        const dragonVersionsResponse = await axios.get(dragonVersionsUrl)
        const latestVersion = dragonVersionsResponse.data[0]
        const dragonManifest = JSON.parse(fs.readFileSync(
            this.paths.dragonManifest, { encoding: "utf-8" }))
        const localVersion = dragonManifest.v
        if (localVersion === latestVersion) {
            console.log(`Data Dragon is up to date (version ${latestVersion}).`)
            return
        }
        console.log(`Downloading latest Data Dragon (${localVersion} -> ${latestVersion})...`)
        fs.removeSync(this.paths.tempDownloads)
        fs.ensureDirSync(this.paths.tempDownloads)
        const dragonUrl = `https://ddragon.leagueoflegends.com/cdn/dragontail-${latestVersion}.tgz`
        const dragonResponse = await axios.get(dragonUrl, {
            responseType: "stream",
            // TODO: progress is not logged for some reason, maybe I need to flush?
            onDownloadProgress: (progressEvent) => {
                const ratio = progressEvent.loaded / progressEvent.total
                const perc  = (ratio * 100).toFixed(2) 
                const done = progressEvent.loaded
                const total = progressEvent.total
                process.stdout.write(`Downloaded ${done} of ${total} (${perc}%)\r`)
            }
        })
        const dragonDownloadPath = path.join(this.paths.tempDownloads, "dragontail.tgz")
        const promise = new Promise<void>((resolve, reject) => {
            // TODO: "finish" event didn't work somehow, try out "end" event
            dragonResponse.data.on("end", () => {
                console.log(`Finished downloading Data Dragon.                    `)
                process.stdout.write(`Extracting new data...\r`)
                fs.createReadStream(dragonDownloadPath)
                .pipe(zlib.createGunzip())
                .pipe(tar.x({ C: this.paths.tempDownloads }))
                .on("finish", () => {
                    const newVersionFolder = path.join(
                        this.paths.tempDownloads, latestVersion)
                    fs.removeSync(this.paths.dragon)
                    fs.moveSync(newVersionFolder, this.paths.dragon)
                    fs.removeSync(this.paths.tempDownloads)
                    console.log(`Extracting new data... done.`)
                    resolve()
                })
            })
            // TODO: reject promise if download/extraction failed
        })
        dragonResponse.data.pipe(fs.createWriteStream(dragonDownloadPath))
        return promise
    }

    public async downloadSeasons() {
        const seasonsUrl = "http://static.developer.riotgames.com/docs/lol/seasons.json"
        const seasonsResponse = await axios.get(seasonsUrl)
        fs.writeFileSync(this.paths.seasons, JSON.stringify(seasonsResponse.data, null, 4))
    }

    /**
     *  Send a request to the chosen API endpoint and return the JSON object
     *  from the response. Throws an error if the response is not valid.
     */
    private async sendRequest<E extends Endpoint>(
            endpoint: E, pathParams: PathParams[E], queryParams?: QueryParams[E]): Promise<ApiResponse[E]> {
        let filledUrl = endpoints[endpoint]
        for (const paramName in pathParams) {
            const paramValue = pathParams[paramName]
            filledUrl = filledUrl.replace("{" + paramName + "}", paramValue as any)
        }
        let response;
        try {
            response = await axios.get(filledUrl, {
                baseURL: `https://${this.platform.toLowerCase()}.api.riotgames.com`,
                responseType: "json",
                headers: {
                    "Accept-Charset": "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Riot-Token": this.apiKey
                },
                params: queryParams || {}
            })
        } catch (error) {
            throw error;
        }
        if (response.status < 200 || response.status >= 300) {
            throw new Error("HTTP status error: " + response.status + "\n" +
                "Response: " + response.data.toString());
        }
        return response.data;
    }

    /**
     *  Attempt to retrieve the entire match history using the Riot Development API.
     *  In short intervals, the function will periodically request batches until
     *  the server returns an empty list.
     *  Note that this function does not request any match details.
     */
    private async downloadAllMatches(accountId: AccountId, batchSize=100): Promise<MatchInfo[]> {
        const dataPath = this.paths.matchList(this.platform, accountId)
        let matches: MatchInfo[];
        if (fs.existsSync(dataPath)) {
            matches = JSON.parse(fs.readFileSync(dataPath, { encoding: "utf-8" }))
        } else {
            matches = []
        }

        // Make sure that retrieved matches get saved if program is interrupted
        const saveData = () => {
            fs.writeFileSync(dataPath, JSON.stringify(matches, null, 4))
            console.log(`Wrote ${matches.length} matches to disk.`)
        }
        const onProgramInterrupt = () => {
            saveData()
            process.exit()
        }
        process.on("SIGINT", onProgramInterrupt)

        let beginIndex = matches.length;
        while (true) {
            try {
                const data = await this.sendRequest(Endpoint.MatchHistory, {
                    encryptedAccountId: accountId
                }, {
                    beginIndex: beginIndex,
                    endIndex: beginIndex + batchSize
                });
                console.log(`Received ${data.matches.length} more match entries.`)
                if (data.matches.length === 0) break;
                matches.push(...data.matches)
            } catch (error) {
                console.error("ERROR:", error.response.data.status.message)
                break
            }
            await sleep(this.requestInterval)
            beginIndex += batchSize;
        }
        saveData()
        process.removeListener("SIGINT", onProgramInterrupt)
        console.log(`Match history contains ${matches.length} matches in total.`)
        return matches
    }

    public async getSummonerInfoByName(name: string): Promise<Summoner> {
        return await this.sendRequest(Endpoint.Summoner, {
            summonerName: name
        })
    }

    /**
     *  Attempt to retrieve all new entries in the match history that have been added
     *  since the given time point. If no time is given, the date of the most recent
     *  game of the downloaded matches is used. No match details are retrieved.
     *  In short intervals, the function will periodically request batches
     *  of games played within 5 days, until the current time.
     */
    public async downloadMatches(accountId: AccountId, beginTime?: number): Promise<MatchInfo[]> {
        const dataPath = this.paths.matchList(this.platform, accountId)
        let matches: MatchInfo[]
        if (fs.existsSync(dataPath)) {
            matches = JSON.parse(fs.readFileSync(dataPath, { encoding: "utf-8" }))
            beginTime = matches[0].timestamp + 1
        } else {
            if (beginTime === undefined) {
                return this.downloadAllMatches(accountId)
            } else {
                matches = []
            }
        }
        let newMatches: MatchInfo[] = []

        // Make sure that retrieved matches get saved if program is interrupted
        const saveData = () => {
            matches = [...newMatches, ...matches]
            if (newMatches.length > 0) {
                fs.writeFileSync(dataPath, JSON.stringify(matches, null, 4))
                console.log(`Added ${newMatches.length} new matches to local history.`)
            }
        }
        const onProgramInterrupt = () => {
            saveData()
            process.exit()
        }
        process.on("SIGINT", onProgramInterrupt)

        const batchInterval = 1000 * 60 * 60 * 24 * 5;  // 5 days in milliseconds
        const currentDate = new Date();
        const currentTime = currentDate.getTime()
        while (beginTime < currentTime) {
            try {
                const data = await this.sendRequest(Endpoint.MatchHistory, {
                    encryptedAccountId: accountId
                }, {
                    beginTime: beginTime,
                    endTime: beginTime + batchInterval
                });
                console.log(`Received ${data.matches.length} more match entries.`)
                newMatches = [...data.matches, ...newMatches]
            } catch (error) {
                // If no matches are found in this period, server will return 404
                // (in this case just continue, otherwise print error and abort)
                if (error.response.data.status.status_code !== 404) {
                    console.error("ERROR:", error.response.data.status.message)
                    break;
                }
            }
            await sleep(this.requestInterval)
            beginTime += batchInterval
        }
        saveData()
        process.removeListener("SIGINT", onProgramInterrupt)
        console.log(`Match history contains ${matches.length} matches in total.`)
        return matches
    }

    /**
     *  Iterate through the local match history starting from the back (oldest game)
     *  and request details for each match in short intervals, up until the given
     *  limit (if given).
     */
    public async downloadMatchDetails(accountId: AccountId, matchList: MatchInfo[]): Promise<MatchDetailsMap> {
        const matches = [...matchList].reverse()  // Get old details first before they get deleted
        const matchDetailsPerSeason: MatchDetailsBySeason = {};
        let counter = 0;

        const saveData = () => {
            for (const seasonId in matchDetailsPerSeason) {
                const matchDetails = matchDetailsPerSeason[seasonId]
                const outputPath = this.paths.matchDetails(
                    this.platform, accountId, parseInt(seasonId))
                fs.writeFileSync(outputPath, JSON.stringify(matchDetails))
            }
            if (counter > 0) {
                console.log(`Added ${counter} new match details.             `)
            }
        }

        // Make sure that retrieved matches get saved if program is interrupted
        const onProgramInterrupt = () => {
            saveData()
            process.exit()
        }
        process.on("SIGINT", onProgramInterrupt)

        for (const matchInfo of matches) {
            const seasonId = matchInfo.season

            // Get existing match details for this season (if any exist)
            if (!matchDetailsPerSeason.hasOwnProperty(seasonId)) {
                const filePath = this.paths.matchDetails(
                    this.platform, accountId, seasonId)
                if (fs.existsSync(filePath)) {
                    const existingData = JSON.parse(
                        fs.readFileSync(filePath, { encoding: "utf-8" }))
                    matchDetailsPerSeason[seasonId] = existingData
                } else {
                    matchDetailsPerSeason[seasonId] = {}
                }
            }
            const matchId = matchInfo.gameId;
            if (matchId in matchDetailsPerSeason[seasonId]) continue
            try {
                const matchDetails = await this.sendRequest(Endpoint.MatchDetails, { matchId })
                matchDetailsPerSeason[seasonId][matchId] = matchDetails;
                ++counter;
                process.stdout.write(`Retrieved details for ${counter} matches...    \r`)
            } catch (error) {
                console.error("ERROR:", error.response.data.status.message,
                    "                   ")  // Padding to overwrite previous text
                break;
            }
            await sleep(this.requestInterval)
        }
        console.log(`Retrieved details for ${counter} matches.         \n`)

        saveData()
        process.removeListener("SIGINT", onProgramInterrupt)
        return Object.assign({}, ...Object.values(matchDetailsPerSeason))
    }
}

