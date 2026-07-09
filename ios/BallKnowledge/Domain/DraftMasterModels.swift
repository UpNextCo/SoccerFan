import Foundation
import CoreGraphics

// MARK: - Battle Mode models
//
// Battle Mode (mode id stays `draft_master`): a daily STAT category, a pool of draggable CONSTRAINT
// CHIPS (a specific club, a whole league, a nationality, a nationality×league combo, or a
// nationality×club combo), and a fine-position formation. You drag each chip onto a slot and pick a
// player who SATISFIES that chip and plays that position; the pick scores the player's TOTAL value of
// the category. On submit your total is compared to the optimal lineup (computed server-side).
// Mirrors backend/src/services/battleGenerator.ts.

struct BattleCategory: Equatable, Codable {
    let id: String
    let title: String
    let noun: String
    var unit: String?   // "eur_m" for value/fee categories, else nil
}

enum BattleConstraintType: String, Equatable, Codable {
    case club, league, nationality, nat_league, nat_club
}

/// A draggable constraint chip. `club`/`nat_club` carry a crest; `league`/`nat_league` a league badge;
/// `nationality`/`nat_league`/`nat_club` a nationality flag.
struct BattleConstraint: Identifiable, Equatable, Codable {
    let id: String
    let type: BattleConstraintType
    let label: String
    let club: String?
    let teamId: Int?
    let logoUrl: String?
    let leagueId: Int?
    let leagueName: String?
    let nationality: String?

    /// Reason copy shown when a picked player doesn't satisfy this chip.
    func rejectReason(player: String) -> String {
        switch type {
        case .club: return "\(player) never played for \(club ?? label)"
        case .league: return "\(player) never played in \(leagueName ?? label)"
        case .nationality: return "\(player) isn't \(nationality ?? label)"
        case .nat_league, .nat_club: return "\(player) doesn't fit \(label)"
        }
    }
}

struct BattleSlot: Identifiable, Equatable, Codable {
    let id: String
    let position: String // fine position, e.g. "Centre-Back"
    let label: String    // short label, e.g. "CB"
    let point: CGPoint   // pitch coordinate (x left→right, y attack-top→defence-bottom)
}

struct BattlePlayer: Identifiable, Equatable, Codable {
    let id: String
    let name: String
    let statValue: Int
    let headshotUrl: String?
}

struct BattlePick: Equatable, Codable {
    let constraint: BattleConstraint
    let player: BattlePlayer
    /// False when the chosen player doesn't satisfy the constraint — scores 0 and shows red.
    let correct: Bool
    /// What this pick contributes to the total (0 for a wrong pick).
    var score: Int { correct ? player.statValue : 0 }
}

/// The mathematically optimal pick for a slot (best chip→slot assignment + best player), revealed
/// on the result screen.
struct BattleOptimalPick: Identifiable, Equatable, Codable {
    let slotId: String
    let position: String
    let constraintId: String
    let constraintLabel: String
    let playerName: String
    let statValue: Int
    var id: String { slotId }
}

struct BattleChallenge: Equatable, Codable {
    let id: String
    let date: String
    let category: BattleCategory
    let formationId: String
    let slots: [BattleSlot]
    let constraints: [BattleConstraint]
    var optimalScore: Int
    /// Perfect XI — stripped from the live puzzle; filled from the completion response.
    var optimalLineup: [BattleOptimalPick]
}

// MARK: - Game state

enum BattlePhase: Equatable, Codable { case intro, building, complete }

struct BattleGameState: Equatable, Codable {
    static let progressVersion = 2
    var challenge: BattleChallenge
    var phase: BattlePhase
    var assignments: [String: BattleConstraint]   // slotId -> constraint chip dragged onto it
    var picks: [String: BattlePick]               // slotId -> chosen player (implies the chip)
    var result: BattleResult?

    init(challenge: BattleChallenge) {
        self.challenge = challenge
        phase = .intro
        assignments = [:]
        picks = [:]
        result = nil
    }

    var usedConstraintIds: Set<String> { Set(assignments.values.map(\.id)) }
    var usedPlayerIds: Set<String> { Set(picks.values.map(\.player.id)) }
    func constraint(forSlot slotId: String) -> BattleConstraint? { assignments[slotId] }
    func pick(forSlot slotId: String) -> BattlePick? { picks[slotId] }
    /// Once a player is selected (right or wrong) the slot is final and its chip is burned. Merely
    /// assigning a chip (then backing out without picking) does NOT lock it.
    func isLocked(_ slotId: String) -> Bool { picks[slotId] != nil }
    var yourTotal: Int { picks.values.reduce(0) { $0 + $1.score } }
    var filledCount: Int { picks.count }
    var isComplete: Bool { picks.count >= challenge.slots.count }

