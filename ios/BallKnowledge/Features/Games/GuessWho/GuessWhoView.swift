import SwiftUI
import SwiftData

// MARK: - ViewModel

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

    var currentGuessNumber: Int {
        min(state.guesses.count + 1, state.puzzle.maxGuesses)
    }

    var searchPlaceholder: String {
        if state.isComplete {
            return "GAME OVER"
        }
        return "GUESS \(currentGuessNumber) OF \(state.puzzle.maxGuesses)"
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

// MARK: - Main View

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
                GuessWhoProgressBar(
                    guessesUsed: viewModel.state.guesses.count,
                    maxGuesses: viewModel.state.puzzle.maxGuesses
                )

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 20) {
                        ForEach(viewModel.state.guesses.reversed()) { row in
                            GuessWhoGuessCard(row: row)
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }

                        if viewModel.state.isComplete {
                            completionSection
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 24)
                }

                if !viewModel.state.isComplete {
                    GuessWhoSearchSection(viewModel: viewModel, modelContext: modelContext)
                }
            }
            .background(BKTheme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(BKTheme.textPrimary)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text("GUESS WHO?")
                        .font(BKFont.caption(13))
                        .tracking(1)
                        .foregroundStyle(BKTheme.accent)
                }
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.82), value: viewModel.state.guesses.count)
        .sheet(isPresented: $viewModel.showShare) {
            ShareResultSheet(shareCard: viewModel.shareCard) {
                viewModel.showShare = false
                onComplete()
                dismiss()
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
            .padding(.horizontal, 28)
            .padding(.vertical, 14)
            .background(BKTheme.accent)
            .clipShape(Capsule())
        }
        .padding(.vertical, 16)
    }
}

// MARK: - Progress

struct GuessWhoProgressBar: View {
    let guessesUsed: Int
    let maxGuesses: Int

