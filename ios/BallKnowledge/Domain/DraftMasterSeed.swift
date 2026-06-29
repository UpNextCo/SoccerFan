import Foundation

/// Offline / practice fallback for Battle Mode when no server puzzle is in the bundle. The real daily
/// catalog (categories, clubs, optimal score) lives on the backend (battleGenerator.ts); this is a
/// small mirror so the screen is never empty. Player search still requires the server, so offline
/// play is intentionally limited — the game is a daily online challenge.
enum BattleSeed {
    static func makeDailyChallenge(date: String? = nil) -> BattleChallenge {
        let dateKey = date ?? todayUTC()
        return challenge(id: "battle_\(dateKey)", date: dateKey)
    }

    static func makePracticeChallenge() -> BattleChallenge {
        challenge(id: "battle_practice_\(UUID().uuidString.prefix(8))", date: todayUTC())
    }

    static func shareText(challenge: BattleChallenge, result: BattleResult) -> String {
        [
            "Ball Knowledge — Battle Mode",
            challenge.category.title,
            "\(result.verdict) · \(result.percentage)% of the perfect XI",
            "\(result.yourTotal) / \(result.optimalScore) \(challenge.category.noun)",
            "",
            "Can you build a better XI?",
        ].joined(separator: "\n")
    }

    private static let standardSlots: [(id: String, position: String)] = [
        ("gk", "Goalkeeper"),
        ("lb", "Left-Back"), ("cb1", "Centre-Back"), ("cb2", "Centre-Back"), ("rb", "Right-Back"),
        ("dm", "Defensive Midfield"), ("cm", "Central Midfield"), ("am", "Attacking Midfield"),
        ("lw", "Left Winger"), ("cf", "Centre-Forward"), ("rw", "Right Winger"),
    ]

    private static let offlineClubs = [
        "Arsenal", "Chelsea", "Liverpool", "Manchester United", "Manchester City", "Tottenham",
        "Everton", "Aston Villa", "Newcastle", "West Ham", "Leicester",
    ]

    private static func challenge(id: String, date: String) -> BattleChallenge {
        BattleChallenge(
            id: id,
            date: date,
            category: BattleCategory(id: "pl_goals", title: "Premier League Goals", noun: "goals"),
            formationId: "4-3-3",
            slots: standardSlots.enumerated().map { index, s in
                BattleFormations.slot(id: s.id, position: s.position, index: index)
            },
            clubs: offlineClubs.map { BattleClub(name: $0, teamId: nil, logoUrl: nil) },
            optimalScore: 700
        )
    }

    private static func todayUTC() -> String {
        String(ISO8601DateFormatter().string(from: Date()).prefix(10))
    }
}
