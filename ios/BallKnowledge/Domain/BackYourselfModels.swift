import Foundation

// MARK: - Category & puzzle

struct BackYourselfCategory: Codable, Equatable {
    let type: String
    let label: String
    let club: String?
    let leagueId: Int?
    let leagueName: String?
    let nationality: String?
    let logoUrl: String?
}

struct BackYourselfPuzzle: Codable, Equatable {
    let id: String
    let date: String
    let category: BackYourselfCategory
    let maxPool: Int
    let mistakesAllowed: Int
}

struct BackYourselfPlayer: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let club: String
    let nationality: String
    let position: String
    let headshotUrl: String?

    init(id: String, name: String, club: String = "", nationality: String = "", position: String = "", headshotUrl: String? = nil) {
        self.id = id
        self.name = name
        self.club = club
        self.nationality = nationality
        self.position = position
        self.headshotUrl = headshotUrl
    }

    init(dto: BackYourselfPlayerDTO) {
        self.init(
            id: dto.id,
            name: dto.name,
            club: dto.club,
            nationality: dto.nationality,
            position: dto.position,
            headshotUrl: dto.headshotUrl
        )
    }

    init(search: PlayerSearchResultDTO) {
        self.init(
            id: search.id,
            name: search.name,
            club: search.club,
            nationality: search.nationality,
            position: search.position,
            headshotUrl: search.headshotUrl
        )
    }
}

// MARK: - API DTOs

struct BackYourselfPuzzleDTO: Codable, Equatable {
    let modeId: String
    let puzzleId: String
    let date: String
    let category: BackYourselfCategory
    let maxPool: Int
    let mistakesAllowed: Int

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        modeId = try c.decode(String.self, forKey: .modeId)
        puzzleId = try c.decode(String.self, forKey: .puzzleId)
        date = try c.decode(String.self, forKey: .date)
        category = try c.decode(BackYourselfCategory.self, forKey: .category)
        maxPool = try c.decodeIfPresent(Int.self, forKey: .maxPool) ?? 10
        mistakesAllowed = try c.decodeIfPresent(Int.self, forKey: .mistakesAllowed) ?? 3
    }
}

struct BackYourselfPlayerDTO: Codable, Equatable {
    let id: String
    let name: String
    let club: String
    let nationality: String
    let position: String
    let headshotUrl: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        club = try c.decodeIfPresent(String.self, forKey: .club) ?? ""
        nationality = try c.decodeIfPresent(String.self, forKey: .nationality) ?? ""
        position = try c.decodeIfPresent(String.self, forKey: .position) ?? ""
        headshotUrl = try c.decodeIfPresent(String.self, forKey: .headshotUrl)
    }
}

struct BackYourselfGuessResultDTO: Codable {
    let ok: Bool
    let correct: Bool
    let duplicate: Bool
    let player: BackYourselfPlayerDTO?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? true
        correct = try c.decode(Bool.self, forKey: .correct)
        duplicate = try c.decodeIfPresent(Bool.self, forKey: .duplicate) ?? false
        player = try c.decodeIfPresent(BackYourselfPlayerDTO.self, forKey: .player)
    }
}

// MARK: - Game state

struct BackYourselfGameState: Codable, Equatable {
    static let progressVersion = 1

    enum Phase: String, Codable {
        case pledge
        case naming
        case won
        case lost
    }

    let puzzle: BackYourselfPuzzle
    var phase: Phase = .pledge
    var pledge: Int
    var named: [BackYourselfPlayer] = []
    var livesRemaining: Int
    var heartLossToken: Int = 0

    init(puzzle: BackYourselfPuzzle) {
        self.puzzle = puzzle
        self.livesRemaining = puzzle.mistakesAllowed
        // Default slider around 60% of the pool (still editable before lock).
        self.pledge = max(1, min(puzzle.maxPool, Int((Double(puzzle.maxPool) * 0.6).rounded())))
    }

    var namedCount: Int { named.count }
    var usedIds: Set<String> { Set(named.map(\.id)) }
    var mistakesMade: Int { max(0, puzzle.mistakesAllowed - livesRemaining) }
    var won: Bool { phase == .won }
    var isResumable: Bool { phase == .naming && (!named.isEmpty || pledge > 0) }

    var projectedXP: Int {
        DailyXP.backYourself(pledge: pledge, maxPool: puzzle.maxPool, won: true)
    }

    var score: Int {
        DailyXP.backYourself(pledge: pledge, maxPool: puzzle.maxPool, won: won)
    }

    func answerPayload() -> JSONValue {
        .object([
            "pledge": .int(pledge),
            "namedPlayerIds": .array(named.map { .string($0.id) }),
            "mistakes": .int(mistakesMade),
            "won": .bool(phase == .won),
        ])
    }

    func shareText(date: String) -> String {
        let hearts = String(repeating: "❤️", count: max(0, livesRemaining))
            + String(repeating: "🖤", count: max(0, puzzle.mistakesAllowed - livesRemaining))
        if phase == .won {
            return "Back Yourself 💪\nNamed \(namedCount)/\(pledge) — \(score) XP\n\(hearts)"
        }
        return "Back Yourself 💪\nFell short of \(pledge)\n\(hearts)"
    }
}
