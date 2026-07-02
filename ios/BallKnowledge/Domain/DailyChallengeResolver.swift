import Foundation
import CoreGraphics

enum DailyChallengeResolver {
    /// Map the server World Cup XI puzzle into the game model. Falls back to nil (caller uses the
    /// local seed) when there's no server puzzle.
    static func worldCupXIPuzzle(from bundle: DailyBundleDTO?) -> WorldCupXIPuzzle? {
        guard let dto = bundle?.worldCupXIPuzzle, dto.slots.count == WorldCupXIPuzzle.slotCount else { return nil }
        return WorldCupXIPuzzle(
            id: dto.puzzleId,
            title: dto.title,
            formation: dto.formation,
            slots: dto.slots.map {
                WorldCupXISlot(
                    id: $0.id,
                    label: $0.label,
                    pitchPoint: CGPoint(x: $0.x, y: $0.y),
                    expectedName: $0.expectedName,
                    clues: $0.clues,
                    year: $0.year,
                    club: $0.club,
                    clubBadgeUrl: $0.clubBadgeUrl,
                    nation: $0.nation
                )
            }
        )
    }

    /// Map the server Battle Mode challenge into the game model (nil → caller uses local seed).
    /// Goals categories ship an all-outfield XI (10 slots, no GK), appearances ship 11 — accept both.
    static func battleChallenge(from bundle: DailyBundleDTO?) -> BattleChallenge? {
        guard let dto = bundle?.draftMasterPuzzle, dto.clubs.count >= 10, dto.slots.count >= 10 else { return nil }
        return BattleChallenge(
            id: dto.puzzleId,
            date: dto.date,
            category: BattleCategory(id: dto.category.id, title: dto.category.title, noun: dto.category.noun),
            formationId: dto.formationId,
            slots: dto.slots.enumerated().map { index, s in
                BattleFormations.slot(id: s.id, position: s.position, index: index, formationId: dto.formationId)
            },
            clubs: dto.clubs.map { BattleClub(name: $0.name, teamId: $0.teamId, logoUrl: $0.logoUrl) },
            optimalScore: dto.optimalScore,
            optimalLineup: (dto.optimalLineup ?? []).map {
                BattleOptimalPick(slotId: $0.slotId, position: $0.position, club: $0.club, playerName: $0.playerName, statValue: $0.statValue)
            }
        )
    }

    /// Map the server Target Man puzzle into the game model. nil when there's no usable server
    /// puzzle — the daily is server-only (no local fallback), so the caller shows "unavailable".
    static func targetManChallenge(from bundle: DailyBundleDTO?) -> TargetManChallenge? {
        guard let bundle, let puzzle = bundle.targetManPuzzle else { return nil }
        return targetManChallenge(from: puzzle, date: bundle.date)
    }

    static func targetManChallenge(from puzzle: TargetManPuzzleDTO, date: String) -> TargetManChallenge? {
        // Server drives the category (Peak Value, CL Goals, Penalties, Trophies, …): the
        // challenge carries display labels + a categoryId the app values guesses against.
        guard !puzzle.categoryId.isEmpty, puzzle.target > 0 else { return nil }
        return TargetManChallenge(
            id: puzzle.puzzleId,
            leagueName: "",
            apiLeagueId: 0,
            category: .goals,
            target: puzzle.target,
            isDaily: true,
            date: date,
            serverCategoryId: puzzle.categoryId,
            serverCategoryLabel: puzzle.categoryLabel,
            serverValueNoun: puzzle.valueNoun,
            serverOffNoun: puzzle.offNoun,
            serverUnit: puzzle.unit
        )
    }

    /// Build the Blind Rank challenge from the daily bundle. The server embeds each player's
    /// stat value, so this is a pure, offline-safe transform. nil when there's no valid server
    /// puzzle — the daily is server-only (no local fallback), so the caller shows "unavailable".
    static func blindRankChallenge(from bundle: DailyBundleDTO?) -> BlindRankChallenge? {
        guard let bundle, let puzzle = bundle.blindRankPuzzle else { return nil }
        return blindRankChallenge(from: puzzle, date: bundle.date)
    }

    static func blindRankChallenge(from puzzle: BlindRankPuzzleDTO, date: String) -> BlindRankChallenge? {
        // The daily is always 10 slots (matches the server's BLIND_RANK_SLOT_COUNT validator) —
        // reject anything shorter (e.g. a stale cached bundle) rather than playing a cut-down game.
        guard puzzle.presentationOrder.count == 10 else { return nil }

        let players = puzzle.presentationOrder.map { entry in
            BlindRankPlayer(
                id: entry.id,
                name: entry.name,
                club: entry.club,
                clubs: entry.clubs,
                league: entry.league,
                nationality: entry.nationality,
                position: entry.position,
                statValue: entry.statValue,
                headshotUrl: entry.headshotUrl
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
            themeTitle: puzzle.themeTitle,
            categoryTitle: puzzle.categoryTitle,
            subtitle: puzzle.subtitle,
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
