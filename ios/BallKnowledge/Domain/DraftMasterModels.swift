import Foundation
import CoreGraphics

enum DraftMasterCategory: String, CaseIterable, Codable {
    case goals
    case assists
    case goalsPlusAssists
    case appearances
    case appearancesMinusYellowCards

    var title: String {
        switch self {
        case .goals: return "Goals"
        case .assists: return "Assists"
        case .goalsPlusAssists: return "Goals + Assists"
        case .appearances: return "Appearances"
        case .appearancesMinusYellowCards: return "Appearances − Yellow Cards"
        }
    }

    var shortTitle: String {
        switch self {
        case .goalsPlusAssists: return "G+A"
        case .appearancesMinusYellowCards: return "Apps − YC"
        default: return title
        }
    }
}

struct DraftMasterPrompt: Identifiable, Equatable, Codable {
    let id: String
    let nationality: String
    let league: String

    var label: String {
        "\(nationality) + \(league)"
    }
}

struct DraftMasterChallenge: Equatable {
    let id: String
    let date: String
    let category: DraftMasterCategory
    let prompts: [DraftMasterPrompt]
    let formation: DraftMasterFormation

    static let promptCount = 11
}

enum DraftMasterFormation: String, Equatable {
    case fourThreeThree = "4-3-3"
}

enum DraftMasterPosition: String, CaseIterable, Identifiable, Codable {
    case gk
    case lb
    case cb1
    case cb2
    case rb
    case cm1
    case cm2
    case cm3
    case lw
    case st
    case rw

    var id: String { rawValue }

    var label: String {
        switch self {
        case .gk: return "GK"
        case .lb: return "LB"
        case .cb1, .cb2: return "CB"
        case .rb: return "RB"
        case .cm1, .cm2, .cm3: return "CM"
        case .lw: return "LW"
        case .st: return "ST"
        case .rw: return "RW"
        }
    }

    /// Normalized pitch coordinates — x left→right, y attack (top) → defence (bottom).
    var pitchPoint: CGPoint {
        switch self {
        case .gk: return CGPoint(x: 0.50, y: 0.90)
        case .lb: return CGPoint(x: 0.14, y: 0.68)
        case .cb1: return CGPoint(x: 0.36, y: 0.72)
        case .cb2: return CGPoint(x: 0.64, y: 0.72)
        case .rb: return CGPoint(x: 0.86, y: 0.68)
        case .cm1: return CGPoint(x: 0.24, y: 0.46)
        case .cm2: return CGPoint(x: 0.50, y: 0.42)
        case .cm3: return CGPoint(x: 0.76, y: 0.46)
        case .lw: return CGPoint(x: 0.16, y: 0.18)
        case .st: return CGPoint(x: 0.50, y: 0.10)
        case .rw: return CGPoint(x: 0.84, y: 0.18)
        }
    }
}

struct DraftMasterPick: Identifiable, Equatable {
    let id = UUID()
    let prompt: DraftMasterPrompt
    let player: PlayerSearchResultDTO
    let position: DraftMasterPosition
    let contribution: Int
}

enum DraftMasterPhase: Equatable {
    case intro
    case drafting
    case assigningPlayer(promptIndex: Int)
    case complete
}

struct DraftMasterGameState: Equatable {
    let challenge: DraftMasterChallenge
    var phase: DraftMasterPhase
    var currentPromptIndex: Int
    var picks: [DraftMasterPick]
    var pendingPlayer: PlayerSearchResultDTO?
    var teamScore: Int?
    var rank: Int?
    var percentile: Int?
    var xpEarned: Int?

    init(challenge: DraftMasterChallenge) {
        self.challenge = challenge
        phase = .intro
        currentPromptIndex = 0
        picks = []
        pendingPlayer = nil
        teamScore = nil
        rank = nil
        percentile = nil
        xpEarned = nil
    }

    var usedPlayerIds: Set<String> {
        Set(picks.map(\.player.id))
    }

    var filledPositions: Set<DraftMasterPosition> {
        Set(picks.map(\.position))
    }

    var availablePositions: [DraftMasterPosition] {
        DraftMasterPosition.allCases.filter { !filledPositions.contains($0) }
    }

    var currentPrompt: DraftMasterPrompt? {
        guard challenge.prompts.indices.contains(currentPromptIndex) else { return nil }
        return challenge.prompts[currentPromptIndex]
    }

    var isDraftComplete: Bool {
        picks.count >= DraftMasterChallenge.promptCount
    }

    func pick(at position: DraftMasterPosition) -> DraftMasterPick? {
        picks.first { $0.position == position }
    }
}

struct DraftMasterLeaderboardEntry: Identifiable, Equatable {
    let id: String
    let name: String
    let score: Int
    let isUser: Bool
}

struct DraftMasterResultSummary: Equatable {
    let teamScore: Int
    let rank: Int
    let percentile: Int
    let xpEarned: Int
    let dailyBoard: [DraftMasterLeaderboardEntry]
    let weeklyBoard: [DraftMasterLeaderboardEntry]
}

enum DraftMasterScoring {
    static func contribution(
        for player: PlayerSearchResultDTO,
        league: TargetManLeague,
        category: DraftMasterCategory
    ) -> Int {
        switch category {
        case .goals:
            return TargetManSeed.statValue(for: player, league: league, category: .goals)
        case .assists:
            return TargetManSeed.statValue(for: player, league: league, category: .assists)
        case .goalsPlusAssists:
            let goals = TargetManSeed.statValue(for: player, league: league, category: .goals)
            let assists = TargetManSeed.statValue(for: player, league: league, category: .assists)
            return goals + assists
        case .appearances:
            return TargetManSeed.statValue(for: player, league: league, category: .appearances)
        case .appearancesMinusYellowCards:
            let apps = TargetManSeed.statValue(for: player, league: league, category: .appearances)
            let yellows = TargetManSeed.statValue(for: player, league: league, category: .yellowCards)
            return apps - yellows
        }
    }

    static func teamScore(picks: [DraftMasterPick]) -> Int {
        picks.reduce(0) { $0 + $1.contribution }
    }

    static func xp(baseComplete: Int = 100, percentile: Int) -> Int {
        var xp = baseComplete
        if percentile <= 50 { xp += 50 }
        if percentile <= 25 { xp += 100 }
        if percentile <= 10 { xp += 250 }
        if percentile <= 1 { xp += 500 }
        return xp
    }

    static func percentileLabel(_ percentile: Int) -> String {
        "Top \(percentile)%"
    }
}

enum DraftMasterTiming {
    static let pickAdvance: Double = 0.25
    static let resultReveal: Double = 0.45
    static let confettiThreshold = 1500
}
