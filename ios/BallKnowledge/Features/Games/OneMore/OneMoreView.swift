import SwiftUI

// MARK: - ViewModel

@MainActor
@Observable
final class OneMoreViewModel {
    var state: OneMoreGameState
    var searchQuery = ""
    var searchResults: [PlayerSearchResultDTO] = []
    var isSearching = false
    var showResult = false
    var showBustOverlay = false
    var confettiBurstToken = 0
    var scorePulseToken = 0
    var lastFeedback: String?

    private let practice: Bool
    private let serverPrompt: Bool

    init(practice: Bool = false, dailyDate: String? = nil, serverPuzzle: OneMorePuzzleDTO? = nil) {
        self.practice = practice
        let serverDaily = practice ? nil : serverPuzzle.flatMap(OneMoreSeed.makeServerPrompt)
        self.serverPrompt = serverDaily != nil
        let prompt = practice
            ? OneMoreSeed.makePracticePrompt()
            : (serverDaily ?? OneMoreSeed.makeDailyPrompt(date: dailyDate))
        self.state = OneMoreGameState(prompt: prompt)
    }

    var xpEarned: Int {
        let score = state.phase == .busted ? 0 : state.bankedScore
        return OneMoreScoring.xp(from: score, streak: state.streak)
    }

    var canCashOut: Bool {
        state.phase == .playing && state.streak > 0
    }

    var atRiskScore: Int {
        state.currentScore
    }

    func search() async {
        let query = searchQuery.trimmingCharacters(in: .whitespaces)
        guard query.count >= 2 else {
            searchResults = []
            return
        }
        isSearching = true
        defer { isSearching = false }
        do {
            searchResults = try await APIClient.shared.searchPlayers(query: query)
        } catch {
            searchResults = []
        }
    }

    func submitPlayer(_ player: PlayerSearchResultDTO) async {
        guard state.phase == .playing else { return }

        if state.usedPlayerIds.contains(player.id) {
            rejectPick(player: player, reason: "Already named")
            return
        }

        state.phase = .validating

        var result: OneMoreValidationResult
        if serverPrompt, let date = state.prompt.date {
            do {
                let outcome = try await APIClient.shared.validateOneMoreAnswer(date: date, playerId: player.id)
                result = outcome.valid
                    ? .valid(statValue: outcome.statValue)
                    : .notEligible(reason: "Doesn't qualify — need \(state.prompt.minimum)+ \(state.prompt.category.label.lowercased())")
            } catch {
                result = OneMoreMatcher.validate(player, prompt: state.prompt, usedIds: state.usedPlayerIds)
            }
        } else {
            result = OneMoreMatcher.validate(player, prompt: state.prompt, usedIds: state.usedPlayerIds)
        }

        // Phase may have changed while awaiting; only proceed if still validating this turn.
        guard state.phase == .validating else { return }

        switch result {
        case .valid(let statValue):
            acceptPick(player: player, statValue: statValue)
        case .alreadyUsed:
            rejectPick(player: player, reason: "Already named")
        case .notEligible(let reason):
            rejectPick(player: player, reason: reason)
        }
    }

    func cashOut() {
        guard canCashOut else { return }
        HapticManager.success()
        state.bankedScore = state.currentScore
        state.phase = .cashedOut
        if state.streak >= OneMoreTiming.confettiThreshold {
            confettiBurstToken += 1
        }
        Task {
            try? await Task.sleep(for: .seconds(OneMoreTiming.cashOutDelay))
            showResult = true
        }
    }

    func restart() {
        let prompt = practice ? OneMoreSeed.makePracticePrompt() : OneMoreSeed.makeDailyPrompt()
        state = OneMoreGameState(prompt: prompt)
        searchQuery = ""
        searchResults = []
        showResult = false
        showBustOverlay = false
        confettiBurstToken = 0
        scorePulseToken = 0
        lastFeedback = nil
    }

