import SwiftUI
import SwiftData

// MARK: - ViewModel

@MainActor
@Observable
final class TargetManViewModel {
    var state: TargetManGameState
    var searchQuery = ""
    var searchResults: [PlayerSearchResultDTO] = []
    var isSearching = false
    var isResolvingStats = false
    var errorMessage: String?
    var confettiBurstToken = 0
    var showResult = false

    private let practice: Bool
    private let dailyBundle: DailyBundleDTO?

    init(dailyBundle: DailyBundleDTO? = nil, practice: Bool = false, challenge: TargetManChallenge? = nil) {
        self.practice = practice
        self.dailyBundle = dailyBundle
        let resolved = challenge ?? {
            if practice {
                return TargetManSeed.makePracticeChallenge()
            }
            if let dailyBundle {
                return DailyChallengeResolver.targetManChallenge(from: dailyBundle)
            }
            return TargetManSeed.makeDailyChallenge()
        }()
        self.state = TargetManGameState(challenge: resolved)
    }

    var xpEarned: Int {
        guard let score = state.score else { return 0 }
        return TargetManScoring.xp(from: score)
    }

    var selectedPlayerIds: Set<String> {
        Set(state.selections.map(\.player.id))
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

    func addPlayer(_ player: PlayerSearchResultDTO) {
        guard state.phase == .selecting else { return }
        guard !selectedPlayerIds.contains(player.id) else { return }
        guard state.selections.count < TargetManGameState.slotCount else { return }

        HapticManager.light()
        state.selections.append(TargetManSelection(player: player))
        searchQuery = ""
        searchResults = []
    }

    func removePlayer(at index: Int) {
        guard state.phase == .selecting else { return }
        guard state.selections.indices.contains(index) else { return }
        HapticManager.light()
        state.selections.remove(at: index)
    }

    func lockAnswers() async {
        guard state.canLock, !isResolvingStats else { return }
        HapticManager.success()
        isResolvingStats = true
        errorMessage = nil
        defer { isResolvingStats = false }

        do {
            state.selections = try await TargetManStats.resolveStats(
                for: state.selections,
                challenge: state.challenge
            )
        } catch {
            errorMessage = error.localizedDescription
            return
        }

        state.phase = .revealing
        revealResults()
    }

    func restart() {
        let challenge: TargetManChallenge
        if practice {
            challenge = TargetManSeed.makePracticeChallenge()
        } else if let dailyBundle {
            challenge = DailyChallengeResolver.targetManChallenge(from: dailyBundle)
        } else {
            challenge = TargetManSeed.makeDailyChallenge()
        }
        state = TargetManGameState(challenge: challenge)
        searchQuery = ""
        searchResults = []
        errorMessage = nil
        confettiBurstToken = 0
        showResult = false
    }

    func newPracticeRound() {
        state = TargetManGameState(challenge: TargetManSeed.makePracticeChallenge())
        searchQuery = ""
        searchResults = []
        showResult = false
    }

    private func revealResults() {
        state.revealedCount = 0
        let total = state.selections.count

        Task {
            for index in 0..<total {
                try? await Task.sleep(for: .seconds(TargetManTiming.revealStagger))
                state.revealedCount = index + 1
                HapticManager.light()
            }

            let combined = state.selections.compactMap(\.statValue).reduce(0, +)
            let difference = combined - state.challenge.target
            let score = TargetManScoring.points(forDifference: difference)

            state.combinedTotal = combined
            state.difference = difference
            state.score = score
            state.phase = .complete

            if score >= 900 {
                HapticManager.success()
                confettiBurstToken += 1
            } else if score >= 400 {
                HapticManager.light()
            }

            showResult = true
        }
    }
}

// MARK: - Main View

struct TargetManView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: TargetManViewModel
    @FocusState private var isSearchFocused: Bool
    private let allowReplay: Bool
    private let dailyDate: String?
    var onComplete: () -> Void

    init(
        dailyBundle: DailyBundleDTO? = nil,
        practice: Bool = false,
        allowReplay: Bool = true,
        onComplete: @escaping () -> Void
    ) {
        _viewModel = State(initialValue: TargetManViewModel(dailyBundle: dailyBundle, practice: practice))
        self.allowReplay = allowReplay
        self.dailyDate = dailyBundle?.date
        self.onComplete = onComplete
    }

