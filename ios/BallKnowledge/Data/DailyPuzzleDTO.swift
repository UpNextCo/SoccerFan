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
    let headshotUrl: String?

    init(
        id: String,
        name: String,
        club: String,
        clubs: String = "",
        league: String,
        nationality: String,
        position: String,
        statValue: Int,
        headshotUrl: String? = nil
    ) {
        self.id = id
        self.name = name
        self.club = club
        self.clubs = clubs
        self.league = league
        self.nationality = nationality
        self.position = position
        self.statValue = statValue
        self.headshotUrl = headshotUrl
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
        headshotUrl = try c.decodeIfPresent(String.self, forKey: .headshotUrl)
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
    let logoUrl: String?
    let teamId: Int?
    let logo2Url: String?
    let team2Id: Int?
    let flag: String?
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
    let headshotUrl: String?
    let awards: [String]
    let stats: [String: Int]

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
        headshotUrl = try c.decodeIfPresent(String.self, forKey: .headshotUrl)
        awards = try c.decodeIfPresent([String].self, forKey: .awards) ?? []
        stats = try c.decodeIfPresent([String: Int].self, forKey: .stats) ?? [:]
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
    let nationality: String
    let value: Int
    let headshotUrl: String?
    let teamId: Int?
    let teamLogoUrl: String?

    init(id: String, name: String, clubs: String = "", position: String = "", nationality: String = "", value: Int, headshotUrl: String? = nil, teamId: Int? = nil, teamLogoUrl: String? = nil) {
        self.id = id; self.name = name; self.clubs = clubs; self.position = position; self.nationality = nationality; self.value = value
        self.headshotUrl = headshotUrl; self.teamId = teamId; self.teamLogoUrl = teamLogoUrl
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        clubs = try c.decodeIfPresent(String.self, forKey: .clubs) ?? ""
        position = try c.decodeIfPresent(String.self, forKey: .position) ?? ""
        nationality = try c.decodeIfPresent(String.self, forKey: .nationality) ?? ""
        value = try c.decodeIfPresent(Int.self, forKey: .value) ?? 0
        headshotUrl = try c.decodeIfPresent(String.self, forKey: .headshotUrl)
        teamId = try c.decodeIfPresent(Int.self, forKey: .teamId)
        teamLogoUrl = try c.decodeIfPresent(String.self, forKey: .teamLogoUrl)
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
    let target: Int?
    let prompt: String
    let category: String
    let answers: [FootballGolfAnswerDTO]
    let hints: [String]

    /// Older puzzles omit `target`; derive from stroke par.
    var resolvedTarget: Int { target ?? par * 2 }
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
    let year: Int?
    let club: String?
    let clubBadgeUrl: String?
    let nation: String?

    enum CodingKeys: String, CodingKey {
        case id, label, x, y, expectedName, clues, year, club, clubBadgeUrl, nation
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        label = try c.decode(String.self, forKey: .label)
        x = try c.decode(Double.self, forKey: .x)
        y = try c.decode(Double.self, forKey: .y)
        expectedName = try c.decode(String.self, forKey: .expectedName)
        clues = try c.decodeIfPresent([String].self, forKey: .clues) ?? []
        year = try c.decodeIfPresent(Int.self, forKey: .year)
        club = try c.decodeIfPresent(String.self, forKey: .club)
        clubBadgeUrl = try c.decodeIfPresent(String.self, forKey: .clubBadgeUrl)
        nation = try c.decodeIfPresent(String.self, forKey: .nation)
    }
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

struct BattleCategoryDTO: Codable, Equatable {
    let id: String
    let title: String
    let noun: String
    let unit: String?
}

struct BattleSlotDTO: Codable, Equatable {
    let id: String
    let position: String
}

struct BattleConstraintDTO: Codable, Equatable {
    let id: String
    let type: String
    let label: String
    let club: String?
    let teamId: Int?
    let logoUrl: String?
    let leagueId: Int?
    let leagueName: String?
    let nationality: String?
}

struct BattleOptimalSlotDTO: Codable, Equatable {
    let slotId: String
    let position: String
    let constraintId: String
    let constraintLabel: String
    let playerName: String
    let statValue: Int
}

struct DraftMasterPuzzleDTO: Codable, Equatable {
    let modeId: String
    let puzzleId: String
    let date: String
    let category: BattleCategoryDTO
    let formationId: String
    let slots: [BattleSlotDTO]
    let constraints: [BattleConstraintDTO]
    let optimalScore: Int
    let optimalLineup: [BattleOptimalSlotDTO]?
}

/// One result from the Battle player search (`POST /daily/battle/players`).
struct BattlePlayerDTO: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let statValue: Int
    let nationality: String?
    let satisfiesConstraint: Bool?
    let headshotUrl: String?
}

struct ClubChainPlayerDTO: Codable, Equatable {
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

struct ClubChainPuzzleDTO: Codable, Equatable {
    let modeId: String
    let puzzleId: String
    let date: String
    let difficulty: String
    let start: ClubChainPlayerDTO
    let target: ClubChainPlayerDTO
    let shortestPathLength: Int
    let maxMoves: Int
    let mistakesAllowed: Int

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        modeId = try c.decode(String.self, forKey: .modeId)
        puzzleId = try c.decode(String.self, forKey: .puzzleId)
        date = try c.decode(String.self, forKey: .date)
        difficulty = try c.decodeIfPresent(String.self, forKey: .difficulty) ?? "medium"
        start = try c.decode(ClubChainPlayerDTO.self, forKey: .start)
        target = try c.decode(ClubChainPlayerDTO.self, forKey: .target)
        shortestPathLength = try c.decodeIfPresent(Int.self, forKey: .shortestPathLength) ?? 2
        maxMoves = try c.decodeIfPresent(Int.self, forKey: .maxMoves) ?? (shortestPathLength + 4)
        mistakesAllowed = try c.decodeIfPresent(Int.self, forKey: .mistakesAllowed) ?? 3
    }
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
    case clubChain(ClubChainPuzzleDTO)

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
        case GameModeID.clubChain.rawValue:
            self = .clubChain(try ClubChainPuzzleDTO(from: decoder))
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
        case .clubChain(let puzzle):
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
        case .clubChain: return GameModeID.clubChain.rawValue
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
        // Lenient: a single game whose puzzle we can't decode (e.g. a puzzle stored in an older shape
        // after a schema change) must NOT nuke the whole bundle — that would leave every game tile
        // dead. Skip the bad game; the rest still open, and the affected mode shows "unavailable".
        games = (try container.decodeIfPresent([LossyDailyGame].self, forKey: .games) ?? [])
            .compactMap(\.game)
    }

    private enum CodingKeys: String, CodingKey {
        case date
        case alreadyPlayed
        case completedModeIds
        case games
    }
}

/// Decodes a `DailyGameDTO` without throwing: a malformed element becomes `nil` and is dropped,
/// so one bad puzzle can't fail the entire daily-bundle decode.
private struct LossyDailyGame: Decodable {
    let game: DailyGameDTO?
    init(from decoder: Decoder) throws {
        game = try? DailyGameDTO(from: decoder)
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

    var clubChainPuzzle: ClubChainPuzzleDTO? {
        guard case .clubChain(let puzzle) = game(for: .clubChain)?.puzzle else { return nil }
        return puzzle
    }
}
