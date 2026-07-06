import SwiftUI

// Match Football Golf's restraint: green (the app accent) is reserved for genuine success
// signals — correct placements, a strong score, the primary action, +XP. Everything neutral
// (labels, counters, ranks, stat values) stays white/grey so the screen reads calm, not busy.
private let blindGreen = BKTheme.accent

/// One motion vocabulary for the whole screen (mirrors Golf) so animation feels deliberate.
private enum BlindRankMotion {
    static let layout = Animation.spring(response: 0.34, dampingFraction: 0.82)
    static let reveal = Animation.spring(response: 0.42, dampingFraction: 0.78)
}

// MARK: - ViewModel

@MainActor
@Observable
final class BlindRankViewModel {
    var state: BlindRankGameState
    var showResult = false
    var confettiBurstToken = 0
    var activeRevealSlide: Int?
    var selectedAdjustSlot: Int?

    init(challenge: BlindRankChallenge) {
        self.state = BlindRankGameState(challenge: challenge)
    }

    var xpEarned: Int {
        BlindRankScoring.xp(fromScore: state.score ?? 0, moves: state.moveCount)
    }

    /// Mid-game and worth saving: started placing players, or reviewing before submit.
    var isResumable: Bool {
        switch state.phase {
        case .ranking: return state.currentPlayerIndex > 0
        case .adjusting: return true
        case .revealing, .complete: return false
        }
    }

    func assignCurrentPlayer(to slot: Int) {
        guard state.phase == .ranking,
              state.slots.indices.contains(slot),
              state.slots[slot] == nil,
              let player = state.currentPlayer else { return }

        HapticManager.light()
        state.slots[slot] = player
        state.currentPlayerIndex += 1

        // Board full → let the player review and swap before locking in (each swap costs XP).
        if state.isBoardFull {
            state.phase = .adjusting
            HapticManager.success()
        }
    }

    /// Tap a slot to pick it up; tap a second slot to swap the two players (one paid "move").
    func tapAdjustSlot(_ index: Int) {
        guard state.phase == .adjusting, state.slots.indices.contains(index) else { return }
        if let selected = selectedAdjustSlot {
            if selected == index {
                selectedAdjustSlot = nil
            } else {
                state.slots.swapAt(selected, index)
                state.moveCount += 1
                selectedAdjustSlot = nil
                HapticManager.success()
            }
        } else {
            selectedAdjustSlot = index
            HapticManager.light()
        }
    }

    func submitAdjustments() {
        guard state.phase == .adjusting else { return }
        selectedAdjustSlot = nil
        beginReveal()
    }

    /// Rehydrate from a saved snapshot (resuming a left game).
    func restore(_ saved: BlindRankGameState) {
        state = saved
        selectedAdjustSlot = nil
        showResult = false
        activeRevealSlide = nil
    }

    func restart() {
        state = BlindRankGameState(challenge: state.challenge)
        showResult = false
        confettiBurstToken = 0
        activeRevealSlide = nil
        selectedAdjustSlot = nil
    }

    func isCorrectSlot(_ index: Int) -> Bool {
        guard state.challenge.correctRanking.indices.contains(index),
              let player = state.slots[index] else { return false }
        return player.id == state.challenge.correctRanking[index]
    }

    private func beginReveal() {
        state.revealSteps = BlindRankScoring.buildRevealSteps(
            slots: state.slots,
            challenge: state.challenge
        )
        state.revealedStepCount = 0
        state.phase = .revealing
        HapticManager.success()

        Task {
            let slotCount = state.slotCount
            for step in 1...slotCount {
                try? await Task.sleep(for: .seconds(BlindRankTiming.revealStagger * 0.35))
                state.revealedStepCount = step

                if let current = state.revealSteps.first(where: { $0.rank == step }), !current.isCorrect {
                    activeRevealSlide = step
                    HapticManager.error()
                    try? await Task.sleep(for: .seconds(BlindRankTiming.revealSlide))
                    activeRevealSlide = nil
                } else {
                    HapticManager.light()
                }
            }

            state.exactMatches = BlindRankScoring.exactMatches(
                slots: state.slots,
                correctRanking: state.challenge.correctRanking
            )
            let roundScore = BlindRankScoring.score(
                slots: state.slots,
                correctRanking: state.challenge.correctRanking
            )
            state.score = roundScore
            state.phase = .complete

            if roundScore >= 24 {
                HapticManager.success()
                confettiBurstToken += 1
            }

            try? await Task.sleep(for: .seconds(BlindRankTiming.resultDelay))
            showResult = true
        }
    }
}

