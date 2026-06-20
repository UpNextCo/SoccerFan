import Foundation

struct BlindRankPlayer: Identifiable, Equatable {
    let id: String
    let name: String
    let club: String
    let league: String
    let nationality: String
    let position: String
    let statValue: Int

    var searchDTO: PlayerSearchResultDTO {
        PlayerSearchResultDTO(
            id: id,
            name: name,
            club: club,
            league: league,
            nationality: nationality,
            position: position
        )
    }
}

struct BlindRankChallenge: Equatable {
    let id: String
    let league: TargetManLeague
    let category: TargetManStatCategory
    let presentationOrder: [BlindRankPlayer]
    let correctRanking: [String]
    let isDaily: Bool
    let date: String?

    var categoryTitle: String {
        "\(league.rawValue) \(category.label)"
    }

    var rankHint: String {
        "Most \(category.label.lowercased()) → least"
    }
}

enum BlindRankPhase: Equatable {
    case ranking
    case revealing
    case complete
}

struct BlindRankGameState: Equatable {
    let challenge: BlindRankChallenge
    var phase: BlindRankPhase
    var currentPlayerIndex: Int
    var slots: [BlindRankPlayer?]
    var revealedSlotCount: Int
    var score: Int?
    var exactMatches: Int?

    static let slotCount = 10

    init(challenge: BlindRankChallenge) {
        self.challenge = challenge
        phase = .ranking
        currentPlayerIndex = 0
        slots = Array(repeating: nil, count: Self.slotCount)
        revealedSlotCount = 0
        score = nil
        exactMatches = nil
    }

    var isBoardFull: Bool {
        slots.allSatisfy { $0 != nil }
    }

    var currentPlayer: BlindRankPlayer? {
        guard phase == .ranking,
              challenge.presentationOrder.indices.contains(currentPlayerIndex) else { return nil }
        return challenge.presentationOrder[currentPlayerIndex]
    }

    var playersRemaining: Int {
        max(0, challenge.presentationOrder.count - currentPlayerIndex)
    }

    var categoryRevealed: Bool {
        phase != .ranking
    }
}

enum BlindRankScoring {
    static func exactMatches(slots: [BlindRankPlayer?], correctRanking: [String]) -> Int {
        zip(slots, correctRanking).reduce(0) { count, pair in
            count + (pair.0?.id == pair.1 ? 1 : 0)
        }
    }

    static func points(forExactMatches matches: Int) -> Int {
        switch matches {
        case 10: return 1000
        case 8...9: return 800
        case 6...7: return 600
        case 4...5: return 400
        case 2...3: return 200
        default: return 50
        }
    }

    static func xp(from score: Int) -> Int {
        max(10, score / 5)
    }

    static func tierLabel(forExactMatches matches: Int) -> String {
        switch matches {
        case 10: return "Perfect ranking"
        case 8...9: return "Elite knowledge"
        case 6...7: return "Solid effort"
        case 4...5: return "Room to improve"
        case 2...3: return "Tough category"
        default: return "Better luck next time"
        }
    }
}

enum BlindRankTiming {
    static let revealStagger: Double = 0.18
    static let categoryRevealDelay: Double = 0.35
    static let resultDelay: Double = 2.2
}
