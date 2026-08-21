import Foundation
import SwiftUI

// DEFUNCT modes (code retained, hidden from homepage daily): guessWho, worldCupXI, blindRank, footballTower, footballGolf.
enum GameModeID: String, CaseIterable, Identifiable {
    case footballBingo = "football_bingo"
    case oneMore = "one_more"
    case targetMan = "target_man"
    case guessWho = "guess_who" // DEFUNCT
    case footballGolf = "football_golf" // DEFUNCT
    case blindRank = "blind_rank" // DEFUNCT
    case draftMaster = "draft_master"
    case worldCupXI = "world_cup_xi" // DEFUNCT
    case clubChain = "club_chain"
    case footballTower = "football_tower" // DEFUNCT
    case lastManStanding = "last_man_standing"
    case backYourself = "back_yourself"
    case darts501 = "darts_501"

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
        case .lastManStanding: return "LAST MAN STANDING"
        case .backYourself: return "BACK YOURSELF"
        case .darts501: return "FOOTBALL 501"
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
        case .lastManStanding: return "person.3.sequence.fill"
        case .backYourself: return "hand.raised.fill"
        case .darts501: return "target"
        }
    }
}

extension GameModeID {
    var id: String { rawValue }
}

enum DailyPlayOrder {
    /// Modes that can be hosted as a VS challenge.
    static let vsModes: [GameModeID] = [
        .backYourself,
        .darts501,
        .targetMan,
        .draftMaster,
    ]

    /// Modes shown on the homepage daily list (excludes defunct guessWho / worldCupXI / blindRank / footballTower / footballGolf).
    static let playableModes: [GameModeID] = [
        .footballBingo,
        .oneMore,
        .draftMaster,
        .clubChain,
        .targetMan,
        .lastManStanding,
        .backYourself,
        .darts501,
    ]

    static func availableModes(in bundle: DailyBundleDTO) -> [GameModeID] {
        let availableIds = Set(bundle.games.map { GameModeCatalog.normalizedModeId($0.modeId) })
        return playableModes.filter { availableIds.contains($0.rawValue) }
    }

    static func completedCount(in bundle: DailyBundleDTO) -> Int {
        availableModes(in: bundle).filter { bundle.isCompleted($0) }.count
    }

    static func allComplete(in bundle: DailyBundleDTO) -> Bool {
        let available = availableModes(in: bundle)
        return !available.isEmpty && available.allSatisfy { bundle.isCompleted($0) }
    }

    static func firstIncomplete(in bundle: DailyBundleDTO) -> GameModeID? {
        availableModes(in: bundle).first { !bundle.isCompleted($0) }
    }

