import axios from "axios"
const path = require("path")
const zlib = require("zlib")
const tar = require("tar")
const fs = require("fs-extra")
import Paths from "./paths"
import { Summoner, Platform, MatchId, AccountId, Puuid, MatchDetailsMap, MatchDetails, Region } from "./types"

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
        puuid: Puuid
    },
    [Endpoint.MatchDetails]: {
        matchId: string
    }
}

interface QueryParams {
    [Endpoint.Summoner]: {
    },
    [Endpoint.MatchHistory]: {
        start?: number,
        count?: number
        startTime?: number,
        endTime?: number,
    },
    [Endpoint.MatchDetails]: {
    }
}

interface ApiResponse {
    [Endpoint.Summoner]: Summoner
    [Endpoint.MatchHistory]: MatchId[]
    [Endpoint.MatchDetails]: MatchDetails
}

const endpoints = {
    [Endpoint.Summoner]: "/lol/summoner/v4/summoners/by-name/{summonerName}",
    [Endpoint.MatchHistory]: "/lol/match/v5/matches/by-puuid/{puuid}/ids",
    [Endpoint.MatchDetails]: "/lol/match/v5/matches/{matchId}"
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
    region: Region
    platform: Platform
    requestInterval?: number
}

export default class API {
    private requestInterval
    private region
    private platform
    private paths
    private apiKey
    
    constructor({ requestInterval=1500, paths, region, platform, apiKey }: DownloadOptions) {
        // Personal API key: at most 20 requests per second, 100 requests per 2 minutes
        this.requestInterval = requestInterval
        this.region = region
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
        const routingValue = endpoint === Endpoint.Summoner ? this.platform : this.region
        try {
            response = await axios.get(filledUrl, {
                baseURL: `https://${routingValue.toLowerCase()}.api.riotgames.com`,
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
    private async downloadAllMatches(accountId: AccountId, puuid: Puuid, batchSize=100): Promise<MatchId[]> {
        const dataPath = this.paths.matchList(this.region, accountId)
        let matchIds: MatchId[] = [];

        // Make sure that retrieved matches get saved if program is interrupted
        const saveData = () => {
            fs.writeFileSync(dataPath, JSON.stringify(matchIds, null, 4))
            console.log(`Wrote ${matchIds.length} matches to disk.`)
        }
        const onProgramInterrupt = () => {
            saveData()
            process.exit()
        }
        process.on("SIGINT", onProgramInterrupt)

        let beginIndex = matchIds.length;
        while (true) {
            try {
                const data = await this.sendRequest(Endpoint.MatchHistory, {
                    puuid: puuid
                }, {
                    start: beginIndex,
                    count: batchSize
                });
                console.log(`Downloaded ${data.length}  match entries.`)
                if (data.length === 0) break;
                matchIds.push(...data)
            } catch (error) {
                console.error("ERROR:", (error as any).response.data.status.message)
                break
            }
            await sleep(this.requestInterval)
            beginIndex += batchSize;
        }
        saveData()
        process.removeListener("SIGINT", onProgramInterrupt)
        console.log(`Match history contains ${matchIds.length} matches in total.`)
        return matchIds
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
    public async downloadMatches(matchIds: MatchId[], accountId: AccountId, puuid: Puuid, beginTime?: number): Promise<MatchId[]> {
        if (beginTime === undefined)
            return this.downloadAllMatches(accountId, puuid)
        let newMatches: MatchId[] = []

        // Make sure that retrieved matches get saved if program is interrupted
        const dataPath = this.paths.matchList(this.region, accountId)
        const saveData = () => {
            matchIds = [...newMatches, ...matchIds]
            if (newMatches.length > 0) {
                fs.writeFileSync(dataPath, JSON.stringify(matchIds, null, 4))
                // console.log(`Added ${newMatches.length} new matches to local history.`)
            }
        }
        const onProgramInterrupt = () => {
            saveData()
            process.exit()
        }
        process.on("SIGINT", onProgramInterrupt)

        const batchInterval =  60 * 60 * 24 * 5;  // 5 days in seconds
        const currentDate = new Date();
        const currentTime = Math.floor(currentDate.getTime() / 1000)
        while (beginTime < currentTime) {
            try {
                const data = await this.sendRequest(Endpoint.MatchHistory, {
                    puuid
                }, {
                    startTime: beginTime,
                    endTime: beginTime + batchInterval
                });
                if (data.length > 0) {
                    console.log(`Downloaded ${data.length} more match entries.`)
                }
                newMatches = [...data, ...newMatches]
            } catch (error) {
                // If no matches are found in this period, server will return 404
                // (in this case just continue, otherwise print error and abort)
                if ((error as any).response.data.status.status_code !== 404) {
                    console.error("ERROR:", (error as any).response.data.status.message)
                    break;
                }
            }
            await sleep(this.requestInterval)
            beginTime += batchInterval
        }
        saveData()
        process.removeListener("SIGINT", onProgramInterrupt)
        console.log(`Match history contains ${matchIds.length} matches.`)
        return matchIds
    }

    /**
     *  Iterate through the local match history starting from the back (oldest game)
     *  and request details for each match in short intervals, up until the given
     *  limit (if given).
     */
    public async downloadMatchDetails(
        accountId: AccountId,
        matchIds: MatchId[],
        matchDetailsMap: MatchDetailsMap
    ): Promise<MatchDetailsMap> {
        matchIds = [...matchIds].reverse()  // Get old details first before they get deleted
        let counter = 0;

        const saveData = () => {
            const outputPath = this.paths.matchDetails(this.region, accountId)
            fs.writeFileSync(outputPath, JSON.stringify(matchDetailsMap))
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
        const numMissingMatches = matchIds.filter(id => !(id in matchDetailsMap)).length
        if (numMissingMatches === 0) return matchDetailsMap

        for (const matchId of matchIds) {
            if (matchId in matchDetailsMap) continue
            try {
                const matchDetails = await this.sendRequest(Endpoint.MatchDetails, { matchId })
                matchDetailsMap[matchId] = matchDetails
                ++counter;
                process.stdout.write(`Downloaded data for ${counter} / ${numMissingMatches} matches...    \r`)
            } catch (error) {
                console.error("ERROR:", (error as any).response.data.status.message,
                    "                   ")  // Padding to overwrite previous text
                break;
            }
            await sleep(this.requestInterval)
        }
        console.log(`Downloaded data for ${counter} / ${numMissingMatches} matches.         `)

        saveData()
        process.removeListener("SIGINT", onProgramInterrupt)
        return matchDetailsMap
    }
}

