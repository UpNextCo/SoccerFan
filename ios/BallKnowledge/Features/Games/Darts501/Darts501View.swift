import SwiftUI
import SwiftData

// MARK: - ViewModel

@MainActor
@Observable
final class Darts501ViewModel {
    var state: Darts501GameState
    var searchQuery = ""
    var searchResults: [PlayerSearchResultDTO] = []
    var isSearching = false
    var isAnimating = false
    var feedback: String?
    var showResult = false
    var confettiBurstToken = 0
    var displayedRemaining: Int
    var revealName: String?
    var revealScore: Int?
    var revealIs180 = false
    var revealIsBust = false
    var scorePunch = false
    var boardShake = false
    var finishLabel: String?
    var checkoutOptionCount: Int?
    var heartLossToken = 0
    var selectedThrow: Darts501Throw?
    private var searchTask: Task<Void, Never>?
    private var feedbackTask: Task<Void, Never>?

    init(puzzle: Darts501Puzzle) {
        self.state = Darts501GameState(puzzle: puzzle)
        self.displayedRemaining = puzzle.startScore
    }

    var isResumable: Bool { state.isResumable }
    var inCheckout: Bool { state.phase == .checkout || state.phase == .won }
    var inputLocked: Bool { isAnimating || state.isFinished }

    func restore(_ saved: Darts501GameState) {
        state = saved
        displayedRemaining = saved.remaining
        searchQuery = ""
        searchResults = []
        feedback = nil
        showResult = saved.isFinished
        revealName = nil
        revealScore = nil
        revealIs180 = false
        revealIsBust = false
        scorePunch = false
        boardShake = false
        finishLabel = nil
        refreshCheckoutOptions()
    }

