import Foundation
import CoreGraphics

// MARK: - Battle Mode models
//
// Battle Mode (mode id stays `draft_master`): you are handed a scenario (a famous match-up with a
// transfer budget) and a formation. You fill position-locked slots with real players within budget,
// then a deterministic power model turns your XI vs the opponent's XI into a scoreline. The sim runs
// entirely on-device from the bundle (player prices come from search, opponent + budget from the
// puzzle), mirroring backend/src/services/battleScenarios.ts.

enum BattleBucket: String, Codable, Equatable {
    case gk = "GK"
    case def = "DEF"
    case mid = "MID"
    case att = "ATT"

    /// Map a coarse player position string to a bucket.
    static func from(position: String) -> BattleBucket {
        let p = position.lowercased().folding(options: .diacriticInsensitive, locale: .current)
        if p.contains("goal") || p == "gk" { return .gk }
        if p.contains("defend") || p.contains("back") || p == "cb" || p == "lb" || p == "rb" { return .def }
        if p.contains("midfield") || p == "cm" || p == "dm" || p == "am" { return .mid }
        if p.contains("attack") || p.contains("forward") || p.contains("wing") || p.contains("striker") { return .att }
        return .mid
    }
}

struct BattleSlot: Identifiable, Equatable {
    let id: String
    let index: Int
    let bucket: BattleBucket
    let label: String
    let point: CGPoint
}

struct BattleFormation: Equatable {
    let id: String
    let slots: [BattleSlot]

    var name: String { id }
}

struct BattleOpponentPlayer: Equatable {
    let name: String
    let bucket: BattleBucket
    let valueEur: Double
}

struct BattleScenario: Equatable {
    let id: String
    let title: String
    let subtitle: String
    let narrative: String
    let competition: String
    let budgetEur: Double
    let opponentName: String
    let opponent: [BattleOpponentPlayer]
}

struct BattleChallenge: Equatable {
    let id: String
    let date: String
    let scenario: BattleScenario
    let formation: BattleFormation
}

struct BattlePick: Identifiable, Equatable {
    let id = UUID()
    let slotId: String
    let player: PlayerSearchResultDTO
    let priceEur: Double
    let bucket: BattleBucket
}

// MARK: - Game state

enum BattlePhase: Equatable {
    case intro
    case building
    case complete
}

struct BattleGameState: Equatable {
    let challenge: BattleChallenge
    var phase: BattlePhase
    var picks: [BattlePick]
    var result: BattleResult?

    init(challenge: BattleChallenge) {
        self.challenge = challenge
        phase = .intro
        picks = []
        result = nil
    }

    var usedPlayerIds: Set<String> { Set(picks.map(\.player.id)) }

    func pick(forSlot slotId: String) -> BattlePick? {
        picks.first { $0.slotId == slotId }
    }

    var spentEur: Double { picks.reduce(0) { $0 + $1.priceEur } }
    var remainingEur: Double { challenge.scenario.budgetEur - spentEur }
    var isComplete: Bool { picks.count >= challenge.formation.slots.count }
}

// MARK: - Match model (mirror of backend battleScenarios.ts)

enum BattleSim {
    static let weights: [BattleBucket: (atk: Double, def: Double)] = [
        .gk: (0.0, 1.0),
        .def: (0.12, 0.9),
        .mid: (0.55, 0.5),
        .att: (1.0, 0.15),
    ]
    static let goalBase = 1.5
    static let goalExp = 1.6
    static let maxGoals = 7

    static func strength(_ valueEur: Double) -> Double {
        pow(max(valueEur, 0) / 1_000_000, 0.62)
    }

    struct Ratings: Equatable { let attack: Double; let defence: Double; var power: Double { attack + defence } }

    static func rate(_ players: [(bucket: BattleBucket, valueEur: Double)]) -> Ratings {
        var attack = 0.0
        var defence = 0.0
        for p in players {
            let s = strength(p.valueEur)
            let w = weights[p.bucket] ?? (0.4, 0.5)
            attack += s * w.atk
            defence += s * w.def
        }
        return Ratings(attack: attack, defence: defence)
    }

