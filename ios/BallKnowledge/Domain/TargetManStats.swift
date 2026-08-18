import Foundation

enum TargetManStats {
    static func resolveStats(
        for selections: [TargetManSelection],
        challenge: TargetManChallenge
    ) async throws -> [TargetManSelection] {
        // Server-driven daily categories are valued in one batch call keyed by categoryId.
        if let categoryId = challenge.serverCategoryId {
            let values = try await APIClient.shared.targetManValues(
                categoryId: categoryId,
                playerIds: selections.map(\.player.id),
                pool: challenge.pool
            )
            return selections.map { selection in
                var copy = selection
                let resolved = values[selection.player.id]
                copy.statValue = resolved?.value ?? 0
                if let pool = challenge.pool, resolved?.inPool == false {
                    copy.poolMissReason = pool.rejectReason(playerName: selection.player.name)
                    copy.statValue = 0
                }
                return copy
            }
        }

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
