import SwiftUI

enum GameModeID: String, CaseIterable, Identifiable {
    case footballBingo = "football_bingo"
    case oneMore = "one_more"
    case targetMan = "target_man"
    case guessWho = "guess_who"
    case footballGolf = "football_golf"
    case blindRank = "blind_rank"
    case draftMaster = "draft_master"
    case worldCupXI = "world_cup_xi"
    case footballTower = "football_tower"

    var title: String {
        switch self {
        case .footballBingo: return "FOOTBALL BINGO"
        case .worldCupXI: return "WORLD CUP XI"
        case .targetMan: return "TARGET MAN"
        case .guessWho: return "GUESS WHO?"
        case .footballGolf: return "FOOTBALL GOLF"
        case .blindRank: return "BLIND RANK"
        case .draftMaster: return "DRAFT MASTER"
        case .oneMore: return "ONE MORE"
        case .footballTower: return "FOOTBALL TOWER"
        }
    }

    var icon: String {
        switch self {
        case .footballBingo: return "square.grid.3x3.fill"
        case .worldCupXI: return "flag.2.crossed.fill"
        case .targetMan: return "scope"
        case .guessWho: return "person.fill.questionmark"
        case .footballGolf: return "flag.fill"
        case .blindRank: return "list.number"
        case .draftMaster: return "person.3.fill"
        case .oneMore: return "flame.fill"
        case .footballTower: return "building.2.fill"
        }
    }
}

extension GameModeID {
    var id: String { rawValue }
}

enum DailyPlayOrder {
    static let playableModes: [GameModeID] = [
        .guessWho,
        .targetMan,
        .blindRank,
        .footballBingo,
        .oneMore,
        .draftMaster,
        .worldCupXI,
        .footballGolf,
    ]

    static func completedCount(in bundle: DailyBundleDTO) -> Int {
        playableModes.filter { bundle.isCompleted($0) }.count
    }

    static func allComplete(in bundle: DailyBundleDTO) -> Bool {
        completedCount(in: bundle) >= playableModes.count
    }

    static func firstIncomplete(in bundle: DailyBundleDTO) -> GameModeID? {
        playableModes.first { !bundle.isCompleted($0) }
    }

    static func nextIncomplete(after mode: GameModeID, in bundle: DailyBundleDTO) -> GameModeID? {
        guard let index = playableModes.firstIndex(of: mode) else { return nil }
        return playableModes.dropFirst(index + 1).first { !bundle.isCompleted($0) }
    }
}

extension DailyBundleDTO {
    func isCompleted(_ mode: GameModeID) -> Bool {
        let normalized = mode.rawValue
        return completedModeIds.contains { GameModeCatalog.normalizedModeId($0) == normalized }
            || DailyCompletionService.isLocallyCompleted(mode, date: date)
    }
}

struct ShareCard: Equatable {
    let title: String
    let grid: String
    let scoreLine: String
    let streakLine: String

    var fullText: String {
        [title, grid, scoreLine, streakLine].joined(separator: "\n")
    }
}

struct GuessWhoGuessRow: Identifiable, Equatable {
    let id = UUID()
    let player: PlayerSearchResultDTO
    let feedback: [GuessFeedbackFieldDTO]
    let isCorrect: Bool
    var isHint: Bool = false
}

struct GuessWhoGameState: Equatable {
    let puzzle: GuessWhoPuzzleDTO
    var guesses: [GuessWhoGuessRow] = []
    var isComplete = false
    var won = false

    var guessesRemaining: Int {
        max(0, puzzle.maxGuesses - guesses.count)
    }

    /// Attribute fields the player has already locked in green — either from a correct guess or a prior hint.
    var knownFields: [String] {
        var fields = Set<String>()
        for row in guesses {
            for f in row.feedback where f.status == "correct" {
                fields.insert(f.field)
            }
        }
        return Array(fields)
    }

    /// Whether a hint can still help: there's an unrevealed attribute and room to use it without ending the game.
    var canHint: Bool {
        !isComplete && guessesRemaining > 1 && knownFields.count < GuessWhoField.allCases.count
    }

    var shareGrid: String {
        guesses.map { row in
            if row.isHint { return "💡" }
            if row.isCorrect { return "🟩" }
            let hasPartial = row.feedback.contains { $0.status == "partial" }
            return hasPartial ? "🟨" : "🟥"
        }.joined()
    }

    mutating func addGuess(_ player: PlayerSearchResultDTO, feedback: [GuessFeedbackFieldDTO], correct: Bool) {
        guesses.append(GuessWhoGuessRow(player: player, feedback: feedback, isCorrect: correct))
        if correct || guesses.count >= puzzle.maxGuesses {
            isComplete = true
            won = correct
        }
    }

    /// Spend a guess to reveal one attribute: that field shows green, the rest of the row stays hidden.
    mutating func addHint(field: String, value: StringOrNumber?) {
        let feedback = GuessWhoField.allCases.map { gf -> GuessFeedbackFieldDTO in
            gf.rawValue == field
                ? GuessFeedbackFieldDTO(field: gf.rawValue, value: value, status: "correct", hint: nil)
                : GuessFeedbackFieldDTO(field: gf.rawValue, value: nil, status: "hidden", hint: nil)
        }
        let hintPlayer = PlayerSearchResultDTO(id: "hint-\(UUID().uuidString)", name: "Hint", club: "", league: "", nationality: "", position: "")
        guesses.append(GuessWhoGuessRow(player: hintPlayer, feedback: feedback, isCorrect: false, isHint: true))
        if guesses.count >= puzzle.maxGuesses {
            isComplete = true
            won = false
        }
    }
}

enum FeedbackStatus {
    case correct, partial, wrong, hidden

    init(raw: String) {
        switch raw {
        case "correct": self = .correct
        case "partial": self = .partial
        case "hidden": self = .hidden
        default: self = .wrong
        }
    }

    var badgeFill: Color {
        switch self {
        case .correct: return BKTheme.guessCorrect
        case .partial: return BKTheme.guessPartial
        case .wrong: return BKTheme.guessWrong
        case .hidden: return BKTheme.cardElevated
        }
    }

    var badgeText: Color {
        switch self {
        case .correct: return BKTheme.background
        case .partial, .wrong: return BKTheme.textPrimary
        case .hidden: return BKTheme.textMuted
        }
    }
}

enum GuessWhoField: String, CaseIterable {
    case nationality
    case league
    case club
    case position
    case age
    case foot

    var label: String {
        switch self {
        case .nationality: return "NAT"
        case .league: return "LGE"
        case .club: return "TEAM"
        case .position: return "POS"
        case .age: return "AGE"
        case .foot: return "FOOT"
        }
    }
}

func fieldLabel(_ field: String) -> String {
    GuessWhoField(rawValue: field)?.label ?? field.uppercased()
}

func displayFields(from feedback: [GuessFeedbackFieldDTO]) -> [GuessFeedbackFieldDTO] {
    GuessWhoField.allCases.compactMap { gf in
        feedback.first { $0.field == gf.rawValue }
    }
}

enum GuessWhoTiming {
    static let flipStagger: Double = 0.18
    static let flipSequenceDuration: Double = flipStagger * Double(GuessWhoField.allCases.count - 1) + 0.5
    static let confettiDuration: Double = 2.4
    static let winShareDelay: Double = flipSequenceDuration + confettiDuration
}

enum PlayerSearchLimits {
    static let maxResults = 3

    static func resultLimit(for query: String) -> Int {
        maxResults
    }
}
