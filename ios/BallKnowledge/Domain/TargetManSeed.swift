import Foundation

enum TargetManSeed {
    static func makeDailyChallenge(date: String? = nil) -> TargetManChallenge {
        let dateKey = date ?? todayUTC()
        let seed = stableHash(dateKey)
        let league = TargetManLeague.allCases[seed % TargetManLeague.allCases.count]
        let category = TargetManStatCategory.allCases[(seed / 7) % TargetManStatCategory.allCases.count]
        let target = targetNumber(for: category, seed: seed)

        return TargetManChallenge(
            id: "target_man_daily_\(dateKey)",
            leagueName: league.rawValue,
            apiLeagueId: league.apiLeagueId,
            category: category,
            target: target,
            isDaily: true,
            date: dateKey
        )
    }

    static func statValue(
        for player: PlayerSearchResultDTO,
        league: TargetManLeague,
        category: TargetManStatCategory
    ) -> Int {
        let key = normalizedName(player.name)
        if let leagueStats = playerStats[league], let stats = leagueStats[key], let value = stats[category] {
            return value
        }
        if league != .premierLeague,
           let plStats = playerStats[.premierLeague],
           let stats = plStats[key],
           let value = stats[category] {
            return scaleStat(value, from: .premierLeague, to: league, category: category)
        }
        return fallbackStat(for: player.name, category: category)
    }

    static func resolveStats(for selections: [TargetManSelection], challenge: TargetManChallenge) -> [TargetManSelection] {
        let league = TargetManLeague(rawValue: challenge.leagueName) ?? .premierLeague
        return selections.map { selection in
            var copy = selection
            copy.statValue = statValue(for: selection.player, league: league, category: challenge.category)
            return copy
        }
    }

    // MARK: - Private

    private static func todayUTC() -> String {
        String(ISO8601DateFormatter().string(from: Date()).prefix(10))
    }

    private static func stableHash(_ value: String) -> Int {
        abs(value.utf8.reduce(5381) { ($0 << 5) &+ $0 &+ Int($1) })
    }