    func updateSearch(_ query: String) {
        searchQuery = query
        searchTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2, !inputLocked else {
            searchResults = []
            isSearching = false
            return
        }
        isSearching = true
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(160))
            guard !Task.isCancelled else { return }
            do {
                let results = try await APIClient.shared.searchPlayers(query: trimmed)
                guard !Task.isCancelled else { return }
                searchResults = results
                isSearching = false
            } catch {
                guard !Task.isCancelled else { return }
                searchResults = []
                isSearching = false
            }
        }
    }

    func select(_ player: PlayerSearchResultDTO) async {
        guard !inputLocked else { return }
        if state.usedPlayerIds.contains(player.id) {
            flashFeedback("Already used")
            return
        }

        isAnimating = true
        searchQuery = ""
        searchResults = []
        feedback = nil

        do {
            let result = try await APIClient.shared.darts501Throw(
                date: state.puzzle.date,
                playerId: player.id,
                alreadyUsedIds: Array(state.usedPlayerIds)
            )
            if result.duplicate {
                flashFeedback("Already used")
                isAnimating = false
                return
            }
            if !result.valid {
                if result.reason == "Unknown player" {
                    flashFeedback(result.reason ?? "Unknown player")
                    isAnimating = false
                    return
                }
                await playThrow(
                    player: player,
                    score: 0,
                    leftValue: result.leftValue,
                    rightValue: result.rightValue,
                    wrongCategory: true
                )
                return
            }
            guard let score = result.score else {
                flashFeedback(result.reason ?? "Not in today's category")
                isAnimating = false
                return
            }
            await playThrow(
                player: player,
                score: score,
                leftValue: result.leftValue,
                rightValue: result.rightValue
            )
        } catch {
            flashFeedback(error.localizedDescription)
            isAnimating = false
        }
    }

    private func playThrow(
        player: PlayerSearchResultDTO,
        score: Int,
        leftValue: Int?,
        rightValue: Int?,
        wrongCategory: Bool = false
    ) async {
        let resolution = Darts501Scoring.resolve(
            remaining: state.remaining,
            score: score,
            inCheckout: state.phase == .checkout,
            checkoutBusts: state.checkoutBusts,
            wrongCategory: wrongCategory
        )

        let row = Darts501Throw(
            playerId: player.id,
            playerName: player.name,
            headshotUrl: player.headshotUrl,
            club: player.club,
            nationality: player.nationality,
            score: score,
            remainingAfter: resolution.remaining,
            kind: resolution.kind,
            bustReason: resolution.bustReason,
            leftValue: leftValue,
            rightValue: rightValue
        )

        revealName = player.name
        revealScore = wrongCategory ? nil : score
        revealIs180 = !wrongCategory && score == 180 && resolution.kind != .bust && resolution.kind != .gameOver
        revealIsBust = wrongCategory
        scorePunch = false

        try? await Task.sleep(for: .milliseconds(80))
        withAnimation(.spring(response: 0.28, dampingFraction: 0.62)) {
            scorePunch = true
        }
        hapticForScore(score, bust: resolution.kind == .bust || resolution.kind == .gameOver)

        try? await Task.sleep(for: .milliseconds(revealIs180 ? 280 : 160))

        if resolution.kind == .bust || resolution.kind == .gameOver {
            revealIsBust = true
            withAnimation(.default.repeatCount(4, autoreverses: true).speed(6)) {
                boardShake = true
            }
            HapticManager.error()
            heartLossToken += 1
            commit(row, resolution: resolution)
            if wrongCategory {
                flashFeedback("\(player.name) doesn't fit the category")
            }
            try? await Task.sleep(for: .milliseconds(wrongCategory ? 900 : 420))
            clearReveal()
            isAnimating = false
            refreshCheckoutOptions()
            if resolution.kind == .gameOver {
                try? await Task.sleep(for: .milliseconds(220))
                GameIntroPreferences.hide(.darts501)
                showResult = true
            }
            return
        }

        withAnimation(.easeOut(duration: 0.38)) {
            displayedRemaining = resolution.remaining
        }
        try? await Task.sleep(for: .milliseconds(380))
        commit(row, resolution: resolution)

        if resolution.kind == .perfect || resolution.kind == .checkout {
            try? await Task.sleep(for: .milliseconds(180))
            withAnimation(.spring(response: 0.32, dampingFraction: 0.7)) {
                finishLabel = resolution.kind == .perfect ? "PERFECT CHECKOUT" : "CHECKOUT"
            }
            HapticManager.success()
            confettiBurstToken += 1
            try? await Task.sleep(for: .milliseconds(resolution.kind == .perfect ? 700 : 480))
            GameIntroPreferences.hide(.darts501)
            showResult = true
            clearReveal()
            isAnimating = false
            return
        }

        try? await Task.sleep(for: .milliseconds(120))
        clearReveal()
        isAnimating = false
        refreshCheckoutOptions()
    }

    func refreshCheckoutOptions() {
        guard inCheckout, !state.isFinished, !state.puzzle.date.isEmpty else {
            checkoutOptionCount = nil
            return
        }
        let date = state.puzzle.date
        let remaining = state.remaining
        let used = Array(state.usedPlayerIds)
        Task {
            do {
                let result = try await APIClient.shared.darts501Checkouts(
                    date: date,
                    remaining: remaining,
                    alreadyUsedIds: used
                )
                checkoutOptionCount = result.count
            } catch {
                // Keep the last count if the request fails.
            }
        }
    }

    private func commit(_ row: Darts501Throw, resolution: Darts501Scoring.Resolution) {
        state.throwHistory.append(row)
        state.remaining = resolution.remaining
        state.checkoutBusts = resolution.checkoutBusts
        displayedRemaining = resolution.remaining
        switch resolution.kind {
        case .perfect, .checkout:
            state.phase = .won
        case .gameOver:
            state.phase = .lost
        case .score, .bust:
            state.phase = resolution.inCheckout ? .checkout : .playing
        }
    }

    private func clearReveal() {
        revealName = nil
        revealScore = nil
        revealIs180 = false
        revealIsBust = false
        scorePunch = false
        boardShake = false
        finishLabel = nil
    }

    private func hapticForScore(_ score: Int, bust: Bool) {
        if bust { return }
        if score == 180 {
            HapticManager.success()
        } else if score >= 100 {
            HapticManager.success()
        } else {
            HapticManager.light()
        }
    }

    private func flashFeedback(_ message: String) {
        feedback = message
        HapticManager.light()
        feedbackTask?.cancel()
        feedbackTask = Task {
            try? await Task.sleep(for: .milliseconds(1600))
            guard !Task.isCancelled else { return }
            if feedback == message { feedback = nil }
        }
    }
}

// MARK: - Main View

