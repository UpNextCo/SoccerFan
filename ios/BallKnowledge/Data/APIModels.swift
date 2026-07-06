import Foundation

struct APIResponse<T: Decodable>: Decodable {
    let success: Bool
    let data: T?
    let error: APIErrorBody?
}

struct APIErrorBody: Decodable {
    let message: String
    let code: String?
}

struct UserProfileDTO: Codable, Equatable {
    let id: String
    let displayName: String
    let xp: Int
    let level: Int
    let streak: Int
    let todayXp: Int
    var avatarUrl: String?
    var favoriteTeamId: Int?
}

struct TeamSearchResultDTO: Codable, Identifiable {
    let id: Int
    let name: String
    let logoUrl: String?
    let leagueId: Int?
    let country: String?
}

struct AuthResponseDTO: Codable {
    let token: String
    let user: UserProfileDTO
}

struct PlayerStandingDTO: Codable, Identifiable {
    let userId: String
    let displayName: String
    let favoriteTeamId: Int?
    let xp: Int
    let rank: Int
    var id: String { userId }
}

struct TeamStandingDTO: Codable, Identifiable {
    let teamId: Int
    let name: String
    let logoUrl: String?
    let members: Int
    let totalXp: Int
    let score: Double
    let rank: Int
    var id: Int { teamId }
}

struct MyLeagueDTO: Codable {
    let weekStart: String
    let cohortId: String?
    let standings: [PlayerStandingDTO]
}

struct PlayerStandingsDTO: Codable {
    let weekStart: String?
    let date: String?
    let standings: [PlayerStandingDTO]
}

struct TeamStandingsDTO: Codable {
    let weekStart: String
    let standings: [TeamStandingDTO]
}

struct AuthAppleRequestDTO: Encodable {
    let identityToken: String
    let displayName: String?
}

struct GameModeMetaDTO: Codable, Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let playerCount: Int
    let isAvailable: Bool
}

struct GuessWhoPuzzleDTO: Codable, Equatable {
    let modeId: String
    let puzzleId: String
    let date: String
    let maxGuesses: Int
    let maxScore: Int
}

struct TeamLogoDTO: Codable, Equatable {
    let teamId: Int
    let logoUrl: String
}

struct GuessFeedbackFieldDTO: Codable, Equatable {
    let field: String
    let value: StringOrNumber?
    let status: String
    let hint: String?
}

struct PlayerSearchResultDTO: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let club: String
    let league: String
    let nationality: String
    let position: String
    /// Transfer-budget price in EUR (peak market value + tier fallback). Optional so locally
    /// constructed results (seeds) and older payloads still decode.
    let priceEur: Double?
    /// API-Football headshot URL (quota-free CDN); nil when we have no API-Football id.
    let headshotUrl: String?
    let teamId: Int?
    let teamLogoUrl: String?

    init(
        id: String,
        name: String,
        club: String,
        league: String,
        nationality: String,
        position: String,
        priceEur: Double? = nil,
        headshotUrl: String? = nil,
        teamId: Int? = nil,
        teamLogoUrl: String? = nil
    ) {
        self.id = id
        self.name = name
        self.club = club
        self.league = league
        self.nationality = nationality
        self.position = position
        self.priceEur = priceEur
        self.headshotUrl = headshotUrl
        self.teamId = teamId
        self.teamLogoUrl = teamLogoUrl
    }
}

struct PlayerCareerStatsTotalsDTO: Codable, Equatable {
    let goals: Int
    let assists: Int
    let appearances: Int
    let yellowCards: Int
    let redCards: Int
    let minutes: Int
    let cleanSheets: Int
    let saves: Int
    let foulsCommitted: Int
    let tackles: Int
}

struct PlayerCareerStatsDTO: Codable, Equatable {
    let playerId: String
    let leagueId: Int
    let totals: PlayerCareerStatsTotalsDTO
    let trophyCount: Int
    let latestTransferFeeEurM: Double?
}

enum StringOrNumber: Codable, Equatable {
    case string(String)
    case int(Int)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let s = try? container.decode(String.self) {
            self = .string(s)
        } else if let i = try? container.decode(Int.self) {
            self = .int(i)
        } else {
            self = .string("")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let s): try container.encode(s)
        case .int(let i): try container.encode(i)
        }
    }

    var display: String {
        switch self {
        case .string(let s): return s
        case .int(let i): return String(i)
        }
    }
}

struct GuessResultDTO: Codable {
    let feedback: [GuessFeedbackFieldDTO]
    let correct: Bool
}

/// The answer player, revealed after a lost Guess Who game. `attributes` is keyed by field name.
struct GuessWhoAnswerDTO: Codable, Equatable {
    let id: String
    let name: String
    let attributes: [String: StringOrNumber]
}

/// A hint: one not-yet-known attribute (field + its correct value). `field` is nil if none remain.
struct GuessWhoHintDTO: Codable, Equatable {
    let field: String?
    let value: StringOrNumber?
}

/// A Codable, arbitrary JSON value — used to carry each game's per-mode answer inputs (ranking
/// order, picks, slot fills…) to the server so it can recompute the authoritative score.
indirect enum JSONValue: Codable, Equatable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .double(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let v = try? c.decode(Bool.self) { self = .bool(v); return }
        if let v = try? c.decode(Int.self) { self = .int(v); return }
        if let v = try? c.decode(Double.self) { self = .double(v); return }
        if let v = try? c.decode(String.self) { self = .string(v); return }
        if let v = try? c.decode([JSONValue].self) { self = .array(v); return }
        if let v = try? c.decode([String: JSONValue].self) { self = .object(v); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON value")
    }
}

struct DailyCompleteRequestDTO: Encodable {
    let modeId: String
    let date: String
    let score: Int
    let guesses: Int
    let won: Bool
    let shareGrid: String
    /// Per-mode answer inputs so the server can recompute the score (nil for modes we don't yet
    /// send; the key is then omitted and the server clamps the reported score instead).
    var answer: JSONValue? = nil
}

struct DailyCompleteResponseDTO: Codable {
    let xpEarned: Int
    let newXp: Int
    let newLevel: Int
    let streak: Int
    let todayXp: Int
}

struct DailyGuessRequestDTO: Encodable {
    let date: String
    let modeId: String
    let playerId: String
}
