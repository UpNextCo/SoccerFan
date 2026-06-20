import Foundation

enum TargetManLeague: String, CaseIterable, Codable {
    case premierLeague = "Premier League"
    case laLiga = "La Liga"
    case bundesliga = "Bundesliga"
    case serieA = "Serie A"
    case ligue1 = "Ligue 1"
}

enum TargetManStatCategory: String, CaseIterable, Codable {
    case goals
    case assists
    case yellowCards
    case redCards
    case appearances
    case cleanSheets
    case minutesPlayed
    case saves
    case foulsCommitted
    case tacklesWon

    var label: String {
        switch self {
        case .goals: return "Goals"
        case .assists: return "Assists"
        case .yellowCards: return "Yellow Cards"
        case .redCards: return "Red Cards"
        case .appearances: return "Appearances"
        case .cleanSheets: return "Clean Sheets"
        case .minutesPlayed: return "Minutes Played"
        case .saves: return "Saves"
        case .foulsCommitted: return "Fouls Committed"
        case .tacklesWon: return "Tackles Won"
        }
    }

    var fallbackRange: ClosedRange<Int> {
        switch self {
        case .goals: return 2...180
        case .assists: return 1...120
        case .yellowCards: return 8...90
        case .redCards: return 0...12
        case .appearances: return 20...520
        case .cleanSheets: return 0...180
        case .minutesPlayed: return 900...38_000
        case .saves: return 0...900
        case .foulsCommitted: return 10...220
        case .tacklesWon: return 20...420
        }
    }
}

struct TargetManChallenge: Equatable {
    let id: String
    let league: TargetManLeague
    let category: TargetManStatCategory
    let target: Int
    let isDaily: Bool
    let date: String?

    var title: String {
        "\(league.rawValue) \(category.label)"
    }
}

enum TargetManPhase: Equatable {
    case selecting
    case revealing
    case complete
}

struct TargetManSelection: Identifiable, Equatable {
    let id: UUID
    var player: PlayerSearchResultDTO
    var statValue: Int?

    init(player: PlayerSearchResultDTO, statValue: Int? = nil) {
        self.id = UUID()
        self.player = player
        self.statValue = statValue
    }
}

struct TargetManGameState: Equatable {
    let challenge: TargetManChallenge
    var selections: [TargetManSelection]
    var phase: TargetManPhase
    var combinedTotal: Int?
    var difference: Int?
    var score: Int?
    var revealedCount: Int

    static let slotCount = 5

    init(challenge: TargetManChallenge) {
        self.challenge = challenge
        selections = []
        phase = .selecting
        combinedTotal = nil
        difference = nil
        score = nil
        revealedCount = 0
    }

    var isFull: Bool { selections.count >= Self.slotCount }
    var canLock: Bool { selections.count == Self.slotCount && phase == .selecting }
}

enum TargetManScoring {
    static func points(forDifference difference: Int) -> Int {
        let distance = abs(difference)
        switch distance {
        case 0: return 1000
        case 1...5: return 900
        case 6...10: return 800
        case 11...25: return 600
        case 26...50: return 400
        case 51...100: return 200
        default: return 50
        }
    }

    static func xp(from score: Int) -> Int {
        max(10, score / 5)
    }
}

enum TargetManTiming {
    static let revealStagger: Double = 0.22
    static let revealSummaryDelay: Double = 0.35
    static let confettiDuration: Double = 2.4
}
