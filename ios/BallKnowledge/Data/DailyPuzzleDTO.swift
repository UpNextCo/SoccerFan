import Foundation

struct TargetManPuzzleDTO: Codable, Equatable {
    let modeId: String
    let puzzleId: String
    let date: String
    let league: String
    let leagueId: Int
    let category: String
    let categoryLabel: String
    let target: Int
    let title: String
}

struct BlindRankPresentationPlayerDTO: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let club: String
    let league: String
    let nationality: String
    let position: String
}

struct BlindRankPuzzleDTO: Codable, Equatable {
    let modeId: String
    let puzzleId: String
    let date: String
    let category: String
    let categoryTitle: String
    let rankHint: String
    let presentationOrder: [BlindRankPresentationPlayerDTO]
}

struct FootballBingoCategoryDTO: Codable, Equatable {
    let id: String
    let title: String
    let type: String
    let iconType: String
    let iconValue: String
    let matchingRule: String
}

struct FootballBingoPlayerDTO: Codable, Equatable {
    let id: String
    let name: String
    let nationality: String
    let clubs: [String]
    let leagues: [String]
    let trophies: [String]
    let teammates: [String]
    let managers: [String]
    let premierLeagueApps: Int?
}

struct FootballBingoPuzzleDTO: Codable, Equatable {
    let modeId: String
    let puzzleId: String
    let date: String
    let title: String
    let categories: [FootballBingoCategoryDTO]
    let players: [FootballBingoPlayerDTO]
}

struct FootballTowerFloorDTO: Codable, Equatable {
    let floor: Int
    let difficulty: String
    let prompt: String
    let answerType: String
}

struct FootballTowerPuzzleDTO: Codable, Equatable {
    let modeId: String
    let puzzleId: String
    let date: String
    let title: String
    let floors: [FootballTowerFloorDTO]
}

enum DailyPuzzleDTO: Codable, Equatable {
    case guessWho(GuessWhoPuzzleDTO)
    case targetMan(TargetManPuzzleDTO)
    case blindRank(BlindRankPuzzleDTO)
    case footballBingo(FootballBingoPuzzleDTO)
    case footballTower(FootballTowerPuzzleDTO)

    private enum CodingKeys: String, CodingKey {
        case modeId
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let modeId = try container.decode(String.self, forKey: .modeId)

        switch modeId {
        case GameModeID.guessWho.rawValue:
            self = .guessWho(try GuessWhoPuzzleDTO(from: decoder))
        case GameModeID.targetMan.rawValue:
            self = .targetMan(try TargetManPuzzleDTO(from: decoder))
        case GameModeID.blindRank.rawValue:
            self = .blindRank(try BlindRankPuzzleDTO(from: decoder))
        case GameModeID.footballBingo.rawValue:
            self = .footballBingo(try FootballBingoPuzzleDTO(from: decoder))
        case GameModeID.footballTower.rawValue:
            self = .footballTower(try FootballTowerPuzzleDTO(from: decoder))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .modeId,
                in: container,
                debugDescription: "Unsupported daily puzzle mode: \(modeId)"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .guessWho(let puzzle):
            try puzzle.encode(to: encoder)
        case .targetMan(let puzzle):
            try puzzle.encode(to: encoder)
        case .blindRank(let puzzle):
            try puzzle.encode(to: encoder)
        case .footballBingo(let puzzle):
            try puzzle.encode(to: encoder)
        case .footballTower(let puzzle):
            try puzzle.encode(to: encoder)
        }
    }

    var modeId: String {
        switch self {
        case .guessWho: return GameModeID.guessWho.rawValue
        case .targetMan: return GameModeID.targetMan.rawValue
        case .blindRank: return GameModeID.blindRank.rawValue
        case .footballBingo: return GameModeID.footballBingo.rawValue
        case .footballTower: return GameModeID.footballTower.rawValue
        }
    }
}

struct DailyGameDTO: Codable, Identifiable, Equatable {
    var id: String { modeId }
    let modeId: String
    let title: String
    let puzzle: DailyPuzzleDTO
}

struct DailyBundleDTO: Codable, Equatable {
    let date: String
    let alreadyPlayed: Bool
    let completedModeIds: [String]
    let games: [DailyGameDTO]

    init(
        date: String,
        alreadyPlayed: Bool,
        completedModeIds: [String] = [],
        games: [DailyGameDTO]
    ) {
        self.date = date
        self.alreadyPlayed = alreadyPlayed
        self.completedModeIds = completedModeIds
        self.games = games
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        date = try container.decode(String.self, forKey: .date)
        alreadyPlayed = try container.decode(Bool.self, forKey: .alreadyPlayed)
        completedModeIds = try container.decodeIfPresent([String].self, forKey: .completedModeIds) ?? []
        games = try container.decode([DailyGameDTO].self, forKey: .games)
    }

    private enum CodingKeys: String, CodingKey {
        case date
        case alreadyPlayed
        case completedModeIds
        case games
    }
}

extension DailyBundleDTO {
    func game(for mode: GameModeID) -> DailyGameDTO? {
        games.first { GameModeCatalog.normalizedModeId($0.modeId) == mode.rawValue }
    }

    var guessWhoPuzzle: GuessWhoPuzzleDTO? {
        guard case .guessWho(let puzzle) = game(for: .guessWho)?.puzzle else { return nil }
        return puzzle
    }

    var targetManPuzzle: TargetManPuzzleDTO? {
        guard case .targetMan(let puzzle) = game(for: .targetMan)?.puzzle else { return nil }
        return puzzle
    }

    var blindRankPuzzle: BlindRankPuzzleDTO? {
        guard case .blindRank(let puzzle) = game(for: .blindRank)?.puzzle else { return nil }
        return puzzle
    }

    var footballBingoPuzzle: FootballBingoPuzzleDTO? {
        guard case .footballBingo(let puzzle) = game(for: .footballBingo)?.puzzle else { return nil }
        return puzzle
    }

    var footballTowerPuzzle: FootballTowerPuzzleDTO? {
        guard case .footballTower(let puzzle) = game(for: .footballTower)?.puzzle else { return nil }
        return puzzle
    }
}
