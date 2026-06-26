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

    private let practice: Bool
    private let dailyBundle: DailyBundleDTO?

    init(challenge: BlindRankChallenge, practice: Bool = false) {
        self.practice = practice
        self.dailyBundle = nil
        self.state = BlindRankGameState(challenge: challenge)
    }

    private init(dailyBundle: DailyBundleDTO?, practice: Bool, challenge: BlindRankChallenge) {
        self.practice = practice
        self.dailyBundle = dailyBundle
        self.state = BlindRankGameState(challenge: challenge)
    }

    init(dailyBundle: DailyBundleDTO? = nil, practice: Bool = false) {
        self.practice = practice
        self.dailyBundle = dailyBundle
        let challenge = practice
            ? BlindRankSeed.makePracticeChallenge()
            : BlindRankSeed.makeDailyChallenge(date: dailyBundle?.date)
        self.state = BlindRankGameState(challenge: challenge)
    }

    static func make(dailyBundle: DailyBundleDTO? = nil, practice: Bool = false) async -> BlindRankViewModel {
        if practice {
            return BlindRankViewModel(challenge: BlindRankSeed.makePracticeChallenge(), practice: true)
        }
        let challenge = DailyChallengeResolver.blindRankChallenge(from: dailyBundle)
        return BlindRankViewModel(dailyBundle: dailyBundle, practice: false, challenge: challenge)
    }

    var xpEarned: Int {
        BlindRankScoring.xp(fromScore: state.score ?? 0)
    }

    func assignCurrentPlayer(to slot: Int) {
        guard state.phase == .ranking,
              state.slots.indices.contains(slot),
              state.slots[slot] == nil,
              let player = state.currentPlayer else { return }

        HapticManager.light()
        state.slots[slot] = player
        state.currentPlayerIndex += 1

        if state.isBoardFull {
            beginReveal()
        }
    }

    func restart() {
        state = BlindRankGameState(
            challenge: practice
                ? BlindRankSeed.makePracticeChallenge()
                : DailyChallengeResolver.blindRankChallenge(from: dailyBundle)
        )
        showResult = false
        confettiBurstToken = 0
        activeRevealSlide = nil
    }

    func newPracticeRound() {
        state = BlindRankGameState(challenge: BlindRankSeed.makePracticeChallenge())
        showResult = false
        confettiBurstToken = 0
        activeRevealSlide = nil
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
    @State private var viewModel: BlindRankViewModel?
    @State private var targetedSlot: Int?
    let dailyBundle: DailyBundleDTO?
    let practice: Bool
    let allowReplay: Bool
    private let dailyDate: String?
    var onComplete: () -> Void

    init(
        dailyBundle: DailyBundleDTO? = nil,
        practice: Bool = false,
        allowReplay: Bool = true,
        onComplete: @escaping () -> Void
    ) {
        self.dailyBundle = dailyBundle
        self.practice = practice
        self.allowReplay = allowReplay
        self.dailyDate = dailyBundle?.date
        self.onComplete = onComplete
    }

    var body: some View {
        Group {
            if let viewModel {
                blindRankContent(viewModel: viewModel)
            } else {
                ProgressView()
                    .tint(BKTheme.accent)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(BKTheme.background)
            }
        }
        .task(id: "\(dailyBundle?.date ?? "none")-\(practice)") {
            viewModel = await BlindRankViewModel.make(dailyBundle: dailyBundle, practice: practice)
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
                    } else {
                        revealContent(viewModel: viewModel)
                    }
                }
                .animation(BlindRankMotion.layout, value: viewModel.state.currentPlayerIndex)
                .animation(BlindRankMotion.reveal, value: viewModel.state.revealedStepCount)
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
                        VStack(spacing: 2) {
                            Text("BLIND RANK")
                                .font(BKFont.caption(13))
                                .tracking(1.5)
                                .foregroundStyle(BKTheme.textSecondary)
                            if viewModel.state.phase == .ranking {
                                Text("PLAYER \(min(viewModel.state.currentPlayerIndex + 1, viewModel.state.slotCount)) OF \(viewModel.state.slotCount)")
                                    .font(BKFont.caption(9))
                                    .foregroundStyle(BKTheme.textMuted)
                            } else {
                                Text("CORRECT ORDER")
                                    .font(BKFont.caption(9))
                                    .foregroundStyle(BKTheme.textMuted)
                            }
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        if allowReplay, viewModel.state.phase == .ranking {
                            Button { viewModel.newPracticeRound() } label: {
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
                                won: (viewModel.state.score ?? 0) >= 17,
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
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                BlindRankSlotsBoard(
                    viewModel: viewModel,
                    currentPlayerId: viewModel.state.currentPlayer?.id,
                    targetedSlot: $targetedSlot
                )
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }

            if let player = viewModel.state.currentPlayer {
                BlindRankCurrentPlayerCard(player: player)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
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
            Text(challenge.isDaily ? "DAILY CHALLENGE" : "PRACTICE")
                .font(BKFont.caption(10))
                .tracking(0.8)
                .foregroundStyle(BKTheme.textMuted)
            Text(challenge.subtitle)
                .font(BKFont.headline(18))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
            Text(challenge.rankHint.uppercased())
                .font(BKFont.caption(10))
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

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Text("YOUR RANKING")
                    .font(BKFont.caption(11))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Spacer()
                Text("\(filledCount)/\(viewModel.state.slotCount)")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
            }

            ForEach(0..<viewModel.state.slotCount, id: \.self) { index in
                BlindRankSlotRow(
                    rank: index + 1,
                    player: viewModel.state.slots[index],
                    currentPlayerId: currentPlayerId,
                    isTargeted: targetedSlot == index,
                    canEdit: viewModel.state.phase == .ranking,
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
    var onDrop: () -> Void
    var onTapEmpty: () -> Void
    var onTargetChange: (Bool) -> Void

    var body: some View {
        HStack(spacing: 10) {
            Text("#\(rank)")
                .font(BKFont.caption(11))
                .foregroundStyle(BKTheme.textMuted)
                .frame(width: 28, alignment: .leading)

            if let player {
                VStack(alignment: .leading, spacing: 4) {
                    Text(player.name)
                        .font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.textPrimary)
                        .lineLimit(1)
                    Text(player.displayClubs)
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.textSecondary)
                        .lineLimit(1)
                }
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
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
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

// MARK: - Current Player Card

private struct BlindRankCurrentPlayerCard: View {
    let player: BlindRankPlayer

    var body: some View {
        VStack(spacing: 10) {
            Text("DRAG TO RANK")
                .font(BKFont.caption(10))
                .tracking(0.8)
                .foregroundStyle(BKTheme.textMuted)

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(player.name)
                        .font(BKFont.headline(17))
                        .foregroundStyle(BKTheme.textPrimary)
                        .lineLimit(2)
                    Text("\(player.displayClubs) · \(player.position)")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textSecondary)
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

                    HStack(alignment: .firstTextBaseline, spacing: 2) {
                        Text("\(score)")
                            .font(BKFont.title(48))
                            .foregroundStyle(score >= 23 ? blindGreen : BKTheme.textPrimary)
                        Text("/ \(maxScore)")
                            .font(BKFont.headline(20))
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
                        Label("\(xpEarned) XP", systemImage: "bolt.fill")
                            .font(BKFont.caption(11))
                            .foregroundStyle(BKTheme.accent)
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
