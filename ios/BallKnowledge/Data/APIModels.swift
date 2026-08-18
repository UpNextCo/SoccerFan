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
    let levelXpStart: Int?
    let nextLevelXp: Int?
    let streak: Int
    let todayXp: Int
    var avatarUrl: String?
    var favoriteTeamId: Int?
}

struct XpByModeRowDTO: Codable, Identifiable, Equatable {
    let modeId: String
    let totalXp: Int
    let todayXp: Int

    var id: String { modeId }
}

struct XpByModeResponseDTO: Codable, Equatable {
    let date: String
    let modes: [XpByModeRowDTO]
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
    var avatarUrl: String?
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
    let weekEnd: String?
    let endsLabel: String?
    let division: String?
    let divisionLabel: String?
    let participated: Bool?
    let cohortId: String?
    let standings: [WeeklyLeagueStandingDTO]
    let zones: WeeklyLeagueZonesDTO?
    let statusLine: String?
    let viewerRank: Int?
}

struct WeeklyLeagueStandingDTO: Codable, Identifiable, Equatable {
    let userId: String
    let displayName: String
    let favoriteTeamId: Int?
    let xp: Int
    let rank: Int
    let avatarUrl: String?
    let isYou: Bool?

    var id: String { userId }

    /// Bridge to the shared row component.
    var asPlayerStanding: PlayerStandingDTO {
        PlayerStandingDTO(
            userId: userId,
            displayName: displayName,
            favoriteTeamId: favoriteTeamId,
            xp: xp,
            rank: rank,
            avatarUrl: avatarUrl
        )
    }
}

struct WeeklyLeagueZonesDTO: Codable, Equatable {
    let promoteMaxRank: Int
    let relegateMinRank: Int
    let isChampionsLeague: Bool
    let isSundayLeague: Bool
    let tableSize: Int
}

struct PlayerStandingsDTO: Codable {
    let weekStart: String?
    let date: String?
    let standings: [PlayerStandingDTO]
}

struct TeamStandingsDTO: Codable {
    let weekStart: String?
    let standings: [TeamStandingDTO]
}

struct TeamFansDTO: Codable {
    let teamId: Int
    let standings: [PlayerStandingDTO]
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

    func decode<T: Decodable>(_ type: T.Type) -> T? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
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
    let optimalLineup: [BattleOptimalSlotDTO]?
    let optimalScore: Int?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        xpEarned = try c.decode(Int.self, forKey: .xpEarned)
        newXp = try c.decode(Int.self, forKey: .newXp)
        newLevel = try c.decode(Int.self, forKey: .newLevel)
        streak = try c.decode(Int.self, forKey: .streak)
        todayXp = try c.decode(Int.self, forKey: .todayXp)
        optimalLineup = try c.decodeIfPresent([BattleOptimalSlotDTO].self, forKey: .optimalLineup)
        optimalScore = try c.decodeIfPresent(Int.self, forKey: .optimalScore)
    }
}

struct DailyGuessRequestDTO: Encodable {
    let date: String
    let modeId: String
    let playerId: String
}

// MARK: - VS

struct VsPlayerDTO: Codable, Equatable {
    let userId: String
    let displayName: String
    let score: Int?
    let displayScore: Int?
    let completed: Bool
    let isYou: Bool
    let isHost: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = try c.decode(String.self, forKey: .userId)
        displayName = try c.decode(String.self, forKey: .displayName)
        score = try c.decodeIfPresent(Int.self, forKey: .score)
        displayScore = try c.decodeIfPresent(Int.self, forKey: .displayScore) ?? score
        completed = try c.decodeIfPresent(Bool.self, forKey: .completed) ?? false
        isYou = try c.decodeIfPresent(Bool.self, forKey: .isYou) ?? false
        isHost = try c.decodeIfPresent(Bool.self, forKey: .isHost) ?? false
    }
}

struct VsRankingDTO: Codable, Equatable {
    let userId: String
    let displayName: String
    let score: Int
    let displayScore: Int
}

struct VsResultDTO: Codable, Equatable {
    let allDone: Bool
    let bothDone: Bool
    let winnerUserId: String?
    let winner: String?
    let yourScore: Int?
    let theirScore: Int?
    let rankings: [VsRankingDTO]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let decodedAll = try c.decodeIfPresent(Bool.self, forKey: .allDone)
        let decodedBoth = try c.decodeIfPresent(Bool.self, forKey: .bothDone) ?? false
        allDone = decodedAll ?? decodedBoth
        bothDone = decodedBoth || allDone
        winnerUserId = try c.decodeIfPresent(String.self, forKey: .winnerUserId)
        winner = try c.decodeIfPresent(String.self, forKey: .winner)
        yourScore = try c.decodeIfPresent(Int.self, forKey: .yourScore)
        theirScore = try c.decodeIfPresent(Int.self, forKey: .theirScore)
        rankings = try c.decodeIfPresent([VsRankingDTO].self, forKey: .rankings) ?? []
    }
}

struct VsChallengeDTO: Codable, Equatable {
    let id: String
    let code: String
    let modeId: String
    let modeTitle: String
    let title: String
    let status: String
    let expiresAt: String
    let youAreHost: Bool
    let maxPlayers: Int
    let canStart: Bool
    let players: [VsPlayerDTO]
    let host: VsPlayerDTO
    let guest: VsPlayerDTO?
    let puzzle: JSONValue
    let optimalLineup: [BattleOptimalSlotDTO]?
    let optimalScore: Int?
    let categoryNoun: String
    let result: VsResultDTO
    let live: VsLiveDTO?
    let hotseat: VsHotseatDTO?

