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

    /// Build the Blind Rank challenge from the daily bundle. The server now embeds
    /// each player's stat value, so this is a pure, offline-safe transform — no
    /// per-player network calls and no silent swap to a different puzzle. We only
    /// fall back to the local seed when there is genuinely no server puzzle.
    static func blindRankChallenge(from bundle: DailyBundleDTO?) -> BlindRankChallenge {
        guard let bundle, let puzzle = bundle.blindRankPuzzle,
              let challenge = blindRankChallenge(from: puzzle, date: bundle.date) else {
            return BlindRankSeed.makeDailyChallenge(date: bundle?.date)
        }
        return challenge
    }

    static func blindRankChallenge(from puzzle: BlindRankPuzzleDTO, date: String) -> BlindRankChallenge? {
        guard puzzle.presentationOrder.count >= 2 else { return nil }

        let players = puzzle.presentationOrder.map { entry in
            BlindRankPlayer(
                id: entry.id,
                name: entry.name,
                club: entry.club,
                league: entry.league,
                nationality: entry.nationality,
                position: entry.position,
                statValue: entry.statValue
            )
        }

        let values = players.map(\.statValue)
        guard Set(values).count == values.count else { return nil }

        let correctRanking = players
            .sorted {
                if $0.statValue == $1.statValue { return $0.name < $1.name }
                return $0.statValue > $1.statValue
            }
            .map(\.id)

        return BlindRankChallenge(
            id: puzzle.puzzleId,
            categoryTitle: puzzle.categoryTitle,
            rankHint: puzzle.rankHint,
            valueNoun: puzzle.valueNoun,
            valuePrefix: puzzle.valuePrefix,
            presentationOrder: players,
            correctRanking: correctRanking,
            isDaily: true,
            date: date
        )
    }
}
