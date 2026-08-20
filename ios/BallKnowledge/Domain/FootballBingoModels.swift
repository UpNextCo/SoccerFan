import Foundation

enum FootballBingoStatus: Equatable, Codable {
    case active
    case won
    case lost
}

enum FootballBingoCategoryType: String, Codable {
    case nationality
    case playedForClub
    case nationClub
    case clubCombo
    case playedInLeague
    case clubLeague
    case nationLeague
    case wonCompetition
    case award
    case playedWithPlayer
    case managedByManager
    case statThreshold
    case position
}

enum FootballBingoIconType: String, Codable {
    case flag
    case clubBadge
    case nationClub
    case clubCombo
    case clubLeague
    case nationLeague
    case trophy
    case league
    case award
    case custom
}

struct FootballBingoCategory: Identifiable, Equatable, Codable {
    let id: String
    let title: String
    let type: FootballBingoCategoryType
    let iconType: FootballBingoIconType
    let iconValue: String
    let matchingRule: String
    var logoUrl: String? = nil
    var teamId: Int? = nil
    var logo2Url: String? = nil
    var team2Id: Int? = nil
    var flag: String? = nil
}

struct FootballBingoPlayer: Identifiable, Equatable, Codable {
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
    var headshotUrl: String? = nil
    var awards: [String] = []
    var stats: [String: Int] = [:]
}

struct FootballBingoGame: Equatable, Codable {
    let id: String
    let title: String
    var categories: [FootballBingoCategory]
    var playerQueue: [FootballBingoPlayer]
    var currentPlayerIndex: Int
    var completedCategoryIds: Set<String>
    /// Successful placements in order — used for server score recompute.
    var placements: [FootballBingoPlacement]
    var remainingPlayers: Int
    var status: FootballBingoStatus

    var currentPlayer: FootballBingoPlayer? {
        guard currentPlayerIndex < playerQueue.count else { return nil }
        return playerQueue[currentPlayerIndex]
    }

    var completedCount: Int { completedCategoryIds.count }

    var isActive: Bool { status == .active }

    mutating func markCompleted(categoryId: String, playerId: String) {
        completedCategoryIds.insert(categoryId)
        placements.append(FootballBingoPlacement(playerId: playerId, categoryId: categoryId))
    }

    mutating func advance(by steps: Int) {
        currentPlayerIndex += steps
        remainingPlayers = max(0, remainingPlayers - steps)

        if completedCategoryIds.count == categories.count {
            status = .won
        } else if remainingPlayers <= 0 || currentPlayerIndex >= playerQueue.count {
            status = .lost
        }
    }

    func answerPayload() -> JSONValue {
        .object([
            "placements": .array(placements.map {
                .object([
                    "playerId": .string($0.playerId),
                    "categoryId": .string($0.categoryId),
                ])
            }),
            "remainingPlayers": .int(remainingPlayers),
            "queueSize": .int(playerQueue.count),
            "won": .bool(status == .won),
        ])
    }
}

struct FootballBingoPlacement: Equatable, Codable {
    let playerId: String
    let categoryId: String
}

/// Persisted snapshot for resume: the board plus the one-shot wildcard flag (which lives on the VM).
struct FootballBingoProgress: Equatable, Codable {
    static let progressVersion = 2
    var game: FootballBingoGame
    var wildcardUsed: Bool
}

enum FootballBingoTiming {
    static let tilePop: Double = 0.32
    static let tileShake: Double = 0.45
    static let playerSlide: Double = 0.35
    static let confettiDuration: Double = 2.4
    static let resultDelay: Double = 0.5
    static let turnDuration: TimeInterval = 10
    static let greenBurst: Double = 0.38
    static let wrongFlashIn: Double = 0.1
    static let wrongFlashOut: Double = 0.35
}