    var body: some View {
        ZStack {
            NavigationStack {
                VStack(spacing: 0) {
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 20) {
                            TargetManChallengeCard(challenge: viewModel.state.challenge)

                            TargetManSlotsView(
                                selections: viewModel.state.selections,
                                phase: viewModel.state.phase,
                                revealedCount: viewModel.state.revealedCount,
                                category: viewModel.state.challenge.category,
                                onRemove: { viewModel.removePlayer(at: $0) }
                            )
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 24)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onTapGesture { isSearchFocused = false }

                    if viewModel.state.phase == .selecting {
                        TargetManSearchSection(
                            viewModel: viewModel,
                            isSearchFocused: $isSearchFocused
                        )
                    }

                    if viewModel.state.canLock {
                        if let error = viewModel.errorMessage {
                            Text(error)
                                .font(BKFont.caption())
                                .foregroundStyle(BKTheme.wrong)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 16)
                        }

                        TargetManLockButton(isLoading: viewModel.isResolvingStats) {
                            isSearchFocused = false
                            Task { await viewModel.lockAnswers() }
                        }
                    }
                }
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
                        Text("TARGET MAN")
                            .font(BKFont.caption(13))
                            .tracking(1)
                            .foregroundStyle(BKTheme.accent)
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        if allowReplay, viewModel.state.phase == .selecting {
                            Button {
                                viewModel.newPracticeRound()
                            } label: {
                                Text("NEW")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.textMuted)
                            }
                        }
                    }
                }
            }

            FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                .zIndex(999)
        }
        .fullScreenCover(isPresented: $viewModel.showResult) {
            TargetManResultView(
                challenge: viewModel.state.challenge,
                selections: viewModel.state.selections,
                combinedTotal: viewModel.state.combinedTotal ?? 0,
                difference: viewModel.state.difference ?? 0,
                score: viewModel.state.score ?? 0,
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
                                modeId: GameModeID.targetMan.rawValue,
                                date: dailyDate,
                                score: viewModel.state.score ?? 0,
                                won: (viewModel.state.score ?? 0) >= 400,
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

// MARK: - Challenge Card

private struct TargetManChallengeCard: View {
    let challenge: TargetManChallenge

    var body: some View {
        VStack(spacing: 14) {
            HStack {
                if challenge.isDaily {
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
                LeagueBadgeImage(league: challenge.league.rawValue, size: 22) {
                    Text(GuessWhoDisplay.leagueAbbrev(challenge.league.rawValue))
                        .font(.system(size: 8, weight: .bold, design: .rounded))
                        .foregroundStyle(BKTheme.textMuted)
                }
            }

            VStack(spacing: 6) {
                Text("TARGET")
                    .font(BKFont.caption(11))
                    .tracking(1)
                    .foregroundStyle(BKTheme.textMuted)
                Text("\(challenge.target)")
                    .font(BKFont.title(42))
                    .foregroundStyle(BKTheme.accent)
                Text(challenge.title.uppercased())
                    .font(BKFont.caption(11))
                    .tracking(0.6)
                    .foregroundStyle(BKTheme.textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(BKTheme.cardElevated.opacity(0.9))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Slots

private struct TargetManSlotsView: View {
    let selections: [TargetManSelection]
    let phase: TargetManPhase
    let revealedCount: Int
    let category: TargetManStatCategory
    var onRemove: (Int) -> Void

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                Text("YOUR 5 PLAYERS")
                    .font(BKFont.caption(11))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Spacer()
                Text("\(selections.count)/\(TargetManGameState.slotCount)")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.accent)
            }

            ForEach(0..<TargetManGameState.slotCount, id: \.self) { index in
                if selections.indices.contains(index) {
                    TargetManFilledSlotRow(
                        selection: selections[index],
                        index: index + 1,
                        category: category,
                        isRevealed: phase != .selecting && revealedCount > index,
                        canRemove: phase == .selecting,
                        onRemove: { onRemove(index) }
                    )
                } else {
                    TargetManEmptySlotRow(index: index + 1)
                }
            }
        }
    }
}

private struct TargetManEmptySlotRow: View {
    let index: Int

    var body: some View {
        HStack(spacing: 12) {
            Text("\(index)")
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .foregroundStyle(BKTheme.textMuted)
                .frame(width: 24, height: 24)
                .background(BKTheme.card)
                .clipShape(Circle())

            Text("SELECT PLAYER")
                .font(BKFont.caption(11))
                .tracking(0.6)
                .foregroundStyle(BKTheme.textMuted)

            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .background(BKTheme.card.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

private struct TargetManFilledSlotRow: View {
    let selection: TargetManSelection
    let index: Int
    let category: TargetManStatCategory
    let isRevealed: Bool
    let canRemove: Bool
    var onRemove: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text("\(index)")
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .foregroundStyle(BKTheme.background)
                .frame(width: 24, height: 24)
                .background(BKTheme.accent)
                .clipShape(Circle())

            TeamBadgeImage(club: selection.player.club, league: selection.player.league, size: 28) {
                Circle()
                    .fill(BKTheme.cardElevated)
                    .frame(width: 28, height: 28)
                    .overlay(
                        Text(GuessWhoDisplay.clubAbbrev(selection.player.club))
                            .font(.system(size: 8, weight: .bold, design: .rounded))
                            .foregroundStyle(BKTheme.textMuted)
                    )
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(selection.player.name.uppercased())
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(BKTheme.textPrimary)
                    .lineLimit(1)
                if isRevealed, let stat = selection.statValue {
                    Text("\(category.label): \(stat)")
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.accent)
                        .transition(.opacity.combined(with: .move(edge: .leading)))
                } else {
                    Text("LOCKED IN")
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.textMuted)
                }
            }

            Spacer()

            if isRevealed, let stat = selection.statValue {
                Text("\(stat)")
                    .font(BKFont.headline(18))
                    .foregroundStyle(BKTheme.accent)
                    .transition(.scale.combined(with: .opacity))
            } else if canRemove {
                Button(action: onRemove) {
                    Ph.x.bold
                        .color(BKTheme.textMuted)
                        .frame(width: 12, height: 12)
                        .padding(8)
                        .background(BKTheme.cardElevated)
                        .clipShape(Circle())
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .animation(.spring(response: 0.32, dampingFraction: 0.78), value: isRevealed)
    }
}

// MARK: - Search

private struct TargetManSearchSection: View {
    @Bindable var viewModel: TargetManViewModel
    var isSearchFocused: FocusState<Bool>.Binding

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                TextField("", text: $viewModel.searchQuery, prompt:
                    Text(viewModel.state.isFull ? "ALL SLOTS FILLED" : "SEARCH PLAYERS")
                        .foregroundStyle(BKTheme.textMuted)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                )
                .textFieldStyle(.plain)
                .foregroundStyle(BKTheme.background)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused(isSearchFocused)
                .submitLabel(.search)
                .disabled(viewModel.state.isFull)
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
                PlayerSearchResultsList(
                    players: viewModel.searchResults,
                    showsNarrowHint: PlayerSearchUI.showsNarrowHint(
                        resultCount: viewModel.searchResults.count,
                        query: viewModel.searchQuery
                    ),
                    isDisabled: { viewModel.selectedPlayerIds.contains($0.id) || viewModel.state.isFull },
                    trailing: { player in
                        if viewModel.selectedPlayerIds.contains(player.id) {
                            return AnyView(
                                Ph.checkCircle.fill
                                    .color(BKTheme.accent)
                                    .frame(width: 14, height: 14)
                            )
                        }
                        return nil
                    },
                    onSelect: { player in
                        isSearchFocused.wrappedValue = false
                        viewModel.addPlayer(player)
                    }
                )
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

private struct TargetManLockButton: View {
    var isLoading = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if isLoading {
                    ProgressView()
                        .tint(BKTheme.background)
                } else {
                    Text("LOCK ANSWERS")
                        .font(BKFont.headline())
                }
            }
            .foregroundStyle(BKTheme.background)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(BKTheme.accent.opacity(isLoading ? 0.75 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .disabled(isLoading)
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
        .background(BKTheme.background)
    }
}

// MARK: - Result

private enum TargetManResultStep: Int, CaseIterable {
    case target = 1
    case guessed = 2
    case offBy = 3
    case points = 4
    case breakdown = 5
    case xp = 6
    case actions = 7
}

private struct TargetManResultView: View {
    let challenge: TargetManChallenge
    let selections: [TargetManSelection]
    let combinedTotal: Int
    let difference: Int
    let score: Int
    let xpEarned: Int
    var showPlayAgain = true
    var onPlayAgain: () -> Void
    var onHome: () -> Void

    @State private var step: Int = 0
    @State private var animatedTotal = 0
    @State private var animatedScore = 0

    private var distance: Int { abs(difference) }

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 20) {
                        VStack(spacing: 6) {
                            Text("RESULT")
                                .font(BKFont.caption(11))
                                .tracking(1.2)
                                .foregroundStyle(BKTheme.textMuted)
                            Text(challenge.title.uppercased())
                                .font(BKFont.caption(10))
                                .tracking(0.6)
                                .foregroundStyle(BKTheme.textSecondary)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.top, 16)

                        VStack(spacing: 10) {
                            if step >= TargetManResultStep.target.rawValue {
                                resultRevealRow(
                                    label: "TARGET \(challenge.category.valueNoun.uppercased())",
                                    value: formattedStat(challenge.target),
                                    subtitle: challenge.category.label,
                                    accent: false
                                )
                                .transition(resultTransition)
                            }

                            if step >= TargetManResultStep.guessed.rawValue {
                                resultRevealRow(
                                    label: "YOUR \(challenge.category.valueNoun.uppercased())",
                                    value: formattedStat(animatedTotal),
                                    subtitle: "Combined from your 5 picks",
                                    accent: true
                                )
                                .transition(resultTransition)
                            }

                            if step >= TargetManResultStep.offBy.rawValue {
                                resultRevealRow(
                                    label: distance == 0 ? "ON TARGET" : "OFF BY",
                                    value: offByValue,
                                    subtitle: offBySubtitle,
                                    accent: distance <= 10,
                                    warning: distance > 100
                                )
                                .transition(resultTransition)
                            }

                            if step >= TargetManResultStep.points.rawValue {
                                VStack(spacing: 8) {
                                    resultRevealRow(
                                        label: "POINTS",
                                        value: "\(animatedScore)",
                                        subtitle: TargetManScoring.tierExplanation(forDifference: difference),
                                        accent: true,
                                        large: true
                                    )

                                    Text(scoreBreakdownHint)
                                        .font(BKFont.caption(10))
                                        .foregroundStyle(BKTheme.textMuted)
                                        .multilineTextAlignment(.center)
                                        .frame(maxWidth: .infinity)
                                        .padding(.horizontal, 8)
                                }
                                .transition(resultTransition)
                            }
                        }
                        .padding(16)
                        .background(BKTheme.cardElevated.opacity(0.9))
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .padding(.horizontal, 20)

                        if step >= TargetManResultStep.breakdown.rawValue {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("PLAYER BREAKDOWN")
                                    .font(BKFont.caption(11))
                                    .tracking(0.8)
                                    .foregroundStyle(BKTheme.textMuted)

                                ForEach(Array(selections.enumerated()), id: \.element.id) { index, selection in
                                    TargetManResultPlayerRow(
                                        index: index + 1,
                                        selection: selection,
                                        category: challenge.category,
                                        appearDelay: Double(index) * 0.08
                                    )
                                }

                                HStack {
                                    Text("COMBINED")
                                        .font(BKFont.caption(10))
                                        .foregroundStyle(BKTheme.textMuted)
                                    Spacer()
                                    Text(formattedStat(combinedTotal))
                                        .font(BKFont.headline(16))
                                        .foregroundStyle(BKTheme.accent)
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 12)
                                .background(BKTheme.cardElevated)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                            .padding(.horizontal, 20)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                        }

                        if step >= TargetManResultStep.xp.rawValue {
                            Text("+\(xpEarned) XP")
                                .font(BKFont.headline(18))
                                .foregroundStyle(BKTheme.accent)
                                .transition(.scale.combined(with: .opacity))
                        }
                    }
                    .padding(.bottom, 24)
                    .animation(.spring(response: 0.38, dampingFraction: 0.78), value: step)
                }

                if step >= TargetManResultStep.actions.rawValue {
                    VStack(spacing: 12) {
                        if showPlayAgain {
                            Button(action: onPlayAgain) {
                                Text("PLAY AGAIN")
                                    .font(BKFont.headline())
                                    .foregroundStyle(BKTheme.background)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 16)
                                    .background(BKTheme.accent)
                                    .clipShape(RoundedRectangle(cornerRadius: 16))
                            }
                        }

                        Button(action: onHome) {
                            Text(showPlayAgain ? "BACK HOME" : "DONE")
                                .font(BKFont.headline())
                                .foregroundStyle(BKTheme.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background(BKTheme.card)
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 32)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .onAppear {
            runRevealSequence()
        }
    }

    private var offByValue: String {
        if distance == 0 { return "0" }
        return "\(distance)"
    }

    private var offBySubtitle: String {
        if distance == 0 {
            return "You nailed the target exactly"
        }
        let direction = difference > 0 ? "over" : "under"
        return "\(distance) \(challenge.category.offLabel) · \(direction) target of \(formattedStat(challenge.target))"
    }

    private var scoreBreakdownHint: String {
        "Scoring: exact 1,000 · within 5 → 900 · within 10 → 800 · within 25 → 600 · within 50 → 400 · within 100 → 200 · 100+ away → 50"
    }

    private var resultTransition: AnyTransition {
        .asymmetric(
            insertion: .scale(scale: 0.92).combined(with: .opacity).combined(with: .move(edge: .top)),
            removal: .opacity
        )
    }

    private func formattedStat(_ value: Int) -> String {
        if challenge.category == .minutesPlayed {
            return value.formatted(.number.grouping(.automatic))
        }
        return "\(value)"
    }

    private func resultRevealRow(
        label: String,
        value: String,
        subtitle: String,
        accent: Bool,
        large: Bool = false,
        warning: Bool = false
    ) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(label)
                    .font(BKFont.caption(10))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Text(subtitle)
                    .font(BKFont.caption(10))
                    .foregroundStyle(warning ? BKTheme.wrong.opacity(0.85) : BKTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 8)

            Text(value)
                .font(large ? BKFont.title(34) : BKFont.headline(22))
                .foregroundStyle(accent ? BKTheme.accent : BKTheme.textPrimary)
                .contentTransition(.numericText())
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(BKTheme.card.opacity(0.85))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func runRevealSequence() {
        step = 0
        animatedTotal = 0
        animatedScore = 0

        Task {
            for targetStep in TargetManResultStep.allCases {
                try? await Task.sleep(for: .seconds(step == 0 ? 0.2 : TargetManTiming.resultStepDelay))
                step = targetStep.rawValue

                switch targetStep {
                case .guessed:
                    HapticManager.light()
                    withAnimation(.spring(response: 0.45, dampingFraction: 0.82)) {
                        animatedTotal = combinedTotal
                    }
                case .offBy:
                    HapticManager.light()
                case .points:
                    if score >= 900 {
                        HapticManager.success()
                    } else {
                        HapticManager.light()
                    }
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.75)) {
                        animatedScore = score
                    }
                case .breakdown, .xp:
                    HapticManager.light()
                case .actions:
                    break
                default:
                    break
                }
            }
        }
    }
}

private struct TargetManResultPlayerRow: View {
    let index: Int
    let selection: TargetManSelection
    let category: TargetManStatCategory
    let appearDelay: Double

    @State private var appeared = false

    var body: some View {
        HStack(spacing: 12) {
            Text("\(index)")
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .foregroundStyle(BKTheme.background)
                .frame(width: 22, height: 22)
                .background(BKTheme.accent.opacity(0.85))
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(selection.player.name.uppercased())
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(BKTheme.textPrimary)
                    .lineLimit(1)
                Text(selection.player.club)
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
                    .lineLimit(1)
            }

            Spacer()

            if let stat = selection.statValue {
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(stat)")
                        .font(BKFont.headline(16))
                        .foregroundStyle(BKTheme.accent)
                    Text(category.label)
                        .font(BKFont.caption(9))
                        .foregroundStyle(BKTheme.textMuted)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared ? 0 : 10)
        .onAppear {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.8).delay(appearDelay)) {
                appeared = true
            }
        }
    }
}