    private static func normalizedName(_ name: String) -> String {
        name.lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .replacingOccurrences(of: "[^a-z0-9 ]", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func targetNumber(for category: TargetManStatCategory, seed: Int) -> Int {
        let range = category.fallbackRange
        let span = range.upperBound - range.lowerBound
        let raw = range.lowerBound + (seed % max(span + 1, 1))

        switch category {
        case .minutesPlayed:
            return (raw / 50) * 50
        case .appearances, .saves, .tacklesWon, .foulsCommitted:
            return (raw / 5) * 5
        default:
            return raw
        }
    }

    private static func fallbackStat(for name: String, category: TargetManStatCategory) -> Int {
        let range = category.fallbackRange
        let span = range.upperBound - range.lowerBound
        let hash = stableHash(normalizedName(name) + category.rawValue)
        return range.lowerBound + (hash % max(span + 1, 1))
    }

    private static func scaleStat(
        _ value: Int,
        from source: TargetManLeague,
        to destination: TargetManLeague,
        category: TargetManStatCategory
    ) -> Int {
        let factor = leagueScaleFactor(from: source, to: destination, category: category)
        let scaled = Int(Double(value) * factor)
        return min(max(scaled, category.fallbackRange.lowerBound), category.fallbackRange.upperBound)
    }

    private static func leagueScaleFactor(
        from source: TargetManLeague,
        to destination: TargetManLeague,
        category: TargetManStatCategory
    ) -> Double {
        guard source != destination else { return 1 }
        if category == .cleanSheets || category == .saves {
            return destination == .premierLeague ? 1.1 : 0.85
        }
        switch (source, destination) {
        case (.premierLeague, .laLiga), (.premierLeague, .serieA):
            return 0.9
        case (.premierLeague, .bundesliga):
            return 0.82
        case (.premierLeague, .ligue1):
            return 0.78
        default:
            return 0.88
        }
    }

    private static func stats(
        _ entries: [TargetManStatCategory: Int]
    ) -> [TargetManStatCategory: Int] {
        entries
    }

    private static let playerStats: [TargetManLeague: [String: [TargetManStatCategory: Int]]] = [
        .premierLeague: premierLeaguePlayerStats,
        .laLiga: laLigaPlayerStats,
        .bundesliga: bundesligaPlayerStats,
        .serieA: serieAPlayerStats,
        .ligue1: ligue1PlayerStats,
    ]

    private static let premierLeaguePlayerStats: [String: [TargetManStatCategory: Int]] = [
        "casemiro": stats([.yellowCards: 67, .goals: 8, .assists: 6, .appearances: 112, .redCards: 4, .minutesPlayed: 8_420, .foulsCommitted: 98, .tacklesWon: 186]),
        "rodri": stats([.yellowCards: 52, .goals: 18, .assists: 14, .appearances: 134, .redCards: 2, .minutesPlayed: 10_120, .foulsCommitted: 74, .tacklesWon: 164]),
        "bruno fernandes": stats([.yellowCards: 36, .goals: 78, .assists: 62, .appearances: 178, .redCards: 1, .minutesPlayed: 14_560, .foulsCommitted: 58, .tacklesWon: 142]),
        "james tarkowski": stats([.yellowCards: 48, .goals: 6, .assists: 3, .appearances: 248, .redCards: 2, .minutesPlayed: 21_800, .foulsCommitted: 112, .tacklesWon: 286]),
        "joelinton": stats([.yellowCards: 41, .goals: 24, .assists: 12, .appearances: 156, .redCards: 3, .minutesPlayed: 10_980, .foulsCommitted: 88, .tacklesWon: 198]),
        "mohamed salah": stats([.yellowCards: 12, .goals: 118, .assists: 52, .appearances: 258, .minutesPlayed: 20_420, .foulsCommitted: 34, .tacklesWon: 88]),
        "harry kane": stats([.yellowCards: 18, .goals: 213, .assists: 42, .appearances: 320, .minutesPlayed: 26_800, .foulsCommitted: 52, .tacklesWon: 96]),
        "kevin de bruyne": stats([.yellowCards: 28, .goals: 72, .assists: 112, .appearances: 278, .minutesPlayed: 21_200, .foulsCommitted: 64, .tacklesWon: 118]),
        "virgil van dijk": stats([.yellowCards: 22, .goals: 18, .assists: 6, .appearances: 198, .cleanSheets: 92, .minutesPlayed: 17_200, .foulsCommitted: 48, .tacklesWon: 164]),
        "declan rice": stats([.yellowCards: 24, .goals: 8, .assists: 10, .appearances: 178, .minutesPlayed: 14_900, .foulsCommitted: 72, .tacklesWon: 204]),
        "bukayo saka": stats([.yellowCards: 14, .goals: 58, .assists: 44, .appearances: 148, .minutesPlayed: 11_600, .foulsCommitted: 38, .tacklesWon: 92]),
        "erling haaland": stats([.yellowCards: 8, .goals: 82, .assists: 14, .appearances: 98, .minutesPlayed: 7_420, .foulsCommitted: 42, .tacklesWon: 28]),
        "son heung min": stats([.yellowCards: 16, .goals: 104, .assists: 48, .appearances: 278, .minutesPlayed: 21_400, .foulsCommitted: 46, .tacklesWon: 104]),
        "james milner": stats([.yellowCards: 92, .goals: 24, .assists: 38, .appearances: 632, .minutesPlayed: 42_800, .foulsCommitted: 148, .tacklesWon: 312]),
        "kyle walker": stats([.yellowCards: 58, .goals: 8, .assists: 28, .appearances: 312, .cleanSheets: 108, .minutesPlayed: 24_600, .foulsCommitted: 82, .tacklesWon: 176]),
        "bernardo silva": stats([.yellowCards: 34, .goals: 42, .assists: 48, .appearances: 198, .minutesPlayed: 14_800, .foulsCommitted: 56, .tacklesWon: 128]),
        "ilkay gundogan": stats([.yellowCards: 44, .goals: 34, .assists: 18, .appearances: 278, .minutesPlayed: 19_600, .foulsCommitted: 68, .tacklesWon: 142]),
        "raheem sterling": stats([.yellowCards: 22, .goals: 112, .assists: 56, .appearances: 378, .minutesPlayed: 26_400, .foulsCommitted: 44, .tacklesWon: 118]),
        "andrew robertson": stats([.yellowCards: 38, .goals: 8, .assists: 52, .appearances: 198, .cleanSheets: 84, .minutesPlayed: 16_200, .foulsCommitted: 52, .tacklesWon: 148]),
        "trent alexander arnold": stats([.yellowCards: 26, .goals: 16, .assists: 58, .appearances: 178, .cleanSheets: 72, .minutesPlayed: 14_400, .foulsCommitted: 38, .tacklesWon: 96]),
        "ederson": stats([.yellowCards: 6, .appearances: 156, .cleanSheets: 74, .saves: 412, .minutesPlayed: 13_800, .foulsCommitted: 8, .tacklesWon: 12]),
        "alisson": stats([.yellowCards: 4, .appearances: 178, .cleanSheets: 82, .saves: 468, .minutesPlayed: 15_600, .foulsCommitted: 6, .tacklesWon: 10]),
        "martin odegaard": stats([.yellowCards: 18, .goals: 28, .assists: 24, .appearances: 112, .minutesPlayed: 8_600, .foulsCommitted: 32, .tacklesWon: 84]),
        "cole palmer": stats([.yellowCards: 8, .goals: 36, .assists: 18, .appearances: 78, .minutesPlayed: 5_800, .foulsCommitted: 22, .tacklesWon: 48]),
        "alexander isak": stats([.yellowCards: 6, .goals: 42, .assists: 8, .appearances: 92, .minutesPlayed: 6_400, .foulsCommitted: 28, .tacklesWon: 36]),
        "darwin nunez": stats([.yellowCards: 22, .goals: 34, .assists: 12, .appearances: 98, .minutesPlayed: 6_200, .foulsCommitted: 54, .tacklesWon: 42]),
        "marcus rashford": stats([.yellowCards: 12, .goals: 82, .assists: 28, .appearances: 248, .minutesPlayed: 16_800, .foulsCommitted: 36, .tacklesWon: 74]),
        "jack grealish": stats([.yellowCards: 42, .goals: 18, .assists: 24, .appearances: 142, .minutesPlayed: 9_800, .foulsCommitted: 78, .tacklesWon: 92]),
        "ruben dias": stats([.yellowCards: 28, .goals: 6, .assists: 2, .appearances: 168, .cleanSheets: 78, .minutesPlayed: 14_200, .foulsCommitted: 46, .tacklesWon: 112]),
        "gabriel magalhaes": stats([.yellowCards: 32, .goals: 14, .assists: 2, .appearances: 132, .cleanSheets: 58, .minutesPlayed: 11_200, .foulsCommitted: 52, .tacklesWon: 98]),
        "william saliba": stats([.yellowCards: 18, .goals: 4, .assists: 2, .appearances: 118, .cleanSheets: 52, .minutesPlayed: 9_800, .foulsCommitted: 34, .tacklesWon: 88]),
        "christian eriksen": stats([.yellowCards: 38, .goals: 12, .assists: 18, .appearances: 156, .minutesPlayed: 9_400, .foulsCommitted: 62, .tacklesWon: 104]),
    ]

    private static let laLigaPlayerStats: [String: [TargetManStatCategory: Int]] = [
        "luka modric": stats([.yellowCards: 58, .goals: 22, .assists: 48, .appearances: 260, .minutesPlayed: 18_400, .foulsCommitted: 72, .tacklesWon: 142]),
        "karim benzema": stats([.yellowCards: 34, .goals: 198, .assists: 72, .appearances: 292, .minutesPlayed: 21_600, .foulsCommitted: 48, .tacklesWon: 68]),
        "antonio rudiger": stats([.yellowCards: 62, .goals: 12, .assists: 4, .appearances: 148, .cleanSheets: 62, .minutesPlayed: 12_400, .foulsCommitted: 88, .tacklesWon: 118]),
        "robert lewandowski": stats([.yellowCards: 28, .goals: 142, .assists: 24, .appearances: 168, .minutesPlayed: 12_800, .foulsCommitted: 42, .tacklesWon: 54]),
        "jude bellingham": stats([.yellowCards: 18, .goals: 32, .assists: 14, .appearances: 58, .minutesPlayed: 4_600, .foulsCommitted: 38, .tacklesWon: 72]),
    ]

    private static let bundesligaPlayerStats: [String: [TargetManStatCategory: Int]] = [
        "harry kane": stats([.yellowCards: 8, .goals: 58, .assists: 12, .appearances: 62, .minutesPlayed: 5_200, .foulsCommitted: 18, .tacklesWon: 28]),
        "jamal musiala": stats([.yellowCards: 6, .goals: 28, .assists: 16, .appearances: 98, .minutesPlayed: 6_800, .foulsCommitted: 24, .tacklesWon: 64]),
        "joshua kimmich": stats([.yellowCards: 48, .goals: 18, .assists: 42, .appearances: 248, .minutesPlayed: 19_200, .foulsCommitted: 68, .tacklesWon: 176]),
        "thomas muller": stats([.yellowCards: 42, .goals: 112, .assists: 128, .appearances: 380, .minutesPlayed: 24_800, .foulsCommitted: 58, .tacklesWon: 124]),
    ]

    private static let serieAPlayerStats: [String: [TargetManStatCategory: Int]] = [
        "lautaro martinez": stats([.yellowCards: 38, .goals: 92, .assists: 18, .appearances: 168, .minutesPlayed: 11_400, .foulsCommitted: 64, .tacklesWon: 72]),
        "federico chiesa": stats([.yellowCards: 22, .goals: 28, .assists: 16, .appearances: 112, .minutesPlayed: 7_200, .foulsCommitted: 34, .tacklesWon: 58]),
        "theo hernandez": stats([.yellowCards: 44, .goals: 24, .assists: 22, .appearances: 142, .minutesPlayed: 11_800, .foulsCommitted: 72, .tacklesWon: 104]),
    ]

    private static let ligue1PlayerStats: [String: [TargetManStatCategory: Int]] = [
        "kylian mbappe": stats([.yellowCards: 14, .goals: 148, .assists: 62, .appearances: 178, .minutesPlayed: 13_600, .foulsCommitted: 32, .tacklesWon: 48]),
        "marquinhos": stats([.yellowCards: 36, .goals: 12, .assists: 4, .appearances: 248, .cleanSheets: 112, .minutesPlayed: 21_200, .foulsCommitted: 54, .tacklesWon: 128]),
        "achraf hakimi": stats([.yellowCards: 28, .goals: 18, .assists: 32, .appearances: 156, .minutesPlayed: 12_400, .foulsCommitted: 46, .tacklesWon: 92]),
    ]
}
