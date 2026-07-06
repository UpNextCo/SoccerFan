import Foundation

// MARK: - Rarity

enum FootballGolfRarity: String, Codable, Equatable, CaseIterable {
    case common
    case uncommon
    case rare
    case ultraRare

    init(serverValue: String) {
        switch serverValue {
        case "common": self = .common
        case "uncommon": self = .uncommon
        case "rare": self = .rare
        case "ultraRare", "ultra_rare": self = .ultraRare
        default: self = .common
        }
    }

    var label: String {
        switch self {
        case .common: return "COMMON"
        case .uncommon: return "UNCOMMON"
        case .rare: return "RARE"
        case .ultraRare: return "ULTRA RARE"
        }
    }

    /// Points this answer scores toward clearing the hole's par.
    var points: Int {
        switch self {
        case .common: return 1
        case .uncommon: return 2
        case .rare: return 3
        case .ultraRare: return 4
        }
    }

    var isStandout: Bool { self == .rare || self == .ultraRare }
}

// MARK: - Course model

struct FootballGolfAnswer: Identifiable, Equatable, Codable {
    let id: String
    let name: String
    let aliases: [String]
    let rarity: FootballGolfRarity
}

struct FootballGolfHole: Identifiable, Equatable {
    let id: String
    let holeNumber: Int
    let par: Int
    let prompt: String
    let category: String
    let answers: [FootballGolfAnswer]
    let hints: [String]
}

struct FootballGolfCourse: Identifiable, Equatable {
    let id: String
    let date: String
    let title: String
    let holes: [FootballGolfHole]

    var totalPar: Int { holes.map(\.par).reduce(0, +) }
}

// MARK: - Per-hole result

/// Extra guesses allowed beyond par before the hole force-settles (par 3 → 5 shots total).
let footballGolfShotCap = 2

struct FootballGolfHoleResult: Identifiable, Equatable, Codable {
    let id: String
    let holeNumber: Int
    let par: Int
    let matched: [FootballGolfAnswer]   // correct answers the player named (in order)
    let shots: Int                      // EFFECTIVE shots: real guesses + skip penalty
    let skipped: Bool

    var pointsReached: Int { matched.reduce(0) { $0 + $1.rarity.points } }

    /// Golf score: effective shots minus par (negative is good).
    var relativeToPar: Int { shots - par }

    var label: String {
        if !skipped && shots == 1 { return "HOLE IN ONE" }
        switch relativeToPar {
        case ...(-3): return "ALBATROSS"
        case -2: return "EAGLE"
        case -1: return "BIRDIE"
        case 0: return "PAR"
        case 1: return "BOGEY"
        case 2: return "DOUBLE BOGEY"
        case 3: return "TRIPLE BOGEY"
        default: return "+\(relativeToPar)"
        }
    }
}

// MARK: - Scoring helpers

enum FootballGolfScoring {
    static func scoreLabel(_ total: Int) -> String {
        if total == 0 { return "E" }
        return total > 0 ? "+\(total)" : "\(total)"
    }

    static func relativeToParLabel(_ total: Int) -> String {
        if total == 0 { return "Level par" }
        if total < 0 { return "\(abs(total)) under par" }
        return "\(total) over par"
    }

    static func finishMessage(_ total: Int) -> String {
        switch total {
        case ...(-4): return "Elite ball knowledge"
        case -3, -2: return "Seriously sharp"
        case -1, 0: return "Solid round"
        case 1, 2: return "Not bad"
        default: return "Room to improve"
        }
    }

    /// XP for a single hole based on its result vs par (under 134 / par 90 / bogey 45 / worse 0).
    static func holeXP(_ result: FootballGolfHoleResult) -> Int {
        DailyXP.golfHole(relativeToPar: result.relativeToPar)
    }

    /// Total XP for the round: sum of per-hole XP, capped at the mode max. This IS the XP banked.
    static func xp(results: [FootballGolfHoleResult]) -> Int {
        DailyXP.xp(.footballGolf, score: results.reduce(0) { $0 + holeXP($1) })
    }
}

// MARK: - Local answer matching (validate against the hole's shipped answers)

enum FootballGolfMatcher {
    static func normalize(_ value: String) -> String {
        value
            .lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .replacingOccurrences(of: "[^a-z0-9 ]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Returns the matched answer for a guess, tolerating accents, punctuation and
    /// "surname only" entries when unambiguous.
    static func match(guess: String, in answers: [FootballGolfAnswer], alreadyMatched: Set<String>) -> FootballGolfAnswer? {
        let g = normalize(guess)
        guard g.count >= 2 else { return nil }

        // exact / alias match first
        for a in answers where !alreadyMatched.contains(a.id) {
            if normalize(a.name) == g { return a }
            if a.aliases.contains(where: { normalize($0) == g }) { return a }
        }
        // surname-only match (e.g. "henry" -> "Thierry Henry") when it's unambiguous
        let surnameHits = answers.filter { a in
            guard !alreadyMatched.contains(a.id) else { return false }
            let parts = normalize(a.name).split(separator: " ")
            return parts.last.map(String.init) == g
        }
        if surnameHits.count == 1 { return surnameHits.first }
        return nil
    }
}

// MARK: - DTO mapping

extension FootballGolfCourse {
    init(dto: FootballGolfPuzzleDTO) {
        self.init(
            id: dto.puzzleId,
            date: dto.date,
            title: dto.title,
            holes: dto.holes.map { h in
                FootballGolfHole(
                    id: h.id,
                    holeNumber: h.holeNumber,
                    par: h.par,
                    prompt: h.prompt,
                    category: h.category,
                    answers: h.answers.map {
                        FootballGolfAnswer(id: $0.id, name: $0.name, aliases: $0.aliases, rarity: FootballGolfRarity(serverValue: $0.rarity))
                    },
                    hints: h.hints
                )
            }
        )
    }
}