    static func expectedGoals(attack: Double, oppDefence: Double) -> Double {
        goalBase * pow(attack / max(oppDefence, 1), goalExp)
    }

    /// Deterministic 0..1 from a string seed (matches backend seedRand).
    static func seedRand(_ seed: String) -> Double {
        var h: UInt32 = 2166136261
        for byte in seed.utf8 {
            h ^= UInt32(byte)
            h = h &* 16777619
        }
        h ^= h << 13
        h ^= h >> 17
        h ^= h << 5
        return Double(h % 100000) / 100000.0
    }

    static func seededGoals(_ xg: Double, seed: String) -> Int {
        let g = Int(floor(max(xg, 0) + seedRand(seed)))
        return min(g, maxGoals)
    }
}

struct BattleGoalEvent: Identifiable, Equatable {
    let id = UUID()
    let scorer: String
    let minute: Int
    let stoppage: Int
    let forYou: Bool

    var minuteLabel: String { stoppage > 0 ? "90+\(stoppage)'" : "\(minute)'" }
    private var sortKey: Double { Double(minute) + Double(stoppage) / 10 }
    static func sortByTime(_ a: BattleGoalEvent, _ b: BattleGoalEvent) -> Bool { a.sortKey < b.sortKey }
}

enum BattleOutcome: Equatable {
    case win, draw, loss

    var verdict: String {
        switch self {
        case .win: return "VICTORY"
        case .draw: return "DRAW"
        case .loss: return "DEFEAT"
        }
    }
}

struct BattleResult: Equatable {
    let yourGoals: Int
    let theirGoals: Int
    let outcome: BattleOutcome
    let your: BattleSim.Ratings
    let opp: BattleSim.Ratings
    let events: [BattleGoalEvent]
    let score: Int
    let powerPoints: Int
    let outcomePoints: Int
    let efficiencyPoints: Int
    let budgetEur: Double
    let spentEur: Double

    var budgetLeftEur: Double { budgetEur - spentEur }
}

enum BattleScoring {
    // Value-for-money score: reward squad power + the outcome + leaving budget unspent (but only when
    // you don't lose, so you can't "win" the score by underspending into a defeat).
    static func score(your: BattleSim.Ratings, outcome: BattleOutcome, budget: Double, spent: Double)
        -> (total: Int, power: Int, outcome: Int, efficiency: Int)
    {
        let powerPoints = Int((your.power * 4).rounded())
        let outcomePoints: Int = outcome == .win ? 500 : outcome == .draw ? 200 : 0
        let leftFraction = budget > 0 ? max(0, (budget - spent) / budget) : 0
        // Value-for-money: banked budget only counts when you don't lose, so you can't farm points
        // by underspending into a defeat. With budget headroom this is a real lever vs. squad power.
        let efficiencyPoints = outcome == .loss ? 0 : Int((leftFraction * 700).rounded())
        return (powerPoints + outcomePoints + efficiencyPoints, powerPoints, outcomePoints, efficiencyPoints)
    }

    static func simulate(picks: [BattlePick], scenario: BattleScenario, seed: String) -> BattleResult {
        let yourXi = picks.map { (bucket: $0.bucket, valueEur: $0.priceEur) }
        let oppXi = scenario.opponent.map { (bucket: $0.bucket, valueEur: $0.valueEur) }
        let your = BattleSim.rate(yourXi)
        let opp = BattleSim.rate(oppXi)

        let yourGoals = BattleSim.seededGoals(BattleSim.expectedGoals(attack: your.attack, oppDefence: opp.defence), seed: "\(seed):you")
        let theirGoals = BattleSim.seededGoals(BattleSim.expectedGoals(attack: opp.attack, oppDefence: your.defence), seed: "\(seed):opp")
        let outcome: BattleOutcome = yourGoals > theirGoals ? .win : yourGoals < theirGoals ? .loss : .draw

        var events = scorers(picks.map { ($0.player.name, $0.bucket, $0.priceEur) }, goals: yourGoals, seed: "\(seed):yg", forYou: true)
        events += scorers(scenario.opponent.map { ($0.name, $0.bucket, $0.valueEur) }, goals: theirGoals, seed: "\(seed):tg", forYou: false)
        events.sort(by: BattleGoalEvent.sortByTime)

        let spent = picks.reduce(0) { $0 + $1.priceEur }
        let s = score(your: your, outcome: outcome, budget: scenario.budgetEur, spent: spent)

        return BattleResult(
            yourGoals: yourGoals, theirGoals: theirGoals, outcome: outcome,
            your: your, opp: opp, events: events,
            score: s.total, powerPoints: s.power, outcomePoints: s.outcome, efficiencyPoints: s.efficiency,
            budgetEur: scenario.budgetEur, spentEur: spent
        )
    }

