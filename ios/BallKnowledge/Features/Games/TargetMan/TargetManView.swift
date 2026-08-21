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
    var shakeToken = 0
    var wrongMessage: String?

    init(challenge: TargetManChallenge) {
        self.state = TargetManGameState(challenge: challenge)
    }

    var xpEarned: Int {
        guard let score = state.score else { return 0 }
        return TargetManScoring.xp(from: score)
    }

    /// Mid-game and worth saving: picking players, at least one chosen.
    var isResumable: Bool {
        state.phase == .selecting && !state.selections.isEmpty
    }

    func restore(_ saved: TargetManGameState) {
        state = saved
        searchQuery = ""
        searchResults = []
        errorMessage = nil
        showResult = false
        wrongMessage = nil
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

        var selection = TargetManSelection(player: player)
        if let pool = state.challenge.pool, pool.isNationality, !pool.matchesNationality(player.nationality) {
            selection.poolMissReason = pool.rejectReason(playerName: player.name)
        }
        state.selections.append(selection)
        searchQuery = ""
        searchResults = []

        if let reason = selection.poolMissReason {
            flashWrong(reason)
            return
        }
        Feedback.play(.place)
        if let pool = state.challenge.pool, pool.isClub {
            Task { await verifyClubPool(playerId: player.id, playerName: player.name, pool: pool) }
        }
    }

    private func verifyClubPool(playerId: String, playerName: String, pool: TargetManPoolDTO) async {
        do {
            let matches = try await APIClient.shared.targetManPoolMatch(playerIds: [playerId], pool: pool)
            guard matches[playerId] == false else { return }
            guard let index = state.selections.firstIndex(where: { $0.player.id == playerId }) else { return }
            let reason = pool.rejectReason(playerName: playerName)
            state.selections[index].poolMissReason = reason
            flashWrong(reason)
        } catch {
            return
        }
    }

    private func flashWrong(_ reason: String) {
        Feedback.play(.deny)
        shakeToken += 1
        wrongMessage = reason
        Task {
            try? await Task.sleep(for: .seconds(2.4))
            if wrongMessage == reason { wrongMessage = nil }
        }
    }

    func removePlayer(at index: Int) {
        guard state.phase == .selecting else { return }
        guard state.selections.indices.contains(index) else { return }
        HapticManager.light()
        state.selections.remove(at: index)
    }

    func lockAnswers() async {
        guard state.canLock, !isResolvingStats else { return }
        Feedback.play(.lock)
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
        state = TargetManGameState(challenge: state.challenge)
        searchQuery = ""
        searchResults = []
        errorMessage = nil
        confettiBurstToken = 0
        showResult = false
        wrongMessage = nil
    }

    private func revealResults() {
        state.revealedCount = 0
        let total = state.selections.count

        Task {
            for index in 0..<total {
                try? await Task.sleep(for: .seconds(TargetManTiming.revealStagger))
                state.revealedCount = index + 1
                if state.selections.indices.contains(index), state.selections[index].isPoolMiss {
                    Feedback.play(.deny)
                } else {
                    Feedback.play(.reveal)
                }
            }

            let combined = state.selections.compactMap(\.statValue).reduce(0, +)
            let difference = combined - state.challenge.target
            let score = TargetManScoring.points(forDifference: difference, target: state.challenge.target)

            state.combinedTotal = combined
            state.difference = difference
            state.score = score
            state.phase = .complete

            if score >= 1000 {
                Feedback.play(.win)
                confettiBurstToken += 1
            } else if score >= TargetManScoring.winThreshold {
                Feedback.play(.win)
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
    @State private var showHelp = false
    @FocusState private var isSearchFocused: Bool
    private let allowReplay: Bool
    private let showsXp: Bool
    private let dailyDate: String?
    private let onSubmit: ((TargetManGameState) async -> Void)?
    var onComplete: () -> Void

    init(
        challenge: TargetManChallenge,
        allowReplay: Bool = false,
        showsXp: Bool = true,
        onSubmit: ((TargetManGameState) async -> Void)? = nil,
        onComplete: @escaping () -> Void
    ) {
        _viewModel = State(initialValue: TargetManViewModel(challenge: challenge))
        self.allowReplay = allowReplay
        self.showsXp = showsXp
        self.dailyDate = challenge.date
        self.onSubmit = onSubmit
        self.onComplete = onComplete
    }

    var body: some View {
        ZStack {
            NavigationStack {
                VStack(spacing: 0) {
                    if showsXp, let score = viewModel.state.score {
                        GameXPBar(current: score, max: DailyXP.maxXP(.targetMan))
                    } else {
                        GameXPBar(current: viewModel.state.selections.count, max: TargetManGameState.slotCount, label: "PICKS")
                    }
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 20) {
                            TargetManChallengeCard(challenge: viewModel.state.challenge)

                            TargetManSlotsView(
                                selections: viewModel.state.selections,
                                phase: viewModel.state.phase,
                                revealedCount: viewModel.state.revealedCount,
                                challenge: viewModel.state.challenge,
                                onRemove: { viewModel.removePlayer(at: $0) }
                            )
                            .modifier(TargetManShakeEffect(animatableData: CGFloat(viewModel.shakeToken)))
                            .animation(.linear(duration: 0.4), value: viewModel.shakeToken)

                            if let msg = viewModel.wrongMessage {
                                Text(msg.uppercased())
                                    .font(BKFont.caption(11))
                                    .tracking(0.5)
                                    .foregroundStyle(BKTheme.wrong)
                                    .multilineTextAlignment(.center)
                                    .transition(.opacity)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 24)
                        .animation(.easeInOut(duration: 0.2), value: viewModel.wrongMessage)
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
                        Text("TARGET MAN")
                            .font(BKFont.caption(13))
                            .tracking(1)
                            .foregroundStyle(BKTheme.accent)
                    }
                    GameHelpToolbarButton(isPresented: $showHelp)
                    // Dev-only replay (allowReplay) re-runs today's daily; hidden for real users.
                    ToolbarItem(placement: .topBarTrailing) {
                        if allowReplay, viewModel.state.phase == .selecting {
                            Button {
                                viewModel.restart()
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
        .gameHelpOverlay(mode: .targetMan, isPresented: $showHelp)
        .persistsGameProgress(
            viewModel.state,
            isResumable: viewModel.isResumable,
            modeId: GameModeID.targetMan.rawValue,
            date: dailyDate,
            version: TargetManGameState.progressVersion,
            enabled: !allowReplay
        )
        .onAppear {
            SoundManager.shared.prepare()
            guard !allowReplay, let dailyDate,
                  let saved = GameProgressStore.load(
                    TargetManGameState.self, modeId: GameModeID.targetMan.rawValue,
                    date: dailyDate, version: TargetManGameState.progressVersion, context: modelContext) else { return }
            viewModel.restore(saved)
        }
        .fullScreenCover(isPresented: $viewModel.showResult) {
            TargetManResultView(
                challenge: viewModel.state.challenge,
                selections: viewModel.state.selections,
                combinedTotal: viewModel.state.combinedTotal ?? 0,
                difference: viewModel.state.difference ?? 0,
                score: viewModel.state.score ?? 0,
                xpEarned: viewModel.xpEarned,
                showsXp: showsXp,
                onHome: {
                    if onSubmit == nil, !allowReplay, let dailyDate {
                        Task {
                            await DailyCompletionService.recordCompletion(
                                modeId: GameModeID.targetMan.rawValue,
                                date: dailyDate,
                                score: viewModel.state.score ?? 0,
                                won: (viewModel.state.score ?? 0) >= TargetManScoring.winThreshold,
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

// MARK: - Challenge Card

private struct TargetManChallengeCard: View {
    let challenge: TargetManChallenge

    var body: some View {
        VStack(spacing: 14) {
            if !challenge.isServerValued {
                HStack {
                    Spacer()
                    LeagueBadgeImage(league: challenge.leagueName, size: 22) {
                        Text(GuessWhoDisplay.leagueAbbrev(challenge.leagueName))
                            .font(.system(size: 8, weight: .bold, design: .rounded))
                            .foregroundStyle(BKTheme.textMuted)
                    }
                }
            }

            VStack(spacing: 6) {
                Text("TARGET")
                    .font(BKFont.caption(11))
                    .tracking(1)
                    .foregroundStyle(BKTheme.textMuted)
                Text(challenge.formatValue(challenge.target))
                    .font(BKFont.title(54))
                    .foregroundStyle(BKTheme.accent)
                Text(challenge.title.uppercased())
                    .font(BKFont.headline(15))
                    .tracking(0.6)
                    .foregroundStyle(BKTheme.textPrimary)
                    .multilineTextAlignment(.center)
                Text("PICK 5 PLAYERS WHO TOGETHER TOTAL THIS")
                    .font(BKFont.caption(9))
                    .tracking(0.5)
                    .foregroundStyle(BKTheme.textMuted)
                    .multilineTextAlignment(.center)
                    .padding(.top, 2)
                Text("CLOSER = MORE XP · 500+ XP TO WIN")
                    .font(BKFont.caption(9))
                    .tracking(0.5)
                    .foregroundStyle(BKTheme.textMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
    }
}

// MARK: - Slots

private struct TargetManSlotsView: View {
    let selections: [TargetManSelection]
    let phase: TargetManPhase
    let revealedCount: Int
    let challenge: TargetManChallenge
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
                        challenge: challenge,
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
    let challenge: TargetManChallenge
    let isRevealed: Bool
    let canRemove: Bool
    var onRemove: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text("\(index)")
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .foregroundStyle(BKTheme.background)
                .frame(width: 24, height: 24)
                .background(selection.isPoolMiss ? BKTheme.wrong : BKTheme.accent)
                .clipShape(Circle())

            PlayerAvatar(urlString: selection.player.headshotUrl, size: 42)

            VStack(alignment: .leading, spacing: 4) {
                Text(selection.player.name.uppercased())
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(selection.isPoolMiss ? BKTheme.wrong : BKTheme.textPrimary)
                    .lineLimit(1)
                if let reason = selection.poolMissReason {
                    Text(reason)
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.wrong)
                        .lineLimit(2)
                } else if isRevealed, let stat = selection.statValue {
                    Text("\(challenge.displayCategoryLabel): \(challenge.formatValue(stat))")
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.accent)
                        .transition(.opacity.combined(with: .move(edge: .leading)))
                } else {
                    HStack(spacing: 4) {
                        Ph.checkCircle.fill.color(BKTheme.background).frame(width: 10, height: 10)
                        Text("SELECTED")
                            .font(.system(size: 9, weight: .heavy, design: .rounded))
                            .foregroundStyle(BKTheme.background)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(BKTheme.accent)
                    .clipShape(Capsule())
                }
            }

            Spacer()

            if isRevealed, let stat = selection.statValue {
                Text("\(stat)")
                    .font(BKFont.headline(18))
                    .foregroundStyle(selection.isPoolMiss ? BKTheme.wrong : BKTheme.accent)
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
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(selection.isPoolMiss ? BKTheme.wrong.opacity(0.7) : Color.clear, lineWidth: 1.5)
        )
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
                .foregroundStyle(BKTheme.textPrimary)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused(isSearchFocused)
                .submitLabel(.search)
                .disabled(viewModel.state.isFull)
                .onChange(of: viewModel.searchQuery) { _, _ in
                    Task { await viewModel.search() }
                }

                if viewModel.isSearching {
                    ProgressView().tint(BKTheme.textSecondary)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(BKTheme.cardElevated)
            .clipShape(RoundedRectangle(cornerRadius: 14))

            if !viewModel.searchResults.isEmpty {
                PlayerSearchResultsList(
                    players: viewModel.searchResults,
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

/// Horizontal shake for a wrong pool pick (same feel as Draft XI).
private struct TargetManShakeEffect: GeometryEffect {
    var animatableData: CGFloat
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 7 * sin(animatableData * .pi * 4), y: 0))
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
    var showsXp: Bool = true
    var onHome: () -> Void

    @State private var step: Int = 0
    @State private var animatedTotal = 0
    @State private var animatedScore = 0

    private var distance: Int { abs(difference) }

    private var verdict: String {
        switch score {
        case 1100: return "BULLSEYE"
        case 1000...: return "SHARPSHOOTER"
        case TargetManScoring.winThreshold...: return "ON TARGET"
        case 275...: return "OFF THE MARK"
        default: return "WIDE"
        }
    }

    private var verdictColor: Color {
        switch score {
        case TargetManScoring.winThreshold...: return BKTheme.accent
        case 275...: return .orange
        default: return BKTheme.wrong
        }
    }

    var body: some View {
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

                        TargetBullseye(score: score, landed: step >= TargetManResultStep.points.rawValue)
                            .frame(height: 168)
                            .padding(.top, 4)

                        if step >= TargetManResultStep.points.rawValue {
                            Text(verdict)
                                .font(BKFont.title(28))
                                .foregroundStyle(verdictColor)
                                .transition(.scale.combined(with: .opacity))
                        }

                        VStack(spacing: 10) {
                            if step >= TargetManResultStep.target.rawValue {
                                resultRevealRow(
                                    label: "TARGET \(challenge.displayValueNoun.uppercased())",
                                    value: formattedStat(challenge.target),
                                    subtitle: challenge.displayCategoryLabel,
                                    accent: false
                                )
                                .transition(resultTransition)
                            }

                            if step >= TargetManResultStep.guessed.rawValue {
                                resultRevealRow(
                                    label: "YOUR \(challenge.displayValueNoun.uppercased())",
                                    value: formattedStat(animatedTotal),
                                    subtitle: "Combined from your 5 picks",
                                    accent: false
                                )
                                .transition(resultTransition)
                            }

                            if step >= TargetManResultStep.offBy.rawValue {
                                resultRevealRow(
                                    label: distance == 0 ? "ON TARGET" : "OFF BY",
                                    value: offByValue,
                                    subtitle: offBySubtitle,
                                    accent: false,
                                    warning: score <= 0
                                )
                                .transition(resultTransition)
                            }

                            if showsXp, step >= TargetManResultStep.points.rawValue {
                                VStack(spacing: 8) {
                                    resultRevealRow(
                                    label: "XP EARNED",
                                    value: "\(animatedScore) XP",
                                    subtitle: TargetManScoring.tierExplanation(forDifference: difference, target: challenge.target),
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
                                        challenge: challenge,
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
                            Text(score >= TargetManScoring.winThreshold ? "Sharp shooting!" : score >= 275 ? "Solid effort" : "Room to improve")
                                .font(BKFont.headline(16))
                                .foregroundStyle(BKTheme.textSecondary)
                                .transition(.scale.combined(with: .opacity))
                        }
                    }
                    .padding(.bottom, 24)
                    .animation(.spring(response: 0.38, dampingFraction: 0.78), value: step)
            }

            if step >= TargetManResultStep.actions.rawValue {
                GameResultExitBar(action: onHome)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .background(BKTheme.background.ignoresSafeArea())
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
        return "\(distance) \(challenge.displayOffLabel) · \(direction) target of \(formattedStat(challenge.target))"
    }

    private var scoreBreakdownHint: String {
        "The closer your combined total lands to the target, the more XP you earn."
    }

    private var resultTransition: AnyTransition {
        .asymmetric(
            insertion: .scale(scale: 0.92).combined(with: .opacity).combined(with: .move(edge: .top)),
            removal: .opacity
        )
    }

    private func formattedStat(_ value: Int) -> String {
        challenge.formatValue(value)
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
                    if score >= 1000 {
                        HapticManager.success()
                    } else {
                        HapticManager.light()
                    }
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.75)) {
                        animatedScore = xpEarned
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

/// The result's hero: a concentric target where a marker lands closer to the bullseye the higher
/// your score. Pure flavour for the "hit the number" fantasy.
private struct TargetBullseye: View {
    let score: Int
    let landed: Bool

    /// 0 = dead centre, 1 = outer edge (scaled to the Target Man XP max).
    private var miss: CGFloat {
        let maxXP = CGFloat(DailyXP.maxXP(.targetMan))
        return CGFloat(max(0, maxXP - CGFloat(score))) / maxXP
    }
    /// Seeded angle so the marker lands somewhere different each time but is stable per score.
    private var angle: CGFloat { CGFloat((score * 137 + 40) % 360) * .pi / 180 }

    private let rings = 5

    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height)
            let maxR = s / 2 - s * 0.06
            ZStack {
                ForEach(0..<rings, id: \.self) { i in
                    let frac = CGFloat(rings - i) / CGFloat(rings)
                    Circle()
                        .fill(ringColor(i))
                        .frame(width: s * frac, height: s * frac)
                        .overlay(
                            Circle().stroke(.white.opacity(0.12), lineWidth: 1)
                                .frame(width: s * frac, height: s * frac)
                        )
                }
                Circle().fill(BKTheme.accent).frame(width: s * 0.05, height: s * 0.05)

                Circle()
                    .fill(.white)
                    .frame(width: 16, height: 16)
                    .overlay(Circle().stroke(.black.opacity(0.35), lineWidth: 1.5))
                    .shadow(color: .black.opacity(0.45), radius: 3, y: 2)
                    .offset(
                        x: landed ? cos(angle) * miss * maxR : 0,
                        y: landed ? sin(angle) * miss * maxR : -s * 0.75
                    )
                    .scaleEffect(landed ? 1 : 2.4)
                    .opacity(landed ? 1 : 0)
                    .animation(.interpolatingSpring(stiffness: 140, damping: 12), value: landed)
            }
            .frame(width: s, height: s)
            .frame(maxWidth: .infinity)
        }
    }

    // Outer (i=0) → inner (i=rings-1): deepen toward the accent bullseye.
    private func ringColor(_ i: Int) -> Color {
        switch i {
        case 0: return BKTheme.card
        case 1: return BKTheme.cardElevated
        case 2: return BKTheme.accent.opacity(0.25)
        case 3: return BKTheme.accent.opacity(0.5)
        default: return BKTheme.accent.opacity(0.8)
        }
    }
}

private struct TargetManResultPlayerRow: View {
    let index: Int
    let selection: TargetManSelection
    let challenge: TargetManChallenge
    let appearDelay: Double

    @State private var appeared = false

    var body: some View {
        HStack(spacing: 12) {
                Text("\(index)")
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .foregroundStyle(BKTheme.background)
                .frame(width: 22, height: 22)
                .background((selection.isPoolMiss ? BKTheme.wrong : BKTheme.accent).opacity(0.85))
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(selection.player.name.uppercased())
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(selection.isPoolMiss ? BKTheme.wrong : BKTheme.textPrimary)
                    .lineLimit(1)
                Text(selection.poolMissReason ?? selection.player.club)
                    .font(BKFont.caption(10))
                    .foregroundStyle(selection.isPoolMiss ? BKTheme.wrong : BKTheme.textMuted)
                    .lineLimit(2)
            }

            Spacer()

            if let stat = selection.statValue {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(challenge.formatValue(stat))
                        .font(BKFont.headline(16))
                        .foregroundStyle(selection.isPoolMiss ? BKTheme.wrong : BKTheme.accent)
                    Text(selection.isPoolMiss ? "WRONG" : challenge.displayCategoryLabel)
                        .font(BKFont.caption(9))
                        .foregroundStyle(selection.isPoolMiss ? BKTheme.wrong : BKTheme.textMuted)
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
