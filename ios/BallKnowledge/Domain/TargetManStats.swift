import Foundation

enum TargetManStats {
    static func resolveStats(
        for selections: [TargetManSelection],
        challenge: TargetManChallenge
    ) async throws -> [TargetManSelection] {
        var updated = selections

        try await withThrowingTaskGroup(of: (Int, Int).self) { group in
            for (index, selection) in selections.enumerated() {
                group.addTask {
                    let response = try await APIClient.shared.getPlayerCareerStats(
                        playerId: selection.player.id,
                        leagueId: challenge.apiLeagueId
                    )
                    let value = statValue(from: response.totals, category: challenge.category)
                    return (index, value)
                }
            }

            for try await (index, value) in group {
                updated[index].statValue = value
            }
        }

        return updated
    }

    static func statValue(
        from totals: PlayerCareerStatsTotalsDTO,
        category: TargetManStatCategory
    ) -> Int {
        switch category {
        case .goals: return totals.goals
        case .assists: return totals.assists
        case .yellowCards: return totals.yellowCards
        case .redCards: return totals.redCards
        case .appearances: return totals.appearances
        case .cleanSheets: return totals.cleanSheets
        case .minutesPlayed: return totals.minutes
        case .saves: return totals.saves
        case .foulsCommitted: return totals.foulsCommitted
        case .tacklesWon: return totals.tackles
        }
    }
}
