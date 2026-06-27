import Foundation

struct TargetManPuzzleDTO: Codable, Equatable {
    let modeId: String
    let puzzleId: String
    let date: String
    let categoryId: String
    let categoryLabel: String
    let valueNoun: String
    let offNoun: String
    let unit: String?
    let target: Int
    let title: String

    enum CodingKeys: String, CodingKey {
        case modeId, puzzleId, date, categoryId, categoryLabel, valueNoun, offNoun, unit, target, title
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        modeId = try c.decode(String.self, forKey: .modeId)
        puzzleId = try c.decode(String.self, forKey: .puzzleId)
        date = try c.decode(String.self, forKey: .date)
        categoryId = try c.decodeIfPresent(String.self, forKey: .categoryId) ?? ""
        categoryLabel = try c.decodeIfPresent(String.self, forKey: .categoryLabel) ?? ""
        valueNoun = try c.decodeIfPresent(String.self, forKey: .valueNoun) ?? "goals"
        offNoun = try c.decodeIfPresent(String.self, forKey: .offNoun) ?? "\(valueNoun) off"
        unit = try c.decodeIfPresent(String.self, forKey: .unit)
        target = try c.decodeIfPresent(Int.self, forKey: .target) ?? 0
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? categoryLabel
    }
}

struct BlindRankPresentationPlayerDTO: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let club: String
    let clubs: String
    let league: String
    let nationality: String
    let position: String
    let statValue: Int

    init(
        id: String,
        name: String,
        club: String,
        clubs: String = "",
        league: String,
        nationality: String,
        position: String,
        statValue: Int
    ) {
        self.id = id
        self.name = name
        self.club = club
        self.clubs = clubs
        self.league = league
        self.nationality = nationality
        self.position = position
        self.statValue = statValue
    }

    // Tolerate older puzzles that predate embedded stats so a stale row never
    // crashes the whole daily-bundle decode (the resolver falls back instead).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        club = try c.decode(String.self, forKey: .club)
        clubs = try c.decodeIfPresent(String.self, forKey: .clubs) ?? ""
        league = try c.decode(String.self, forKey: .league)
        nationality = try c.decode(String.self, forKey: .nationality)
        position = try c.decode(String.self, forKey: .position)
        statValue = try c.decodeIfPresent(Int.self, forKey: .statValue) ?? 0
    }
}

struct BlindRankPuzzleDTO: Codable, Equatable {
    let modeId: String
    let puzzleId: String
    let date: String
    let category: String
    let themeTitle: String
    let categoryTitle: String
    let subtitle: String
    let rankHint: String
    let valueNoun: String
    let valuePrefix: String
    let presentationOrder: [BlindRankPresentationPlayerDTO]

