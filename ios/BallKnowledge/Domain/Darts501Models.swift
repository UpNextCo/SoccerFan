import Foundation

// MARK: - Puzzle

struct Darts501Puzzle: Equatable, Codable {
    let id: String
    let date: String
    let formulaId: String
    let formulaLabel: String
    let startScore: Int
    let checkoutWindow: Int
    let checkoutLives: Int
}

struct Darts501ThrowResultDTO: Codable {
    let valid: Bool
    let duplicate: Bool
    let reason: String?
    let player: Darts501PlayerDTO?
    let score: Int?
    let leftValue: Int?
    let rightValue: Int?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        valid = try c.decodeIfPresent(Bool.self, forKey: .valid) ?? false
        duplicate = try c.decodeIfPresent(Bool.self, forKey: .duplicate) ?? false
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
        player = try c.decodeIfPresent(Darts501PlayerDTO.self, forKey: .player)
        score = try c.decodeIfPresent(Int.self, forKey: .score)
        leftValue = try c.decodeIfPresent(Int.self, forKey: .leftValue)
        rightValue = try c.decodeIfPresent(Int.self, forKey: .rightValue)
    }
}

struct Darts501PlayerDTO: Codable, Equatable {
    let id: String
    let name: String
    let club: String
    let nationality: String
    let position: String
    let headshotUrl: String?

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

// MARK: - Throw history

enum Darts501BustReason: String, Codable, Equatable {
    case impossible
    case over180 = "over_180"
    case checkoutOvershoot = "checkout_overshoot"
}

enum Darts501ThrowKind: String, Codable, Equatable {
    case score
    case bust
    case checkout
    case perfect
    case gameOver = "game_over"
}

struct Darts501Throw: Identifiable, Equatable, Codable {
    var id = UUID()
    let playerId: String
    let playerName: String
    let headshotUrl: String?
    let club: String
    let nationality: String
    let score: Int
    let remainingAfter: Int
    let kind: Darts501ThrowKind
    let bustReason: Darts501BustReason?
    let leftValue: Int?
    let rightValue: Int?
}

// MARK: - State

enum Darts501Phase: String, Codable, Equatable {
    case playing
    case checkout
    case won
    case lost
}

struct Darts501GameState: Equatable, Codable {
    static let progressVersion = 1

    let puzzle: Darts501Puzzle
    var remaining: Int
    var throwHistory: [Darts501Throw]
    var checkoutBusts: Int
    var phase: Darts501Phase

    init(puzzle: Darts501Puzzle) {
        self.puzzle = puzzle
        remaining = puzzle.startScore
        throwHistory = []
        checkoutBusts = 0
        phase = .playing
    }

    var usedPlayerIds: Set<String> {
        Set(throwHistory.map(\.playerId))
    }

    var isResumable: Bool {
        !throwHistory.isEmpty && (phase == .playing || phase == .checkout)
    }

    var isFinished: Bool {
        phase == .won || phase == .lost
    }

    var won: Bool { phase == .won }
    var perfect: Bool { phase == .won && remaining == 0 }

    var highestScore: Int {
        throwHistory.filter { $0.kind != .bust && $0.kind != .gameOver }.map(\.score).max() ?? 0
    }

    var bustCount: Int {
        throwHistory.filter { $0.kind == .bust || $0.kind == .gameOver }.count
    }

    var checkoutRemaining: Int {
        max(0, puzzle.checkoutLives - checkoutBusts)
    }

    var xpEarned: Int {
        Darts501Scoring.xp(
            won: won,
            perfect: perfect,
            throwCount: throwHistory.count,
            busts: bustCount
        )
    }

    func answerPayload() -> JSONValue {
        .object([
            "playerIds": .array(throwHistory.map { .string($0.playerId) }),
        ])
    }
}

// MARK: - Rules

enum Darts501Scoring {
    static let startScore = 501
    static let checkoutThreshold = 180
    static let checkoutWindow = 10
    static let checkoutLives = 3
    static let impossibleScores: Set<Int> = [163, 166, 169, 172, 173, 175, 176, 178, 179]

    static func isValidDartsScore(_ score: Int) -> Bool {
        score >= 0 && score <= 180 && !impossibleScores.contains(score)
    }

    static func bustReason(for score: Int) -> Darts501BustReason? {
        if score > 180 { return .over180 }
        if impossibleScores.contains(score) { return .impossible }
        return nil
    }

    static func isCheckoutRemaining(_ remaining: Int) -> Bool {
        remaining <= checkoutThreshold
    }

    static func isSuccessfulCheckout(_ nextRemaining: Int) -> Bool {
        nextRemaining <= 0 && nextRemaining >= -checkoutWindow
    }

    struct Resolution: Equatable {
        let kind: Darts501ThrowKind
        let remaining: Int
        let inCheckout: Bool
        let checkoutBusts: Int
        let bustReason: Darts501BustReason?
    }

    static func resolve(
        remaining: Int,
        score: Int,
        inCheckout: Bool,
        checkoutBusts: Int
    ) -> Resolution {
        let checkout = inCheckout || isCheckoutRemaining(remaining)
        if let reason = bustReason(for: score) {
            let nextBusts = checkout ? checkoutBusts + 1 : checkoutBusts
            if checkout && nextBusts >= checkoutLives {
                return Resolution(
                    kind: .gameOver,
                    remaining: remaining,
                    inCheckout: true,
                    checkoutBusts: nextBusts,
                    bustReason: reason
                )
            }
            return Resolution(
                kind: .bust,
                remaining: remaining,
                inCheckout: checkout,
                checkoutBusts: nextBusts,
                bustReason: reason
            )
        }

        let nextRemaining = remaining - score
        if isSuccessfulCheckout(nextRemaining) {
            return Resolution(
                kind: nextRemaining == 0 ? .perfect : .checkout,
                remaining: nextRemaining,
                inCheckout: true,
                checkoutBusts: checkoutBusts,
                bustReason: nil
            )
        }

        if checkout && nextRemaining < -checkoutWindow {
            let nextBusts = checkoutBusts + 1
            if nextBusts >= checkoutLives {
                return Resolution(
                    kind: .gameOver,
                    remaining: remaining,
                    inCheckout: true,
                    checkoutBusts: nextBusts,
                    bustReason: .checkoutOvershoot
                )
            }
            return Resolution(
                kind: .bust,
                remaining: remaining,
                inCheckout: true,
                checkoutBusts: nextBusts,
                bustReason: .checkoutOvershoot
            )
        }

        return Resolution(
            kind: .score,
            remaining: nextRemaining,
            inCheckout: isCheckoutRemaining(nextRemaining),
            checkoutBusts: checkoutBusts,
            bustReason: nil
        )
    }

    static func xp(won: Bool, perfect: Bool, throwCount: Int, busts: Int) -> Int {
        DailyXP.darts501(won: won, perfect: perfect, throwCount: throwCount, busts: busts)
    }
}
