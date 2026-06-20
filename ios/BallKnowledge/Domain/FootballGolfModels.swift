import Foundation

enum FootballGolfAnswerType: String, Codable {
    case player
    case team
    case country
    case manager
    case stadium
}

enum FootballGolfHoleOutcome: String, Codable, Equatable {
    case birdie
    case par
    case bogey

    var score: Int {
        switch self {
        case .birdie: return -1
        case .par: return 0
        case .bogey: return 1
        }
    }

    var label: String {
        switch self {
        case .birdie: return "BIRDIE"
        case .par: return "PAR"
        case .bogey: return "BOGEY"
        }
    }
}

struct FootballGolfHole: Identifiable, Equatable {
    let id: String
    let holeNumber: Int
    let par: Int
    let question: String
    let answerType: FootballGolfAnswerType
    let correctAnswers: [String]
    let aliases: [String: [String]]
}

struct FootballGolfCourse: Identifiable, Equatable {
    let id: String
    let title: String
    let theme: String
    let weekId: String
    let holes: [FootballGolfHole]

    var totalPar: Int { holes.map(\.par).reduce(0, +) }
}

struct FootballGolfHoleResult: Identifiable, Equatable {
    let id: String
    let holeId: String
    let holeNumber: Int
    let par: Int
    let submittedAnswers: [String]
    let matchedAnswers: [String]
    let correctCount: Int
    let outcome: FootballGolfHoleOutcome

    var score: Int { outcome.score }
}

enum FootballGolfPhase: Equatable {
    case playing
    case holeResult
    case finished
}

struct FootballGolfGameState: Equatable {
    let course: FootballGolfCourse
    var currentHoleIndex: Int
    var draftAnswers: [String]
    var holeResults: [FootballGolfHoleResult]
    var lastHoleResult: FootballGolfHoleResult?
    var phase: FootballGolfPhase

    init(course: FootballGolfCourse) {
        self.course = course
        currentHoleIndex = 0
        draftAnswers = Array(repeating: "", count: course.holes.first?.par ?? 3)
        holeResults = []
        lastHoleResult = nil
        phase = .playing
    }

    var currentHole: FootballGolfHole? {
        guard course.holes.indices.contains(currentHoleIndex) else { return nil }
        return course.holes[currentHoleIndex]
    }

    var totalScore: Int {
        holeResults.map(\.score).reduce(0, +)
    }

    var holesRemaining: Int {
        max(0, course.holes.count - holeResults.count)
    }

    var isRoundComplete: Bool {
        holeResults.count >= course.holes.count
    }
}

enum FootballGolfScoring {
    static func outcome(correctCount: Int, par: Int) -> FootballGolfHoleOutcome {
        if correctCount >= par {
            return .birdie
        }
        if correctCount == par - 1 {
            return .par
        }
        return .bogey
    }

    static func scoreLabel(_ total: Int) -> String {
        if total == 0 { return "E" }
        if total > 0 { return "+\(total)" }
        return "\(total)"
    }

    static func relativeToParLabel(total: Int, par: Int) -> String {
        let relative = total
        if relative == 0 { return "Level par" }
        if relative < 0 { return "\(abs(relative)) under par" }
        return "\(relative) over par"
    }

    static func xp(from totalScore: Int, par: Int) -> Int {
        let relative = totalScore
        if relative <= -4 { return 120 }
        if relative <= -2 { return 90 }
        if relative <= 0 { return 70 }
        if relative <= 2 { return 45 }
        return 25
    }
}

struct FootballGolfLeaderboardEntry: Identifiable, Equatable {
    let id: String
    let name: String
    let score: Int
    let isUser: Bool
}

enum FootballGolfTiming {
    static let holeResultDelay: Double = 1.6
    static let holeResultAutoAdvance: Double = 2.2
}
