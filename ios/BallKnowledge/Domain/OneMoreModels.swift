import Foundation

struct OneMorePrompt: Equatable {
    let id: String
    let league: TargetManLeague
    let category: TargetManStatCategory
    let minimum: Int
    let isDaily: Bool
    let date: String?

    var title: String {
        switch category {
        case .goals:
            return "\(league.rawValue) players with \(minimum)+ goals"
        case .assists:
            return "\(league.rawValue) players with \(minimum)+ assists"
        case .appearances:
            return "\(league.rawValue) players with \(minimum)+ appearances"
        default:
            return "\(league.rawValue) players with \(minimum)+ \(category.label.lowercased())"
        }
    }

    var searchHint: String {
        "Name a \(league.rawValue) player…"
    }

    var ruleLine: String {
        "One wrong answer loses everything"
    }
}

struct OneMorePick: Identifiable, Equatable {
    let id = UUID()
    let player: PlayerSearchResultDTO
    let statValue: Int
    let pointsAfter: Int
}

enum OneMorePhase: Equatable {
    case playing
    case validating
    case busted
    case cashedOut
}

struct OneMoreGameState: Equatable {
    let prompt: OneMorePrompt
    var phase: OneMorePhase
    var streak: Int
    var bankedScore: Int
    var picks: [OneMorePick]
    var bustPick: OneMorePick?

    init(prompt: OneMorePrompt) {
        self.prompt = prompt
        phase = .playing
        streak = 0
        bankedScore = 0
        picks = []
        bustPick = nil
    }

    var isActive: Bool {
        phase == .playing || phase == .validating
    }

    var currentScore: Int {
        OneMoreScoring.score(forStreak: streak)
    }

    var nextPickPoints: Int {
        OneMoreScoring.points(forPick: streak + 1)
    }

    var usedPlayerIds: Set<String> {
        Set(picks.map(\.player.id))
    }
}

enum OneMoreValidationResult: Equatable {
    case valid(statValue: Int)
    case alreadyUsed
    case notEligible(reason: String)
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
    static let correctPulse: Double = 0.35
    static let bustFlash: Double = 0.55
    static let bustHold: Double = 1.4
    static let cashOutDelay: Double = 0.25
    static let confettiThreshold = 5
}