    init(
        modeId: String,
        puzzleId: String,
        date: String,
        category: String,
        themeTitle: String = "",
        categoryTitle: String,
        subtitle: String = "",
        rankHint: String,
        valueNoun: String,
        valuePrefix: String,
        presentationOrder: [BlindRankPresentationPlayerDTO]
    ) {
        self.modeId = modeId
        self.puzzleId = puzzleId
        self.date = date
        self.category = category
        self.themeTitle = themeTitle
        self.categoryTitle = categoryTitle
        self.subtitle = subtitle
        self.rankHint = rankHint
        self.valueNoun = valueNoun
        self.valuePrefix = valuePrefix
        self.presentationOrder = presentationOrder
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        modeId = try c.decode(String.self, forKey: .modeId)
        puzzleId = try c.decode(String.self, forKey: .puzzleId)
        date = try c.decode(String.self, forKey: .date)
        category = try c.decode(String.self, forKey: .category)
        themeTitle = try c.decodeIfPresent(String.self, forKey: .themeTitle) ?? ""
        categoryTitle = try c.decodeIfPresent(String.self, forKey: .categoryTitle) ?? ""
        subtitle = try c.decodeIfPresent(String.self, forKey: .subtitle) ?? ""
        rankHint = try c.decodeIfPresent(String.self, forKey: .rankHint) ?? "Most → least"
        valueNoun = try c.decodeIfPresent(String.self, forKey: .valueNoun) ?? ""
        valuePrefix = try c.decodeIfPresent(String.self, forKey: .valuePrefix) ?? ""
        presentationOrder = try c.decode([BlindRankPresentationPlayerDTO].self, forKey: .presentationOrder)
    }
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
    let position: String
    let clubs: [String]
    let leagues: [String]
    let trophies: [String]
    let teammates: [String]
    let managers: [String]
    let premierLeagueApps: Int?
    let topLeagueGoals: Int?
    let topLeagueApps: Int?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        nationality = try c.decode(String.self, forKey: .nationality)
        position = try c.decodeIfPresent(String.self, forKey: .position) ?? ""
        clubs = try c.decodeIfPresent([String].self, forKey: .clubs) ?? []
        leagues = try c.decodeIfPresent([String].self, forKey: .leagues) ?? []
        trophies = try c.decodeIfPresent([String].self, forKey: .trophies) ?? []
        teammates = try c.decodeIfPresent([String].self, forKey: .teammates) ?? []
        managers = try c.decodeIfPresent([String].self, forKey: .managers) ?? []
        premierLeagueApps = try c.decodeIfPresent(Int.self, forKey: .premierLeagueApps)
        topLeagueGoals = try c.decodeIfPresent(Int.self, forKey: .topLeagueGoals)
        topLeagueApps = try c.decodeIfPresent(Int.self, forKey: .topLeagueApps)
    }
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

struct OneMoreOptionDTO: Codable, Equatable {
    let id: String
    let name: String
    let clubs: String
    let position: String
    let value: Int

    init(id: String, name: String, clubs: String = "", position: String = "", value: Int) {
        self.id = id; self.name = name; self.clubs = clubs; self.position = position; self.value = value
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        clubs = try c.decodeIfPresent(String.self, forKey: .clubs) ?? ""
        position = try c.decodeIfPresent(String.self, forKey: .position) ?? ""
        value = try c.decodeIfPresent(Int.self, forKey: .value) ?? 0
    }
}

struct OneMoreRoundDTO: Codable, Equatable {
    let options: [OneMoreOptionDTO]
}

struct OneMorePuzzleDTO: Codable, Equatable {
    let modeId: String
    let puzzleId: String
    let date: String
    let title: String
    let valueNoun: String
    let minimum: Int
    let rounds: [OneMoreRoundDTO]

    init(
        modeId: String, puzzleId: String, date: String, title: String,
        valueNoun: String, minimum: Int, rounds: [OneMoreRoundDTO] = []
    ) {
        self.modeId = modeId; self.puzzleId = puzzleId; self.date = date; self.title = title
        self.valueNoun = valueNoun; self.minimum = minimum; self.rounds = rounds
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        modeId = try c.decode(String.self, forKey: .modeId)
        puzzleId = try c.decode(String.self, forKey: .puzzleId)
        date = try c.decode(String.self, forKey: .date)
        title = try c.decode(String.self, forKey: .title)
        valueNoun = try c.decodeIfPresent(String.self, forKey: .valueNoun) ?? "goals"
        minimum = try c.decode(Int.self, forKey: .minimum)
        rounds = try c.decodeIfPresent([OneMoreRoundDTO].self, forKey: .rounds) ?? []
    }
}

struct FootballGolfAnswerDTO: Codable, Equatable {
    let id: String
    let name: String
    let aliases: [String]
    let rarity: String
}

struct FootballGolfHoleDTO: Codable, Equatable {
    let id: String
    let holeNumber: Int
    let par: Int
    let prompt: String
    let category: String
    let answers: [FootballGolfAnswerDTO]
    let hints: [String]
}

struct FootballGolfPuzzleDTO: Codable, Equatable {
    let modeId: String
    let puzzleId: String
    let date: String
    let title: String
    let totalPar: Int
    let holes: [FootballGolfHoleDTO]
}

struct WorldCupXISlotDTO: Codable, Equatable {
    let id: String
    let label: String
    let x: Double
    let y: Double
    let expectedName: String
    let clues: [String]
}

