import Foundation

// MARK: - Difficulty

enum ClubChainDifficulty: String, Codable, Equatable {
    case easy, medium, hard

    var label: String {
        switch self {
        case .easy: return "EASY"
        case .medium: return "MEDIUM"
        case .hard: return "HARD"
        }
    }

    /// Shown under the difficulty badge — recall hardness, not chain length.
    var subtitle: String {
        switch self {
        case .easy: return "Familiar connectors"
        case .medium: return "Trickier links"
        case .hard: return "Obscure bridges"
        }
    }
}

// MARK: - Players & puzzle

struct ClubChainPlayer: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let club: String
    let nationality: String
    let position: String
    let headshotUrl: String?

    init(id: String, name: String, club: String = "", nationality: String = "", position: String = "", headshotUrl: String? = nil) {
        self.id = id; self.name = name; self.club = club; self.nationality = nationality
        self.position = position; self.headshotUrl = headshotUrl
    }

    init(dto: ClubChainPlayerDTO) {
        self.init(id: dto.id, name: dto.name, club: dto.club, nationality: dto.nationality,
                  position: dto.position, headshotUrl: dto.headshotUrl)
    }

    init(search: PlayerSearchResultDTO) {
        self.init(id: search.id, name: search.name, club: search.club, nationality: search.nationality,
                  position: search.position, headshotUrl: search.headshotUrl)
    }
}

struct ClubChainPuzzle: Codable, Equatable {
    let id: String
    let date: String
    let difficulty: ClubChainDifficulty
    let start: ClubChainPlayer
    let target: ClubChainPlayer
    /// Shortest teammate chain length in LINKS (edges) — the scoring "par".
    let shortestPathLength: Int
    /// Max players the player may add before failing.
    let maxMoves: Int
    let mistakesAllowed: Int
}

// MARK: - Link validation DTOs

/// The confirmation returned after a valid move — the shared club + the overlap years.
struct TeammateLinkDTO: Codable, Equatable {
    let clubId: Int
    let clubName: String
    let overlapStart: String
    let overlapEnd: String
    let clubBadgeUrl: String?

    /// "2013–2015", or just "2013" for a single-season overlap.
    var yearsText: String {
        overlapStart == overlapEnd ? overlapStart : "\(overlapStart)–\(overlapEnd)"
    }
}

struct ClubChainLinkResultDTO: Codable {
    let link: TeammateLinkDTO?
    let targetLink: TeammateLinkDTO?
}

// MARK: - Chain step

/// One added player, plus the shared-club link that connects it to the PREVIOUS node in the chain.
struct ClubChainStep: Codable, Equatable, Identifiable {
    var id: String { player.id }
    let player: ClubChainPlayer
    let link: TeammateLinkDTO
}

// MARK: - Medals & scoring

enum ClubChainMedal: String, Codable {
    case gold, silver, bronze, none

    var title: String {
        switch self {
        case .gold: return "GOLD"
        case .silver: return "SILVER"
        case .bronze: return "BRONZE"
        case .none: return "—"
        }
    }

    var emoji: String {
        switch self {
        case .gold: return "🥇"
        case .silver: return "🥈"
        case .bronze: return "🥉"
        case .none: return "❌"
        }
    }

    /// Base medal XP before wrong-guess deductions: gold 1000 / silver 750 / bronze 500 / none 0.
    var points: Int {
        switch self {
        case .gold: return 1000
        case .silver: return 750
        case .bronze: return 500
        case .none: return 0
        }
    }
}

// MARK: - Game state

struct ClubChainGameState: Codable, Equatable {
    static let progressVersion = 1

    enum Phase: String, Codable { case playing, won, lost }

    let puzzle: ClubChainPuzzle
    var steps: [ClubChainStep] = []
    /// The final shared-club link from the last added player to the TARGET (set only on a win).
    var closingLink: TeammateLinkDTO?
    var livesRemaining: Int
    var phase: Phase = .playing

    init(puzzle: ClubChainPuzzle) {
        self.puzzle = puzzle
        self.livesRemaining = puzzle.mistakesAllowed
    }

    /// Players already placed in the chain (start + added + target) — can't be reused.
    var usedIds: Set<String> {
        var ids: Set<String> = [puzzle.start.id, puzzle.target.id]
        for step in steps { ids.insert(step.player.id) }
        return ids
    }

    /// The node a newly added player must link back to.
    var tailId: String { steps.last?.player.id ?? puzzle.start.id }

    /// Players added so far (the "moves" that count for scoring).
    var moves: Int { steps.count }

    /// Fewest players you'd need to add on the optimal route (shortest chain minus the target hop).
    var optimalMoves: Int { max(1, puzzle.shortestPathLength - 1) }

    /// Teammate links in the shortest route (start → … → target).
    var linkCount: Int { puzzle.shortestPathLength }

    /// Players you must insert for a gold medal on the shortest route.
    var goldMoves: Int { optimalMoves }

    /// Max players you may insert before the chain fails.
    var moveLimit: Int { puzzle.maxMoves }

    var movesRemaining: Int { max(0, puzzle.maxMoves - steps.count) }

    /// Wrong guesses spent (each costs a heart and XP).
    var mistakesMade: Int { max(0, puzzle.mistakesAllowed - livesRemaining) }

    var isResumable: Bool { phase == .playing && !steps.isEmpty }

    var medal: ClubChainMedal {
        guard phase == .won else { return .none }
        if moves <= optimalMoves { return .gold }
        if moves <= optimalMoves + 2 { return .silver }
        return .bronze
    }

    var score: Int {
        DailyXP.clubChain(reached: won, moves: moves, par: optimalMoves, mistakes: mistakesMade)
    }
    var won: Bool { phase == .won }

    func answerPayload() -> JSONValue {
        .object([
            "steps": .array(steps.map { .string($0.player.id) }),
            "won": .bool(phase == .won),
            "mistakes": .int(mistakesMade),
        ])
    }

    /// Spoiler-free share text: medal + move count + lives, never the players/solution.
    func shareText(date: String) -> String {
        let hearts = String(repeating: "❤️", count: max(0, livesRemaining))
            + String(repeating: "🖤", count: max(0, puzzle.mistakesAllowed - livesRemaining))
        let header = "Club Chain 🔗 \(puzzle.difficulty.label.capitalized)"
        if phase == .won {
            return "\(header)\n\(medal.emoji) \(moves) players added (gold: \(optimalMoves) · \(linkCount)-link chain)\n\(hearts)"
        }
        return "\(header)\n❌ Couldn't connect them\n\(hearts)"
    }
}
