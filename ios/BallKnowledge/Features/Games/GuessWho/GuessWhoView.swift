import SwiftUI
import SwiftData

@MainActor
@Observable
final class GuessWhoViewModel {
    var state: GuessWhoGameState
    var searchQuery = ""
    var searchResults: [PlayerSearchResultDTO] = []
    var isSearching = false
    var isSubmitting = false
    var errorMessage: String?
    var completionResult: DailyCompleteResponseDTO?
    var showShare = false

    private let date: String

    init(puzzle: GuessWhoPuzzleDTO, date: String) {
        self.state = GuessWhoGameState(puzzle: puzzle)
        self.date = date
    }

    func search() async {
        let q = searchQuery.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else {
            searchResults = []
            return
        }
        isSearching = true
        defer { isSearching = false }
        do {
            searchResults = try await APIClient.shared.searchPlayers(query: q)
        } catch {
            searchResults = []
        }
    }

    func submitGuess(_ player: PlayerSearchResultDTO, context: ModelContext) async {
        guard !state.isComplete else { return }
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            let result = try await APIClient.shared.dailyGuess(DailyGuessRequestDTO(
                date: date,
                modeId: state.puzzle.modeId,
                playerId: player.id
            ))

            state.addGuess(player, feedback: result.feedback, correct: result.correct)
            searchQuery = ""
            searchResults = []

            if result.correct {
                HapticManager.success()
            } else if state.isComplete {
                HapticManager.error()
            } else {
                HapticManager.light()
            }

            if state.isComplete {
                await completeGame(context: context)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func completeGame(context: ModelContext?) async {
        let score = state.won ? max(10, 100 - (state.guesses.count - 1) * 10) : 0
        let request = DailyCompleteRequestDTO(
            modeId: state.puzzle.modeId,
            date: date,
            score: score,
            guesses: state.guesses.count,
            won: state.won,
            shareGrid: state.shareGrid
        )

        do {
            completionResult = try await APIClient.shared.dailyComplete(request)
            showShare = true
        } catch {
            if let context {
                try? OfflineCache.queueCompletion(request, context: context)
            }
            errorMessage = "Completed — will sync when online"
            showShare = true
        }
    }

    var shareCard: ShareCard {
        ShareCard(
            title: "Ball Knowledge — Guess Who? \(formattedDate)",
            grid: state.shareGrid,
            scoreLine: "\(state.guesses.count)/\(state.puzzle.maxGuesses)",
            streakLine: "🔥 Ball Knowledge"
        )
    }

    private var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        if let d = ISO8601DateFormatter().date(from: date + "T00:00:00Z") {
            return formatter.string(from: d)
        }
        return date
    }
}

struct GuessWhoView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: GuessWhoViewModel
    var onComplete: () -> Void

