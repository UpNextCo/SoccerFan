import Foundation
import CoreGraphics

// MARK: - Battle Mode models
//
// Battle Mode (mode id stays `draft_master`): a daily STAT category, 11 category-relevant clubs, and
// a fine-position formation. You drag each club onto a slot and pick a player who played for that
// club at that position; the pick scores the player's TOTAL career value of the category. On submit
// your total is compared to the optimal lineup (computed server-side). Mirrors
// backend/src/services/battleGenerator.ts.

struct BattleCategory: Equatable {
    let id: String
    let title: String
    let noun: String
}

struct BattleClub: Identifiable, Equatable {
    let name: String
    let teamId: Int?
    let logoUrl: String?
    var id: String { name }
}

struct BattleSlot: Identifiable, Equatable {
    let id: String
    let position: String // fine position, e.g. "Centre-Back"
    let label: String    // short label, e.g. "CB"
    let point: CGPoint   // pitch coordinate (x left→right, y attack-top→defence-bottom)
}

struct BattlePlayer: Identifiable, Equatable {
    let id: String
    let name: String
    let statValue: Int
    let headshotUrl: String?
}

struct BattlePick: Equatable {
    let club: BattleClub
    let player: BattlePlayer
}

/// The mathematically optimal pick for a slot (best club→slot assignment + best player), revealed
/// on the result screen.
struct BattleOptimalPick: Identifiable, Equatable {
    let slotId: String
    let position: String
    let club: String
    let playerName: String
    let statValue: Int
    var id: String { slotId }
}

struct BattleChallenge: Equatable {
    let id: String
    let date: String
    let category: BattleCategory
    let formationId: String
    let slots: [BattleSlot]
    let clubs: [BattleClub]
    let optimalScore: Int
    let optimalLineup: [BattleOptimalPick]
}

// MARK: - Game state

enum BattlePhase: Equatable { case intro, building, complete }

struct BattleGameState: Equatable {
    let challenge: BattleChallenge
    var phase: BattlePhase
    var assignments: [String: BattleClub]   // slotId -> club dragged onto it
    var picks: [String: BattlePick]         // slotId -> chosen player (implies the club)
    var result: BattleResult?

    init(challenge: BattleChallenge) {
        self.challenge = challenge
        phase = .intro
        assignments = [:]
        picks = [:]
        result = nil
    }

    var usedClubNames: Set<String> { Set(assignments.values.map(\.name)) }
    var usedPlayerIds: Set<String> { Set(picks.values.map(\.player.id)) }
    func club(forSlot slotId: String) -> BattleClub? { assignments[slotId] }
    func pick(forSlot slotId: String) -> BattlePick? { picks[slotId] }
    var yourTotal: Int { picks.values.reduce(0) { $0 + $1.player.statValue } }
    var filledCount: Int { picks.count }
    var isComplete: Bool { picks.count >= challenge.slots.count }
}

struct BattleResult: Equatable {
    let yourTotal: Int
    let optimalScore: Int

    var percentage: Int {
        guard optimalScore > 0 else { return 0 }
        return min(100, Int((Double(yourTotal) / Double(optimalScore) * 100).rounded()))
    }

    var verdict: String {
        switch percentage {
        case 95...: return "PERFECT XI"
        case 85..<95: return "WORLD CLASS"
        case 70..<85: return "GREAT XI"
        case 50..<70: return "SOLID"
        default: return "KEEP DIGGING"
        }
    }
}

// MARK: - Formation layout

enum BattleFormations {
    /// 4-3-3 with a keeper (appearances categories). y: 0.1 = attack (top) → 0.93 = own goal (bottom).
    private static let withGk: [String: (label: String, point: CGPoint)] = [
        "gk": ("GK", CGPoint(x: 0.50, y: 0.93)),
        "lb": ("LB", CGPoint(x: 0.12, y: 0.76)),
        "cb1": ("CB", CGPoint(x: 0.37, y: 0.80)),
        "cb2": ("CB", CGPoint(x: 0.63, y: 0.80)),
        "rb": ("RB", CGPoint(x: 0.88, y: 0.76)),
        "dm": ("DM", CGPoint(x: 0.50, y: 0.62)),
        "cm": ("CM", CGPoint(x: 0.30, y: 0.50)),
        "am": ("AM", CGPoint(x: 0.70, y: 0.50)),
        "lw": ("LW", CGPoint(x: 0.16, y: 0.20)),
        "cf": ("ST", CGPoint(x: 0.50, y: 0.13)),
        "rw": ("RW", CGPoint(x: 0.84, y: 0.20)),
    ]

    /// All-outfield 4-3-3 (goals categories, no keeper) — uses the full pitch: defenders pushed back,
    /// the two central mids on the halfway line, the DM just behind the centre circle.
    private static let outfield: [String: (label: String, point: CGPoint)] = [
        "lb": ("LB", CGPoint(x: 0.12, y: 0.78)),
        "cb1": ("CB", CGPoint(x: 0.37, y: 0.82)),
        "cb2": ("CB", CGPoint(x: 0.63, y: 0.82)),
        "rb": ("RB", CGPoint(x: 0.88, y: 0.78)),
        "dm": ("DM", CGPoint(x: 0.50, y: 0.61)),
        "cm": ("CM", CGPoint(x: 0.30, y: 0.50)),
        "am": ("AM", CGPoint(x: 0.70, y: 0.50)),
        "lw": ("LW", CGPoint(x: 0.16, y: 0.24)),
        "cf": ("ST", CGPoint(x: 0.50, y: 0.17)),
        "rw": ("RW", CGPoint(x: 0.84, y: 0.24)),
    ]

    static func slot(id: String, position: String, index: Int, formationId: String) -> BattleSlot {
        let table = formationId == "4-3-3-of" ? outfield : withGk
        if let l = table[id] {
            return BattleSlot(id: id, position: position, label: l.label, point: l.point)
        }
        // Fallback: spread unknown ids in a grid, label from position.
        let col = CGFloat(index % 4), row = CGFloat(index / 4)
        return BattleSlot(id: id, position: position, label: shortLabel(position),
                          point: CGPoint(x: 0.2 + col * 0.2, y: 0.2 + row * 0.2))
    }

    static func shortLabel(_ position: String) -> String {
        switch position {
        case "Goalkeeper": return "GK"
        case "Left-Back": return "LB"
        case "Right-Back": return "RB"
        case "Centre-Back": return "CB"
        case "Defensive Midfield": return "DM"
        case "Central Midfield": return "CM"
        case "Attacking Midfield": return "AM"
        case "Left Winger": return "LW"
        case "Right Winger": return "RW"
        case "Centre-Forward": return "ST"
        default: return String(position.prefix(2)).uppercased()
        }
    }
}

enum BattleTiming {
    static let confettiThreshold = 85 // percentage
    static let resultReveal: Double = 0.4
}
