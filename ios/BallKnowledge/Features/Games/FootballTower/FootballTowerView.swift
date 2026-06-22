import SwiftUI

// MARK: - ViewModel

@MainActor
@Observable
final class FootballTowerViewModel {
    var state: FootballTowerGameState?
    var searchQuery = ""
    var searchResults: [FootballTowerSuggestion] = []
    var isSearching = false
    var showResult = false
    var showLeaderboard = false
    var showShare = false
    var confettiBurstToken = 0
    var resultSummary: FootballTowerResultSummary?
    var towerOffset: CGFloat = 0
    var feedbackMessage: String?
    var isSuccessFeedback = false

    private var todayDate: String {
        String(ISO8601DateFormatter().string(from: Date()).prefix(10))
    }

    var dailyBestFloor: Int? {
        FootballTowerDailyStore.bestFloor(for: todayDate)
    }

    var hasPlayedDailyToday: Bool {
        FootballTowerDailyStore.hasPlayedToday(date: todayDate)
    }

    func startDaily() {
        let questions = FootballTowerSeed.makeDailyTower(date: todayDate)
        state = FootballTowerGameState(mode: .daily, date: todayDate, questions: questions)
        resetSearch()
    }

    func startFreePlay() {
        state = FootballTowerGameState(
            mode: .freePlay,
            date: todayDate,
            questions: FootballTowerSeed.makeFreePlayTower()
        )
        resetSearch()
    }

    func search() async {
        guard let question = state?.currentQuestion else {
            searchResults = []
            return
        }
        let query = searchQuery.trimmingCharacters(in: .whitespaces)
        guard query.count >= 2 else {
            searchResults = []
            return
        }
        isSearching = true
        defer { isSearching = false }
        searchResults = await FootballTowerSearch.search(query: query, question: question)
    }

    func submit(_ suggestion: FootballTowerSuggestion) {
        guard var run = state,
              let question = run.currentQuestion,
              run.phase == .playing else { return }

        let isCorrect = FootballTowerValidator.validate(
            answerId: suggestion.id,
            answerName: suggestion.name,
            question: question,
            usedIds: run.usedAnswerIds,
            nationality: suggestion.nationality,
            league: suggestion.league,
            position: suggestion.position
        )

        run.usedAnswerIds.insert(suggestion.id)
        run.answers.append(
            FootballTowerAnswerRecord(
                floor: run.currentFloor,
                questionId: question.id,
                answerId: suggestion.id,
                answerName: suggestion.name,
                isCorrect: isCorrect
            )
        )

        searchQuery = ""
        searchResults = []
        feedbackMessage = nil

        if isCorrect {
            run.streak += 1
            run.phase = .correctTransition
            isSuccessFeedback = true
            feedbackMessage = "Correct · +100"
            HapticManager.success()
            towerOffset = -28

            if run.streak >= FootballTowerTiming.confettiFloor {
                confettiBurstToken += 1
            }

            state = run

            Task {
                try? await Task.sleep(for: .seconds(FootballTowerTiming.correctClimb))
                guard var updated = state else { return }
                updated.currentFloor += 1
                updated.phase = .playing
                state = updated
                withAnimation(.spring(response: 0.45, dampingFraction: 0.72)) {
                    towerOffset = 0
                }
            }
        } else {
            run.failedAnswerName = suggestion.name
            run.phase = .failed
            run.score = FootballTowerScoring.score(forCorrectFloors: run.correctCount)
            run.xpEarned = run.mode == .daily
                ? FootballTowerScoring.xp(from: run.score ?? 0, mode: .daily, percentile: 50)
                : 0
            isSuccessFeedback = false
            feedbackMessage = "Wrong answer"
            HapticManager.error()
            towerOffset = 120
            state = run

            let standout = run.answers.filter(\.isCorrect).last?.answerName
            resultSummary = FootballTowerSeed.resultSummary(state: run, standout: standout)

            if run.mode == .daily {
                FootballTowerDailyStore.saveBestFloor(run.correctCount, for: todayDate)
            }

            Task {
                try? await Task.sleep(for: .seconds(FootballTowerTiming.failDrop))
                showResult = true
            }
        }
    }

    func returnToMenu() {
        state = nil
        showResult = false
        showLeaderboard = false
        showShare = false
        resultSummary = nil
        towerOffset = 0
        feedbackMessage = nil
        resetSearch()
    }