    var body: some View {
        HStack(spacing: 8) {
            ForEach(0..<maxGuesses, id: \.self) { i in
                Capsule()
                    .fill(i < guessesUsed ? BKTheme.accent : BKTheme.cardElevated)
                    .frame(height: 4)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }
}

// MARK: - Guess Card (Who Are Ya style)

struct GuessWhoGuessCard: View {
    let row: GuessWhoGuessRow

    private var fields: [GuessFeedbackFieldDTO] {
        displayFields(from: row.feedback)
    }

    var body: some View {
        VStack(spacing: 14) {
            Text(row.player.name.uppercased())
                .font(.system(size: 15, weight: .heavy, design: .rounded))
                .tracking(0.5)
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)

            HStack(spacing: 0) {
                ForEach(fields, id: \.field) { field in
                    GuessWhoAttributeBadge(field: field)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.vertical, 16)
        .padding(.horizontal, 8)
        .background(BKTheme.card.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

struct GuessWhoAttributeBadge: View {
    let field: GuessFeedbackFieldDTO

    private var status: FeedbackStatus { FeedbackStatus(raw: field.status) }

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                Circle()
                    .fill(status.badgeFill)
                    .frame(width: 48, height: 48)

                Text(badgeContent)
                    .font(.system(size: badgeFontSize, weight: .bold, design: .rounded))
                    .foregroundStyle(status.badgeText)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.55)
                    .padding(4)
            }

            Text(fieldLabel(field.field))
                .font(.system(size: 9, weight: .bold, design: .rounded))
                .tracking(0.3)
                .foregroundStyle(BKTheme.textMuted)
        }
    }

    private var badgeFontSize: CGFloat {
        switch field.field {
        case "nationality": return 22
        case "league", "club": return 11
        default: return 13
        }
    }

    private var badgeContent: String {
        switch field.field {
        case "nationality":
            return GuessWhoDisplay.nationalityFlag(field.value?.display ?? "?")
        case "league":
            return GuessWhoDisplay.leagueAbbrev(field.value?.display ?? "?")
        case "club":
            return GuessWhoDisplay.clubAbbrev(field.value?.display ?? "?")
        case "position":
            return GuessWhoDisplay.positionAbbrev(field.value?.display ?? "?")
        case "age", "shirtNumber":
            return numericDisplay
        default:
            return field.value?.display ?? "?"
        }
    }

    private var numericDisplay: String {
        let value = field.value?.display ?? "?"
        guard field.field == "age" || field.field == "shirtNumber" else { return value }

        let prefix = field.field == "shirtNumber" ? "#" : ""
        if let hint = field.hint {
            let arrow = hint == "higher" ? "↑" : "↓"
            return "\(prefix)\(value)\(arrow)"
        }
        return "\(prefix)\(value)"
    }
}

// MARK: - Display Helpers

enum GuessWhoDisplay {
    static func nationalityFlag(_ nationality: String) -> String {
        flags[nationality] ?? String(nationality.prefix(2)).uppercased()
    }

    static func leagueAbbrev(_ league: String) -> String {
        leagueAbbrevs[league] ?? String(league.prefix(3)).uppercased()
    }

    static func clubAbbrev(_ club: String) -> String {
        clubAbbrevs[club] ?? String(club.prefix(4)).uppercased()
    }

    static func positionAbbrev(_ position: String) -> String {
        switch position.lowercased() {
        case "goalkeeper": return "GK"
        case "defender": return "DEF"
        case "midfielder": return "MID"
        case "attacker": return "ATT"
        default: return String(position.prefix(3)).uppercased()
        }
    }

    private static let flags: [String: String] = [
        "England": "ENG",
        "France": "🇫🇷",
        "Spain": "🇪🇸",
        "Germany": "🇩🇪",
        "Italy": "🇮🇹",
        "Portugal": "🇵🇹",
        "Brazil": "🇧🇷",
        "Argentina": "🇦🇷",
        "Netherlands": "🇳🇱",
        "Belgium": "🇧🇪",
        "Norway": "🇳🇴",
        "Egypt": "🇪🇬",
        "Poland": "🇵🇱",
        "Morocco": "🇲🇦",
        "Nigeria": "🇳🇬",
        "South Korea": "🇰🇷",
        "United States": "🇺🇸",
        "USA": "🇺🇸",
    ]

    private static let leagueAbbrevs: [String: String] = [
        "Premier League": "PL",
        "La Liga": "LL",
        "Serie A": "SA",
        "Ligue 1": "L1",
        "Bundesliga": "BL",
        "Super Lig": "SL",
        "MLS": "MLS",
        "Pro League": "SPL",
    ]

    private static let clubAbbrevs: [String: String] = [
        "Manchester City": "MCI",
        "Manchester United": "MUN",
        "Real Madrid": "RMA",
        "Barcelona": "BAR",
        "Liverpool": "LIV",
        "Arsenal": "ARS",
        "Chelsea": "CHE",
        "Tottenham": "TOT",
        "Bayern Munich": "BAY",
        "AC Milan": "MIL",
        "Paris Saint Germain": "PSG",
        "Atletico Madrid": "ATM",
        "Inter Miami": "MIA",
    ]
}

// MARK: - Search

struct GuessWhoSearchSection: View {
    @Bindable var viewModel: GuessWhoViewModel
    let modelContext: ModelContext

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                HStack(spacing: 12) {
                    TextField("", text: $viewModel.searchQuery, prompt:
                        Text(viewModel.searchPlaceholder)
                            .foregroundStyle(BKTheme.textMuted)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                    )
                    .textFieldStyle(.plain)
                    .foregroundStyle(BKTheme.background)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onChange(of: viewModel.searchQuery) { _, _ in
                        Task { await viewModel.search() }
                    }

                    if viewModel.isSubmitting {
                        ProgressView()
                            .tint(BKTheme.accent)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(BKTheme.accent.opacity(0.35), lineWidth: 1.5)
                )

                if !viewModel.searchResults.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(viewModel.searchResults) { player in
                            Button {
                                Task { await viewModel.submitGuess(player, context: modelContext) }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(player.name.uppercased())
                                            .font(.system(size: 13, weight: .bold, design: .rounded))
                                            .foregroundStyle(BKTheme.textPrimary)
                                        Text("\(player.club) · \(player.league)")
                                            .font(BKFont.caption(11))
                                            .foregroundStyle(BKTheme.textMuted)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(BKTheme.textMuted)
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 12)
                            }
                            if player.id != viewModel.searchResults.last?.id {
                                Divider().background(BKTheme.cardElevated)
                            }
                        }
                    }
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                if let error = viewModel.errorMessage {
                    Text(error)
                        .font(BKFont.caption())
                        .foregroundStyle(BKTheme.wrong)
                }
            }
            .padding(16)
            .background(BKTheme.background)
        }
    }
}

// MARK: - Share & Haptics

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
