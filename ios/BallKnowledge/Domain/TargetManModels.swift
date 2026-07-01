import Foundation

enum TargetManLeague: String, CaseIterable, Codable {
    case premierLeague = "Premier League"
    case laLiga = "La Liga"
    case bundesliga = "Bundesliga"
    case serieA = "Serie A"
    case ligue1 = "Ligue 1"

    /// API-Football league id (matches backend ingest config).
    var apiLeagueId: Int {
        switch self {
        case .premierLeague: return 39
        case .laLiga: return 140
        case .serieA: return 135
        case .bundesliga: return 78
        case .ligue1: return 61
        }
    }
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

    var offLabel: String {
        switch self {
        case .minutesPlayed: return "minutes off"
        case .goals: return "goals off"
        case .assists: return "assists off"
        case .yellowCards: return "yellow cards off"
        case .redCards: return "red cards off"
        case .appearances: return "appearances off"
        case .cleanSheets: return "clean sheets off"
        case .saves: return "saves off"
        case .foulsCommitted: return "fouls off"
        case .tacklesWon: return "tackles off"
        }
    }

    var valueNoun: String {
        switch self {
        case .minutesPlayed: return "minutes"
        case .goals: return "goals"
        case .assists: return "assists"
        case .yellowCards: return "yellow cards"
        case .redCards: return "red cards"
        case .appearances: return "appearances"
        case .cleanSheets: return "clean sheets"
        case .saves: return "saves"
        case .foulsCommitted: return "fouls"
        case .tacklesWon: return "tackles"
        }
    }

    var careerStatMetric: CareerStatMetric {
        switch self {
        case .goals: return .goals
        case .assists: return .assists
        case .appearances: return .appearances
        case .yellowCards: return .yellowCards
        case .redCards: return .redCards
        case .cleanSheets: return .cleanSheets
        case .minutesPlayed: return .minutes
        case .saves: return .saves
        case .foulsCommitted: return .foulsCommitted
        case .tacklesWon: return .tackles
        }
    }
}

struct TargetManChallenge: Equatable {
    let id: String
    let leagueName: String
    let apiLeagueId: Int
    let category: TargetManStatCategory
    let target: Int
    let isDaily: Bool
    let date: String?

    // Server-driven daily category (Peak Value, CL Goals, Penalties, Trophies, …). When present,
    // valuation and all display labels come from the server instead of the local `category` enum,
    // which now only backs offline practice. Defaulted so existing call sites are unchanged.
    var serverCategoryId: String? = nil
    var serverCategoryLabel: String? = nil
    var serverValueNoun: String? = nil
    var serverOffNoun: String? = nil
    var serverUnit: String? = nil // "eur_m" → format as €Xm

    var isServerValued: Bool { serverCategoryId != nil }
    var displayTitle: String { serverCategoryLabel ?? "\(leagueName) \(category.label)" }
    var displayCategoryLabel: String { serverCategoryLabel ?? category.label }
    var displayValueNoun: String { serverValueNoun ?? category.valueNoun }
    var displayOffLabel: String { serverOffNoun ?? category.offLabel }

    var title: String { displayTitle }

    func formatValue(_ value: Int) -> String {
        if serverUnit == "eur_m" { return "€\(value)m" }
        if serverCategoryId == nil && category == .minutesPlayed {
            return value.formatted(.number.grouping(.automatic))
        }
        return "\(value)"
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
    /// Percentage-of-target accuracy, so categories of any magnitude (a ~300
    /// assists target and a ~200,000 minutes target) score on the same fair curve.
    static func points(forDifference difference: Int, target: Int) -> Int {
        let distance = abs(difference)
        if distance == 0 { return 1000 }
        let pct = Double(distance) / Double(max(target, 1))
        switch pct {
        case ..<0.02: return 900
        case ..<0.05: return 750
        case ..<0.10: return 600
        case ..<0.15: return 450
        case ..<0.25: return 250
        default: return 50
        }
    }

    static func xp(from score: Int) -> Int {
        DailyXP.xp(.targetMan, score: score, won: score >= 400)
    }

    static func tierExplanation(forDifference difference: Int, target: Int) -> String {
        if difference == 0 { return "Exact match — bullseye!" }
        let pct = Double(abs(difference)) / Double(max(target, 1))
        switch pct {
        case ..<0.02: return "Within 2% of target — top tier"
        case ..<0.05: return "Within 5% of target"
        case ..<0.10: return "Within 10% of target"
        case ..<0.15: return "Within 15% of target"
        case ..<0.25: return "Within 25% of target"
        default: return "More than 25% away"
        }
    }

    static func differenceDescription(target: Int, total: Int, difference: Int) -> String {
        if difference == 0 {
            return "Perfect — you hit the target exactly"
        }
        let direction = difference > 0 ? "over" : "under"
        return "\(abs(difference)) \(direction) the target of \(target)"
    }
}

enum TargetManTiming {
    static let revealStagger: Double = 0.22
    static let confettiDuration: Double = 2.4
    static let resultStepDelay: Double = 0.55
}