    /// The user's picks, for server-side score recompute: slot → placed constraint + chosen player.
    func answerPayload() -> JSONValue {
        let picksJson: [JSONValue] = picks.map { slotId, pick in
            .object([
                "slotId": .string(slotId),
                "constraintId": .string(pick.constraint.id),
                "playerId": .string(pick.player.id),
            ])
        }
        return .object(["picks": .array(picksJson)])
    }
}

struct BattleResult: Equatable, Codable {
    let yourTotal: Int
    let optimalScore: Int

    var percentage: Int {
        guard optimalScore > 0 else { return 0 }
        return min(100, Int((Double(yourTotal) / Double(optimalScore) * 100).rounded()))
    }

    /// XP banked — share of the optimal XI out of the Draft XI max. This IS the XP.
    var xp: Int { DailyXP.draft(total: yourTotal, optimal: optimalScore) }

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
    /// y: 0.1 = attack (top) → 0.94 = own goal (bottom).
    private typealias Layout = [String: (label: String, point: CGPoint)]

    private static let layoutsGk: [String: Layout] = [
        "4-3-3": [
            "gk": ("GK", CGPoint(x: 0.50, y: 0.94)),
            "lb": ("LB", CGPoint(x: 0.12, y: 0.74)),
            "cb1": ("CB", CGPoint(x: 0.37, y: 0.78)),
            "cb2": ("CB", CGPoint(x: 0.63, y: 0.78)),
            "rb": ("RB", CGPoint(x: 0.88, y: 0.74)),
            "dm": ("DM", CGPoint(x: 0.50, y: 0.57)),
            "cm": ("CM", CGPoint(x: 0.30, y: 0.50)),
            "am": ("AM", CGPoint(x: 0.70, y: 0.50)),
            "lw": ("LW", CGPoint(x: 0.16, y: 0.24)),
            "cf": ("ST", CGPoint(x: 0.50, y: 0.17)),
            "rw": ("RW", CGPoint(x: 0.84, y: 0.24)),
        ],
        "4-4-2": [
            "gk": ("GK", CGPoint(x: 0.50, y: 0.94)),
            "lb": ("LB", CGPoint(x: 0.12, y: 0.74)),
            "cb1": ("CB", CGPoint(x: 0.37, y: 0.78)),
            "cb2": ("CB", CGPoint(x: 0.63, y: 0.78)),
            "rb": ("RB", CGPoint(x: 0.88, y: 0.74)),
            "lm": ("LM", CGPoint(x: 0.14, y: 0.50)),
            "cm1": ("CM", CGPoint(x: 0.36, y: 0.52)),
            "cm2": ("CM", CGPoint(x: 0.64, y: 0.52)),
            "rm": ("RM", CGPoint(x: 0.86, y: 0.50)),
            "st1": ("ST", CGPoint(x: 0.38, y: 0.18)),
            "st2": ("ST", CGPoint(x: 0.62, y: 0.18)),
        ],
        "4-2-3-1": [
            "gk": ("GK", CGPoint(x: 0.50, y: 0.94)),
            "lb": ("LB", CGPoint(x: 0.12, y: 0.74)),
            "cb1": ("CB", CGPoint(x: 0.37, y: 0.78)),
            "cb2": ("CB", CGPoint(x: 0.63, y: 0.78)),
            "rb": ("RB", CGPoint(x: 0.88, y: 0.74)),
            "dm1": ("DM", CGPoint(x: 0.38, y: 0.58)),
            "dm2": ("DM", CGPoint(x: 0.62, y: 0.58)),
            "lw": ("LW", CGPoint(x: 0.16, y: 0.36)),
            "am": ("AM", CGPoint(x: 0.50, y: 0.30)),
            "rw": ("RW", CGPoint(x: 0.84, y: 0.36)),
            "cf": ("ST", CGPoint(x: 0.50, y: 0.17)),
        ],
        "3-5-2": [
            "gk": ("GK", CGPoint(x: 0.50, y: 0.94)),
            "cb1": ("CB", CGPoint(x: 0.25, y: 0.78)),
            "cb2": ("CB", CGPoint(x: 0.50, y: 0.76)),
            "cb3": ("CB", CGPoint(x: 0.75, y: 0.78)),
            "lb": ("LB", CGPoint(x: 0.10, y: 0.58)),
            "rb": ("RB", CGPoint(x: 0.90, y: 0.58)),
            "dm": ("DM", CGPoint(x: 0.50, y: 0.50)),
            "cm1": ("CM", CGPoint(x: 0.32, y: 0.44)),
            "cm2": ("CM", CGPoint(x: 0.68, y: 0.44)),
            "st1": ("ST", CGPoint(x: 0.38, y: 0.18)),
            "st2": ("ST", CGPoint(x: 0.62, y: 0.18)),
        ],
    ]

