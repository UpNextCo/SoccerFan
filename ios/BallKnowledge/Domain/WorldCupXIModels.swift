import Foundation
import CoreGraphics

enum WorldCupXISpecialReveal: String, CaseIterable, Identifiable {
    case captain
    case manager
    case host
    case topScorer

    var id: String { rawValue }

    var title: String {
        switch self {
        case .captain: return "Captain"
        case .manager: return "Manager"
        case .host: return "Host nation"
        case .topScorer: return "Top scorer"
        }
    }

    var costLabel: String { "−60 pts" }
}

struct WorldCupXISlot: Identifiable, Equatable {
    let id: String
    let label: String
    let pitchPoint: CGPoint
    let expectedName: String
    let clues: [String]

    var primaryClue: String { clues.first ?? "" }
}

struct WorldCupXIPuzzle: Equatable {
    let id: String
    let country: String
    let year: Int
    let formation: String
    let manager: String
    let captain: String
    let hostNation: String
    let topScorerClue: String
    let slots: [WorldCupXISlot]

    static let slotCount = 11

    func specialClue(for reveal: WorldCupXISpecialReveal) -> String {
        switch reveal {
        case .captain: return "Captain: \(captain)"
        case .manager: return "Manager: \(manager)"
        case .host: return "Host nation: \(hostNation)"
        case .topScorer: return topScorerClue
        }
    }
}

enum WorldCupXIPhase: Equatable {
    case playing
    case complete
}

struct WorldCupXIFill: Equatable {
    let player: PlayerSearchResultDTO
}

struct WorldCupXIResultSummary: Equatable {
    let puzzle: WorldCupXIPuzzle
    let guessedYear: Int
    let won: Bool
    let score: Int
    let slotResults: [WorldCupXISlotResult]
    let revealsUsed: Int
}

struct WorldCupXISlotResult: Identifiable, Equatable {
    let slot: WorldCupXISlot
    let guessedName: String?
    let isCorrect: Bool
    var id: String { slot.id }
}

struct WorldCupXIGameState: Equatable {
    let puzzle: WorldCupXIPuzzle
    var phase: WorldCupXIPhase
    var fills: [String: WorldCupXIFill]
    var revealedSlotIds: Set<String>
    var revealedSpecials: Set<WorldCupXISpecialReveal>
    var activeSlotId: String?
    var guessedYear: Int?
    var result: WorldCupXIResultSummary?

    init(puzzle: WorldCupXIPuzzle) {
        self.puzzle = puzzle
        phase = .playing
        fills = [:]
        revealedSlotIds = []
        revealedSpecials = []
        activeSlotId = nil
        guessedYear = nil
        result = nil
    }

    var revealCount: Int {
        revealedSlotIds.count + revealedSpecials.count
    }
}

enum WorldCupXIMatcher {
    static func matches(_ player: PlayerSearchResultDTO, expected: String) -> Bool {
        namesMatch(player.name, expected)
    }

    static func namesMatch(_ guess: String, _ expected: String) -> Bool {
        let g = normalize(guess)
        let e = normalize(expected)
        if g == e { return true }
        if g.contains(e) || e.contains(g) { return true }

        let gLast = lastToken(guess)
        let eLast = lastToken(expected)
        if !gLast.isEmpty, gLast == eLast {
            let gFirst = firstToken(guess)
            let eFirst = firstToken(expected)
            if gFirst.isEmpty || eFirst.isEmpty || gFirst.prefix(1) == eFirst.prefix(1) {
                return true
            }
        }
        return false
    }

    private static func normalize(_ value: String) -> String {
        value
            .folding(options: .diacriticInsensitive, locale: .current)
            .lowercased()
            .replacingOccurrences(of: ".", with: "")
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespaces)
    }

    private static func lastToken(_ name: String) -> String {
        normalize(name.split(separator: " ").last.map(String.init) ?? name)
    }

    private static func firstToken(_ name: String) -> String {
        normalize(name.split(separator: " ").first.map(String.init) ?? name)
    }
}

enum WorldCupXIScoring {
    static let baseScore = 1000
    static let slotRevealCost = 45
    static let specialRevealCost = 60
    static let wrongPlayerPenalty = 25
    static let correctPlayerBonus = 12

    static func buildResult(puzzle: WorldCupXIPuzzle, state: WorldCupXIGameState, guessedYear: Int) -> WorldCupXIResultSummary {
        let won = guessedYear == puzzle.year
        var score = won ? baseScore : 0

        if won {
            score -= state.revealedSlotIds.count * slotRevealCost
            score -= state.revealedSpecials.count * specialRevealCost
        }

        let slotResults = puzzle.slots.map { slot -> WorldCupXISlotResult in
            let guess = state.fills[slot.id]?.player.name
            let isCorrect = guess.map { WorldCupXIMatcher.namesMatch($0, slot.expectedName) } ?? false
            if won, let guess, !isCorrect {
                score -= wrongPlayerPenalty
            }
            if won, isCorrect {
                score += correctPlayerBonus
            }
            return WorldCupXISlotResult(slot: slot, guessedName: guess, isCorrect: isCorrect)
        }

        return WorldCupXIResultSummary(
            puzzle: puzzle,
            guessedYear: guessedYear,
            won: won,
            score: max(0, score),
            slotResults: slotResults,
            revealsUsed: state.revealCount
        )
    }
}