    var gameMode: GameModeID? { GameModeID(rawValue: modeId) }
    var isLiveDraft: Bool { modeId == GameModeID.draftMaster.rawValue && live != nil && status == "active" && !result.allDone }
    var isLiveHotseat: Bool { modeId == GameModeID.backYourself.rawValue && hotseat != nil && status == "active" && !result.allDone }
    var isLivePlay: Bool { isLiveDraft || isLiveHotseat }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        code = try c.decode(String.self, forKey: .code)
        modeId = try c.decode(String.self, forKey: .modeId)
        modeTitle = try c.decodeIfPresent(String.self, forKey: .modeTitle) ?? (GameModeID(rawValue: modeId)?.title ?? modeId.uppercased())
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? modeTitle
        status = try c.decode(String.self, forKey: .status)
        expiresAt = try c.decode(String.self, forKey: .expiresAt)
        youAreHost = try c.decode(Bool.self, forKey: .youAreHost)
        maxPlayers = try c.decodeIfPresent(Int.self, forKey: .maxPlayers) ?? 5
        canStart = try c.decodeIfPresent(Bool.self, forKey: .canStart) ?? false
        if let decoded = try c.decodeIfPresent([VsPlayerDTO].self, forKey: .players), !decoded.isEmpty {
            players = decoded
        } else {
            let hostPlayer = try c.decode(VsPlayerDTO.self, forKey: .host)
            let guestPlayer = try c.decodeIfPresent(VsPlayerDTO.self, forKey: .guest)
            players = [hostPlayer] + (guestPlayer.map { [$0] } ?? [])
        }
        host = try c.decodeIfPresent(VsPlayerDTO.self, forKey: .host) ?? players.first { $0.isHost } ?? players[0]
        guest = try c.decodeIfPresent(VsPlayerDTO.self, forKey: .guest) ?? players.first { !$0.isHost }
        puzzle = try c.decode(JSONValue.self, forKey: .puzzle)
        optimalLineup = try c.decodeIfPresent([BattleOptimalSlotDTO].self, forKey: .optimalLineup)
        optimalScore = try c.decodeIfPresent(Int.self, forKey: .optimalScore)
        categoryNoun = try c.decodeIfPresent(String.self, forKey: .categoryNoun) ?? "pts"
        result = try c.decode(VsResultDTO.self, forKey: .result)
        live = try c.decodeIfPresent(VsLiveDTO.self, forKey: .live)
        hotseat = try c.decodeIfPresent(VsHotseatDTO.self, forKey: .hotseat)
    }
}

struct VsHotseatPlayerDTO: Codable, Equatable {
    let userId: String
    let displayName: String
    let isYou: Bool
    let alive: Bool
    let namedCount: Int
}

struct VsHotseatNamedDTO: Codable, Equatable, Identifiable {
    let userId: String
    let displayName: String
    let playerId: String
    let playerName: String
    let headshotUrl: String?

    var id: String { "\(userId)-\(playerId)-\(playerName)" }
}

struct VsHotseatDTO: Codable, Equatable {
    let turnUserId: String
    let yourTurn: Bool
    let deadlineAt: String
    let finished: Bool
    let namedPlayerIds: [String]
    let players: [VsHotseatPlayerDTO]
    let named: [VsHotseatNamedDTO]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        turnUserId = try c.decode(String.self, forKey: .turnUserId)
        yourTurn = try c.decodeIfPresent(Bool.self, forKey: .yourTurn) ?? false
        deadlineAt = try c.decode(String.self, forKey: .deadlineAt)
        finished = try c.decodeIfPresent(Bool.self, forKey: .finished) ?? false
        namedPlayerIds = try c.decodeIfPresent([String].self, forKey: .namedPlayerIds) ?? []
        players = try c.decodeIfPresent([VsHotseatPlayerDTO].self, forKey: .players) ?? []
        named = try c.decodeIfPresent([VsHotseatNamedDTO].self, forKey: .named) ?? []
    }
}

struct VsLiveBoardDTO: Codable, Equatable {
    let userId: String
    let displayName: String
    let isYou: Bool
    let total: Int
    let locked: Bool
    let playerName: String?
    let constraintLabel: String?
    let statValue: Int?
    let headshotUrl: String?
}

struct VsLiveDTO: Codable, Equatable {
    let slotIndex: Int
    let slotCount: Int
    let slotId: String
    let slotLabel: String
    let slotPosition: String
    let deadlineAt: String
    let youLocked: Bool
    let finished: Bool
    let usedConstraintIds: [String]
    let usedPlayerIds: [String]
    let board: [VsLiveBoardDTO]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slotIndex = try c.decode(Int.self, forKey: .slotIndex)
        slotCount = try c.decode(Int.self, forKey: .slotCount)
        slotId = try c.decode(String.self, forKey: .slotId)
        slotLabel = try c.decode(String.self, forKey: .slotLabel)
        slotPosition = try c.decode(String.self, forKey: .slotPosition)
        deadlineAt = try c.decode(String.self, forKey: .deadlineAt)
        youLocked = try c.decodeIfPresent(Bool.self, forKey: .youLocked) ?? false
        finished = try c.decodeIfPresent(Bool.self, forKey: .finished) ?? false
        usedConstraintIds = try c.decodeIfPresent([String].self, forKey: .usedConstraintIds) ?? []
        usedPlayerIds = try c.decodeIfPresent([String].self, forKey: .usedPlayerIds) ?? []
        board = try c.decodeIfPresent([VsLiveBoardDTO].self, forKey: .board) ?? []
    }
}

struct VsPickDTO: Encodable {
    let slotId: String
    let constraintId: String
    let playerId: String
}

struct VsSubmitRequestDTO: Encodable {
    let answer: JSONValue
}
