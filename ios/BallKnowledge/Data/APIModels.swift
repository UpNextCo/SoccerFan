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
}

struct AuthResponseDTO: Codable {
    let token: String
    let user: UserProfileDTO
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
    let teamId: Int?
    let teamLogoUrl: String?

    init(
        id: String,
        name: String,
        club: String,
        league: String,
        nationality: String,
        position: String,
        teamId: Int? = nil,
        teamLogoUrl: String? = nil
    ) {
        self.id = id
        self.name = name
        self.club = club
        self.league = league
        self.nationality = nationality
        self.position = position
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

struct DailyCompleteRequestDTO: Encodable {
    let modeId: String
    let date: String
    let score: Int
    let guesses: Int
    let won: Bool
    let shareGrid: String
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