    private func resetSearch() {
        searchQuery = ""
        searchResults = []
        feedbackMessage = nil
        towerOffset = 0
    }
}

// MARK: - Main View

struct FootballTowerView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel = FootballTowerViewModel()
    @FocusState private var isSearchFocused: Bool
    var dailyOnly: Bool = false
    var allowReplay: Bool = true
    var onComplete: () -> Void

    var body: some View {
        ZStack {
            NavigationStack {
                Group {
                    if viewModel.state == nil {
                        FootballTowerMenuView(viewModel: viewModel)
                    } else {
                        FootballTowerGameScreen(
                            viewModel: viewModel,
                            isSearchFocused: $isSearchFocused
                        )
                    }
                }
                .background(BKTheme.background)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            if viewModel.state == nil {
                                dismiss()
                            } else {
                                viewModel.returnToMenu()
                            }
                        } label: {
                            Ph.x.bold
                                .color(BKTheme.textPrimary)
                                .frame(width: 15, height: 15)
                        }
                    }
                    ToolbarItem(placement: .principal) {
                        Text("FOOTBALL TOWER")
                            .font(BKFont.caption(13))
                            .tracking(1)
                            .foregroundStyle(BKTheme.accent)
                    }
                }
            }

            FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                .zIndex(999)
        }
        .fullScreenCover(isPresented: $viewModel.showResult) {
            if let summary = viewModel.resultSummary, let run = viewModel.state {
                FootballTowerResultView(
                    summary: summary,
                    mode: run.mode,
                    failedAnswer: run.failedAnswerName,
                    onLeaderboard: {
                        viewModel.showResult = false
                        viewModel.showLeaderboard = true
                    },
                    onShare: { viewModel.showShare = true },
                    onFreePlay: allowReplay ? {
                        viewModel.showResult = false
                        viewModel.startFreePlay()
                    } : nil,
                    onMenu: {
                        viewModel.returnToMenu()
                    },
                    onHome: {
                        if !allowReplay, let date = viewModel.state?.date {
                            Task {
                                await DailyCompletionService.recordCompletion(
                                    modeId: GameModeID.footballTower.rawValue,
                                    date: date,
                                    score: summary.correctCount,
                                    won: summary.correctCount >= 5,
                                    context: modelContext
                                )
                            }
                        }
                        viewModel.returnToMenu()
                        onComplete()
                        dismiss()
                    }
                )
            }
        }
        .sheet(isPresented: $viewModel.showLeaderboard) {
            if let summary = viewModel.resultSummary {
                FootballTowerLeaderboardSheet(entries: summary.dailyBoard)
            }
        }
        .sheet(isPresented: $viewModel.showShare) {
            if let summary = viewModel.resultSummary, let run = viewModel.state {
                FootballTowerShareSheet(summary: summary, mode: run.mode)
            }
        }
        .onAppear {
            if dailyOnly, viewModel.state == nil {
                viewModel.startDaily()
            }
        }
    }
}

// MARK: - Menu