    init(puzzle: GuessWhoPuzzleDTO, date: String, onComplete: @escaping () -> Void) {
        _viewModel = State(initialValue: GuessWhoViewModel(puzzle: puzzle, date: date))
        self.onComplete = onComplete
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                GuessWhoHeader(
                    guessesUsed: viewModel.state.guesses.count,
                    maxGuesses: viewModel.state.puzzle.maxGuesses
                )

                ScrollView {
                    VStack(spacing: 12) {
                        columnHeaders

                        ForEach(viewModel.state.guesses) { row in
                            GuessRowView(row: row)
                        }

                        if !viewModel.state.isComplete {
                            searchSection
                        }

                        if viewModel.state.isComplete {
                            completionSection
                        }
                    }
                    .padding(16)
                }
            }
            .background(BKTheme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .foregroundStyle(BKTheme.textPrimary)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text("GUESS WHO?")
                        .font(BKFont.caption())
                        .foregroundStyle(BKTheme.accent)
                }
            }
        }
        .sheet(isPresented: $viewModel.showShare) {
            ShareResultSheet(shareCard: viewModel.shareCard) {
                viewModel.showShare = false
                onComplete()
                dismiss()
            }
        }
    }

    private var columnHeaders: some View {
        HStack(spacing: 4) {
            Text("Player")
                .frame(width: 80, alignment: .leading)
            ForEach(["Nation", "League", "Club", "Pos", "Age", "#", "Val"], id: \.self) { h in
                Text(h)
                    .font(.system(size: 9, weight: .bold))
                    .frame(maxWidth: .infinity)
            }
        }
        .foregroundStyle(BKTheme.textMuted)
        .font(BKFont.caption(9))
    }

    private var searchSection: some View {
        VStack(spacing: 12) {
            HStack {
                TextField("Search player...", text: $viewModel.searchQuery)
                    .textFieldStyle(.plain)
                    .foregroundStyle(BKTheme.textPrimary)
                    .autocorrectionDisabled()
                    .onChange(of: viewModel.searchQuery) { _, _ in
                        Task { await viewModel.search() }
                    }

                if viewModel.isSubmitting {
                    ProgressView().tint(BKTheme.accent)
                }
            }
            .padding(14)
            .background(BKTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14))

            if !viewModel.searchResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(viewModel.searchResults) { player in
                        Button {
                            Task { await viewModel.submitGuess(player, context: modelContext) }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(player.name)
                                        .font(BKFont.headline(14))
                                        .foregroundStyle(BKTheme.textPrimary)
                                    Text("\(player.club) · \(player.league)")
                                        .font(BKFont.caption(11))
                                        .foregroundStyle(BKTheme.textMuted)
                                }
                                Spacer()
                            }
                            .padding(12)
                        }
                        Divider().background(BKTheme.cardElevated)
                    }
                }
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }

            if let error = viewModel.errorMessage {
                Text(error)
                    .font(BKFont.caption())
                    .foregroundStyle(BKTheme.wrong)
            }
        }
    }

    private var completionSection: some View {
        VStack(spacing: 16) {
            Image(systemName: viewModel.state.won ? "checkmark.circle.fill" : "xmark.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(viewModel.state.won ? BKTheme.accent : BKTheme.wrong)

            Text(viewModel.state.won ? "Got it!" : "Better luck tomorrow")
                .font(BKFont.title(22))
                .foregroundStyle(BKTheme.textPrimary)

            if let result = viewModel.completionResult {
                Text("+\(result.xpEarned) XP")
                    .font(BKFont.headline())
                    .foregroundStyle(BKTheme.accent)
            }

            Button("Share Result") {
                viewModel.showShare = true
            }
            .font(BKFont.headline())
            .foregroundStyle(BKTheme.background)
            .padding(.horizontal, 24)
            .padding(.vertical, 14)
            .background(BKTheme.accent)
            .clipShape(Capsule())
        }
        .padding(.vertical, 24)
    }
}

struct GuessWhoHeader: View {
    let guessesUsed: Int
    let maxGuesses: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<maxGuesses, id: \.self) { i in
                Circle()
                    .fill(i < guessesUsed ? BKTheme.accent : BKTheme.cardElevated)
                    .frame(width: 10, height: 10)
            }
        }
        .padding(.vertical, 12)
    }
}

struct GuessRowView: View {
    let row: GuessWhoGuessRow

    var body: some View {
        HStack(spacing: 4) {
            Text(row.player.name.components(separatedBy: " ").last ?? row.player.name)
                .font(.system(size: 10, weight: .bold))
                .lineLimit(1)
                .frame(width: 80, alignment: .leading)
                .foregroundStyle(BKTheme.textPrimary)

            ForEach(row.feedback, id: \.field) { field in
                Text(field.value?.display ?? "-")
                    .font(.system(size: 9, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(FeedbackStatus(raw: field.status).color)
                    .foregroundStyle(BKTheme.textPrimary)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
    }
}

struct ShareResultSheet: View {
    let shareCard: ShareCard
    var onDone: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Text("Share your score")
                .font(BKFont.title(22))
                .foregroundStyle(BKTheme.textPrimary)

            VStack(alignment: .leading, spacing: 8) {
                Text(shareCard.title)
                Text(shareCard.grid).font(.title)
                Text(shareCard.scoreLine)
            }
            .font(BKFont.body())
            .foregroundStyle(BKTheme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(BKTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal)

            ShareLink(item: shareCard.fullText) {
                Text("Share")
                    .font(BKFont.headline())
                    .foregroundStyle(BKTheme.background)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(BKTheme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            .padding(.horizontal)

            Button("Done", action: onDone)
                .foregroundStyle(BKTheme.textMuted)
        }
        .padding(.vertical, 32)
        .background(BKTheme.background)
        .presentationDetents([.medium])
    }
}

enum HapticManager {
    static func light() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
}