struct Darts501View: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: Darts501ViewModel
    @State private var showHelp = false
    @FocusState private var isSearchFocused: Bool
    private let allowReplay: Bool
    private let showsXp: Bool
    private let dailyDate: String?
    private let onSubmit: ((Darts501GameState) async -> Void)?
    var onComplete: () -> Void

    init(
        dailyDate: String?,
        puzzle: Darts501Puzzle,
        allowReplay: Bool = false,
        showsXp: Bool = true,
        onSubmit: ((Darts501GameState) async -> Void)? = nil,
        onComplete: @escaping () -> Void
    ) {
        _viewModel = State(initialValue: Darts501ViewModel(puzzle: puzzle))
        self.dailyDate = dailyDate
        self.allowReplay = allowReplay
        self.showsXp = showsXp
        self.onSubmit = onSubmit
        self.onComplete = onComplete
    }

    var body: some View {
        ZStack {
            NavigationStack {
                VStack(spacing: 0) {
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 0) {
                            Darts501Scoreboard(
                                remaining: viewModel.displayedRemaining,
                                inCheckout: viewModel.inCheckout,
                                revealName: viewModel.revealName,
                                revealScore: viewModel.revealScore,
                                revealIs180: viewModel.revealIs180,
                                revealIsBust: viewModel.revealIsBust,
                                scorePunch: viewModel.scorePunch,
                                shake: viewModel.boardShake,
                                finishLabel: viewModel.finishLabel,
                                checkoutOptionCount: viewModel.checkoutOptionCount
                            )
                            .padding(.horizontal, 16)
                            .padding(.top, 8)

                            Darts501CategoryCard(category: viewModel.state.puzzle.category)
                                .padding(.horizontal, 16)
                                .padding(.top, 12)
                                .padding(.bottom, 8)

                            Darts501HistoryList(
                                rows: viewModel.state.throwHistory,
                                onSelect: { viewModel.selectedThrow = $0 }
                            )
                        }
                    }
                    .scrollDismissesKeyboard(.immediately)
                    .scrollBounceBehavior(.always)
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 6)
                            .onChanged { _ in
                                if isSearchFocused { isSearchFocused = false }
                            }
                    )

                    Darts501SearchSection(
                        viewModel: viewModel,
                        isSearchFocused: $isSearchFocused
                    )
                }
                .background(StadiumBackground())
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { dismiss() } label: {
                            Ph.x.bold
                                .color(BKTheme.textPrimary)
                                .frame(width: 15, height: 15)
                        }
                    }
                    ToolbarItem(placement: .principal) {
                        Text(GameModeID.darts501.title)
                            .font(BKFont.caption(13))
                            .tracking(1)
                            .foregroundStyle(BKTheme.accent)
                    }
                    GameHelpToolbarButton(isPresented: $showHelp)
                }
            }

            FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                .zIndex(999)
        }
        .gameHelpOverlay(mode: .darts501, isPresented: $showHelp)
        .persistsGameProgress(
            viewModel.state,
            isResumable: viewModel.isResumable,
            modeId: GameModeID.darts501.rawValue,
            date: dailyDate,
            version: Darts501GameState.progressVersion,
            enabled: !allowReplay
        )
        .onAppear {
            guard !allowReplay, let dailyDate,
                  let saved = GameProgressStore.load(
                    Darts501GameState.self,
                    modeId: GameModeID.darts501.rawValue,
                    date: dailyDate,
                    version: Darts501GameState.progressVersion,
                    context: modelContext
                  ) else { return }
            viewModel.restore(saved)
        }
        .sheet(item: $viewModel.selectedThrow) { row in
            Darts501ThrowDetailSheet(row: row, category: viewModel.state.puzzle.category)
        }
        .fullScreenCover(isPresented: $viewModel.showResult) {
            Darts501ResultView(
                state: viewModel.state,
                showsXp: showsXp,
                onHome: {
                    if onSubmit == nil, !allowReplay, let dailyDate {
                        Task {
                            await DailyCompletionService.recordCompletion(
                                modeId: GameModeID.darts501.rawValue,
                                date: dailyDate,
                                score: viewModel.state.xpEarned,
                                won: viewModel.state.won,
                                answer: viewModel.state.answerPayload(),
                                context: modelContext
                            )
                        }
                    }
                    viewModel.showResult = false
                    onComplete()
                    dismiss()
                }
            )
            .task {
                if let onSubmit {
                    await onSubmit(viewModel.state)
                }
            }
        }
    }
}

// MARK: - Scoreboard

private struct Darts501Scoreboard: View {
    let remaining: Int
    let inCheckout: Bool
    let revealName: String?
    let revealScore: Int?
    let revealIs180: Bool
    let revealIsBust: Bool
    let scorePunch: Bool
    let shake: Bool
    let finishLabel: String?
    var checkoutOptionCount: Int? = nil

