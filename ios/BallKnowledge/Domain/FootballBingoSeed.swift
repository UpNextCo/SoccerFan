import Foundation

enum FootballBingoSeed {
    /// Build a game from a server-generated puzzle (categories + player queue are
    /// already chosen and deterministically ordered server-side). The daily is
    /// server-only — there is deliberately no offline fallback grid.
    static func makeGame(from dto: FootballBingoPuzzleDTO) -> FootballBingoGame {
        let categories = dto.categories.map { c in
            FootballBingoCategory(
                id: c.id,
                title: c.title,
                type: FootballBingoCategoryType(rawValue: c.type) ?? .nationality,
                iconType: FootballBingoIconType(rawValue: c.iconType) ?? .custom,
                iconValue: c.iconValue,
                matchingRule: c.matchingRule,
                logoUrl: c.logoUrl,
                teamId: c.teamId,
                logo2Url: c.logo2Url,
                team2Id: c.team2Id,
                flag: c.flag
            )
        }
        let players = dto.players.map { p in
            FootballBingoPlayer(
                id: p.id,
                name: p.name,
                nationality: p.nationality,
                position: p.position,
                clubs: p.clubs,
                leagues: p.leagues,
                trophies: p.trophies,
                teammates: p.teammates,
                managers: p.managers,
                premierLeagueApps: p.premierLeagueApps,
                topLeagueGoals: p.topLeagueGoals,
                topLeagueApps: p.topLeagueApps,
                headshotUrl: p.headshotUrl,
                awards: p.awards,
                stats: p.stats
            )
        }
        return FootballBingoGame(
            id: dto.puzzleId,
            title: dto.title,
            categories: categories,
            playerQueue: players,
            currentPlayerIndex: 0,
            completedCategoryIds: [],
            placements: [],
            remainingPlayers: players.count,
            status: .active
        )
    }
}