    private static func scorers(_ players: [(name: String, bucket: BattleBucket, valueEur: Double)], goals: Int, seed: String, forYou: Bool) -> [BattleGoalEvent] {
        guard goals > 0, !players.isEmpty else { return [] }
        let weights = players.map { max(BattleSim.strength($0.valueEur) * ((BattleSim.weights[$0.bucket]?.atk ?? 0.4) + 0.05), 0.01) }
        let total = weights.reduce(0, +)
        var out: [BattleGoalEvent] = []
        var usedMinutes = Set<Int>()
        for i in 0..<goals {
            let r = BattleSim.seedRand("\(seed):s\(i)") * total
            var acc = 0.0
            var idx = 0
            for j in 0..<weights.count {
                acc += weights[j]
                if r <= acc { idx = j; break }
            }
            var minute = 1 + Int(BattleSim.seedRand("\(seed):m\(i)") * 90)
            while usedMinutes.contains(minute) { minute = (minute % 90) + 1 }
            usedMinutes.insert(minute)
            let isStoppage = minute >= 88 && BattleSim.seedRand("\(seed):st\(i)") > 0.6
            out.append(BattleGoalEvent(
                scorer: players[idx].name,
                minute: isStoppage ? 90 : minute,
                stoppage: isStoppage ? 1 + Int(BattleSim.seedRand("\(seed):sa\(i)") * 5) : 0,
                forYou: forYou
            ))
        }
        return out
    }
}

// MARK: - Formations

enum BattleFormations {
    static let ids = ["4-3-3", "4-4-2", "4-2-3-1", "3-5-2", "4-3-1-2"]

    static func named(_ id: String) -> BattleFormation {
        let layout = layouts[id] ?? layouts["4-3-3"]!
        let slots = layout.enumerated().map { index, s in
            BattleSlot(id: "slot-\(index)", index: index, bucket: s.bucket, label: s.label, point: s.point)
        }
        return BattleFormation(id: layouts[id] != nil ? id : "4-3-3", slots: slots)
    }

    private typealias Slot = (bucket: BattleBucket, label: String, point: CGPoint)