    var body: some View {
        VStack(spacing: 6) {
            if inCheckout || finishLabel != nil {
                VStack(spacing: 3) {
                    Text(finishLabel ?? "CHECKOUT")
                        .font(BKFont.caption(12))
                        .tracking(2)
                        .foregroundStyle(finishLabel == "PERFECT CHECKOUT" ? BKTheme.accent : BKTheme.partial)
                    if finishLabel == nil, let checkoutOptionCount {
                        Text(checkoutOptionCount == 1 ? "1 OPTION" : "\(checkoutOptionCount) OPTIONS")
                            .font(BKFont.caption(11))
                            .tracking(1.2)
                            .foregroundStyle(BKTheme.partial)
                    }
                }
                .transition(.opacity.combined(with: .scale(scale: 0.94)))
            }

            Text("\(remaining)")
                .font(BKFont.title(inCheckout ? 56 : 52))
                .foregroundStyle(BKTheme.textPrimary)
                .contentTransition(.numericText())
                .scaleEffect(finishLabel == "PERFECT CHECKOUT" ? 1.08 : 1)
                .shadow(
                    color: revealIs180 ? BKTheme.accent.opacity(0.35) : .clear,
                    radius: revealIs180 ? 18 : 0
                )
                .offset(x: shake ? -7 : 0)
            Text("REMAINING")
                .font(BKFont.caption(11))
                .tracking(1.4)
                .foregroundStyle(BKTheme.textMuted)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity)
        .overlay(alignment: .top) {
            if let revealName {
                VStack(spacing: 2) {
                    if revealScore != nil || !revealIsBust {
                        Text(revealName)
                            .font(BKFont.caption(11))
                            .foregroundStyle(BKTheme.textSecondary)
                            .lineLimit(1)
                    }
                    if let revealScore {
                        Text(revealIs180 ? "180!" : "\(revealScore)")
                            .font(BKFont.title(revealIs180 ? 28 : 22))
                            .foregroundStyle(revealIsBust ? BKTheme.wrong : (revealIs180 ? BKTheme.accent : BKTheme.textPrimary))
                            .scaleEffect(scorePunch ? 1 : 0.72)
                    }
                    if revealIsBust {
                        Text(revealScore == nil ? "MISS" : "BUST")
                            .font(BKFont.headline(13))
                            .tracking(1.2)
                            .foregroundStyle(BKTheme.wrong)
                        if revealScore == nil {
                            Text("\(revealName) doesn't fit the category")
                                .font(BKFont.caption(11))
                                .foregroundStyle(BKTheme.textSecondary)
                                .multilineTextAlignment(.center)
                                .lineLimit(2)
                        }
                    }
                }
                .opacity(scorePunch ? 1 : 0)
                .padding(.top, 4)
                .allowsHitTesting(false)
            }
        }
        .animation(.easeInOut(duration: 0.22), value: inCheckout)
    }
}

private struct Darts501HeartsRow: View {
    let total: Int
    let remaining: Int
    let lossToken: Int

    @State private var breakingIndex: Int?
    @State private var breakScale: CGFloat = 1
    @State private var breakOpacity: Double = 1

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<total, id: \.self) { index in
                let filled = index < remaining
                let isBreaking = breakingIndex == index
                Image(systemName: filled || isBreaking ? "heart.fill" : "heart")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(
                        filled || isBreaking
                            ? Color(red: 0.95, green: 0.28, blue: 0.38)
                            : BKTheme.textMuted.opacity(0.35)
                    )
                    .scaleEffect(isBreaking ? breakScale : 1)
                    .opacity(isBreaking ? breakOpacity : 1)
                    .offset(y: isBreaking ? -6 : 0)
                    .accessibilityLabel(filled ? "Life remaining" : "Life lost")
            }
        }
        .onChange(of: lossToken) { _, _ in
            guard remaining < total else { return }
            let index = remaining
            breakingIndex = index
            breakScale = 1.35
            breakOpacity = 1
            withAnimation(.spring(response: 0.28, dampingFraction: 0.45)) {
                breakScale = 0.35
                breakOpacity = 0
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.32) {
                breakingIndex = nil
                breakScale = 1
                breakOpacity = 1
            }
        }
    }
}

private struct Darts501CategoryCard: View {
    let category: Darts501CategoryDisplay

