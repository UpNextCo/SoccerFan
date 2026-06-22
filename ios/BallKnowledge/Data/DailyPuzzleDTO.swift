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

enum DailyPuzzleDTO: Codable, Equatable {
    case guessWho(GuessWhoPuzzleDTO)
    case targetMan(TargetManPuzzleDTO)
    case blindRank(BlindRankPuzzleDTO)

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
        }
    }

    var modeId: String {
        switch self {
        case .guessWho: return GameModeID.guessWho.rawValue
        case .targetMan: return GameModeID.targetMan.rawValue
        case .blindRank: return GameModeID.blindRank.rawValue
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
    let games: [DailyGameDTO]
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
}
