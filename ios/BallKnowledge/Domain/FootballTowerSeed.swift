import Foundation

enum FootballTowerSeed {
    static func makeDailyTower(date: String? = nil) -> [FootballTowerQuestion] {
        let dateKey = date ?? todayUTC()
        let seed = stableHash("football_tower_\(dateKey)")
        return buildTower(seed: seed, dateKey: dateKey, count: 40)
    }

    static func makeFreePlayTower() -> [FootballTowerQuestion] {
        let seed = Int.random(in: 0...999_999)
        return buildTower(seed: seed, dateKey: "free", count: 40)
    }

    static func resultSummary(
        state: FootballTowerGameState,
        standout: String?
    ) -> FootballTowerResultSummary {
        let correct = state.correctCount
        let failedFloor = state.currentFloor
        let score = FootballTowerScoring.score(forCorrectFloors: correct)
        let board = mockDailyLeaderboard(userFloor: correct, userScore: score)
        let rank = (board.firstIndex { $0.isUser } ?? board.count - 1) + 1
        let percentile = max(1, min(99, Int(Double(rank) / 4800 * 100)))
        let xp = FootballTowerScoring.xp(from: score, mode: state.mode, percentile: percentile)

        return FootballTowerResultSummary(
            highestFloor: correct,
            failedFloor: failedFloor,
            correctCount: correct,
            bestStreak: state.streak,
            score: score,
            xpEarned: xp,
            percentile: percentile,
            rank: rank,
            dailyBoard: board,
            standoutAnswer: standout
        )
    }

    static func shareText(summary: FootballTowerResultSummary, mode: FootballTowerRunMode) -> String {
        var lines = [
            "Ball Knowledge — Football Tower",
            mode == .daily ? "Daily Tower" : "Free Play",
            "Floor reached: \(summary.failedFloor)",
            "Correct answers: \(summary.correctCount)",
            "Score: \(summary.score)",
            "Top \(summary.percentile)%",
            "Rank #\(summary.rank)",
        ]
        if let standout = summary.standoutAnswer {
            lines.append("Standout: \(standout)")
        }
        lines.append("")
        lines.append("How high can you climb?")
        return lines.joined(separator: "\n")
    }

    // MARK: - Private

    private struct Template {
        let prompt: String
        let answerType: FootballTowerAnswerType
        let rule: FootballTowerRule
        let minFloor: Int
    }

    private static let templates: [Template] = [
        // Easy
        t("Name a Premier League club.", .club, .plClub, 1),
        t("Name a current Premier League player.", .player, .plPlayer, 1),
        t("Name a player from England.", .player, .nationality("England"), 1),
        t("Name a Champions League winner.", .player, .uclWinner, 1),
        t("Name a Premier League goalkeeper.", .player, .goalkeeper, 1),
        t("Name a football nation.", .country, .country, 1),
        // Medium
        t("Name a Brazilian who has played in the Premier League.", .player, .brazilianPL, 6),
        t("Name a player with 100+ Premier League appearances.", .player, .minPlApps(100), 6),
        t("Name a player who has played for Chelsea.", .player, .playedFor("Chelsea"), 6),
        t("Name a player who has scored in the Champions League.", .player, .uclScorer, 6),
        t("Name a Spanish player who has played in La Liga.", .player, .spanishLaLiga, 6),
        t("Name a player who has played for Liverpool.", .player, .playedFor("Liverpool"), 6),
        // Hard
        t("Name a French player with 10+ Champions League goals.", .player, .frenchMinUclGoals(10), 16),
        t("Name a player with 50+ Premier League assists.", .player, .minPlAssists(50), 16),
        t("Name a goalkeeper with 100+ Premier League appearances.", .player, .gkMinPlApps(100), 16),
        t("Name a player who has played for both Arsenal and Chelsea.", .player, .playedForBoth("Arsenal", "Chelsea"), 16),
        t("Name an Italian who has played in the Premier League.", .player, .italianPL, 16),
        t("Name a player with 200+ Premier League appearances.", .player, .minPlApps(200), 16),
        // Elite
        t("Name a Dutch player with 100+ Premier League appearances.", .player, .dutchMinPlApps(100), 31),
        t("Name a player with 10+ Champions League goals for Bayern Munich.", .player, .bayernMinUclGoals(10), 31),
        t("Name a defender with 200+ Premier League appearances.", .player, .defenderMinPlApps(200), 31),
        t("Name a player who has played for both Manchester United and Chelsea.", .player, .playedForBoth("Manchester United", "Chelsea"), 31),
        t("Name a non-European player with 20+ Champions League appearances.", .player, .nonEuropeanMinUclApps(20), 31),
        t("Name a French player with 15+ Champions League goals.", .player, .frenchMinUclGoals(15), 31),
    ]