struct WorldCupXIPuzzleDTO: Codable, Equatable {
    let modeId: String
    let puzzleId: String
    let date: String
    let title: String
    let formation: String
    let slots: [WorldCupXISlotDTO]

    enum CodingKeys: String, CodingKey { case modeId, puzzleId, date, title, formation, slots }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        modeId = try c.decode(String.self, forKey: .modeId)
        puzzleId = try c.decode(String.self, forKey: .puzzleId)
        date = try c.decode(String.self, forKey: .date)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? "Name the World Cup XI"
        formation = try c.decodeIfPresent(String.self, forKey: .formation) ?? "4-3-3"
        slots = try c.decode([WorldCupXISlotDTO].self, forKey: .slots)
    }
}

struct DraftMasterOpponentPlayerDTO: Codable, Equatable {
    let name: String
    let bucket: String
    let valueEur: Double
}

struct DraftMasterOpponentDTO: Codable, Equatable {
    let name: String
    let players: [DraftMasterOpponentPlayerDTO]
}

struct DraftMasterScenarioDTO: Codable, Equatable {
    let id: String
    let title: String
    let subtitle: String
    let narrative: String
    let competition: String
    let budgetEur: Double
    let opponent: DraftMasterOpponentDTO
}

struct DraftMasterPuzzleDTO: Codable, Equatable {
    let modeId: String
    let puzzleId: String
    let date: String
    let scenario: DraftMasterScenarioDTO
    let formationId: String
}

enum DailyPuzzleDTO: Codable, Equatable {
    case guessWho(GuessWhoPuzzleDTO)
    case targetMan(TargetManPuzzleDTO)
    case blindRank(BlindRankPuzzleDTO)
    case footballBingo(FootballBingoPuzzleDTO)
    case footballTower(FootballTowerPuzzleDTO)
    case footballGolf(FootballGolfPuzzleDTO)
    case oneMore(OneMorePuzzleDTO)
    case worldCupXI(WorldCupXIPuzzleDTO)
    case draftMaster(DraftMasterPuzzleDTO)

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
        case GameModeID.footballGolf.rawValue:
            self = .footballGolf(try FootballGolfPuzzleDTO(from: decoder))
        case GameModeID.oneMore.rawValue:
            self = .oneMore(try OneMorePuzzleDTO(from: decoder))
        case GameModeID.worldCupXI.rawValue:
            self = .worldCupXI(try WorldCupXIPuzzleDTO(from: decoder))
        case GameModeID.draftMaster.rawValue:
            self = .draftMaster(try DraftMasterPuzzleDTO(from: decoder))
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
        case .footballGolf(let puzzle):
            try puzzle.encode(to: encoder)
        case .oneMore(let puzzle):
            try puzzle.encode(to: encoder)
        case .worldCupXI(let puzzle):
            try puzzle.encode(to: encoder)
        case .draftMaster(let puzzle):
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
        case .footballGolf: return GameModeID.footballGolf.rawValue
        case .oneMore: return GameModeID.oneMore.rawValue
        case .worldCupXI: return GameModeID.worldCupXI.rawValue
        case .draftMaster: return GameModeID.draftMaster.rawValue
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

    var footballGolfPuzzle: FootballGolfPuzzleDTO? {
        guard case .footballGolf(let puzzle) = game(for: .footballGolf)?.puzzle else { return nil }
        return puzzle
    }

    var oneMorePuzzle: OneMorePuzzleDTO? {
        guard case .oneMore(let puzzle) = game(for: .oneMore)?.puzzle else { return nil }
        return puzzle
    }

    var worldCupXIPuzzle: WorldCupXIPuzzleDTO? {
        guard case .worldCupXI(let puzzle) = game(for: .worldCupXI)?.puzzle else { return nil }
        return puzzle
    }

    var draftMasterPuzzle: DraftMasterPuzzleDTO? {
        guard case .draftMaster(let puzzle) = game(for: .draftMaster)?.puzzle else { return nil }
        return puzzle
    }
}
