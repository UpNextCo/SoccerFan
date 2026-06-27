import Foundation

/// Offline / practice fallback for Battle Mode when no server puzzle is in the bundle. The real
/// daily catalog lives on the backend (battleScenarios.ts); this is a small mirror so the game is
/// playable offline and in practice mode.
enum BattleSeed {
    static func makeDailyChallenge(date: String? = nil) -> BattleChallenge {
        let dateKey = date ?? todayUTC()
        let seed = stableHash("battle_\(dateKey)")
        let scenario = scenarios[seed % scenarios.count]
        let formationId = BattleFormations.ids[(seed / 7) % BattleFormations.ids.count]
        return BattleChallenge(id: "battle_\(dateKey)", date: dateKey, scenario: scenario, formation: BattleFormations.named(formationId))
    }

    static func makePracticeChallenge() -> BattleChallenge {
        let seed = Int.random(in: 0...999_999)
        return BattleChallenge(
            id: "battle_practice_\(UUID().uuidString.prefix(8))",
            date: todayUTC(),
            scenario: scenarios[seed % scenarios.count],
            formation: BattleFormations.named(BattleFormations.ids[seed % BattleFormations.ids.count])
        )
    }

    /// Mock rank + percentile from a score, for the local leaderboard flavour.
    static func rankPercentile(score: Int) -> (rank: Int, percentile: Int) {
        let total = 4_800
        // Higher score -> better (lower) percentile. ~1000 is a strong day.
        let frac = max(0.01, min(0.99, 1.0 - Double(score) / 1400.0))
        let percentile = max(1, min(99, Int((frac * 100).rounded())))
        let rank = max(1, Int(Double(total) * frac / 100))
        return (rank, percentile)
    }

    static func xp(outcome: BattleOutcome, percentile: Int) -> Int {
        var xp = 100
        if outcome == .win { xp += 120 } else if outcome == .draw { xp += 50 }
        if percentile <= 50 { xp += 50 }
        if percentile <= 25 { xp += 100 }
        if percentile <= 10 { xp += 200 }
        return xp
    }

    static func shareText(challenge: BattleChallenge, result: BattleResult) -> String {
        var lines = [
            "Ball Knowledge — Battle Mode",
            challenge.scenario.subtitle,
            "\(result.outcome.verdict) \(result.yourGoals)-\(result.theirGoals)",
            "Score: \(result.score.formatted())",
            "Spent \(BattleFormat.money(result.spentEur)) / \(BattleFormat.money(result.budgetEur))",
        ]
        let goals = result.events.filter(\.forYou)
        if !goals.isEmpty {
            lines.append("")
            lines.append(goals.map { "\($0.scorer) \($0.minuteLabel)" }.joined(separator: ", "))
        }
        lines.append("")
        lines.append("Can you beat the scenario?")
        return lines.joined(separator: "\n")
    }

    // MARK: - Offline scenarios

    private static func opp(_ name: String, _ bucket: BattleBucket, _ valueM: Double) -> BattleOpponentPlayer {
        BattleOpponentPlayer(name: name, bucket: bucket, valueEur: valueM * 1_000_000)
    }

    private static let scenarios: [BattleScenario] = [
        BattleScenario(
            id: "ucl-barca-2011",
            title: "Champions League Final",
            subtitle: "Beat prime Barcelona",
            narrative: "Wembley, 2011. Guardiola's Barcelona are at their tiki-taka peak. Build an XI and stop them.",
            competition: "UEFA Champions League",
            budgetEur: 840_000_000,
            opponentName: "Barcelona (2011)",
            opponent: [
                opp("Víctor Valdés", .gk, 22), opp("Dani Alves", .def, 45), opp("Gerard Piqué", .def, 55),
                opp("Carles Puyol", .def, 30), opp("Eric Abidal", .def, 25), opp("Sergio Busquets", .mid, 70),
                opp("Xavi", .mid, 70), opp("Andrés Iniesta", .mid, 90), opp("Pedro", .att, 45),
                opp("Lionel Messi", .att, 200), opp("David Villa", .att, 50),
            ]
        ),
        BattleScenario(
            id: "top4-villa",
            title: "Top-Four Race",
            subtitle: "Beat Aston Villa to clinch 4th",
            narrative: "Champions League football is on the line. Out-gun a stubborn, well-drilled Villa.",
            competition: "Premier League",
            budgetEur: 680_000_000,
            opponentName: "Aston Villa",
            opponent: [
                opp("Emiliano Martínez", .gk, 35), opp("Matty Cash", .def, 22), opp("Ezri Konsa", .def, 35),
                opp("Pau Torres", .def, 40), opp("Lucas Digne", .def, 18), opp("Boubacar Kamara", .mid, 45),
                opp("Douglas Luiz", .mid, 50), opp("John McGinn", .mid, 35), opp("Leon Bailey", .att, 40),
                opp("Ollie Watkins", .att, 60), opp("Moussa Diaby", .att, 50),
            ]
        ),
        BattleScenario(
            id: "survive-luton-forest",
            title: "Relegation Battle",
            subtitle: "Beat the drop on a shoestring",
            narrative: "You have the smallest budget in the league. Find value, dig in, and stay up.",
            competition: "Premier League",
            budgetEur: 350_000_000,
            opponentName: "Nottingham Forest",
            opponent: [
                opp("Matz Sels", .gk, 8), opp("Neco Williams", .def, 15), opp("Murillo", .def, 30),
                opp("Nikola Milenković", .def, 18), opp("Ola Aina", .def, 10), opp("Ryan Yates", .mid, 10),
                opp("Nicolás Domínguez", .mid, 14), opp("Morgan Gibbs-White", .mid, 40), opp("Anthony Elanga", .att, 30),
                opp("Chris Wood", .att, 10), opp("Callum Hudson-Odoi", .att, 18),
            ]
        ),
        BattleScenario(
            id: "clasico-real",
            title: "El Clásico",
            subtitle: "Win at the Bernabéu",
            narrative: "The biggest club game on earth. Silence the home crowd and take the spoils.",
            competition: "La Liga",
            budgetEur: 1_210_000_000,
            opponentName: "Real Madrid",
            opponent: [
                opp("Thibaut Courtois", .gk, 45), opp("Dani Carvajal", .def, 20), opp("Éder Militão", .def, 55),
                opp("Antonio Rüdiger", .def, 30), opp("Ferland Mendy", .def, 25), opp("Aurélien Tchouaméni", .mid, 80),
                opp("Federico Valverde", .mid, 100), opp("Jude Bellingham", .mid, 180), opp("Rodrygo", .att, 100),
                opp("Vinícius Júnior", .att, 200), opp("Kylian Mbappé", .att, 180),
            ]
        ),
    ]

    private static func todayUTC() -> String {
        String(ISO8601DateFormatter().string(from: Date()).prefix(10))
    }

    private static func stableHash(_ value: String) -> Int {
        abs(value.utf8.reduce(5381) { ($0 << 5) &+ $0 &+ Int($1) })
    }
}
