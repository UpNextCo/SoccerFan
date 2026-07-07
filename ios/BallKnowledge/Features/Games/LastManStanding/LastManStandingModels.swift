import Foundation
import SwiftUI

// MARK: - Curve & layout

struct LMSRoundStep: Equatable, Codable {
    let afterCorrectCount: Int
    let remaining: Int
    let label: String
    let commentary: String?
}

struct LMSLayoutProfile: Equatable {
    let iconSize: CGFloat
    let spacing: CGFloat
    let minColumns: Int
    let maxHeight: CGFloat
    let spotlight: Bool
}

enum LMSGameStatus: String, Codable {
    case intro
    case question
    case correctReveal
    case eliminating
    case lost
    case won
}

// MARK: - Questions

struct LMSOption: Identifiable, Equatable, Codable {
    let id: String
    let label: String
}

struct LMSQuestion: Identifiable, Equatable, Codable {
    let id: String
    let prompt: String
    let options: [LMSOption]
}

struct LMSPrompt: Equatable, Codable {
    let id: String
    let date: String?
    let questions: [LMSQuestion]

    func correctOptionId(for question: LMSQuestion) -> String? {
        guard let date else { return nil }
        return LMSAnswerKey.correctOptionId(date: date, questionId: question.id, options: question.options)
    }
}

/// Shared deterministic answer key — mirrors the server stub generator.
enum LMSAnswerKey {
    static func correctOptionId(date: String, questionId: String, options: [LMSOption]) -> String? {
        guard !options.isEmpty else { return nil }
        let h = hash("\(date)-lms-\(questionId)")
        return options[h % options.count].id
    }

    static func hash(_ s: String) -> Int {
        var h = 0
        for char in s.unicodeScalars {
            h = (h &<< 5) &- h &+ Int(char.value)
            h |= 0
        }
        return abs(h)
    }
}

// MARK: - Entrants

struct LMSEntrant: Identifiable, Equatable, Codable {
    let id: UUID
    var isUser: Bool
    var shirtHue: Double
    var isEliminated: Bool
    var eliminationToken: Int
}

// MARK: - Game state

struct LMSGameState: Equatable, Codable {
    static let progressVersion = 1
    static let totalQuestions = 10
    static let startingEntrants = 100

    static let roundSteps: [LMSRoundStep] = [
        .init(afterCorrectCount: 0, remaining: 100, label: "Round of 100", commentary: nil),
        .init(afterCorrectCount: 1, remaining: 80, label: "Top 80", commentary: nil),
        .init(afterCorrectCount: 2, remaining: 60, label: "Top 60", commentary: "The easy ones are gone."),
        .init(afterCorrectCount: 3, remaining: 45, label: "Top 45", commentary: nil),
        .init(afterCorrectCount: 4, remaining: 32, label: "Top 32", commentary: "Half the field is out."),
        .init(afterCorrectCount: 5, remaining: 22, label: "Top 22", commentary: "Only ball knowledge survives."),
        .init(afterCorrectCount: 6, remaining: 15, label: "Top 15", commentary: nil),
        .init(afterCorrectCount: 7, remaining: 10, label: "Top 10", commentary: "Top 10. No passengers now."),
        .init(afterCorrectCount: 8, remaining: 6, label: "Final 6", commentary: nil),
        .init(afterCorrectCount: 9, remaining: 3, label: "Final 3", commentary: "Final 3."),
        .init(afterCorrectCount: 10, remaining: 1, label: "Last Man Standing", commentary: "One answer from glory."),
    ]

    let prompt: LMSPrompt
    var status: LMSGameStatus
    var currentQuestionIndex: Int
    var questionsSurvived: Int
    var entrantModels: [LMSEntrant]
    let userEntrantId: UUID
    var pendingEliminationIds: [UUID]
    var eliminatedEntrantIds: Set<UUID>
    var displayedRemaining: Int
    var pickHistory: [String]

    var currentQuestion: LMSQuestion? {
        guard currentQuestionIndex >= 0, currentQuestionIndex < prompt.questions.count else { return nil }
        return prompt.questions[currentQuestionIndex]
    }

    var currentStep: LMSRoundStep {
        Self.roundSteps[min(questionsSurvived, Self.roundSteps.count - 1)]
    }

    var nextStepAfterCorrect: LMSRoundStep? {
        let nextIndex = questionsSurvived + 1
        guard nextIndex < Self.roundSteps.count else { return nil }
        return Self.roundSteps[nextIndex]
    }

