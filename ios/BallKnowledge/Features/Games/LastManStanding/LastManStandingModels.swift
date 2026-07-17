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

enum LMSQuestionType: String, Codable {
    case higherLower = "higher_lower"
    case careerPath = "career_path"
    case oddOneOut = "odd_one_out"
    case whichClub = "which_club"
    case imageBadge = "image_badge"
    case customImage = "custom_image"
    case customQuestion = "custom_question"
}

struct LMSCareerClub: Equatable, Codable {
    let name: String
    var logoUrl: String?
    var note: String?
}

struct LMSCluePlayer: Equatable, Codable {
    let id: String?
    let name: String
    var headshotUrl: String?
    var nationality: String?
    var position: String?
}

enum LMSPresentationLayout: String, Codable {
    case twoUp = "two_up"
    case grid
    case stack
    case imageHeader = "image_header"
}

struct LMSPresentation: Equatable, Codable {
    var layout: LMSPresentationLayout?
    var imageUrl: String?
    var imageBlur: Double?
    var careerClubs: [LMSCareerClub]?
    var cluePlayers: [LMSCluePlayer]?
}

struct LMSOption: Identifiable, Equatable, Codable {
    let id: String
    let label: String
    var headshotUrl: String?
    var teamLogoUrl: String?
    var nationality: String?
    var position: String?
}

struct LMSQuestion: Identifiable, Equatable, Codable {
    let id: String
    let type: LMSQuestionType
    let slot: Int
    var signature: Bool = false
    let prompt: String
    var subPrompt: String?
    let options: [LMSOption]
    var presentation: LMSPresentation?
}

struct LMSPrompt: Equatable, Codable {
    let id: String
    let date: String?
    let questions: [LMSQuestion]
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
    static let progressVersion = 2
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

    var finishRank: Int { currentStep.remaining }

    var finishRankOrdinal: String { Self.ordinal(finishRank) }

    var visibleEntrants: [LMSEntrant] {
        entrantModels.filter { !$0.isEliminated || $0.eliminationToken > 0 }
    }

    var isInteractive: Bool { status == .question }

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
        guard pendingEliminationIds.isEmpty, let next = nextStepAfterCorrect else { return }
        let toRemove = displayedRemaining - next.remaining
        guard toRemove > 0 else { return }
        let candidates = entrantModels.filter { !$0.isEliminated && !$0.isUser }.map(\.id)
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
        // Packed crowd uses fixed minColumns so 100 always fits in the card with no scroll.
        switch remaining {
        case 1:
            return LMSLayoutProfile(iconSize: 56, spacing: 8, minColumns: 1, maxHeight: 96, spotlight: true)
        case 2...3:
            return LMSLayoutProfile(iconSize: 44, spacing: 6, minColumns: 3, maxHeight: 110, spotlight: true)
        case 4...10:
            return LMSLayoutProfile(iconSize: 34, spacing: 3, minColumns: 5, maxHeight: 128, spotlight: false)
        case 11...22:
            return LMSLayoutProfile(iconSize: 28, spacing: 2, minColumns: 7, maxHeight: 140, spotlight: false)
        case 23...45:
            return LMSLayoutProfile(iconSize: 24, spacing: 1, minColumns: 10, maxHeight: 160, spotlight: false)
        default:
            // 10×10 grid of 100 — card height is derived from content, not maxHeight.
            return LMSLayoutProfile(iconSize: 26, spacing: 0, minColumns: 10, maxHeight: 268, spotlight: false)
        }
    }

    static func ordinal(_ n: Int) -> String {
        let suffix: String
        let ones = n % 10
        let tens = (n / 10) % 10
        if tens == 1 { suffix = "th" }
        else {
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
    init(seed: UInt64) { state = seed == 0 ? 0xDEADBEEF : seed }
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

enum LMSPromptSeed {
    static func entrantSeed(for prompt: LMSPrompt) -> Int {
        var h = 0
        for char in (prompt.date ?? prompt.id).unicodeScalars {
            h = (h &<< 5) &- h &+ Int(char.value)
            h |= 0
        }
        return abs(h)
    }
}
