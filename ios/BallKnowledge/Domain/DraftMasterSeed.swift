import Foundation

enum DraftMasterSeed {
    static func makeDailyChallenge(date: String? = nil) -> DraftMasterChallenge {
        let dateKey = date ?? todayUTC()
        let seed = stableHash("draft_master_\(dateKey)")
        let category = DraftMasterCategory.allCases[seed % DraftMasterCategory.allCases.count]
        let prompts = dailyPrompts(seed: seed)

        return DraftMasterChallenge(
            id: "draft_master_\(dateKey)",
            date: dateKey,
            category: category,
            prompts: prompts,
            formation: .fourThreeThree
        )
    }

    static func makePracticeChallenge() -> DraftMasterChallenge {
        let seed = Int.random(in: 0...999_999)
        return DraftMasterChallenge(
            id: "draft_master_practice_\(UUID().uuidString.prefix(8))",
            date: todayUTC(),
            category: DraftMasterCategory.allCases[seed % DraftMasterCategory.allCases.count],
            prompts: dailyPrompts(seed: seed),
            formation: .fourThreeThree
        )
    }

    static func resultSummary(teamScore: Int, picks: [DraftMasterPick]) -> DraftMasterResultSummary {
        let dailyBoard = mockDailyLeaderboard(userScore: teamScore)
        let rank = (dailyBoard.firstIndex { $0.isUser } ?? dailyBoard.count - 1) + 1
        let percentile = mockPercentile(rank: rank, total: 4_800)
        let xp = DraftMasterScoring.xp(percentile: percentile)

        return DraftMasterResultSummary(
            teamScore: teamScore,
            rank: rank,
            percentile: percentile,
            xpEarned: xp,
            dailyBoard: dailyBoard,
            weeklyBoard: mockWeeklyLeaderboard(userWeeklyTotal: weeklyTotal(from: teamScore))
        )
    }

    static let spinDecoyNations: [String] = [
        "England", "France", "Brazil", "Argentina", "Spain", "Portugal",
        "Germany", "Belgium", "Netherlands", "Italy", "Senegal", "Uruguay",
        "Croatia", "Poland", "Mexico", "USA", "Japan", "Morocco",
    ]

    static let spinDecoyLeagues: [String] = [
        "Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1",
        "Primeira Liga", "Eredivisie", "MLS", "Saudi Pro League",
    ]

    static func shareText(
        challenge: DraftMasterChallenge,
        picks: [DraftMasterPick],
        summary: DraftMasterResultSummary
    ) -> String {
        var lines = [
            "Ball Knowledge — Daily Draft",
            "Category: \(challenge.category.title)",
            "Score: \(summary.teamScore.formatted())",
            DraftMasterScoring.percentileLabel(summary.percentile),
            "Rank #\(summary.rank)",
            "",
            "XI (\(challenge.formation.rawValue)):",
        ]

        for position in DraftMasterPosition.allCases {
            if let pick = picks.first(where: { $0.position == position }) {
                lines.append("\(position.label): \(pick.player.name) (\(pick.contribution))")
            }
        }

        lines.append("")
        lines.append("Can you beat my draft?")
        return lines.joined(separator: "\n")
    }

    // MARK: - Private

    private static let basePrompts: [DraftMasterPrompt] = [
        prompt("p1", "England", "Premier League"),
        prompt("p2", "France", "Ligue 1"),
        prompt("p3", "Brazil", "La Liga"),
        prompt("p4", "Argentina", "Serie A"),
        prompt("p5", "Spain", "La Liga"),
        prompt("p6", "Portugal", "Premier League"),
        prompt("p7", "Germany", "Bundesliga"),
        prompt("p8", "Belgium", "Bundesliga"),
        prompt("p9", "Netherlands", "Premier League"),
        prompt("p10", "Italy", "Serie A"),
        prompt("p11", "Senegal", "Ligue 1"),
    ]

    private static func dailyPrompts(seed: Int) -> [DraftMasterPrompt] {
        seededShuffle(basePrompts, seed: seed).enumerated().map { index, prompt in
            DraftMasterPrompt(
                id: "\(prompt.id)_\(index)",
                nationality: prompt.nationality,
                league: prompt.league
            )
        }
    }

    private static func mockDailyLeaderboard(userScore: Int) -> [DraftMasterLeaderboardEntry] {
        let spread = max(120, userScore / 8)
        var entries: [DraftMasterLeaderboardEntry] = [
            .init(id: "1", name: "Sam", score: userScore + spread * 2, isUser: false),
            .init(id: "2", name: "Jack", score: userScore + spread, isUser: false),
            .init(id: "3", name: "Liam", score: userScore + spread / 2, isUser: false),
            .init(id: "4", name: "Noah", score: max(0, userScore - spread / 3), isUser: false),
            .init(id: "5", name: "Alex", score: max(0, userScore - spread), isUser: false),
            .init(id: "6", name: "Max", score: max(0, userScore - spread * 2), isUser: false),
        ]
        entries.append(.init(id: "user", name: "YOU", score: userScore, isUser: true))
        return entries.sorted { $0.score > $1.score }
    }

