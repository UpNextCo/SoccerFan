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
        case .draftMaster: return "BATTLE MODE"
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
        Array(knownGreenValues.keys)
    }

    /// The correct value for every field already locked in green, so hints can re-show them.
    var knownGreenValues: [String: StringOrNumber] {
        var map: [String: StringOrNumber] = [:]
        for row in guesses {
            for f in row.feedback where f.status == "correct" {
                if let v = f.value { map[f.field] = v }
            }
        }
        return map
    }

    /// Real guesses made (hint rows don't count toward the "after guess 5" gate).
    var actualGuessCount: Int {
        guesses.filter { !$0.isHint }.count
    }

    /// Hints unlock after 5 guesses and only reveal club → nationality. Once both are known there's
    /// nothing useful left, so the button hides.
    var canHint: Bool {
        guard !isComplete, actualGuessCount >= 5, guessesRemaining > 1 else { return false }
        let knownSet = Set(knownFields)
        return !(knownSet.contains("club") && knownSet.contains("nationality"))
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

    /// Spend a guess to reveal one attribute: the newly revealed field plus everything already
    /// locked in green show green, only the still-unknown fields stay hidden.
    mutating func addHint(field: String, value: StringOrNumber?) {
        let known = knownGreenValues
        let feedback = GuessWhoField.allCases.map { gf -> GuessFeedbackFieldDTO in
            if gf.rawValue == field {
                return GuessFeedbackFieldDTO(field: gf.rawValue, value: value, status: "correct", hint: nil)
            } else if let knownValue = known[gf.rawValue] {
                return GuessFeedbackFieldDTO(field: gf.rawValue, value: knownValue, status: "correct", hint: nil)
            } else {
                return GuessFeedbackFieldDTO(field: gf.rawValue, value: nil, status: "hidden", hint: nil)
            }
        }
        // Carry the league (if known/just-revealed) so the club crest resolves to the right team.
        let knownLeague = field == GuessWhoField.league.rawValue ? value?.display : known[GuessWhoField.league.rawValue]?.display
        let hintPlayer = PlayerSearchResultDTO(id: "hint-\(UUID().uuidString)", name: "Hint", club: "", league: knownLeague ?? "", nationality: "", position: "")
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

/// Single source of truth for how a daily game's result becomes XP.
///
/// This MIRRORS the server model in `backend/src/services/dailyService.ts`
/// (`computeXp` / `modePerformance` / `MAX_XP` / `XP_FLOOR`). Keep the two in lockstep: the number
/// every game shows on-screen — live and on the result card — IS the XP banked to the player's
/// profile. No game shows an arbitrary "points" number any more.
enum DailyXP {
    static let floor = 10
    static let defaultMax = 70

    /// Per-mode XP ceiling on a perfect win. A modest spread reflecting length/effort so no single
    /// game dominates the day (biggest is only ~1.7× the smallest).
    static let maxXP: [String: Int] = [
        "guess_who": 60,
        "target_man": 60,
        "blind_rank": 70,
        "one_more": 70,
        "football_bingo": 80,
        "world_cup_xi": 90,
        "draft_master": 90,
        "football_tower": 90,
        "football_golf": 100,
    ]

    /// Normalise a game's result to 0–1 on its own score scale. Mirror of the server switch.
    static func performance(mode: String, score: Int, guesses: Int) -> Double {
        let s = Double(max(0, score))
        switch mode {
        case "guess_who": return Double(9 - min(8, max(1, guesses))) / 8.0
        case "world_cup_xi": return s / 1100     // correct × 100, out of 11
        case "draft_master": return s / 100      // % of the perfect XI
        case "football_tower": return s / 15     // floors climbed
        case "football_golf": return s / 80      // max(0, 40 − strokesVsPar×4)
        case "blind_rank": return s / 26         // ~win at 17
        case "target_man": return s / 620        // ~win at 400
        case "one_more": return s / 1000         // banked total — more risked = more XP
        case "football_bingo": return s / 90     // 50 + remaining×3
        default: return 0.8
        }
    }

    /// The XP banked for this result (win applies the participation floor; a loss is the floor).
    static func xp(mode: String, score: Int, guesses: Int = 1, won: Bool) -> Int {
        guard won else { return floor }
        let cap = maxXP[mode] ?? defaultMax
        let perf = min(1.0, max(0.0, performance(mode: mode, score: score, guesses: guesses)))
        return max(floor, Int((perf * Double(cap)).rounded()))
    }

    static func xp(_ mode: GameModeID, score: Int, guesses: Int = 1, won: Bool) -> Int {
        xp(mode: mode.rawValue, score: score, guesses: guesses, won: won)
    }

    /// Live "so far / at risk" XP during play. Same curve as `xp`, but WITHOUT the participation floor
    /// so it can read 0 and climb (used by One More's running meter — the XP you'd bank / lose).
    static func projected(_ mode: GameModeID, score: Int, guesses: Int = 1) -> Int {
        let cap = maxXP[mode.rawValue] ?? defaultMax
        let perf = min(1.0, max(0.0, performance(mode: mode.rawValue, score: score, guesses: guesses)))
        return Int((perf * Double(cap)).rounded())
    }
}
