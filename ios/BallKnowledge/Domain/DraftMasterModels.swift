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
    case spinningPrompt(index: Int)
    case drafting
    case complete
}

struct DraftMasterGameState: Equatable {
    let challenge: DraftMasterChallenge
    var phase: DraftMasterPhase
    var currentPromptIndex: Int
    var picks: [DraftMasterPick]
    var teamScore: Int?
    var rank: Int?
    var percentile: Int?
    var xpEarned: Int?

    init(challenge: DraftMasterChallenge) {
        self.challenge = challenge
        phase = .intro
        currentPromptIndex = 0
        picks = []
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
    static let spinCountryTicks = 10
    static let spinLeagueTicks = 8
    static let spinTickFast: Double = 0.06
    static let spinTickSlow: Double = 0.11
}

enum DraftMasterRole: String, CaseIterable, Hashable {
    case gk
    case lb
    case cb
    case rb
    case cm
    case lw
    case st
    case rw

    var label: String {
        switch self {
        case .gk: return "GK"
        case .lb: return "LB"
        case .cb: return "CB"
        case .rb: return "RB"
        case .cm: return "CM"
        case .lw: return "LW"
        case .st: return "ST"
        case .rw: return "RW"
        }
    }
}

enum DraftMasterPositionMapper {
    static func role(for position: DraftMasterPosition) -> DraftMasterRole {
        switch position {
        case .gk: return .gk
        case .lb: return .lb
        case .cb1, .cb2: return .cb
        case .rb: return .rb
        case .cm1, .cm2, .cm3: return .cm
        case .lw: return .lw
        case .st: return .st
        case .rw: return .rw
        }
    }

    static func roles(for playerPosition: String) -> [DraftMasterRole] {
        let p = playerPosition.lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)

        if p.contains("goal") || p == "gk" { return [.gk] }
        if p == "lb" || p.contains("left back") || p.contains("lwb") { return [.lb] }
        if p == "rb" || p.contains("right back") || p.contains("rwb") { return [.rb] }
        if p == "cb" || p.contains("centre-back") || p.contains("center back") || p.contains("centre back") {
            return [.cb]
        }
        if p == "lw" || p.contains("left wing") || p.contains("left winger") { return [.lw] }
        if p == "rw" || p.contains("right wing") || p.contains("right winger") { return [.rw] }
        if p == "st" || p.contains("striker") || p.contains("centre forward") || p.contains("center forward") {
            return [.st]
        }
        if p == "cm" || p == "dm" || p == "cdm" || p == "am" || p == "cam"
            || p.contains("midfield") || p.contains("midfielder") {
            return [.cm]
        }
        if p.contains("defender") || p.contains("defence") || p.contains("defense") {
            return [.cb, .lb, .rb]
        }
        if p.contains("forward") || p.contains("attacker") || p.contains("winger") {
            return [.st, .lw, .rw]
        }
        if p == "lm" { return [.lw, .cm] }
        if p == "rm" { return [.rw, .cm] }

        return [.cm, .st]
    }

    static func canFit(_ player: PlayerSearchResultDTO, filled: Set<DraftMasterPosition>) -> Bool {
        resolvePosition(for: player, filled: filled) != nil
    }

    static func resolvePosition(
        for player: PlayerSearchResultDTO,
        filled: Set<DraftMasterPosition>
    ) -> DraftMasterPosition? {
        for role in roles(for: player.position) {
            if let slot = firstAvailableSlot(for: role, filled: filled) {
                return slot
            }
        }
        return nil
    }

    static func positionConflictMessage(for player: PlayerSearchResultDTO) -> String {
        let roles = roles(for: player.position).map(\.label).joined(separator: "/")
        return "\(roles) slot already filled"
    }

    private static func firstAvailableSlot(
        for role: DraftMasterRole,
        filled: Set<DraftMasterPosition>
    ) -> DraftMasterPosition? {
        switch role {
        case .gk:
            return filled.contains(.gk) ? nil : .gk
        case .lb:
            return filled.contains(.lb) ? nil : .lb
        case .rb:
            return filled.contains(.rb) ? nil : .rb
        case .cb:
            if !filled.contains(.cb1) { return .cb1 }
            if !filled.contains(.cb2) { return .cb2 }
            return nil
        case .cm:
            if !filled.contains(.cm1) { return .cm1 }
            if !filled.contains(.cm2) { return .cm2 }
            if !filled.contains(.cm3) { return .cm3 }
            return nil
        case .lw:
            return filled.contains(.lw) ? nil : .lw
        case .st:
            return filled.contains(.st) ? nil : .st
        case .rw:
            return filled.contains(.rw) ? nil : .rw
        }
    }
}