// MARK: - Main View

struct BlindRankView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: BlindRankViewModel
    @State private var targetedSlot: Int?
    let allowReplay: Bool
    private let dailyDate: String?
    var onComplete: () -> Void

    init(
        challenge: BlindRankChallenge,
        allowReplay: Bool = false,
        onComplete: @escaping () -> Void
    ) {
        _viewModel = State(initialValue: BlindRankViewModel(challenge: challenge))
        self.allowReplay = allowReplay
        self.dailyDate = challenge.date
        self.onComplete = onComplete
    }

    var body: some View {
        blindRankContent(viewModel: viewModel)
            .persistsGameProgress(
                viewModel.state,
                isResumable: viewModel.isResumable,
                modeId: GameModeID.blindRank.rawValue,
                date: dailyDate,
                version: BlindRankGameState.progressVersion,
                enabled: !allowReplay
            )
            .onAppear {
                guard !allowReplay, let dailyDate,
                      let saved = GameProgressStore.load(
                        BlindRankGameState.self, modeId: GameModeID.blindRank.rawValue,
                        date: dailyDate, version: BlindRankGameState.progressVersion, context: modelContext) else { return }
                viewModel.restore(saved)
            }
    }

    @ViewBuilder
    private func blindRankContent(viewModel: BlindRankViewModel) -> some View {
        @Bindable var viewModel = viewModel
        ZStack {
            NavigationStack {
                VStack(spacing: 0) {
                    BlindRankCategoryBanner(challenge: viewModel.state.challenge)
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 12)

                    if viewModel.state.phase == .ranking {
                        rankingContent(viewModel: viewModel)
                    } else if viewModel.state.phase == .adjusting {
                        adjustContent(viewModel: viewModel)
                    } else {
                        revealContent(viewModel: viewModel)
                    }
                }
                .animation(BlindRankMotion.layout, value: viewModel.state.currentPlayerIndex)
                .animation(BlindRankMotion.layout, value: viewModel.state.moveCount)
                .animation(BlindRankMotion.layout, value: viewModel.selectedAdjustSlot)
                .animation(BlindRankMotion.reveal, value: viewModel.state.revealedStepCount)
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
                        VStack(spacing: 2) {
                            Text("BLIND RANK")
                                .font(BKFont.caption(13))
                                .tracking(1.5)
                                .foregroundStyle(BKTheme.textSecondary)
                            if viewModel.state.phase == .ranking {
                                Text("PLAYER \(min(viewModel.state.currentPlayerIndex + 1, viewModel.state.slotCount)) OF \(viewModel.state.slotCount)")
                                    .font(BKFont.caption(9))
                                    .foregroundStyle(BKTheme.textMuted)
                            } else if viewModel.state.phase == .adjusting {
                                Text("REVIEW & ADJUST")
                                    .font(BKFont.caption(9))
                                    .foregroundStyle(BKTheme.textMuted)
                            } else {
                                Text("CORRECT ORDER")
                                    .font(BKFont.caption(9))
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
            BlindRankResultView(
                challenge: viewModel.state.challenge,
                revealSteps: viewModel.state.revealSteps,
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
                                modeId: GameModeID.blindRank.rawValue,
                                date: dailyDate,
                                score: viewModel.state.score ?? 0,
                                guesses: viewModel.state.moveCount,
                                won: (viewModel.state.score ?? 0) >= 17,
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
        }
    }

    private func rankingContent(viewModel: BlindRankViewModel) -> some View {
        VStack(spacing: 10) {
            // Fill the space between the banner and the player card; the board sizes its rows to
            // fit, so all slots stay on screen (no scrolling) and empty/filled rows are equal height.
            GeometryReader { geo in
                BlindRankSlotsBoard(
                    viewModel: viewModel,
                    currentPlayerId: viewModel.state.currentPlayer?.id,
                    targetedSlot: $targetedSlot,
                    availableHeight: geo.size.height
                )
            }
            .padding(.horizontal, 16)

            if let player = viewModel.state.currentPlayer {
                BlindRankCurrentPlayerCard(player: player)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }

    private func adjustContent(viewModel: BlindRankViewModel) -> some View {
        VStack(spacing: 10) {
            GeometryReader { geo in
                BlindRankAdjustBoard(viewModel: viewModel, availableHeight: geo.size.height)
            }
            .padding(.horizontal, 16)

            BlindRankAdjustBar(
                moveCount: viewModel.state.moveCount,
                selecting: viewModel.selectedAdjustSlot != nil,
                onSubmit: { viewModel.submitAdjustments() }
            )
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
    }

    private func revealContent(viewModel: BlindRankViewModel) -> some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 14) {
                BlindRankOrderRevealView(
                    steps: viewModel.state.revealSteps,
                    revealedCount: viewModel.state.revealedStepCount,
                    valueNoun: viewModel.state.challenge.valueNoun,
                    valuePrefix: viewModel.state.challenge.valuePrefix,
                    activeSlideStep: viewModel.activeRevealSlide,
                    slotCount: viewModel.state.slotCount
                )

                if viewModel.state.phase == .complete, let exact = viewModel.state.exactMatches {
                    BlindRankRevealFooter(exactMatches: exact, slotCount: viewModel.state.slotCount)
                } else {
                    BlindRankRevealFooter(exactMatches: nil, slotCount: viewModel.state.slotCount)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
    }
}

// MARK: - Category Banner

private struct BlindRankCategoryBanner: View {
    let challenge: BlindRankChallenge

    var body: some View {
        VStack(spacing: 6) {
            Text(challenge.subtitle)
                .font(BKFont.headline(18))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
            Text(challenge.rankHint.uppercased())
                .font(BKFont.caption(10))
                .tracking(0.5)
                .foregroundStyle(BKTheme.textMuted)
            Text("3 PTS PER EXACT SPOT · SCORE 17+ / 30 TO WIN")
                .font(BKFont.caption(9))
                .tracking(0.5)
                .foregroundStyle(BKTheme.textMuted)
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
    }
}

// MARK: - Order Reveal Animation

private struct BlindRankOrderRevealView: View {
    let steps: [BlindRankRevealStep]
    let revealedCount: Int
    let valueNoun: String
    let valuePrefix: String
    let activeSlideStep: Int?
    let slotCount: Int

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Text("ACTUAL ORDER")
                    .font(BKFont.caption(11))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Spacer()
                Text("\(min(revealedCount, slotCount))/\(slotCount)")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
            }

            ForEach(steps) { step in
                BlindRankRevealStepRow(
                    step: step,
                    valueNoun: valueNoun,
                    valuePrefix: valuePrefix,
                    isVisible: step.rank <= revealedCount,
                    isSliding: activeSlideStep == step.rank
                )
            }
        }
    }
}

private struct BlindRankRevealStepRow: View {
    let step: BlindRankRevealStep
    let valueNoun: String
    let valuePrefix: String
    let isVisible: Bool
    let isSliding: Bool

    @State private var slideOffset: CGFloat = 0
    @State private var checkScale: CGFloat = 0.6

    var body: some View {
        HStack(spacing: 10) {
            Text("#\(step.rank)")
                .font(BKFont.caption(11))
                .foregroundStyle(BKTheme.textMuted)
                .frame(width: 28, alignment: .leading)

            if isVisible {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(step.player.name)
                            .font(BKFont.headline(14))
                            .foregroundStyle(BKTheme.textPrimary)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        statusIcon
                    }

                    HStack(spacing: 8) {
                        Text(formattedValue(step.player.statValue))
                            .font(BKFont.caption(11))
                            .foregroundStyle(BKTheme.textSecondary)
                        if !step.isCorrect, let userRank = step.userRank {
                            Text("You had #\(userRank)")
                                .font(BKFont.caption(9))
                                .foregroundStyle(BKTheme.wrong.opacity(0.9))
                                .offset(x: slideOffset)
                        } else if step.isCorrect {
                            Text("Spot on")
                                .font(BKFont.caption(9))
                                .foregroundStyle(BKTheme.accent.opacity(0.85))
                        }
                    }
                }
                .transition(.asymmetric(
                    insertion: .move(edge: .leading).combined(with: .opacity),
                    removal: .opacity
                ))
            } else {
                RoundedRectangle(cornerRadius: 6)
                    .fill(BKTheme.card.opacity(0.5))
                    .frame(height: 36)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(rowBackground)
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(borderColor, lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .offset(x: isSliding ? slideOffset : 0)
        .onChange(of: isVisible) { _, visible in
            guard visible else { return }
            if step.isCorrect {
                withAnimation(.spring(response: 0.32, dampingFraction: 0.5)) {
                    checkScale = 1
                }
            } else if let userRank = step.userRank {
                let delta = CGFloat(userRank - step.rank) * 18
                slideOffset = delta
                withAnimation(.spring(response: 0.5, dampingFraction: 0.68)) {
                    slideOffset = 0
                }
            }
        }
        .onChange(of: isSliding) { _, sliding in
            if sliding, let userRank = step.userRank {
                let delta = CGFloat(userRank - step.rank) * 22
                slideOffset = delta
                withAnimation(.spring(response: 0.48, dampingFraction: 0.62)) {
                    slideOffset = 0
                }
            }
        }
    }

    @ViewBuilder
    private var statusIcon: some View {
        if step.isCorrect {
            Ph.checkCircle.fill
                .color(BKTheme.accent)
                .frame(width: 16, height: 16)
                .scaleEffect(checkScale)
        } else {
            Ph.xCircle.fill
                .color(BKTheme.wrong)
                .frame(width: 16, height: 16)
        }
    }

    private var rowBackground: Color {
        guard isVisible else { return BKTheme.card.opacity(0.35) }
        return step.isCorrect ? BKTheme.guessCorrect.opacity(0.12) : BKTheme.wrong.opacity(0.08)
    }

    private var borderColor: Color {
        guard isVisible else { return BKTheme.cardElevated }
        return step.isCorrect ? BKTheme.accent.opacity(0.45) : BKTheme.wrong.opacity(0.35)
    }

    private func formattedValue(_ value: Int) -> String {
        "\(valuePrefix)\(value) \(valueNoun)"
    }
}

// MARK: - Slots Board

private struct BlindRankSlotsBoard: View {
    let viewModel: BlindRankViewModel
    let currentPlayerId: String?
    @Binding var targetedSlot: Int?
    var availableHeight: CGFloat

    private let headerHeight: CGFloat = 22
    private let rowSpacing: CGFloat = 6

    var body: some View {
        let n = viewModel.state.slotCount
        let usable = availableHeight - headerHeight - rowSpacing * CGFloat(n + 1)
        let rowHeight = min(58, max(30, usable / CGFloat(max(1, n))))

        VStack(spacing: rowSpacing) {
            HStack {
                Text("YOUR RANKING")
                    .font(BKFont.caption(11))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Spacer()
                Text("\(filledCount)/\(n)")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
            }
            .frame(height: headerHeight)

            ForEach(0..<n, id: \.self) { index in
                BlindRankSlotRow(
                    rank: index + 1,
                    player: viewModel.state.slots[index],
                    currentPlayerId: currentPlayerId,
                    isTargeted: targetedSlot == index,
                    canEdit: viewModel.state.phase == .ranking,
                    height: rowHeight,
                    onDrop: { viewModel.assignCurrentPlayer(to: index) },
                    onTapEmpty: { viewModel.assignCurrentPlayer(to: index) },
                    onTargetChange: { targeted in
                        targetedSlot = targeted ? index : (targetedSlot == index ? nil : targetedSlot)
                    }
                )
            }
        }
    }

    private var filledCount: Int {
        viewModel.state.slots.compactMap { $0 }.count
    }
}

private struct BlindRankSlotRow: View {
    let rank: Int
    let player: BlindRankPlayer?
    let currentPlayerId: String?
    let isTargeted: Bool
    let canEdit: Bool
    var height: CGFloat = 48
    var onDrop: () -> Void
    var onTapEmpty: () -> Void
    var onTargetChange: (Bool) -> Void

    private var avatarSize: CGFloat { min(34, height - 14) }

    var body: some View {
        HStack(spacing: 10) {
            Text("#\(rank)")
                .font(BKFont.caption(11))
                .foregroundStyle(BKTheme.textMuted)
                .frame(width: 28, alignment: .leading)

            if let player {
                PlayerAvatar(urlString: player.headshotUrl, size: avatarSize)
                Text(player.name)
                    .font(BKFont.headline(14))
                    .foregroundStyle(BKTheme.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                Text(GuessWhoDisplay.nationalityFlag(player.nationality))
                    .font(.system(size: 20))
            } else {
                Button(action: onTapEmpty) {
                    HStack {
                        Text(canEdit ? "Drop player here" : "—")
                            .font(BKFont.body(13))
                            .foregroundStyle(BKTheme.textMuted)
                        Spacer()
                        if canEdit {
                            Text("+")
                                .font(BKFont.headline(16))
                                .foregroundStyle(BKTheme.textMuted)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(!canEdit)
            }
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, minHeight: height, maxHeight: height, alignment: .leading)
        .background(isTargeted && canEdit ? BKTheme.cardElevated : (player == nil ? BKTheme.card.opacity(0.55) : BKTheme.card))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(isTargeted && canEdit ? BKTheme.accent : BKTheme.cardElevated, lineWidth: isTargeted ? 2 : 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .dropDestination(for: String.self) { items, _ in
            guard canEdit,
                  player == nil,
                  let draggedId = items.first,
                  draggedId == currentPlayerId else { return false }
            onDrop()
            return true
        } isTargeted: { targeted in
            onTargetChange(targeted)
        }
    }
}

// MARK: - Review / Adjust Board

private struct BlindRankAdjustBoard: View {
    let viewModel: BlindRankViewModel
    var availableHeight: CGFloat

    private let headerHeight: CGFloat = 22
    private let rowSpacing: CGFloat = 6

    var body: some View {
        let n = viewModel.state.slotCount
        let usable = availableHeight - headerHeight - rowSpacing * CGFloat(n + 1)
        let rowHeight = min(58, max(30, usable / CGFloat(max(1, n))))

        VStack(spacing: rowSpacing) {
            HStack {
                Text("TAP TWO TO SWAP")
                    .font(BKFont.caption(11))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Spacer()
                Text("VALUES STILL HIDDEN")
                    .font(BKFont.caption(9))
                    .foregroundStyle(BKTheme.textMuted)
            }
            .frame(height: headerHeight)

            ForEach(0..<n, id: \.self) { index in
                BlindRankAdjustRow(
                    rank: index + 1,
                    player: viewModel.state.slots[index],
                    isSelected: viewModel.selectedAdjustSlot == index,
                    dimmed: viewModel.selectedAdjustSlot != nil && viewModel.selectedAdjustSlot != index,
                    height: rowHeight,
                    onTap: { viewModel.tapAdjustSlot(index) }
                )
            }
        }
    }
}

private struct BlindRankAdjustRow: View {
    let rank: Int
    let player: BlindRankPlayer?
    let isSelected: Bool
    var dimmed: Bool = false
    var height: CGFloat = 48
    var onTap: () -> Void

    private var avatarSize: CGFloat { min(34, height - 14) }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                Text("#\(rank)")
                    .font(BKFont.caption(11))
                    .foregroundStyle(isSelected ? blindGreen : BKTheme.textMuted)
                    .frame(width: 28, alignment: .leading)

                if let player {
                    PlayerAvatar(urlString: player.headshotUrl, size: avatarSize)
                    Text(player.name)
                        .font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Spacer(minLength: 0)
                    Text(GuessWhoDisplay.nationalityFlag(player.nationality))
                        .font(.system(size: 20))
                }

                Image(systemName: isSelected ? "arrow.up.arrow.down.circle.fill" : "arrow.up.arrow.down")
                    .font(.system(size: 14))
                    .foregroundStyle(isSelected ? blindGreen : BKTheme.textMuted)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: height, maxHeight: height, alignment: .leading)
            .background(isSelected ? BKTheme.cardElevated : BKTheme.card)
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? blindGreen : BKTheme.cardElevated, lineWidth: isSelected ? 2 : 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .opacity(dimmed ? 0.6 : 1)
        }
        .buttonStyle(.plain)
    }
}

private struct BlindRankAdjustBar: View {
    let moveCount: Int
    let selecting: Bool
    var onSubmit: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("ADJUSTMENTS")
                        .font(BKFont.caption(9))
                        .tracking(0.6)
                        .foregroundStyle(BKTheme.textMuted)
                    Text("\(moveCount)")
                        .font(BKFont.headline(16))
                        .foregroundStyle(BKTheme.textPrimary)
                }
                Spacer()
            }

            Text("Rearrange as much as you like — only your final order counts.")
                .font(BKFont.caption(10))
                .foregroundStyle(BKTheme.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)

            Button(action: onSubmit) {
                Text(selecting ? "TAP ANOTHER TO SWAP" : "LOCK IN RANKING")
                    .font(BKFont.headline(15))
                    .foregroundStyle(selecting ? BKTheme.textMuted : BKTheme.background)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(selecting ? BKTheme.cardElevated : BKTheme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .disabled(selecting)
        }
        .padding(14)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
    }
}

// MARK: - Current Player Card

private struct BlindRankCurrentPlayerCard: View {
    let player: BlindRankPlayer

    /// Collapse a fine position into the broad role fans use.
    static func coarsePosition(_ position: String) -> String {
        let p = position.lowercased()
        if p.contains("keep") || p == "gk" { return "Goalkeeper" }
        if p.contains("back") || p.contains("defen") || p == "cb" { return "Defender" }
        if p.contains("midfield") || p == "cm" || p == "dm" || p == "am" { return "Midfielder" }
        if p.contains("forward") || p.contains("wing") || p.contains("strik") || p.contains("attack") || p == "cf" || p == "st" { return "Forward" }
        return position
    }

    var body: some View {
        HStack(spacing: 12) {
            BlindRankDragHandle()

            PlayerAvatar(urlString: player.headshotUrl, size: 44)

            VStack(alignment: .leading, spacing: 3) {
                Text(player.name)
                    .font(BKFont.headline(17))
                    .foregroundStyle(BKTheme.textPrimary)
                    .lineLimit(2)
                Text(player.displayClubs)
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textSecondary)
                    .lineLimit(1)
                Text(Self.coarsePosition(player.position).uppercased())
                    .font(BKFont.caption(10))
                    .tracking(0.4)
                    .foregroundStyle(BKTheme.textMuted)
            }

            Spacer(minLength: 0)

            Text(GuessWhoDisplay.nationalityFlag(player.nationality))
                .font(.system(size: 28))
        }
        .padding(14)
        .background(BKTheme.cardElevated)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay {
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(Color.white.opacity(0.06), lineWidth: 1)
        }
        .draggable(player.id)
    }
}

/// Two columns of three dots — the classic "drag me" grip.
private struct BlindRankDragHandle: View {
    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<2, id: \.self) { _ in
                VStack(spacing: 3) {
                    ForEach(0..<3, id: \.self) { _ in
                        Circle()
                            .fill(BKTheme.textMuted)
                            .frame(width: 3, height: 3)
                    }
                }
            }
        }
        .frame(width: 12)
    }
}