    var body: some View {
        VStack(spacing: 8) {
            if category.hasNationFilter {
                Text(category.flag)
                    .font(.system(size: 46))
                Text(category.audience)
                    .font(BKFont.headline(16))
                    .foregroundStyle(BKTheme.textPrimary)
                    .multilineTextAlignment(.center)
                Text(category.formula)
                    .font(BKFont.body(13))
                    .foregroundStyle(BKTheme.textSecondary)
                    .multilineTextAlignment(.center)
            } else {
                Text("TODAY'S STAT")
                    .font(BKFont.caption(11))
                    .tracking(1.2)
                    .foregroundStyle(BKTheme.textMuted)
                Text(category.formula)
                    .font(BKFont.headline(15))
                    .foregroundStyle(BKTheme.textPrimary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Search

private struct Darts501SearchSection: View {
    @Bindable var viewModel: Darts501ViewModel
    var isSearchFocused: FocusState<Bool>.Binding

    var body: some View {
        VStack(spacing: 10) {
            if !viewModel.searchResults.isEmpty, !viewModel.inputLocked {
                PlayerSearchResultsList(
                    players: viewModel.searchResults,
                    isDisabled: { viewModel.state.usedPlayerIds.contains($0.id) },
                    trailing: { player in
                        if viewModel.state.usedPlayerIds.contains(player.id) {
                            return AnyView(
                                Text("Already used")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.textMuted)
                            )
                        }
                        return nil
                    },
                    onSelect: { player in
                        isSearchFocused.wrappedValue = false
                        Task { await viewModel.select(player) }
                    }
                )
                .simultaneousGesture(
                    DragGesture(minimumDistance: 6)
                        .onChanged { _ in
                            if isSearchFocused.wrappedValue { isSearchFocused.wrappedValue = false }
                        }
                )
            }

            if let feedback = viewModel.feedback {
                Text(feedback)
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
            }

            Darts501HeartsBox(
                total: viewModel.state.puzzle.checkoutLives,
                remaining: viewModel.state.checkoutRemaining,
                lossToken: viewModel.heartLossToken
            )
            .simultaneousGesture(
                DragGesture(minimumDistance: 6)
                    .onChanged { _ in
                        if isSearchFocused.wrappedValue { isSearchFocused.wrappedValue = false }
                    }
            )

            HStack(spacing: 12) {
                TextField("", text: $viewModel.searchQuery, prompt:
                    Text(viewModel.inputLocked ? "LOCKING IN…" : "Search player")
                        .foregroundStyle(BKTheme.textMuted)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                )
                .textFieldStyle(.plain)
                .foregroundStyle(BKTheme.textPrimary)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused(isSearchFocused)
                .submitLabel(.search)
                .disabled(viewModel.inputLocked)
                .onChange(of: viewModel.searchQuery) { _, newValue in
                    viewModel.updateSearch(newValue)
                }

                if viewModel.isSearching {
                    ProgressView().tint(BKTheme.textSecondary)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(BKTheme.cardElevated)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .padding(.horizontal, 16)
        .padding(.top, 2)
        .padding(.bottom, 12)
        .background(BKTheme.background)
    }
}

private struct Darts501HeartsBox: View {
    let total: Int
    let remaining: Int
    let lossToken: Int

    var body: some View {
        HStack {
            Text("LIVES")
                .font(BKFont.caption(10))
                .tracking(1.1)
                .foregroundStyle(BKTheme.textMuted)
            Spacer()
            Darts501HeartsRow(total: total, remaining: remaining, lossToken: lossToken)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - History

private struct Darts501HistoryList: View {
    let rows: [Darts501Throw]
    var onSelect: (Darts501Throw) -> Void

    var body: some View {
        LazyVStack(spacing: 6) {
            ForEach(Array(rows.reversed().enumerated()), id: \.element.id) { index, row in
                Button {
                    onSelect(row)
                } label: {
                    Darts501HistoryRow(row: row, isLatest: index == 0)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 24)
    }
}

private struct Darts501HistoryRow: View {
    let row: Darts501Throw
    let isLatest: Bool

    private var isBust: Bool {
        row.kind == .bust || row.kind == .gameOver
    }

    var body: some View {
        HStack(spacing: 10) {
            PlayerAvatar(urlString: row.headshotUrl, size: 28)
            Text(row.playerName)
                .font(isLatest ? BKFont.headline(14) : BKFont.body(13))
                .foregroundStyle(isBust ? BKTheme.wrong : BKTheme.textPrimary)
                .lineLimit(1)
            Spacer(minLength: 8)
            Darts501HistoryValue(
                value: row.bustReason == .wrongCategory ? "—" : "\(row.score)",
                label: "Score",
                color: isBust ? BKTheme.wrong : BKTheme.textPrimary
            )
            Darts501HistoryValue(
                value: row.bustReason == .wrongCategory ? "MISS" : (isBust ? "BUST" : "\(row.remainingAfter)"),
                label: "Left",
                color: isBust ? BKTheme.wrong : BKTheme.textMuted
            )
        }
        .padding(.horizontal, 12)
        .padding(.vertical, isLatest ? 12 : 9)
        .background(isLatest ? BKTheme.cardElevated : BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

private struct Darts501HistoryValue: View {
    let value: String
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(BKFont.headline(13))
                .foregroundStyle(color)
                .monospacedDigit()
            Text(label.uppercased())
                .font(BKFont.caption(8))
                .tracking(0.6)
                .foregroundStyle(BKTheme.textMuted)
        }
        .frame(minWidth: 40)
    }
}

// MARK: - Throw detail

private struct Darts501ThrowDetailSheet: View {
    let row: Darts501Throw
    let category: Darts501CategoryDisplay
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                PlayerAvatar(urlString: row.headshotUrl, size: 56)
                Text(row.playerName)
                    .font(BKFont.headline(18))
                    .foregroundStyle(BKTheme.textPrimary)
                if row.bustReason == .wrongCategory {
                    Text("MISS")
                        .font(BKFont.title(28))
                        .foregroundStyle(BKTheme.wrong)
                    Text("\(row.playerName) doesn't fit the category")
                        .font(BKFont.body(14))
                        .foregroundStyle(BKTheme.textSecondary)
                        .multilineTextAlignment(.center)
                } else {
                    Text("\(row.score)")
                        .font(BKFont.title(40))
                        .foregroundStyle(row.kind == .bust || row.kind == .gameOver ? BKTheme.wrong : BKTheme.textPrimary)
                    if row.kind == .bust || row.kind == .gameOver {
                        Text("BUST")
                            .font(BKFont.headline(14))
                            .foregroundStyle(BKTheme.wrong)
                    }
                }
                if category.hasNationFilter {
                    Text("\(category.flag)  \(category.audience)")
                        .font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.textPrimary)
                }
                Text(category.formula)
                    .font(BKFont.body(13))
                    .foregroundStyle(BKTheme.textSecondary)
                    .multilineTextAlignment(.center)
                if let left = row.leftValue, let right = row.rightValue {
                    Text("\(left)  ·  \(right)")
                        .font(BKFont.caption(12))
                        .foregroundStyle(BKTheme.textSecondary)
                }
                Spacer()
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(BKTheme.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.accent)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Result

private struct Darts501ResultView: View {
    let state: Darts501GameState
    var showsXp: Bool = true
    var onHome: () -> Void

    private var hero: String {
        if state.perfect { return "PERFECT CHECKOUT" }
        if state.won { return "CHECKOUT" }
        return "BUST"
    }

    var body: some View {
        GameResultScreen(onExit: onHome) {
            VStack(spacing: 20) {
                VStack(spacing: 8) {
                    Text(GameModeID.darts501.title)
                        .font(BKFont.caption(11))
                        .tracking(1)
                        .foregroundStyle(BKTheme.textMuted)
                    Text(hero)
                        .font(BKFont.title(28))
                        .foregroundStyle(state.won ? BKTheme.textPrimary : BKTheme.wrong)
                        .multilineTextAlignment(.center)
                    if !state.won {
                        Text("Game Over")
                            .font(BKFont.headline(16))
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                    Darts501CategoryCard(category: state.puzzle.category)
                }
                .padding(.top, 24)

                if showsXp {
                    XPResultSummary(earned: state.xpEarned, max: DailyXP.maxXP(.darts501))
                }

                HStack(spacing: 10) {
                    Darts501StatChip(label: "Throws", value: "\(state.throwHistory.count)")
                    Darts501StatChip(label: "Highest", value: "\(state.highestScore)")
                    if state.won {
                        Darts501StatChip(label: "Checkout", value: "\(state.remaining)")
                    } else {
                        Darts501StatChip(label: "Left", value: "\(state.remaining)")
                    }
                    Darts501StatChip(label: "Busts", value: "\(state.bustCount)")
                }

                VStack(spacing: 8) {
                    ForEach(state.throwHistory) { row in
                        Darts501HistoryRow(row: row, isLatest: false)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

private struct Darts501StatChip: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(BKFont.headline(16))
                .foregroundStyle(BKTheme.textPrimary)
            Text(label.uppercased())
                .font(BKFont.caption(9))
                .tracking(0.6)
                .foregroundStyle(BKTheme.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