    static func nextIncomplete(after mode: GameModeID, in bundle: DailyBundleDTO) -> GameModeID? {
        let available = availableModes(in: bundle)
        guard let index = available.firstIndex(of: mode) else { return nil }
        return available.dropFirst(index + 1).first { !bundle.isCompleted($0) }
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
    /// Live games share a 1000 XP ceiling (eight-game total 8000). Hidden / defunct modes keep
    /// their own caps. A full loss earns 0. Every game's on-screen score IS this XP.
    static let maxByMode: [String: Int] = [
        "guess_who": 800,
        "one_more": 1000,
        "target_man": 1000,
        "blind_rank": 1000,
        "football_bingo": 1000,
        "club_chain": 1000,
        "world_cup_xi": 1100,
        "draft_master": 1000,
        "football_tower": 900,
        "football_golf": 800,
        "last_man_standing": 1000,
        "back_yourself": 1000,
        "darts_501": 1000,
    ]
    static let defaultMax = 1000

    /// Retained for source compatibility — the review phase no longer costs XP.
    static let blindRankMoveCost = 0

    static func maxXP(mode: String) -> Int { maxByMode[mode] ?? defaultMax }
    static func maxXP(_ mode: GameModeID) -> Int { maxXP(mode: mode.rawValue) }

    /// A game's `score` IS its XP. Clamp to the mode's ceiling; a full loss is 0. Mirror of the
    /// server `computeXp`. `guesses`/`won` are kept for call-site compatibility only.
    static func xp(mode: String, score: Int, guesses: Int = 1, won: Bool = true) -> Int {
        if mode == GameModeID.footballGolf.rawValue { return 0 }
        return max(0, min(maxXP(mode: mode), score))
    }

    static func xp(_ mode: GameModeID, score: Int, guesses: Int = 1, won: Bool = true) -> Int {
        xp(mode: mode.rawValue, score: score, guesses: guesses, won: won)
    }

    /// Live running XP for the HUD — the running score is already XP, so this just clamps.
    static func projected(_ mode: GameModeID, score: Int, guesses: Int = 1) -> Int {
        xp(mode, score: score)
    }

    // MARK: - Per-game XP builders (each returns XP; games use these to build their score + HUD)

    /// Guess Who: solve in 1 = 800, then -100 per extra guess (min 100 at 8); unsolved = 0.
    static func guessWho(guesses: Int, solved: Bool) -> Int {
        solved ? max(100, 900 - 100 * min(8, max(1, guesses))) : 0
    }

    /// World Cup XI: 100 XP per correct slot (11 -> 1100).
    static let worldCupPerSlot = 100

    /// Blind Rank: per slot by distance from its true spot (exact 100 / off-1 60 / off-2 30 / else 0).
    static func blindRankSlot(distance: Int) -> Int {
        switch distance {
        case 0: return 100
        case 1: return 60
        case 2: return 30
        default: return 0
        }
    }

    /// Football Golf: five-hole XP mirrored by the server. Eagle+ 160 / birdie 130 / par 60 /
    /// bogey 25 / worse 0. Five eagles = 800, five birdies = 650, five pars = 300.
    static func golfHole(relativeToPar: Int) -> Int {
        if relativeToPar <= -2 { return 160 }
        if relativeToPar == -1 { return 130 }
        if relativeToPar == 0 { return 60 }
        if relativeToPar == 1 { return 25 }
        return 0
    }

    /// One More: each correct answer is a flat share of the 1000 max (10 rounds → 100 each).
    /// Clearing every round banks the full 1000.
    static func oneMorePick(_ k: Int, rounds: Int) -> Int {
        guard rounds > 0, k > 0 else { return 0 }
        return Int((Double(maxXP(.oneMore)) / Double(rounds)).rounded())
    }

    static func oneMoreTotal(streak: Int, rounds: Int) -> Int {
        guard streak > 0, rounds > 0 else { return 0 }
        return min(maxXP(.oneMore), streak * oneMorePick(1, rounds: rounds))
    }

    /// Target Man: closeness bands (exact 1000 ... within 25% 250, else 0).
    static func targetMan(pctOff: Double) -> Int {
        switch pctOff {
        case ..<0.0001: return 1000
        case ..<0.02: return 900
        case ..<0.05: return 800
        case ..<0.10: return 650
        case ..<0.15: return 450
        case ..<0.25: return 250
        default: return 0
        }
    }

    /// Draft XI: 1000 XP at ≥90% of the optimal XI (100% still clamps to 1000).
    static let draftPerfectAtFraction = 0.90
    /// Signature trophy: 98% or more of the optimal XI.
    static let draftSignatureAtFraction = 0.98
    static func draft(total: Int, optimal: Int) -> Int {
        guard optimal > 0 else { return 0 }
        let pct = Double(total) / Double(optimal)
        return min(maxXP(.draftMaster), Int((Double(maxXP(.draftMaster)) * pct / draftPerfectAtFraction).rounded()))
    }

    /// Football Bingo: clear the grid → 400–1000 by leftover players. 1000 at ≤10 skips
    /// (zero-skip is effectively impossible on the 55-player queue). Near-miss if you run out
    /// with only a few tiles left (1→250 / 2→150 / 3→75). Otherwise 0.
    static let bingoFloor = 400
    static let bingoPerfectMaxSkips = 10
    static func bingo(filled: Int, tiles: Int, remaining: Int, queueSize: Int) -> Int {
        let filledClamped = max(0, min(filled, tiles))
        if filledClamped >= tiles {
            guard queueSize > tiles else { return 1000 }
            let slack = queueSize - tiles
            let remainingForPerfect = max(0, slack - bingoPerfectMaxSkips)
            if remainingForPerfect == 0 || remaining >= remainingForPerfect { return 1000 }
            let efficiency = Swift.min(1, Swift.max(0, Double(remaining) / Double(remainingForPerfect)))
            return bingoFloor + Int((Double(1000 - bingoFloor) * efficiency).rounded())
        }
        switch tiles - filledClamped {
        case 1: return 250
        case 2: return 150
        case 3: return 75
        default: return 0
        }
    }

    /// Club Chain: medal by moves vs par, then −150 XP per wrong guess (gold 1000 / silver 750 / bronze 500).
    static let clubChainMistakeCost = 150

    static func clubChain(reached: Bool, moves: Int, par: Int, mistakes: Int = 0) -> Int {
        guard reached else { return 0 }
        let base: Int
        if moves <= par { base = 1000 }
        else if moves <= par + 2 { base = 750 }
        else { base = 500 }
        return max(0, base - max(0, mistakes) * clubChainMistakeCost)
    }

    /// Last Man Standing: 100 XP per question survived (partial credit on loss); full clear = 1000.
    static func lastManStanding(survived: Int) -> Int {
        min(maxXP(.lastManStanding), max(0, survived) * 100)
    }

    /// Back Yourself: hit the pledge with lives left → `round(1000 * (min(pledge,xpCap)/xpCap)^1.41)`; else 0.
    static func backYourself(pledge: Int, xpCap: Int, won: Bool) -> Int {
        guard won, xpCap > 0, pledge > 0 else { return 0 }
        let effective = min(pledge, xpCap)
        let ratio = min(1, max(0, Double(effective) / Double(xpCap)))
        let ceiling = maxXP(.backYourself)
        return max(0, min(ceiling, Int((Double(ceiling) * pow(ratio, 1.41)).rounded())))
    }

    /// Darts 501: checkout 820 / perfect 1000, then −40 XP per throw over 4 and −30 XP per bust.
    /// A loss (three checkout busts) is 0. Win floor 280.
    static func darts501(won: Bool, perfect: Bool, throwCount: Int, busts: Int) -> Int {
        guard won else { return 0 }
        let base = perfect ? 1000 : 820
        let throwPenalty = max(0, throwCount - 4) * 40
        let bustPenalty = max(0, busts) * 30
        return max(280, min(1000, base - throwPenalty - bustPenalty))
    }
}