    var finishRank: Int {
        currentStep.remaining
    }

    var finishRankOrdinal: String {
        Self.ordinal(finishRank)
    }

    var aliveEntrants: [LMSEntrant] {
        entrantModels.filter { !isEntrantHidden($0) }
    }

    var visibleEntrants: [LMSEntrant] {
        entrantModels.filter { !$0.isEliminated || $0.eliminationToken > 0 }
    }

    var isInteractive: Bool {
        status == .question
    }

    static func make(prompt: LMSPrompt, seed: Int) -> LMSGameState {
        let userId = UUID()
        var rng = SeededRandomNumberGenerator(seed: UInt64(bitPattern: Int64(seed)))
        var entrants: [LMSEntrant] = [
            LMSEntrant(id: userId, isUser: true, shirtHue: 0.12, isEliminated: false, eliminationToken: 0),
        ]
        for _ in 1..<startingEntrants {
            entrants.append(
                LMSEntrant(
                    id: UUID(),
                    isUser: false,
                    shirtHue: Double.random(in: 0.02...0.92, using: &rng),
                    isEliminated: false,
                    eliminationToken: 0
                )
            )
        }
        return LMSGameState(
            prompt: prompt,
            status: .intro,
            currentQuestionIndex: 0,
            questionsSurvived: 0,
            entrantModels: entrants,
            userEntrantId: userId,
            pendingEliminationIds: [],
            eliminatedEntrantIds: [],
            displayedRemaining: startingEntrants,
            pickHistory: []
        )
    }

    mutating func prepareEliminations() {
        guard pendingEliminationIds.isEmpty,
              let next = nextStepAfterCorrect else { return }
        let toRemove = displayedRemaining - next.remaining
        guard toRemove > 0 else { return }

        let candidates = entrantModels
            .filter { !$0.isEliminated && !$0.isUser }
            .map(\.id)
        pendingEliminationIds = Array(candidates.shuffled().prefix(toRemove))
    }

    mutating func markEliminated(_ id: UUID, token: Int) {
        guard let index = entrantModels.firstIndex(where: { $0.id == id }) else { return }
        entrantModels[index].isEliminated = true
        entrantModels[index].eliminationToken = token
        eliminatedEntrantIds.insert(id)
    }

    mutating func finalizeEliminations() {
        for index in entrantModels.indices where entrantModels[index].isEliminated {
            entrantModels[index].eliminationToken = 0
        }
        pendingEliminationIds = []
    }

    mutating func eliminateUser() {
        markEliminated(userEntrantId, token: 1)
    }

    static func layoutProfile(forRemaining remaining: Int) -> LMSLayoutProfile {
        switch remaining {
        case 1:
            return LMSLayoutProfile(iconSize: 56, spacing: 12, minColumns: 1, maxHeight: 100, spotlight: true)
        case 2...3:
            return LMSLayoutProfile(iconSize: 44, spacing: 10, minColumns: 3, maxHeight: 120, spotlight: true)
        case 4...10:
            return LMSLayoutProfile(iconSize: 30, spacing: 6, minColumns: 5, maxHeight: 132, spotlight: false)
        case 11...22:
            return LMSLayoutProfile(iconSize: 24, spacing: 4, minColumns: 8, maxHeight: 148, spotlight: false)
        case 23...45:
            return LMSLayoutProfile(iconSize: 20, spacing: 2, minColumns: 10, maxHeight: 162, spotlight: false)
        default:
            return LMSLayoutProfile(iconSize: 17, spacing: 1, minColumns: 11, maxHeight: 196, spotlight: false)
        }
    }

    private func isEntrantHidden(_ entrant: LMSEntrant) -> Bool {
        entrant.isEliminated && entrant.eliminationToken == 0
    }

    static func ordinal(_ n: Int) -> String {
        let suffix: String
        let ones = n % 10
        let tens = (n / 10) % 10
        if tens == 1 {
            suffix = "th"
        } else {
            switch ones {
            case 1: suffix = "st"
            case 2: suffix = "nd"
            case 3: suffix = "rd"
            default: suffix = "th"
            }
        }
        return "\(n)\(suffix)"
    }
}

struct SeededRandomNumberGenerator: RandomNumberGenerator {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed == 0 ? 0xDEADBEEF : seed
    }

    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}

enum LastManStandingScoring {
    static func xp(survived: Int, won: Bool) -> Int {
        DailyXP.lastManStanding(survived: won ? LMSGameState.totalQuestions : survived)
    }
}
