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
    var errorMessage: String?
    var confettiBurstToken = 0
    var showResult = false

    private let practice: Bool

    init(practice: Bool = false) {
        self.practice = practice
        let challenge = practice ? TargetManSeed.makePracticeChallenge() : TargetManSeed.makeDailyChallenge()
        self.state = TargetManGameState(challenge: challenge)
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

    func lockAnswers() {
        guard state.canLock else { return }
        HapticManager.success()
        state.phase = .revealing
        state.selections = TargetManSeed.resolveStats(for: state.selections, challenge: state.challenge)
        revealResults()
    }

    func restart() {
        let challenge = practice ? TargetManSeed.makePracticeChallenge() : TargetManSeed.makeDailyChallenge()
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

            try? await Task.sleep(for: .seconds(TargetManTiming.revealSummaryDelay))

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

            try? await Task.sleep(for: .seconds(0.45))
            showResult = true
        }
    }
}

// MARK: - Main View

struct TargetManView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel: TargetManViewModel
    @FocusState private var isSearchFocused: Bool
    var onComplete: () -> Void

    init(practice: Bool = false, onComplete: @escaping () -> Void) {
        _viewModel = State(initialValue: TargetManViewModel(practice: practice))
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

                            if viewModel.state.phase == .complete,
                               let total = viewModel.state.combinedTotal,
                               let difference = viewModel.state.difference,
                               let score = viewModel.state.score {
                                TargetManSummaryCard(
                                    total: total,
                                    target: viewModel.state.challenge.target,
                                    difference: difference,
                                    score: score,
                                    category: viewModel.state.challenge.category
                                )
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 24)
                        .animation(.spring(response: 0.35, dampingFraction: 0.82), value: viewModel.state.phase)
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
                        TargetManLockButton {
                            isSearchFocused = false
                            viewModel.lockAnswers()
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
                        if viewModel.state.phase == .selecting {
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
                score: viewModel.state.score ?? 0,
                xpEarned: viewModel.xpEarned,
                difference: viewModel.state.difference ?? 0,
                onPlayAgain: {
                    viewModel.showResult = false
                    viewModel.restart()
                },
                onHome: {
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

// MARK: - Summary

private struct TargetManSummaryCard: View {
    let total: Int
    let target: Int
    let difference: Int
    let score: Int
    let category: TargetManStatCategory

    private var differenceLabel: String {
        if difference == 0 { return "EXACT MATCH" }
        return difference > 0 ? "+\(difference)" : "\(difference)"
    }

    var body: some View {
        VStack(spacing: 14) {
            Text("RESULT")
                .font(BKFont.caption(11))
                .tracking(1)
                .foregroundStyle(BKTheme.textMuted)

            HStack(spacing: 16) {
                summaryColumn("COMBINED", value: "\(total)")
                summaryColumn("TARGET", value: "\(target)")
                summaryColumn("DIFF", value: differenceLabel, accent: abs(difference) <= 10)
            }

            Text("\(score) POINTS")
                .font(BKFont.headline(22))
                .foregroundStyle(BKTheme.accent)
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(BKTheme.cardElevated.opacity(0.9))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func summaryColumn(_ label: String, value: String, accent: Bool = false) -> some View {
        VStack(spacing: 4) {
            Text(label)
                .font(BKFont.caption(9))
                .foregroundStyle(BKTheme.textMuted)
            Text(value)
                .font(BKFont.headline(16))
                .foregroundStyle(accent ? BKTheme.accent : BKTheme.textPrimary)
        }
        .frame(maxWidth: .infinity)
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
                VStack(spacing: 0) {
                    ForEach(viewModel.searchResults) { player in
                        Button {
                            isSearchFocused.wrappedValue = false
                            viewModel.addPlayer(player)
                        } label: {
                            HStack(spacing: 12) {
                                TeamBadgeImage(club: player.club, league: player.league, size: 28) {
                                    Circle()
                                        .fill(BKTheme.cardElevated)
                                        .frame(width: 28, height: 28)
                                        .overlay(
                                            Text(GuessWhoDisplay.clubAbbrev(player.club))
                                                .font(.system(size: 8, weight: .bold, design: .rounded))
                                                .foregroundStyle(BKTheme.textMuted)
                                        )
                                }

                                VStack(alignment: .leading, spacing: 3) {
                                    Text(player.name.uppercased())
                                        .font(.system(size: 13, weight: .bold, design: .rounded))
                                        .foregroundStyle(BKTheme.textPrimary)
                                    Text("\(player.club) · \(player.league)")
                                        .font(BKFont.caption(11))
                                        .foregroundStyle(BKTheme.textMuted)
                                }

                                Spacer()

                                if viewModel.selectedPlayerIds.contains(player.id) {
                                    Ph.checkCircle.fill
                                        .color(BKTheme.accent)
                                        .frame(width: 14, height: 14)
                                } else {
                                    Ph.caretRight.bold
                                        .color(BKTheme.textMuted)
                                        .frame(width: 12, height: 12)
                                }
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                        }
                        .disabled(viewModel.selectedPlayerIds.contains(player.id) || viewModel.state.isFull)

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

private struct TargetManLockButton: View {
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text("LOCK ANSWERS")
                .font(BKFont.headline())
                .foregroundStyle(BKTheme.background)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(BKTheme.accent)
                .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
        .background(BKTheme.background)
    }
}

// MARK: - Result

private struct TargetManResultView: View {
    let score: Int
    let xpEarned: Int
    let difference: Int
    var onPlayAgain: () -> Void
    var onHome: () -> Void

    private var headline: String {
        if difference == 0 { return "BULLSEYE" }
        if abs(difference) <= 10 { return "SO CLOSE" }
        if abs(difference) <= 50 { return "SOLID EFFORT" }
        return "KEEP SHOOTING"
    }

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()

            VStack(spacing: 20) {
                Spacer()

                Ph.chartBar.fill
                    .color(BKTheme.accent)
                    .frame(width: 64, height: 64)

                Text(headline)
                    .font(BKFont.title(26))
                    .foregroundStyle(BKTheme.textPrimary)

                Text("\(score) POINTS")
                    .font(BKFont.headline(22))
                    .foregroundStyle(BKTheme.accent)

                Text("+\(xpEarned) XP")
                    .font(BKFont.body())
                    .foregroundStyle(BKTheme.textSecondary)

                Spacer()

                VStack(spacing: 12) {
                    Button(action: onPlayAgain) {
                        Text("PLAY AGAIN")
                            .font(BKFont.headline())
                            .foregroundStyle(BKTheme.background)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(BKTheme.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                    }

                    Button(action: onHome) {
                        Text("BACK HOME")
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
            }
        }
    }
}