private struct FootballTowerMenuView: View {
    @Bindable var viewModel: FootballTowerViewModel

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 24) {
                VStack(spacing: 10) {
                    Ph.chartBar.fill
                        .color(BKTheme.accent)
                        .frame(width: 40, height: 40)
                    Text("FOOTBALL TOWER")
                        .font(BKFont.title(26))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text("Climb as high as you can.\nOne wrong answer ends your run.")
                        .font(BKFont.body(14))
                        .foregroundStyle(BKTheme.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 24)

                FootballTowerPreviewStack(floor: viewModel.dailyBestFloor ?? 0)

                if let best = viewModel.dailyBestFloor {
                    Text("Today's best: Floor \(best)")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.accent)
                }

                VStack(spacing: 12) {
                    Button(action: viewModel.startDaily) {
                        menuButton(
                            title: viewModel.hasPlayedDailyToday ? "PLAY DAILY TOWER AGAIN" : "PLAY DAILY TOWER",
                            subtitle: "XP · streaks · leaderboard",
                            primary: true
                        )
                    }

                    Button(action: viewModel.startFreePlay) {
                        menuButton(
                            title: "FREE PLAY",
                            subtitle: "Unlimited practice · no ranked XP",
                            primary: false
                        )
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
    }

    private func menuButton(title: String, subtitle: String, primary: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(BKFont.headline(15))
            Text(subtitle)
                .font(BKFont.caption(10))
                .opacity(0.85)
        }
        .foregroundStyle(primary ? BKTheme.background : BKTheme.textPrimary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(primary ? BKTheme.accent : BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - Game Screen

private struct FootballTowerGameScreen: View {
    @Bindable var viewModel: FootballTowerViewModel
    var isSearchFocused: FocusState<Bool>.Binding

    var body: some View {
        if let state = viewModel.state, let question = state.currentQuestion {
            VStack(spacing: 0) {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 16) {
                        FootballTowerHeader(
                            floor: state.currentFloor,
                            difficulty: question.difficulty,
                            streak: state.streak,
                            usedCount: state.usedAnswerIds.count,
                            mode: state.mode
                        )

                        FootballTowerVisual(
                            currentFloor: state.currentFloor,
                            streak: state.streak,
                            offset: viewModel.towerOffset,
                            isClimbing: state.phase == .correctTransition
                        )

                        FootballTowerQuestionCard(question: question)

                        if let feedback = viewModel.feedbackMessage {
                            Text(feedback.uppercased())
                                .font(BKFont.caption(11))
                                .foregroundStyle(viewModel.isSuccessFeedback ? BKTheme.accent : BKTheme.wrong)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 16)
                }

                if state.phase == .playing {
                    FootballTowerSearchSection(
                        viewModel: viewModel,
                        question: question,
                        isSearchFocused: isSearchFocused
                    )
                }
            }
            .animation(.spring(response: 0.42, dampingFraction: 0.78), value: viewModel.towerOffset)
        }
    }
}

// MARK: - Header

private struct FootballTowerHeader: View {
    let floor: Int
    let difficulty: FootballTowerDifficulty
    let streak: Int
    let usedCount: Int
    let mode: FootballTowerRunMode

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("FLOOR \(floor)")
                    .font(BKFont.headline(18))
                    .foregroundStyle(BKTheme.accent)
                Text(difficulty.label)
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                HStack(spacing: 4) {
                    Ph.fire.fill
                        .color(BKTheme.streak)
                        .frame(width: 12, height: 12)
                    Text("\(streak)")
                        .font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.textPrimary)
                }
                Text("\(usedCount) used")
                    .font(BKFont.caption(9))
                    .foregroundStyle(BKTheme.textMuted)
            }
        }
        .padding(14)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - Tower Visual

private struct FootballTowerVisual: View {
    let currentFloor: Int
    let streak: Int
    let offset: CGFloat
    let isClimbing: Bool

    var body: some View {
        ZStack(alignment: .bottom) {
            RoundedRectangle(cornerRadius: 18)
                .fill(
                    LinearGradient(
                        colors: [BKTheme.cardElevated, BKTheme.card, BKTheme.background],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(height: 220)
                .overlay {
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(BKTheme.accent.opacity(0.2), lineWidth: 1)
                }

            VStack(spacing: 6) {
                ForEach((max(1, currentFloor - 4)...currentFloor).reversed(), id: \.self) { floor in
                    towerFloorRow(floor: floor, isCurrent: floor == currentFloor)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .offset(y: offset)
        }
        .overlay(alignment: .topTrailing) {
            if isClimbing {
                Text("+100")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(BKTheme.accent.opacity(0.15))
                    .clipShape(Capsule())
                    .padding(12)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
    }

    private func towerFloorRow(floor: Int, isCurrent: Bool) -> some View {
        HStack {
            Text("F\(floor)")
                .font(BKFont.caption(10))
                .foregroundStyle(BKTheme.textMuted)
                .frame(width: 28, alignment: .leading)
            RoundedRectangle(cornerRadius: 6)
                .fill(isCurrent ? BKTheme.accent.opacity(0.85) : BKTheme.cardElevated)
                .frame(height: isCurrent ? 14 : 10)
                .overlay(alignment: .leading) {
                    if isCurrent {
                        Circle()
                            .fill(BKTheme.background)
                            .frame(width: 8, height: 8)
                            .padding(.leading, 6)
                    }
                }
        }
    }
}

private struct FootballTowerPreviewStack: View {
    let floor: Int

    var body: some View {
        ZStack(alignment: .bottom) {
            RoundedRectangle(cornerRadius: 16)
                .fill(BKTheme.card)
                .frame(height: 140)
            VStack(spacing: 5) {
                ForEach(0..<5, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 4)
                        .fill(index == 0 && floor > 0 ? BKTheme.accent.opacity(0.7) : BKTheme.cardElevated)
                        .frame(height: 8)
                }
            }
            .padding(20)
        }
        .padding(.horizontal, 40)
    }
}

// MARK: - Question Card

private struct FootballTowerQuestionCard: View {
    let question: FootballTowerQuestion

    var body: some View {
        VStack(spacing: 10) {
            Text("QUESTION")
                .font(BKFont.caption(10))
                .tracking(0.8)
                .foregroundStyle(BKTheme.textMuted)
            Text(question.prompt)
                .font(BKFont.headline(17))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(BKTheme.cardElevated.opacity(0.95))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Search

private struct FootballTowerSearchSection: View {
    @Bindable var viewModel: FootballTowerViewModel
    let question: FootballTowerQuestion
    var isSearchFocused: FocusState<Bool>.Binding

    private var placeholder: String {
        switch question.answerType {
        case .player: return "Search player…"
        case .club: return "Search club…"
        case .country: return "Search country…"
        }
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                TextField("", text: $viewModel.searchQuery, prompt:
                    Text(placeholder)
                        .foregroundStyle(BKTheme.textMuted)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                )
                .textFieldStyle(.plain)
                .foregroundStyle(BKTheme.background)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused(isSearchFocused)
                .submitLabel(.search)
                .onChange(of: viewModel.searchQuery) { _, _ in
                    Task { await viewModel.search() }
                }

                if viewModel.isSearching {
                    ProgressView().tint(BKTheme.accent)
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
                    ForEach(viewModel.searchResults) { suggestion in
                        Button {
                            isSearchFocused.wrappedValue = false
                            viewModel.submit(suggestion)
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(suggestion.name.uppercased())
                                        .font(.system(size: 13, weight: .bold, design: .rounded))
                                        .foregroundStyle(BKTheme.textPrimary)
                                    Text(suggestion.subtitle)
                                        .font(BKFont.caption(11))
                                        .foregroundStyle(BKTheme.textMuted)
                                }
                                Spacer()
                                Ph.caretRight.bold
                                    .color(BKTheme.textMuted)
                                    .frame(width: 12, height: 12)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                        }
                        .disabled(viewModel.state?.usedAnswerIds.contains(suggestion.id) == true)

                        if suggestion.id != viewModel.searchResults.last?.id {
                            Divider().background(BKTheme.cardElevated)
                        }
                    }
                }
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(BKTheme.background)
    }
}

// MARK: - Result

private struct FootballTowerResultView: View {
    let summary: FootballTowerResultSummary
    let mode: FootballTowerRunMode
    let failedAnswer: String?
    var onLeaderboard: () -> Void
    var onShare: () -> Void
    var onFreePlay: (() -> Void)?
    var onMenu: () -> Void
    var onHome: () -> Void

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    Text("RUN OVER")
                        .font(BKFont.title(28))
                        .foregroundStyle(BKTheme.wrong)
                        .padding(.top, 24)

                    VStack(spacing: 8) {
                        Text("You reached Floor \(summary.failedFloor)")
                            .font(BKFont.headline(18))
                            .foregroundStyle(BKTheme.textPrimary)
                        Text("Correct answers: \(summary.correctCount)")
                            .font(BKFont.body(14))
                            .foregroundStyle(BKTheme.textSecondary)
                        if let failedAnswer {
                            Text("Wrong: \(failedAnswer)")
                                .font(BKFont.caption(11))
                                .foregroundStyle(BKTheme.wrong.opacity(0.85))
                        }
                    }

                    Text("\(summary.score)")
                        .font(BKFont.title(48))
                        .foregroundStyle(BKTheme.accent)

                    if mode == .daily {
                        Text("+\(summary.xpEarned) XP")
                            .font(BKFont.headline(18))
                            .foregroundStyle(BKTheme.accent)
                    }

                    FootballTowerShareCardView(summary: summary, mode: mode)

                    VStack(spacing: 10) {
                        Button(action: onLeaderboard) {
                            primaryButton("VIEW LEADERBOARD")
                        }
                        Button(action: onShare) {
                            secondaryButton("SHARE RESULT")
                        }
                        if let onFreePlay {
                            Button(action: onFreePlay) {
                                secondaryButton("FREE PLAY")
                            }
                        }
                        if onFreePlay != nil {
                            Button(action: onMenu) {
                                Text("BACK TO MENU")
                                    .font(BKFont.caption(11))
                                    .foregroundStyle(BKTheme.textMuted)
                            }
                        }
                        Button(action: onHome) {
                            Text(onFreePlay == nil ? "DONE" : "BACK TO GAMES")
                                .font(BKFont.caption(11))
                                .foregroundStyle(BKTheme.textMuted)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
        }
    }

    private func primaryButton(_ title: String) -> some View {
        Text(title)
            .font(BKFont.headline(14))
            .foregroundStyle(BKTheme.background)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(BKTheme.accent)
            .clipShape(Capsule())
    }

    private func secondaryButton(_ title: String) -> some View {
        Text(title)
            .font(BKFont.headline(14))
            .foregroundStyle(BKTheme.textPrimary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(BKTheme.card)
            .clipShape(Capsule())
    }
}

// MARK: - Share Card

struct FootballTowerShareCardView: View {
    let summary: FootballTowerResultSummary
    let mode: FootballTowerRunMode

    var body: some View {
        VStack(spacing: 14) {
            Text("FOOTBALL TOWER")
                .font(BKFont.caption(10))
                .tracking(1)
                .foregroundStyle(BKTheme.accent)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("FLOOR REACHED")
                        .font(BKFont.caption(9))
                        .foregroundStyle(BKTheme.textMuted)
                    Text("\(summary.failedFloor)")
                        .font(BKFont.title(32))
                        .foregroundStyle(BKTheme.accent)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text("Top \(summary.percentile)%")
                        .font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text("Rank #\(summary.rank)")
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.textMuted)
                }
            }

            HStack {
                stat("CORRECT", "\(summary.correctCount)")
                Spacer()
                stat("SCORE", "\(summary.score)")
                Spacer()
                stat("STREAK", "\(summary.bestStreak)")
            }

            if let standout = summary.standoutAnswer {
                Text("Standout: \(standout)")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(16)
        .background(
            LinearGradient(
                colors: [BKTheme.cardElevated, BKTheme.card],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18)
                .stroke(BKTheme.accent.opacity(0.25), lineWidth: 1)
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(BKFont.caption(8))
                .foregroundStyle(BKTheme.textMuted)
            Text(value)
                .font(BKFont.headline(13))
                .foregroundStyle(BKTheme.textPrimary)
        }
    }
}

private struct FootballTowerShareSheet: View {
    let summary: FootballTowerResultSummary
    let mode: FootballTowerRunMode
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                FootballTowerShareCardView(summary: summary, mode: mode)
                    .padding(.horizontal, 16)

                ShareLink(item: FootballTowerSeed.shareText(summary: summary, mode: mode)) {
                    Text("SHARE")
                        .font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.background)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(BKTheme.accent)
                        .clipShape(Capsule())
                }
                .padding(.horizontal, 16)

                Spacer()
            }
            .padding(.top, 16)
            .background(BKTheme.background)
            .navigationTitle("Share Result")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(BKTheme.accent)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct FootballTowerLeaderboardSheet: View {
    let entries: [FootballTowerLeaderboardEntry]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(Array(entries.enumerated()), id: \.element.id) { index, entry in
                HStack {
                    Text("#\(index + 1)")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textMuted)
                        .frame(width: 28, alignment: .leading)
                    Text(entry.name)
                        .font(BKFont.headline(14))
                        .foregroundStyle(entry.isUser ? BKTheme.accent : BKTheme.textPrimary)
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("F\(entry.floor)")
                            .font(BKFont.headline(13))
                        Text("\(entry.score)")
                            .font(BKFont.caption(9))
                            .foregroundStyle(BKTheme.textMuted)
                    }
                }
                .listRowBackground(entry.isUser ? BKTheme.cardElevated : BKTheme.card)
            }
            .scrollContentBackground(.hidden)
            .background(BKTheme.background)
            .navigationTitle("Daily Leaderboard")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(BKTheme.accent)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