    func newPracticeRound() {
        state = OneMoreGameState(prompt: OneMoreSeed.makePracticePrompt())
        searchQuery = ""
        searchResults = []
        showResult = false
        showBustOverlay = false
        lastFeedback = nil
    }

    private func acceptPick(player: PlayerSearchResultDTO, statValue: Int) {
        state.streak += 1
        let pointsAfter = state.currentScore
        state.picks.append(OneMorePick(player: player, statValue: statValue, pointsAfter: pointsAfter))
        searchQuery = ""
        searchResults = []
        lastFeedback = "+\(OneMoreScoring.points(forPick: state.streak)) pts"
        state.phase = .playing
        HapticManager.success()
        scorePulseToken += 1
    }

    private func rejectPick(player: PlayerSearchResultDTO, reason: String) {
        let lostScore = state.currentScore
        state.bustPick = OneMorePick(
            player: player,
            statValue: 0,
            pointsAfter: lostScore
        )
        state.streak = 0
        state.bankedScore = 0
        state.phase = .busted
        lastFeedback = reason
        searchQuery = ""
        searchResults = []
        HapticManager.error()
        showBustOverlay = true

        Task {
            try? await Task.sleep(for: .seconds(OneMoreTiming.bustHold))
            showBustOverlay = false
            showResult = true
        }
    }
}

// MARK: - Main View

struct OneMoreView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: OneMoreViewModel
    @FocusState private var isSearchFocused: Bool
    private let allowReplay: Bool
    private let dailyDate: String?
    var onComplete: () -> Void

    init(
        dailyDate: String? = nil,
        serverPuzzle: OneMorePuzzleDTO? = nil,
        practice: Bool = false,
        allowReplay: Bool = true,
        onComplete: @escaping () -> Void
    ) {
        _viewModel = State(initialValue: OneMoreViewModel(practice: practice, dailyDate: dailyDate, serverPuzzle: serverPuzzle))
        self.allowReplay = allowReplay
        self.dailyDate = dailyDate
        self.onComplete = onComplete
    }

    var body: some View {
        ZStack {
            NavigationStack {
                VStack(spacing: 0) {
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 16) {
                            OneMorePromptCard(prompt: viewModel.state.prompt)

                            OneMoreScoreHero(
                                streak: viewModel.state.streak,
                                currentScore: viewModel.state.currentScore,
                                nextPoints: viewModel.state.nextPickPoints,
                                riskLabel: OneMoreScoring.riskLabel(forStreak: viewModel.state.streak),
                                pulseToken: viewModel.scorePulseToken,
                                isActive: viewModel.state.isActive
                            )

                            if !viewModel.state.picks.isEmpty {
                                OneMorePickHistory(
                                    picks: viewModel.state.picks,
                                    statLabel: viewModel.state.prompt.category.label.lowercased()
                                )
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 16)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onTapGesture { isSearchFocused = false }

                    if viewModel.canCashOut {
                        OneMoreCashOutButton(score: viewModel.state.currentScore) {
                            isSearchFocused = false
                            viewModel.cashOut()
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 10)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }

                    if viewModel.state.isActive {
                        OneMoreSearchSection(
                            viewModel: viewModel,
                            isSearchFocused: $isSearchFocused
                        )
                    }
                }
                .animation(.spring(response: 0.38, dampingFraction: 0.78), value: viewModel.state.streak)
                .animation(.spring(response: 0.38, dampingFraction: 0.78), value: viewModel.canCashOut)
                .background(BKTheme.background)
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
                        Text("ONE MORE")
                            .font(BKFont.caption(13))
                            .tracking(1)
                            .foregroundStyle(BKTheme.accent)
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        if allowReplay, viewModel.state.phase == .playing {
                            Button { viewModel.newPracticeRound() } label: {
                                Text("NEW")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.textMuted)
                            }
                        }
                    }
                }
            }

            if viewModel.showBustOverlay {
                OneMoreBustOverlay(
                    lostScore: viewModel.state.bustPick?.pointsAfter ?? 0,
                    reason: viewModel.lastFeedback ?? "Wrong answer"
                )
                .transition(.opacity)
                .zIndex(50)
            }

            FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                .zIndex(999)
        }
        .fullScreenCover(isPresented: $viewModel.showResult) {
            OneMoreResultView(
                prompt: viewModel.state.prompt,
                outcome: viewModel.state.phase,
                picks: viewModel.state.picks,
                bustPick: viewModel.state.bustPick,
                finalScore: viewModel.state.phase == .busted ? 0 : viewModel.state.bankedScore,
                streak: viewModel.state.picks.count,
                xpEarned: viewModel.xpEarned,
                showPlayAgain: allowReplay,
                onPlayAgain: {
                    viewModel.showResult = false
                    viewModel.restart()
                },
                onHome: {
                    if !allowReplay, let dailyDate {
                        Task {
                            await DailyCompletionService.recordCompletion(
                                modeId: GameModeID.oneMore.rawValue,
                                date: dailyDate,
                                score: viewModel.state.phase == .busted ? 0 : viewModel.state.bankedScore,
                                won: viewModel.state.phase == .cashedOut,
                                context: modelContext
                            )
                        }
                    }
                    viewModel.showResult = false
                    onComplete()
                    dismiss()
                }
            )
        }
    }
}

