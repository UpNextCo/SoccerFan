import Foundation

enum DailyChallengeResolver {
    static func targetManChallenge(from bundle: DailyBundleDTO?) -> TargetManChallenge {
        guard let bundle, let puzzle = bundle.targetManPuzzle else {
            return TargetManSeed.makeDailyChallenge()
        }
        return targetManChallenge(from: puzzle, date: bundle.date)
    }

    static func targetManChallenge(from puzzle: TargetManPuzzleDTO, date: String) -> TargetManChallenge {
        let league = TargetManLeague.allCases.first { $0.rawValue == puzzle.league }
            ?? TargetManLeague.allCases.first { $0.apiLeagueId == puzzle.leagueId }
            ?? .premierLeague
        let category = TargetManStatCategory(rawValue: puzzle.category) ?? .goals

        return TargetManChallenge(
            id: puzzle.puzzleId,
            league: league,
            category: category,
            target: puzzle.target,
            isDaily: true,
            date: date
        )
    }

    static func blindRankChallenge(from bundle: DailyBundleDTO?) async -> BlindRankChallenge {
        guard let bundle, let puzzle = bundle.blindRankPuzzle else {
            return BlindRankSeed.makeDailyChallenge(date: bundle?.date)
        }

        if let challenge = await blindRankChallenge(from: puzzle, date: bundle.date) {
            return challenge
        }
        return BlindRankSeed.makeDailyChallenge(date: bundle.date)
    }

    static func blindRankChallenge(from puzzle: BlindRankPuzzleDTO, date: String) async -> BlindRankChallenge? {
        guard let category = blindRankCategory(from: puzzle.category) else { return nil }
        guard let metric = careerMetric(for: category) else { return nil }
        guard !puzzle.presentationOrder.isEmpty else { return nil }

        var valuedPlayers: [BlindRankPlayer] = []
        valuedPlayers.reserveCapacity(puzzle.presentationOrder.count)

        for entry in puzzle.presentationOrder {
            do {
                let stats = try await APIClient.shared.getPlayerCareerStats(
                    playerId: entry.id,
                    leagueId: TargetManLeague.premierLeague.apiLeagueId
                )
                let statValue = TargetManStats.statValue(from: stats.totals, category: targetCategory(for: metric))
                valuedPlayers.append(
                    BlindRankPlayer(
                        id: entry.id,
                        name: entry.name,
                        club: entry.club,
                        league: entry.league,
                        nationality: entry.nationality,
                        position: entry.position,
                        statValue: statValue
                    )
                )
            } catch {
                return nil
            }
        }

        let values = valuedPlayers.map(\.statValue)
        guard Set(values).count == values.count else { return nil }

        let correctRanking = valuedPlayers
            .sorted {
                if $0.statValue == $1.statValue { return $0.name < $1.name }
                return $0.statValue > $1.statValue
            }
            .map(\.id)

        let byId = Dictionary(uniqueKeysWithValues: valuedPlayers.map { ($0.id, $0) })
        let presentationOrder = puzzle.presentationOrder.compactMap { entry -> BlindRankPlayer? in
            guard let player = byId[entry.id] else { return nil }
            return BlindRankPlayer(
                id: entry.id,
                name: entry.name,
                club: entry.club,
                league: entry.league,
                nationality: entry.nationality,
                position: entry.position,
                statValue: player.statValue
            )
        }

        guard presentationOrder.count == puzzle.presentationOrder.count else { return nil }

        return BlindRankChallenge(
            id: puzzle.puzzleId,
            category: category,
            presentationOrder: presentationOrder,
            correctRanking: correctRanking,
            isDaily: true,
            date: date
        )
    }

    private static func blindRankCategory(from apiCategory: String) -> BlindRankCategory? {
        switch apiCategory {
        case "premier_league_goals": return .premierLeagueGoals
        case "premier_league_assists": return .premierLeagueAssists
        case "premier_league_appearances": return .premierLeagueAppearances
        default: return nil
        }
    }

    private static func careerMetric(for category: BlindRankCategory) -> CareerStatMetric? {
        switch category {
        case .premierLeagueGoals: return .goals
        case .premierLeagueAssists: return .assists
        case .premierLeagueAppearances: return .appearances
        default: return nil
        }
    }

    private static func targetCategory(for metric: CareerStatMetric) -> TargetManStatCategory {
        switch metric {
        case .goals: return .goals
        case .assists: return .assists
        case .appearances: return .appearances
        case .yellowCards: return .yellowCards
        case .redCards: return .redCards
        case .minutes: return .minutesPlayed
        case .cleanSheets: return .cleanSheets
        case .saves: return .saves
        case .foulsCommitted: return .foulsCommitted
        case .tackles: return .tacklesWon
        }
    }
}
