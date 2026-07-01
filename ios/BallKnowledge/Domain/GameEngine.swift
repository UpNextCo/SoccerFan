import SwiftUI

/// Protocol all game modes conform to for the modular engine.
protocol DailyGame {
    var modeId: GameModeID { get }
    associatedtype PuzzleView: View
    @ViewBuilder func makeView(puzzle: GuessWhoPuzzleDTO, date: String, onComplete: @escaping () -> Void) -> PuzzleView
}

/// Guess Who is the v1 reference implementation.
struct GuessWhoGame: DailyGame {
    let modeId: GameModeID = .guessWho

    func makeView(puzzle: GuessWhoPuzzleDTO, date: String, onComplete: @escaping () -> Void) -> some View {
        GuessWhoView(puzzle: puzzle, date: date, onComplete: onComplete)
    }
}

struct ComingSoonGameView: View {
    let modeId: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Text("Coming Soon")
                .font(BKFont.title())
                .foregroundStyle(BKTheme.textPrimary)
            Text("\(modeId) is on the way.")
                .foregroundStyle(BKTheme.textSecondary)
            Button("Close") { dismiss() }
                .foregroundStyle(BKTheme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BKTheme.background)
    }
}