    // y: 0.1 = attack (top), 0.9 = own goal (bottom).
    private static let layouts: [String: [Slot]] = [
        "4-3-3": [
            (.gk, "GK", CGPoint(x: 0.50, y: 0.90)),
            (.def, "LB", CGPoint(x: 0.14, y: 0.68)), (.def, "CB", CGPoint(x: 0.37, y: 0.72)),
            (.def, "CB", CGPoint(x: 0.63, y: 0.72)), (.def, "RB", CGPoint(x: 0.86, y: 0.68)),
            (.mid, "CM", CGPoint(x: 0.26, y: 0.48)), (.mid, "CM", CGPoint(x: 0.50, y: 0.44)), (.mid, "CM", CGPoint(x: 0.74, y: 0.48)),
            (.att, "LW", CGPoint(x: 0.18, y: 0.18)), (.att, "ST", CGPoint(x: 0.50, y: 0.12)), (.att, "RW", CGPoint(x: 0.82, y: 0.18)),
        ],
        "4-4-2": [
            (.gk, "GK", CGPoint(x: 0.50, y: 0.90)),
            (.def, "LB", CGPoint(x: 0.14, y: 0.68)), (.def, "CB", CGPoint(x: 0.37, y: 0.72)),
            (.def, "CB", CGPoint(x: 0.63, y: 0.72)), (.def, "RB", CGPoint(x: 0.86, y: 0.68)),
            (.mid, "LM", CGPoint(x: 0.16, y: 0.46)), (.mid, "CM", CGPoint(x: 0.40, y: 0.48)),
            (.mid, "CM", CGPoint(x: 0.60, y: 0.48)), (.mid, "RM", CGPoint(x: 0.84, y: 0.46)),
            (.att, "ST", CGPoint(x: 0.38, y: 0.14)), (.att, "ST", CGPoint(x: 0.62, y: 0.14)),
        ],
        "4-2-3-1": [
            (.gk, "GK", CGPoint(x: 0.50, y: 0.90)),
            (.def, "LB", CGPoint(x: 0.14, y: 0.70)), (.def, "CB", CGPoint(x: 0.37, y: 0.74)),
            (.def, "CB", CGPoint(x: 0.63, y: 0.74)), (.def, "RB", CGPoint(x: 0.86, y: 0.70)),
            (.mid, "DM", CGPoint(x: 0.38, y: 0.56)), (.mid, "DM", CGPoint(x: 0.62, y: 0.56)),
            (.mid, "LAM", CGPoint(x: 0.18, y: 0.34)), (.mid, "CAM", CGPoint(x: 0.50, y: 0.32)), (.mid, "RAM", CGPoint(x: 0.82, y: 0.34)),
            (.att, "ST", CGPoint(x: 0.50, y: 0.11)),
        ],
        "3-5-2": [
            (.gk, "GK", CGPoint(x: 0.50, y: 0.90)),
            (.def, "CB", CGPoint(x: 0.28, y: 0.74)), (.def, "CB", CGPoint(x: 0.50, y: 0.76)), (.def, "CB", CGPoint(x: 0.72, y: 0.74)),
            (.mid, "LWB", CGPoint(x: 0.11, y: 0.50)), (.mid, "CM", CGPoint(x: 0.35, y: 0.50)), (.mid, "CM", CGPoint(x: 0.50, y: 0.52)),
            (.mid, "CM", CGPoint(x: 0.65, y: 0.50)), (.mid, "RWB", CGPoint(x: 0.89, y: 0.50)),
            (.att, "ST", CGPoint(x: 0.38, y: 0.14)), (.att, "ST", CGPoint(x: 0.62, y: 0.14)),
        ],
        "4-3-1-2": [
            (.gk, "GK", CGPoint(x: 0.50, y: 0.90)),
            (.def, "LB", CGPoint(x: 0.14, y: 0.68)), (.def, "CB", CGPoint(x: 0.37, y: 0.72)),
            (.def, "CB", CGPoint(x: 0.63, y: 0.72)), (.def, "RB", CGPoint(x: 0.86, y: 0.68)),
            (.mid, "CM", CGPoint(x: 0.30, y: 0.52)), (.mid, "CM", CGPoint(x: 0.50, y: 0.54)), (.mid, "CM", CGPoint(x: 0.70, y: 0.52)),
            (.mid, "AM", CGPoint(x: 0.50, y: 0.32)),
            (.att, "ST", CGPoint(x: 0.38, y: 0.13)), (.att, "ST", CGPoint(x: 0.62, y: 0.13)),
        ],
    ]
}

// MARK: - Formatting helpers

enum BattleFormat {
    /// EUR value -> short money string, e.g. 180000000 -> "€180M", 8000000 -> "€8M", 500000 -> "€0.5M".
    static func money(_ eur: Double) -> String {
        let m = eur / 1_000_000
        if m >= 100 { return "€\(Int(m.rounded()))M" }
        if m >= 10 { return "€\(Int(m.rounded()))M" }
        if m >= 1 { return String(format: "€%.0fM", m) }
        return String(format: "€%.1fM", m)
    }
}

enum BattleTiming {
    static let confettiOnWin = true
    static let resultReveal: Double = 0.4
}