    private static func buildTower(seed: Int, dateKey: String, count: Int) -> [FootballTowerQuestion] {
        (1...count).map { floor in
            let difficulty = FootballTowerDifficulty.forFloor(floor)
            let eligible = templates.filter { $0.minFloor <= floorForTemplate(difficulty: difficulty) }
            let pool = eligible.isEmpty ? templates : eligible
            let index = abs(stableHash("\(dateKey)_\(floor)_\(seed)")) % pool.count
            let template = pool[index]
            return FootballTowerQuestion(
                id: "ftq_\(dateKey)_\(floor)",
                floor: floor,
                difficulty: difficulty,
                prompt: template.prompt,
                answerType: template.answerType,
                rule: template.rule
            )
        }
    }

    private static func floorForTemplate(difficulty: FootballTowerDifficulty) -> Int {
        switch difficulty {
        case .easy: return 1
        case .medium: return 6
        case .hard: return 16
        case .elite: return 31
        }
    }

    private static func t(
        _ prompt: String,
        _ type: FootballTowerAnswerType,
        _ rule: FootballTowerRule,
        _ minFloor: Int
    ) -> Template {
        Template(prompt: prompt, answerType: type, rule: rule, minFloor: minFloor)
    }

    private static func mockDailyLeaderboard(userFloor: Int, userScore: Int) -> [FootballTowerLeaderboardEntry] {
        var entries: [FootballTowerLeaderboardEntry] = [
            .init(id: "1", name: "Sam", floor: userFloor + 4, score: (userFloor + 4) * 100, isUser: false),
            .init(id: "2", name: "Jack", floor: userFloor + 2, score: (userFloor + 2) * 100, isUser: false),
            .init(id: "3", name: "Liam", floor: userFloor + 1, score: (userFloor + 1) * 100, isUser: false),
            .init(id: "4", name: "Noah", floor: max(1, userFloor - 1), score: max(100, (userFloor - 1) * 100), isUser: false),
            .init(id: "5", name: "Alex", floor: max(1, userFloor - 3), score: max(100, (userFloor - 3) * 100), isUser: false),
        ]
        entries.append(.init(id: "user", name: "YOU", floor: userFloor, score: userScore, isUser: true))
        return entries.sorted { $0.floor > $1.floor }
    }

    private static func todayUTC() -> String {
        String(ISO8601DateFormatter().string(from: Date()).prefix(10))
    }

    private static func stableHash(_ value: String) -> Int {
        abs(value.utf8.reduce(5381) { ($0 << 5) &+ $0 &+ Int($1) })
    }
}

struct FootballTowerSuggestion: Identifiable, Equatable {
    let id: String
    let name: String
    let subtitle: String
    let nationality: String?
    let league: String?
    let position: String?
}

enum FootballTowerSearch {
    static func search(query: String, question: FootballTowerQuestion) async -> [FootballTowerSuggestion] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else { return [] }

        switch question.answerType {
        case .club:
            return FootballTowerCatalog.searchClubs(query: trimmed).map {
                FootballTowerSuggestion(
                    id: FootballTowerValidator.answerId(for: $0, type: .club),
                    name: $0,
                    subtitle: "Premier League club",
                    nationality: nil,
                    league: "Premier League",
                    position: nil
                )
            }
        case .country:
            return FootballTowerCatalog.searchCountries(query: trimmed).map {
                FootballTowerSuggestion(
                    id: FootballTowerValidator.answerId(for: $0, type: .country),
                    name: $0,
                    subtitle: "Nation",
                    nationality: $0,
                    league: nil,
                    position: nil
                )
            }
        case .player:
            do {
                let players = try await APIClient.shared.searchPlayers(query: trimmed)
                return players.prefix(6).map { player in
                    FootballTowerSuggestion(
                        id: FootballTowerValidator.answerId(for: player.name, type: .player),
                        name: player.name,
                        subtitle: "\(player.club) · \(player.nationality)",
                        nationality: player.nationality,
                        league: player.league,
                        position: player.position
                    )
                }
            } catch {
                return FootballTowerCatalog.players
                    .filter { FootballTowerCatalog.normalized($0.name).contains(FootballTowerCatalog.normalized(trimmed)) }
                    .prefix(6)
                    .map {
                        FootballTowerSuggestion(
                            id: $0.id,
                            name: $0.name,
                            subtitle: "\($0.nationality) · \($0.clubs.first ?? "")",
                            nationality: $0.nationality,
                            league: $0.leagues.first,
                            position: $0.position
                        )
                    }
            }
        }
    }
}