// MARK: - Reveal Footer

private struct BlindRankRevealFooter: View {
    let exactMatches: Int?
    let slotCount: Int

    var body: some View {
        VStack(spacing: 6) {
            if let exactMatches {
                Text("\(exactMatches)/\(slotCount) EXACT")
                    .font(BKFont.headline(16))
                    .foregroundStyle(BKTheme.textPrimary)
                Text("Tallying your score…")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textSecondary)
            } else {
                ProgressView()
                    .tint(BKTheme.accent)
                Text("Revealing correct order…")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textMuted)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - Result View

private struct BlindRankBreakdownChip: View {
    let count: Int
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 3) {
            Text("\(count)")
                .font(BKFont.title(22))
                .foregroundStyle(color)
            Text(label)
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

private struct BlindRankResultView: View {
    let challenge: BlindRankChallenge
    let revealSteps: [BlindRankRevealStep]
    let score: Int
    let xpEarned: Int
    var showPlayAgain = true
    var onPlayAgain: () -> Void
    var onHome: () -> Void

    var slotCount: Int { challenge.presentationOrder.count }
    var maxScore: Int { BlindRankScoring.maxScore(slotCount: slotCount) }

    /// Distance buckets derived from the reveal steps (every slot is filled at completion).
    private var breakdown: (exact: Int, close: Int, disaster: Int) {
        var exact = 0, close = 0, disaster = 0
        for step in revealSteps {
            guard let userRank = step.userRank else { continue }
            let dist = abs(step.rank - userRank)
            if dist == 0 { exact += 1 } else if dist <= 2 { close += 1 } else { disaster += 1 }
        }
        return (exact, close, disaster)
    }

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        Text("BLIND RANK")
                            .font(BKFont.caption(11))
                            .tracking(1)
                            .foregroundStyle(BKTheme.textMuted)
                        Text(challenge.subtitle)
                            .font(BKFont.headline(18))
                            .foregroundStyle(BKTheme.textPrimary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 24)

                    VStack(spacing: 2) {
                        Text("\(xpEarned)")
                            .font(BKFont.title(48))
                            .foregroundStyle(score >= 17 ? blindGreen : BKTheme.textPrimary)
                        Text("XP EARNED")
                            .font(BKFont.caption(11))
                            .tracking(1)
                            .foregroundStyle(BKTheme.textMuted)
                    }

                    Text(BlindRankScoring.verdict(forScore: score))
                        .font(BKFont.headline(15))
                        .foregroundStyle(BKTheme.textPrimary)
                        .multilineTextAlignment(.center)

                    HStack(spacing: 10) {
                        BlindRankBreakdownChip(count: breakdown.exact, label: "SPOT ON", color: BKTheme.accent)
                        BlindRankBreakdownChip(count: breakdown.close, label: "CLOSE", color: BKTheme.textSecondary)
                        BlindRankBreakdownChip(count: breakdown.disaster, label: "WAY OFF", color: BKTheme.wrong)
                    }

                    VStack(spacing: 8) {
                        ForEach(revealSteps) { step in
                            HStack(spacing: 10) {
                                Text("#\(step.rank)")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.textMuted)
                                    .frame(width: 24, alignment: .leading)
                                Text(step.player.name)
                                    .font(BKFont.body(13))
                                    .foregroundStyle(BKTheme.textPrimary)
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                                Text("\(challenge.valuePrefix)\(step.player.statValue)")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.textMuted)
                                if step.isCorrect {
                                    Ph.checkCircle.fill
                                        .color(BKTheme.accent)
                                        .frame(width: 14, height: 14)
                                } else {
                                    Ph.xCircle.fill
                                        .color(BKTheme.wrong)
                                        .frame(width: 14, height: 14)
                                }
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(BKTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }

                    HStack(spacing: 10) {
                        Label("\(score) / \(maxScore) ranking accuracy", systemImage: "target")
                            .font(BKFont.caption(11))
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(BKTheme.cardElevated)
                    .clipShape(Capsule())

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
                    .padding(.top, 8)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
        }
    }
}