// MARK: - Prompt Card

private struct OneMorePromptCard: View {
    let prompt: OneMorePrompt

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                if prompt.isDaily {
                    Text("DAILY CHALLENGE")
                        .font(BKFont.caption(10))
                        .tracking(0.8)
                        .foregroundStyle(BKTheme.accent)
                } else {
                    Text("PRACTICE")
                        .font(BKFont.caption(10))
                        .tracking(0.8)
                        .foregroundStyle(BKTheme.textMuted)
                }
                Spacer()
                LeagueBadgeImage(league: prompt.league.rawValue, size: 22) {
                    Text(GuessWhoDisplay.leagueAbbrev(prompt.league.rawValue))
                        .font(.system(size: 8, weight: .bold, design: .rounded))
                        .foregroundStyle(BKTheme.textMuted)
                }
            }

            VStack(spacing: 8) {
                Text("NAME PLAYERS WITH")
                    .font(BKFont.caption(11))
                    .tracking(1)
                    .foregroundStyle(BKTheme.textMuted)
                Text("\(prompt.minimum)+ \(prompt.league.rawValue.uppercased()) \(prompt.category.label.uppercased())")
                    .font(BKFont.headline(18))
                    .foregroundStyle(BKTheme.textPrimary)
                    .multilineTextAlignment(.center)
                Text(prompt.ruleLine.uppercased())
                    .font(BKFont.caption(10))
                    .tracking(0.5)
                    .foregroundStyle(BKTheme.wrong.opacity(0.9))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(BKTheme.cardElevated.opacity(0.9))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Score Hero

private struct OneMoreScoreHero: View {
    let streak: Int
    let currentScore: Int
    let nextPoints: Int
    let riskLabel: String
    let pulseToken: Int
    let isActive: Bool

    @State private var pulseScale: CGFloat = 1

    private var dangerLevel: Double {
        min(1, Double(streak) / 10)
    }

    var body: some View {
        VStack(spacing: 14) {
            HStack {
                HStack(spacing: 6) {
                    Ph.fire.fill
                        .color(BKTheme.streak)
                        .frame(width: 16, height: 16)
                    Text("\(streak) STREAK")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textPrimary)
                }
                Spacer()
                if isActive, streak > 0 {
                    Text("+\(nextPoints) NEXT")
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.accent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(BKTheme.accent.opacity(0.12))
                        .clipShape(Capsule())
                }
            }

            Text("\(currentScore)")
                .font(BKFont.title(52))
                .foregroundStyle(BKTheme.accent)
                .scaleEffect(pulseScale)
                .contentTransition(.numericText())
                .animation(.spring(response: 0.32, dampingFraction: 0.55), value: currentScore)

            Text(riskLabel.uppercased())
                .font(BKFont.caption(10))
                .tracking(0.5)
                .foregroundStyle(BKTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .stroke(
                    LinearGradient(
                        colors: [
                            BKTheme.accent.opacity(0.15 + dangerLevel * 0.45),
                            BKTheme.wrong.opacity(dangerLevel * 0.35),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1.5
                )
        }
        .onChange(of: pulseToken) { _, _ in
            pulseScale = 1.12
            withAnimation(.spring(response: 0.28, dampingFraction: 0.45)) {
                pulseScale = 1
            }
        }
    }
}

// MARK: - Pick History

private struct OneMorePickHistory: View {
    let picks: [OneMorePick]
    var statLabel: String = "goals"

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("YOUR RUN")
                .font(BKFont.caption(11))
                .tracking(0.8)
                .foregroundStyle(BKTheme.textMuted)

            ForEach(Array(picks.enumerated().reversed()), id: \.element.id) { index, pick in
                HStack(spacing: 10) {
                    Text("#\(picks.count - index)")
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.accent)
                        .frame(width: 24, alignment: .leading)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(pick.player.name)
                            .font(BKFont.headline(14))
                            .foregroundStyle(BKTheme.textPrimary)
                            .lineLimit(1)
                        Text("\(pick.statValue) \(statLabel)")
                            .font(BKFont.caption(10))
                            .foregroundStyle(BKTheme.textMuted)
                    }

                    Spacer(minLength: 0)

                    Text("+\(OneMoreScoring.points(forPick: picks.count - index))")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.accent)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(BKTheme.cardElevated.opacity(0.85))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }
}

// MARK: - Cash Out

private struct OneMoreCashOutButton: View {
    let score: Int
    var action: () -> Void

    @State private var glow = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Ph.lightning.fill
                    .color(BKTheme.background)
                    .frame(width: 16, height: 16)
                Text("CASH OUT · \(score) PTS")
                    .font(BKFont.headline(15))
                    .foregroundStyle(BKTheme.background)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                LinearGradient(
                    colors: [BKTheme.accent, BKTheme.accentMuted],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .clipShape(Capsule())
            .shadow(color: BKTheme.accent.opacity(glow ? 0.45 : 0.2), radius: glow ? 14 : 6, y: 2)
        }
        .buttonStyle(.plain)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
                glow = true
            }
        }
    }
}

