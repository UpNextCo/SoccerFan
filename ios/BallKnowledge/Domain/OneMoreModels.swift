import Foundation

/// One pickable name in a round; `value` is its career total of the category in the league.
struct OneMoreOption: Identifiable, Equatable {
    let id: String
    let name: String
    let clubs: String
    let position: String
    let value: Int
}

/// A binary round: exactly two options, one of which clears the day's threshold.
struct OneMoreRound: Equatable {
    let options: [OneMoreOption]
}

struct OneMorePrompt: Equatable {
    let id: String
    let metricTitle: String   // e.g. "Premier League goals", "career penalty goals"
    let valueNoun: String     // reveal unit, e.g. "goals", "pens", "caps"
    let minimum: Int
    let rounds: [OneMoreRound]
    let isDaily: Bool
    let date: String?

    var statNoun: String { valueNoun }

    /// Full prompt line, e.g. "Players with 50+ Premier League goals".
    var title: String {
        "Players with \(minimum)+ \(metricTitle)"
    }

    /// Big card headline, e.g. "WHO HAS 50+ PREMIER LEAGUE GOALS?"
    var question: String {
        "WHO HAS \(minimum)+ \(metricTitle.uppercased())?"
    }

    var ruleLine: String {
        "One wrong pick loses everything"
    }

    /// Whether an option clears the day's threshold (exactly one per round does).
    func qualifies(_ option: OneMoreOption) -> Bool { option.value >= minimum }
}

struct OneMorePick: Identifiable, Equatable {
    let id = UUID()
    let name: String
    let statValue: Int
    let pointsAfter: Int
}

enum OneMorePhase: Equatable {
    case playing
    case revealing   // showing both stat values right after a pick
    case busted
    case cashedOut   // cashed out OR cleared every round
}

struct OneMoreGameState: Equatable {
    let prompt: OneMorePrompt
    var phase: OneMorePhase
    var streak: Int
    var bankedScore: Int
    var picks: [OneMorePick]
    var roundIndex: Int
    var chosenOptionId: String?     // the option tapped this round (for reveal highlight)
    var bustPick: OneMorePick?      // the wrong option chosen
    var bustCorrect: OneMoreOption? // the option they should have picked

    init(prompt: OneMorePrompt) {
        self.prompt = prompt
        phase = .playing
        streak = 0
        bankedScore = 0
        picks = []
        roundIndex = 0
        chosenOptionId = nil
        bustPick = nil
        bustCorrect = nil
    }

    var isActive: Bool {
        phase == .playing || phase == .revealing
    }

    var currentRound: OneMoreRound? {
        prompt.rounds.indices.contains(roundIndex) ? prompt.rounds[roundIndex] : nil
    }

    var currentScore: Int {
        OneMoreScoring.score(forStreak: streak)
    }

    var nextPickPoints: Int {
        OneMoreScoring.points(forPick: streak + 1)
    }
}

enum OneMoreScoring {
    static func points(forPick pickNumber: Int) -> Int {
        guard pickNumber > 0 else { return 0 }
        return 50 + pickNumber * 50
    }

    static func score(forStreak streak: Int) -> Int {
        guard streak > 0 else { return 0 }
        return (1...streak).reduce(0) { $0 + points(forPick: $1) }
    }

    static func xp(from score: Int, streak: Int) -> Int {
        max(10, score / 4 + streak * 2)
    }

    static func riskLabel(forStreak streak: Int) -> String {
        switch streak {
        case 0: return "First correct answer banks points"
        case 1...2: return "Heating up — cash out or push"
        case 3...5: return "Solid run — one mistake wipes it"
        case 6...8: return "High risk — big reward territory"
        default: return "All or nothing — legend status"
        }
    }
}

enum OneMoreTiming {
    static let reveal: Double = 0.9       // how long both stat values show after a pick
    static let bustHold: Double = 1.4
    static let cashOutDelay: Double = 0.25
    static let confettiThreshold = 5
}
