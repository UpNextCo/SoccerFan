import Foundation
import CoreGraphics

struct WorldCupXISlot: Identifiable, Equatable, Codable {
    let id: String
    let label: String
    let pitchPoint: CGPoint
    let expectedName: String
    let clues: [String]
    /// Context shown ABOVE the clue: the tournament year, the club the player was at THEN (+ crest),
    /// and their nation (shown as a flag emoji).
    let year: Int?
    let club: String?
    let clubBadgeUrl: String?
    let nation: String?

    init(
        id: String,
        label: String,
        pitchPoint: CGPoint,
        expectedName: String,
        clues: [String],
        year: Int? = nil,
        club: String? = nil,
        clubBadgeUrl: String? = nil,
        nation: String? = nil
    ) {
        self.id = id
        self.label = label
        self.pitchPoint = pitchPoint
        self.expectedName = expectedName
        self.clues = clues
        self.year = year
        self.club = club
        self.clubBadgeUrl = clubBadgeUrl
        self.nation = nation
    }

    var primaryClue: String { clues.first ?? "" }
}

struct WorldCupXIPuzzle: Equatable, Codable {
    let id: String
    let title: String
    let formation: String
    let slots: [WorldCupXISlot]

    static let slotCount = 11
}

enum WorldCupXIPhase: Equatable, Codable {
    case playing
    case complete
}

/// A player named for a slot, with whether it matched the clue's answer.
struct WorldCupXIFill: Equatable, Codable {
    let player: PlayerSearchResultDTO
    let isCorrect: Bool
}

struct WorldCupXISlotResult: Identifiable, Equatable, Codable {
    let slot: WorldCupXISlot
    let guessedName: String?
    let isCorrect: Bool
    var id: String { slot.id }
}

struct WorldCupXIResultSummary: Equatable, Codable {
    let puzzle: WorldCupXIPuzzle
    let correctCount: Int
    let score: Int
    let won: Bool
    let slotResults: [WorldCupXISlotResult]
}

struct WorldCupXIGameState: Equatable, Codable {
    static let progressVersion = 1
    let puzzle: WorldCupXIPuzzle
    var phase: WorldCupXIPhase
    var fills: [String: WorldCupXIFill]
    var activeSlotId: String?
    var result: WorldCupXIResultSummary?

    init(puzzle: WorldCupXIPuzzle) {
        self.puzzle = puzzle
        phase = .playing
        fills = [:]
        activeSlotId = nil
        result = nil
    }

    var correctCount: Int { fills.values.filter(\.isCorrect).count }
    var answeredCount: Int { fills.count }
    var allAnswered: Bool { fills.count >= puzzle.slots.count }
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
    static let perCorrect = 100

    static func buildResult(puzzle: WorldCupXIPuzzle, state: WorldCupXIGameState) -> WorldCupXIResultSummary {
        let slotResults = puzzle.slots.map { slot -> WorldCupXISlotResult in
            let fill = state.fills[slot.id]
            return WorldCupXISlotResult(slot: slot, guessedName: fill?.player.name, isCorrect: fill?.isCorrect ?? false)
        }
        let correct = slotResults.filter(\.isCorrect).count
        return WorldCupXIResultSummary(
            puzzle: puzzle,
            correctCount: correct,
            score: correct * perCorrect,
            won: correct >= 6,
            slotResults: slotResults
        )
    }

    static func xp(from score: Int) -> Int {
        DailyXP.xp(.worldCupXI, score: score, won: score >= 6 * perCorrect)
    }
}