// MARK: - Search

private struct OneMoreSearchSection: View {
    @Bindable var viewModel: OneMoreViewModel
    var isSearchFocused: FocusState<Bool>.Binding

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                TextField("", text: $viewModel.searchQuery, prompt:
                    Text(viewModel.state.prompt.searchHint)
                        .foregroundStyle(BKTheme.textMuted)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                )
                .textFieldStyle(.plain)
                .foregroundStyle(BKTheme.background)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused(isSearchFocused)
                .submitLabel(.search)
                .disabled(viewModel.state.phase == .validating)
                .onChange(of: viewModel.searchQuery) { _, _ in
                    Task { await viewModel.search() }
                }

                if viewModel.isSearching || viewModel.state.phase == .validating {
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

            if let feedback = viewModel.lastFeedback, viewModel.state.phase == .playing {
                Text(feedback.uppercased())
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.accent)
            }

            if !viewModel.searchResults.isEmpty {
                PlayerSearchResultsList(
                    players: viewModel.searchResults,
                    isDisabled: { viewModel.state.usedPlayerIds.contains($0.id) },
                    onSelect: { player in
                        isSearchFocused.wrappedValue = false
                        Task { await viewModel.submitPlayer(player) }
                    }
                )
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(BKTheme.background)
    }
}

