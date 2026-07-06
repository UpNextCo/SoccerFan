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
    case clubChain = "club_chain"
    case footballTower = "football_tower"

    var title: String {
        switch self {
        case .footballBingo: return "FOOTBALL BINGO"
        case .worldCupXI: return "WORLD CUP XI"
        case .targetMan: return "TARGET MAN"
        case .guessWho: return "GUESS WHO?"
        case .footballGolf: return "FOOTBALL GOLF"
        case .blindRank: return "BLIND RANK"
        case .draftMaster: return "DRAFT XI"
        case .oneMore: return "ONE MORE"
        case .clubChain: return "CLUB CHAIN"
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
        case .clubChain: return "link"
        case .footballTower: return "building.2.fill"
        }
    }
}

extension GameModeID {
    var id: String { rawValue }
}

enum DailyPlayOrder {
    static let playableModes: [GameModeID] = [
        .footballBingo,
        .oneMore,
        .draftMaster,
        .footballGolf,
        .clubChain,
        .guessWho,
        .targetMan,
        .worldCupXI,
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

struct GuessWhoGuessRow: Identifiable, Equatable, Codable {
    var id = UUID()
    let player: PlayerSearchResultDTO
    let feedback: [GuessFeedbackFieldDTO]
    let isCorrect: Bool
    var isHint: Bool = false
}

struct GuessWhoGameState: Equatable, Codable {
    static let progressVersion = 1
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
    /// Every finished game banks at least this; XP then scales continuously with performance up to the
    /// mode's ceiling — no win/loss gate, no arbitrary "you lost" score. Mirror of the server model.
    static let participation = 30
    static let defaultCeiling = 800

    /// Retained for source compatibility — the review phase no longer costs XP.
    static let blindRankMoveCost = 0

    /// Per-mode XP ceiling on a perfect game, scaled to each game's effort/length (quick ~700 → longest 1000).
    static let ceiling: [String: Int] = [
        "guess_who": 700,
        "one_more": 700,
        "target_man": 750,
        "blind_rank": 800,
        "football_bingo": 850,
        "club_chain": 850,
        "world_cup_xi": 950,
        "draft_master": 950,
        "football_tower": 900,
        "football_golf": 1000,
    ]

    /// Normalise a game's result to 0–1 on its true score scale. Continuous — no win/loss gate. Guess
    /// Who can't be read from a single score (8-guess win vs 8-guess loss), so it uses `won`.
    static func performance(mode: String, score: Int, guesses: Int = 1, won: Bool = true) -> Double {
        let s = Double(max(0, score))
        switch mode {
        case "guess_who": return won ? Double(9 - min(8, max(1, guesses))) / 8.0 : 0
        case "world_cup_xi": return s / 1100     // correct × 100, out of 11
        case "draft_master": return s / 100      // % of the perfect XI
        case "football_tower": return s / 15     // floors climbed
        case "blind_rank": return s / 30         // 10 slots × 3 — a perfect ranking is the max
        case "target_man": return s / 1000       // exact-hit tier is the max, so precision pays
        case "one_more": return s / 1000         // banked total — more risked = more XP
        case "football_bingo": return s / 90     // 50 + remaining×3
        case "club_chain": return s / 100        // medal points: gold 100 / silver 75 / bronze 50
        default: return 0.8
        }
    }

    /// Football Golf is scored straight off strokes-vs-par (negative = under par). Mirror of the
    /// server `golfXp`: ≤ −15 → 1000, −10 → 900 (+20/stroke to −15), par → 400 (+50/stroke to −10),
    /// over par → −50/stroke down to the participation floor.
    static func golfXp(total: Int) -> Int {
        if total <= -15 { return 1000 }
        if total <= -10 { return 900 + (-total - 10) * 20 }
        if total <= 0 { return 400 + -total * 50 }
        return max(participation, 400 - total * 50)
    }

    /// The XP banked for this result: participation base + performance up to the mode's ceiling.
    static func xp(mode: String, score: Int, guesses: Int = 1, won: Bool) -> Int {
        if mode == "football_golf" { return golfXp(total: score) }
        let cap = ceiling[mode] ?? defaultCeiling
        let perf = min(1.0, max(0.0, performance(mode: mode, score: score, guesses: guesses, won: won)))
        return Int((Double(participation) + perf * Double(cap - participation)).rounded())
    }

    static func xp(_ mode: GameModeID, score: Int, guesses: Int = 1, won: Bool) -> Int {
        xp(mode: mode.rawValue, score: score, guesses: guesses, won: won)
    }

    /// Live "so far / at risk" XP during play — the performance portion above the participation base,
    /// so it reads 0 and climbs (used by One More's running meter — the XP you'd bank / lose).
    static func projected(_ mode: GameModeID, score: Int, guesses: Int = 1) -> Int {
        let cap = ceiling[mode.rawValue] ?? defaultCeiling
        let perf = min(1.0, max(0.0, performance(mode: mode.rawValue, score: score, guesses: guesses)))
        return Int((perf * Double(cap - participation)).rounded())
    }
}
