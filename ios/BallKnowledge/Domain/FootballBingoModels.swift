import Foundation

enum FootballBingoStatus: Equatable {
    case active
    case won
    case lost
}

enum FootballBingoCategoryType: String, Codable {
    case nationality
    case playedForClub
    case playedInLeague
    case wonCompetition
    case playedWithPlayer
    case managedByManager
    case statThreshold
}

enum FootballBingoIconType: String, Codable {
    case flag
    case clubBadge
    case trophy
    case league
    case custom
}

struct FootballBingoCategory: Identifiable, Equatable {
    let id: String
    let title: String
    let type: FootballBingoCategoryType
    let iconType: FootballBingoIconType
    let iconValue: String
    let matchingRule: String
}

struct FootballBingoPlayer: Identifiable, Equatable {
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

struct FootballBingoGame: Equatable {
    let id: String
    let title: String
    var categories: [FootballBingoCategory]
    var playerQueue: [FootballBingoPlayer]
    var currentPlayerIndex: Int
    var completedCategoryIds: Set<String>
    var remainingPlayers: Int
    var status: FootballBingoStatus

    var currentPlayer: FootballBingoPlayer? {
        guard currentPlayerIndex < playerQueue.count else { return nil }
        return playerQueue[currentPlayerIndex]
    }

    var completedCount: Int { completedCategoryIds.count }

    var isActive: Bool { status == .active }

    mutating func markCompleted(categoryId: String) {
        completedCategoryIds.insert(categoryId)
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
