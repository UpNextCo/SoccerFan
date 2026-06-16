import SwiftUI

enum GameModeID: String, CaseIterable {
    case footballBingo = "football_bingo"
    case tenaball = "tenaball"
    case tikiTakaToe = "tiki_taka_toe"
    case guessWho = "guess_who"
    case whereWereYa = "where_were_ya"
    case blindRank = "blind_rank"
    case guessTheGoal = "guess_the_goal"
    case emojiPlayers = "emoji_players"
    case careerPath = "career_path"

    var title: String {
        switch self {
        case .footballBingo: return "FOOTBALL BINGO"
        case .tenaball: return "TENABALL"
        case .tikiTakaToe: return "TIKI-TAKA-TOE"
        case .guessWho: return "GUESS WHO?"
        case .whereWereYa: return "WHERE WERE YA?"
        case .blindRank: return "BLIND RANK"
        case .guessTheGoal: return "GUESS THE GOAL"
        case .emojiPlayers: return "EMOJI PLAYERS"
        case .careerPath: return "CAREER PATH"
        }
    }

    var icon: String {
        switch self {
        case .footballBingo: return "square.grid.3x3.fill"
        case .tenaball: return "target"
        case .tikiTakaToe: return "grid"
        case .guessWho: return "person.fill.questionmark"
        case .whereWereYa: return "globe.europe.africa.fill"
        case .blindRank: return "list.number"
        case .guessTheGoal: return "soccerball"
        case .emojiPlayers: return "face.smiling"
        case .careerPath: return "point.topleft.down.curvedto.point.bottomright.up"
        }
    }
}

struct ShareCard: Equatable {
    let title: String
    let grid: String
    let scoreLine: String
    let streakLine: String

    var fullText: String {
        [title, grid, scoreLine, streakLine].joined(separator: "\n")
    }
}

struct GuessWhoGuessRow: Identifiable, Equatable {
    let id = UUID()
    let player: PlayerSearchResultDTO
    let feedback: [GuessFeedbackFieldDTO]
    let isCorrect: Bool
}

struct GuessWhoGameState: Equatable {
    let puzzle: GuessWhoPuzzleDTO
    var guesses: [GuessWhoGuessRow] = []
    var isComplete = false
    var won = false

    var guessesRemaining: Int {
        max(0, puzzle.maxGuesses - guesses.count)
    }

    var shareGrid: String {
        guesses.map { row in
            if row.isCorrect { return "🟩" }
            let hasPartial = row.feedback.contains { $0.status == "partial" }
            return hasPartial ? "🟨" : "🟥"
        }.joined()
    }

    mutating func addGuess(_ player: PlayerSearchResultDTO, feedback: [GuessFeedbackFieldDTO], correct: Bool) {
        guesses.append(GuessWhoGuessRow(player: player, feedback: feedback, isCorrect: correct))
        if correct || guesses.count >= puzzle.maxGuesses {
            isComplete = true
            won = correct
        }
    }
}

enum FeedbackStatus {
    case correct, partial, wrong

    init(raw: String) {
        switch raw {
        case "correct": self = .correct
        case "partial": self = .partial
        default: self = .wrong
        }
    }

    var color: Color {
        switch self {
        case .correct: return BKTheme.correct
        case .partial: return BKTheme.partial
        case .wrong: return BKTheme.wrong.opacity(0.35)
        }
    }
}

func fieldLabel(_ field: String) -> String {
    switch field {
    case "nationality": return "Nation"
    case "league": return "League"
    case "club": return "Club"
    case "position": return "Pos"
    case "age": return "Age"
    case "shirtNumber": return "#"
    case "marketValueTier": return "Value"
    default: return field.capitalized
    }
}
