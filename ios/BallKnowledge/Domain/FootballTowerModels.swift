import Foundation

enum FootballTowerDifficulty: String, CaseIterable, Codable {
    case easy
    case medium
    case hard
    case elite

    var label: String {
        rawValue.uppercased()
    }

    static func forFloor(_ floor: Int) -> FootballTowerDifficulty {
        switch floor {
        case 1...5: return .easy
        case 6...15: return .medium
        case 16...30: return .hard
        default: return .elite
        }
    }
}

enum FootballTowerAnswerType: String, Codable {
    case player
    case club
    case country
}

enum FootballTowerRule: Equatable {
    case plClub
    case plPlayer
    case nationality(String)
    case uclWinner
    case goalkeeper
    case brazilianPL
    case minPlApps(Int)
    case playedFor(String)
    case uclScorer
    case spanishLaLiga
    case frenchMinUclGoals(Int)
    case minPlAssists(Int)
    case gkMinPlApps(Int)
    case playedForBoth(String, String)
    case italianPL
    case dutchMinPlApps(Int)
    case bayernMinUclGoals(Int)
    case defenderMinPlApps(Int)
    case nonEuropeanMinUclApps(Int)
    case country
}

struct FootballTowerQuestion: Identifiable, Equatable {
    let id: String
    let floor: Int
    let difficulty: FootballTowerDifficulty
    let prompt: String
    let answerType: FootballTowerAnswerType
    let rule: FootballTowerRule
}

struct FootballTowerAnswerRecord: Identifiable, Equatable {
    let id = UUID()
    let floor: Int
    let questionId: String
    let answerId: String
    let answerName: String
    let isCorrect: Bool
}

enum FootballTowerRunMode: Equatable {
    case daily
    case freePlay
}

enum FootballTowerPhase: Equatable {
    case menu
    case playing
    case correctTransition
    case failed
    case complete
}

struct FootballTowerGameState: Equatable {
    let mode: FootballTowerRunMode
    let date: String
    let questions: [FootballTowerQuestion]
    var phase: FootballTowerPhase
    var currentFloor: Int
    var streak: Int
    var answers: [FootballTowerAnswerRecord]
    var usedAnswerIds: Set<String>
    var failedAnswerName: String?
    var score: Int?
    var xpEarned: Int?

    init(mode: FootballTowerRunMode, date: String, questions: [FootballTowerQuestion]) {
        self.mode = mode
        self.date = date
        self.questions = questions
        phase = .playing
        currentFloor = 1
        streak = 0
        answers = []
        usedAnswerIds = []
        failedAnswerName = nil
        score = nil
        xpEarned = nil
    }

    var currentQuestion: FootballTowerQuestion? {
        questions.first { $0.floor == currentFloor }
    }

    var correctCount: Int {
        answers.filter(\.isCorrect).count
    }

    var highestFloorReached: Int {
        correctCount
    }
}

struct FootballTowerLeaderboardEntry: Identifiable, Equatable {
    let id: String
    let name: String
    let floor: Int
    let score: Int
    let isUser: Bool
}

struct FootballTowerResultSummary: Equatable {
    let highestFloor: Int
    let failedFloor: Int
    let correctCount: Int
    let bestStreak: Int
    let score: Int
    let xpEarned: Int
    let percentile: Int
    let rank: Int
    let dailyBoard: [FootballTowerLeaderboardEntry]
    let standoutAnswer: String?
}

enum FootballTowerScoring {
    static func score(forCorrectFloors floors: Int) -> Int {
        max(0, floors) * 100
    }

    static func xp(from score: Int, mode: FootballTowerRunMode, percentile: Int) -> Int {
        guard mode == .daily else { return 0 }
        // `score` here is floors × 100; the server scores by raw floor count (win at 5+).
        let floors = score / 100
        return DailyXP.xp(.footballTower, score: floors, won: floors >= 5)
    }
}

enum FootballTowerTiming {
    static let correctClimb: Double = 0.55
    static let failDrop: Double = 1.1
    static let confettiFloor = 15
}

enum FootballTowerDailyStore {
    private static func key(for date: String) -> String { "football_tower_daily_\(date)" }

    static func bestFloor(for date: String) -> Int? {
        let value = UserDefaults.standard.integer(forKey: key(for: date))
        return value > 0 ? value : nil
    }

    static func saveBestFloor(_ floor: Int, for date: String) {
        let current = bestFloor(for: date) ?? 0
        if floor > current {
            UserDefaults.standard.set(floor, forKey: key(for: date))
        }
    }

    static func hasPlayedToday(date: String) -> Bool {
        bestFloor(for: date) != nil
    }
}