    /// All-outfield variants — defenders pushed back, attackers given a touch more room.
    private static let layoutsOutfield: [String: Layout] = [
        "4-3-3": [
            "lb": ("LB", CGPoint(x: 0.12, y: 0.76)),
            "cb1": ("CB", CGPoint(x: 0.37, y: 0.80)),
            "cb2": ("CB", CGPoint(x: 0.63, y: 0.80)),
            "rb": ("RB", CGPoint(x: 0.88, y: 0.76)),
            "dm": ("DM", CGPoint(x: 0.50, y: 0.56)),
            "cm": ("CM", CGPoint(x: 0.30, y: 0.50)),
            "am": ("AM", CGPoint(x: 0.70, y: 0.50)),
            "lw": ("LW", CGPoint(x: 0.16, y: 0.28)),
            "cf": ("ST", CGPoint(x: 0.50, y: 0.21)),
            "rw": ("RW", CGPoint(x: 0.84, y: 0.28)),
        ],
        "4-4-2": [
            "lb": ("LB", CGPoint(x: 0.12, y: 0.76)),
            "cb1": ("CB", CGPoint(x: 0.37, y: 0.80)),
            "cb2": ("CB", CGPoint(x: 0.63, y: 0.80)),
            "rb": ("RB", CGPoint(x: 0.88, y: 0.76)),
            "lm": ("LM", CGPoint(x: 0.14, y: 0.52)),
            "cm1": ("CM", CGPoint(x: 0.36, y: 0.54)),
            "cm2": ("CM", CGPoint(x: 0.64, y: 0.54)),
            "rm": ("RM", CGPoint(x: 0.86, y: 0.52)),
            "st1": ("ST", CGPoint(x: 0.38, y: 0.21)),
            "st2": ("ST", CGPoint(x: 0.62, y: 0.21)),
        ],
        "4-2-3-1": [
            "lb": ("LB", CGPoint(x: 0.12, y: 0.76)),
            "cb1": ("CB", CGPoint(x: 0.37, y: 0.80)),
            "cb2": ("CB", CGPoint(x: 0.63, y: 0.80)),
            "rb": ("RB", CGPoint(x: 0.88, y: 0.76)),
            "dm1": ("DM", CGPoint(x: 0.38, y: 0.60)),
            "dm2": ("DM", CGPoint(x: 0.62, y: 0.60)),
            "lw": ("LW", CGPoint(x: 0.16, y: 0.38)),
            "am": ("AM", CGPoint(x: 0.50, y: 0.32)),
            "rw": ("RW", CGPoint(x: 0.84, y: 0.38)),
            "cf": ("ST", CGPoint(x: 0.50, y: 0.21)),
        ],
        "3-5-2": [
            "cb1": ("CB", CGPoint(x: 0.25, y: 0.80)),
            "cb2": ("CB", CGPoint(x: 0.50, y: 0.78)),
            "cb3": ("CB", CGPoint(x: 0.75, y: 0.80)),
            "lb": ("LB", CGPoint(x: 0.10, y: 0.60)),
            "rb": ("RB", CGPoint(x: 0.90, y: 0.60)),
            "dm": ("DM", CGPoint(x: 0.50, y: 0.52)),
            "cm1": ("CM", CGPoint(x: 0.32, y: 0.46)),
            "cm2": ("CM", CGPoint(x: 0.68, y: 0.46)),
            "st1": ("ST", CGPoint(x: 0.38, y: 0.21)),
            "st2": ("ST", CGPoint(x: 0.62, y: 0.21)),
        ],
    ]

    static func displayName(for formationId: String) -> String {
        formationId.hasSuffix("-of") ? String(formationId.dropLast(3)) : formationId
    }

    private static func baseId(_ formationId: String) -> String {
        formationId.hasSuffix("-of") ? String(formationId.dropLast(3)) : formationId
    }

    static func slot(id: String, position: String, index: Int, formationId: String) -> BattleSlot {
        let outfield = formationId.hasSuffix("-of")
        let base = baseId(formationId)
        let table = outfield ? layoutsOutfield[base] : layoutsGk[base]
        if let l = table?[id] {
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
        case "Left Midfield": return "LM"
        case "Right Midfield": return "RM"
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