    private static func mockWeeklyLeaderboard(userWeeklyTotal: Int) -> [DraftMasterLeaderboardEntry] {
        [
            .init(id: "w1", name: "Sam", score: userWeeklyTotal + 2_400, isUser: false),
            .init(id: "w2", name: "Jack", score: userWeeklyTotal + 1_100, isUser: false),
            .init(id: "w3", name: "Liam", score: userWeeklyTotal + 600, isUser: false),
            .init(id: "user", name: "YOU", score: userWeeklyTotal, isUser: true),
            .init(id: "w4", name: "Noah", score: max(0, userWeeklyTotal - 800), isUser: false),
            .init(id: "w5", name: "Alex", score: max(0, userWeeklyTotal - 1_500), isUser: false),
        ].sorted { $0.score > $1.score }
    }

    private static func mockPercentile(rank: Int, total: Int) -> Int {
        let raw = Double(rank) / Double(total) * 100
        return max(1, min(99, Int(raw.rounded(.up))))
    }

    private static func weeklyTotal(from todayScore: Int) -> Int {
        todayScore + 4_200 + (todayScore % 900)
    }

    private static func prompt(_ id: String, _ nationality: String, _ league: String) -> DraftMasterPrompt {
        DraftMasterPrompt(id: id, nationality: nationality, league: league)
    }

    private static func seededShuffle<T>(_ array: [T], seed: Int) -> [T] {
        var result = array
        var state = UInt64(bitPattern: Int64(seed == 0 ? 1 : seed))
        for index in stride(from: result.count - 1, through: 1, by: -1) {
            state = state &* 6364136223846793005 &+ 1
            let swapIndex = Int(state % UInt64(index + 1))
            result.swapAt(index, swapIndex)
        }
        return result
    }

    private static func todayUTC() -> String {
        String(ISO8601DateFormatter().string(from: Date()).prefix(10))
    }

    private static func stableHash(_ value: String) -> Int {
        abs(value.utf8.reduce(5381) { ($0 << 5) &+ $0 &+ Int($1) })
    }
}

enum DraftMasterMatcher {
    static func matches(_ player: PlayerSearchResultDTO, prompt: DraftMasterPrompt) -> Bool {
        nationalityMatches(player.nationality, prompt.nationality)
            && leagueMatches(player.league, prompt.league)
    }

    static func league(from prompt: DraftMasterPrompt) -> TargetManLeague? {
        TargetManLeague.allCases.first { leagueMatches(prompt.league, $0.rawValue) }
    }

    static func validationError(
        for player: PlayerSearchResultDTO,
        prompt: DraftMasterPrompt,
        usedIds: Set<String>
    ) -> String? {
        if usedIds.contains(player.id) {
            return "Player already in your XI"
        }
        if !nationalityMatches(player.nationality, prompt.nationality) {
            return "Wrong nationality for this prompt"
        }
        if !leagueMatches(player.league, prompt.league) {
            return "Wrong league for this prompt"
        }
        return nil
    }

    private static func nationalityMatches(_ playerValue: String, _ promptValue: String) -> Bool {
        normalizedCountry(playerValue) == normalizedCountry(promptValue)
    }

    private static func leagueMatches(_ playerValue: String, _ promptValue: String) -> Bool {
        let player = normalized(playerValue)
        let prompt = normalized(promptValue)
        if player == prompt { return true }
        if player.contains(prompt) || prompt.contains(player) { return true }

        switch prompt {
        case "premierleague", "premier league":
            return player.contains("premier")
        case "laliga", "la liga":
            return player.contains("la liga") || player == "laliga"
        case "seriea", "serie a":
            return player.contains("serie")
        case "bundesliga":
            return player.contains("bundes")
        case "ligue1", "ligue 1":
            return player.contains("ligue")
        default:
            return false
        }
    }

    private static func normalizedCountry(_ value: String) -> String {
        let key = normalized(value)
        return countryAliases[key] ?? key
    }

    private static func normalized(_ value: String) -> String {
        value.lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .replacingOccurrences(of: "[^a-z0-9 ]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static let countryAliases: [String: String] = [
        "england": "england",
        "france": "france",
        "brazil": "brazil",
        "argentina": "argentina",
        "spain": "spain",
        "portugal": "portugal",
        "germany": "germany",
        "belgium": "belgium",
        "netherlands": "netherlands",
        "holland": "netherlands",
        "italy": "italy",
        "senegal": "senegal",
        "usa": "united states",
        "united states": "united states",
        "south korea": "south korea",
        "korea republic": "south korea",
    ]
}