// MARK: - Bust Overlay

private struct OneMoreBustOverlay: View {
    let lostScore: Int
    let reason: String

    @State private var shake = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.82).ignoresSafeArea()

            VStack(spacing: 16) {
                Ph.xCircle.fill
                    .color(BKTheme.wrong)
                    .frame(width: 56, height: 56)

                Text("BUSTED")
                    .font(BKFont.title(36))
                    .foregroundStyle(BKTheme.wrong)

                if lostScore > 0 {
                    Text("Lost \(lostScore) points on the line")
                        .font(BKFont.headline(16))
                        .foregroundStyle(BKTheme.textPrimary)
                }

                Text(reason.uppercased())
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            .offset(x: shake ? -8 : 0)
        }
        .onAppear {
            withAnimation(.default.repeatCount(4, autoreverses: true).speed(6)) {
                shake = true
            }
        }
    }
}

// MARK: - Result View

private struct OneMoreResultView: View {
    let prompt: OneMorePrompt
    let outcome: OneMorePhase
    let picks: [OneMorePick]
    let bustPick: OneMorePick?
    let finalScore: Int
    let streak: Int
    let xpEarned: Int
    var showPlayAgain = true
    var onPlayAgain: () -> Void
    var onHome: () -> Void

    private var isBusted: Bool { outcome == .busted }

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        Text("ONE MORE")
                            .font(BKFont.caption(11))
                            .tracking(1)
                            .foregroundStyle(BKTheme.accent)
                        Text(isBusted ? "RUN OVER" : "CASHED OUT")
                            .font(BKFont.title(28))
                            .foregroundStyle(isBusted ? BKTheme.wrong : BKTheme.textPrimary)
                        Text(prompt.title)
                            .font(BKFont.body(14))
                            .foregroundStyle(BKTheme.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 24)

                    Text("\(finalScore)")
                        .font(BKFont.title(52))
                        .foregroundStyle(isBusted ? BKTheme.textMuted : BKTheme.accent)

                    Text(isBusted ? "0 points banked" : "\(streak) correct · streak complete")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textMuted)

                    VStack(spacing: 8) {
                        ForEach(picks) { pick in
                            HStack(spacing: 10) {
                                Ph.checkCircle.fill
                                    .color(BKTheme.accent)
                                    .frame(width: 14, height: 14)
                                Text(pick.player.name)
                                    .font(BKFont.body(13))
                                    .foregroundStyle(BKTheme.textPrimary)
                                    .lineLimit(1)
                                Spacer()
                                Text("\(pick.statValue)G")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.textMuted)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(BKTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }

                        if let bustPick {
                            HStack(spacing: 10) {
                                Ph.xCircle.fill
                                    .color(BKTheme.wrong)
                                    .frame(width: 14, height: 14)
                                Text(bustPick.player.name)
                                    .font(BKFont.body(13))
                                    .foregroundStyle(BKTheme.wrong)
                                    .lineLimit(1)
                                Spacer()
                                Text("BUST")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.wrong)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(BKTheme.wrong.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }

                    Text("+\(xpEarned) XP")
                        .font(BKFont.headline(18))
                        .foregroundStyle(BKTheme.accent)

                    VStack(spacing: 10) {
                        if showPlayAgain {
                            Button(action: onPlayAgain) {
                                Text("PLAY AGAIN")
                                    .font(BKFont.headline(14))
                                    .foregroundStyle(BKTheme.background)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                                    .background(BKTheme.accent)
                                    .clipShape(Capsule())
                            }
                        }

                        Button(action: onHome) {
                            Text(showPlayAgain ? "BACK TO GAMES" : "DONE")
                                .font(BKFont.headline(14))
                                .foregroundStyle(BKTheme.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(BKTheme.card)
                                .clipShape(Capsule())
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
        }
    }
}
