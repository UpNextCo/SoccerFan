import SwiftUI

// MARK: - ViewModel

@MainActor
@Observable
final class LastManStandingViewModel {
    var state: LMSGameState
    var showResult = false
    var confettiBurstToken = 0
    var showCorrectFlash = false
    var activeCommentary: String?
    var eliminationWaveToken = 0

    init(prompt: LMSPrompt) {
        let seed = LMSAnswerKey.hash(prompt.date ?? prompt.id)
        self.state = LMSGameState.make(prompt: prompt, seed: seed)
    }

    var xpEarned: Int {
        LastManStandingScoring.xp(survived: state.questionsSurvived, won: state.status == .won)
    }

    var currentScore: Int {
        DailyXP.lastManStanding(survived: state.questionsSurvived)
    }

    func beginIfNeeded() {
        guard state.status == .intro else { return }
        state.status = .question
    }

    func submit(optionId: String) {
        guard state.status == .question, let question = state.currentQuestion else { return }
        HapticManager.light()
        state.pickHistory.append(optionId)

        let correctId = state.prompt.correctOptionId(for: question)
        if optionId == correctId {
            handleCorrect()
        } else {
            handleWrong()
        }
    }

    private func handleCorrect() {
        state.status = .correctReveal
        showCorrectFlash = true
        HapticManager.success()
        // TODO: SFX hook — correct answer sting

        Task {
            try? await Task.sleep(for: .milliseconds(350))
            showCorrectFlash = false
            await runElimination()
        }
    }

    private func handleWrong() {
        state.eliminateUser()
        state.status = .lost
        HapticManager.error()
        // TODO: SFX hook — elimination fail
        Task {
            try? await Task.sleep(for: .milliseconds(1200))
            showResult = true
        }
    }

    private func runElimination() async {
        state.questionsSurvived += 1

        if state.questionsSurvived >= LMSGameState.totalQuestions {
            state.displayedRemaining = 1
            state.status = .won
            confettiBurstToken += 1
            HapticManager.success()
            try? await Task.sleep(for: .milliseconds(800))
            showResult = true
            return
        }

        state.prepareEliminations()
        state.status = .eliminating
        activeCommentary = state.currentStep.commentary

        let ids = state.pendingEliminationIds
        guard !ids.isEmpty else {
            advanceToNextQuestion()
            return
        }

        let waveCount = ids.count >= 20 ? 4 : 3
        let waves = splitIntoWaves(ids, waveCount: waveCount)
        let targetRemaining = state.nextStepAfterCorrect?.remaining ?? state.displayedRemaining
        let startRemaining = state.displayedRemaining
        var eliminatedSoFar = 0

        for (waveIndex, wave) in waves.enumerated() {
            for id in wave {
                eliminationWaveToken += 1
                let token = eliminationWaveToken
                state.markEliminated(id, token: token)
                eliminatedSoFar += 1
                HapticManager.light()
                try? await Task.sleep(for: .milliseconds(40))
            }
            let interim = max(targetRemaining, startRemaining - eliminatedSoFar)
            withAnimation(.easeOut(duration: 0.18)) {
                state.displayedRemaining = interim
            }
            if waveIndex < waves.count - 1 {
                try? await Task.sleep(for: .milliseconds(150))
            }
        }

        withAnimation(.easeOut(duration: 0.25)) {
            state.displayedRemaining = targetRemaining
        }
        try? await Task.sleep(for: .milliseconds(220))
        state.finalizeEliminations()
        advanceToNextQuestion()
    }

    private func advanceToNextQuestion() {
        state.currentQuestionIndex += 1
        state.status = .question
    }

    private func splitIntoWaves(_ ids: [UUID], waveCount: Int) -> [[UUID]] {
        let chunkSize = max(1, Int(ceil(Double(ids.count) / Double(waveCount))))
        return stride(from: 0, to: ids.count, by: chunkSize).map {
            Array(ids[$0..<min($0 + chunkSize, ids.count)])
        }
    }

    func restart() {
        let prompt = state.prompt
        let seed = LMSAnswerKey.hash(prompt.date ?? prompt.id)
        state = LMSGameState.make(prompt: prompt, seed: seed)
        state.status = .question
        showResult = false
        showCorrectFlash = false
        activeCommentary = nil
        confettiBurstToken = 0
    }
}

// MARK: - Main View

struct LastManStandingView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: LastManStandingViewModel
    private let allowReplay: Bool
    private let dailyDate: String?
    var onComplete: () -> Void

    init(dailyDate: String? = nil, prompt: LMSPrompt, allowReplay: Bool = false, onComplete: @escaping () -> Void) {
        _viewModel = State(initialValue: LastManStandingViewModel(prompt: prompt))
        self.allowReplay = allowReplay
        self.dailyDate = dailyDate
        self.onComplete = onComplete
    }

    private var state: LMSGameState { viewModel.state }

    var body: some View {
        ZStack {
            NavigationStack {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 16) {
                        headerStrip
                        questionSection
                        survivorSection
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 28)
                }
                .background(StadiumBackground())
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { dismiss() } label: {
                            Ph.x.bold.color(BKTheme.textPrimary).frame(width: 20, height: 20)
                        }
                    }
                    ToolbarItem(placement: .principal) {
                        Text("LAST MAN STANDING")
                            .font(BKFont.caption(11))
                            .tracking(1.1)
                            .foregroundStyle(BKTheme.textPrimary)
                    }
                }
            }

            if viewModel.showCorrectFlash {
                correctFlash
                    .transition(.scale.combined(with: .opacity))
                    .zIndex(20)
            }

            if state.status == .lost {
                lossOverlay
                    .transition(.opacity)
                    .zIndex(30)
            }

            FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                .allowsHitTesting(false)
                .zIndex(999)
        }
        .onAppear { viewModel.beginIfNeeded() }
        .fullScreenCover(isPresented: $viewModel.showResult) {
            LastManStandingResultView(
                won: state.status == .won,
                finishRank: state.finishRank,
                finishRankOrdinal: state.finishRankOrdinal,
                questionsSurvived: state.questionsSurvived,
                xpEarned: viewModel.xpEarned,
                showPlayAgain: allowReplay,
                onPlayAgain: {
                    viewModel.showResult = false
                    viewModel.restart()
                },
                onHome: {
                    recordCompletionAndExit()
                }
            )
        }
    }

    private var headerStrip: some View {
        VStack(spacing: 10) {
            GameXPBar(current: viewModel.currentScore, max: DailyXP.maxXP(.lastManStanding))
            HStack {
                Text(state.currentStep.label)
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textSecondary)
                Spacer()
                Text("Q\(min(state.currentQuestionIndex + 1, LMSGameState.totalQuestions))/\(LMSGameState.totalQuestions)")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textMuted)
            }
        }
        .padding(.top, 8)
    }

    @ViewBuilder
    private var questionSection: some View {
        if let question = state.currentQuestion, state.status != .lost {
            VStack(spacing: 12) {
                VStack(spacing: 8) {
                    Text("QUESTION")
                        .font(BKFont.caption(10))
                        .tracking(0.8)
                        .foregroundStyle(BKTheme.textMuted)
                    Text(question.prompt)
                        .font(BKFont.headline(18))
                        .foregroundStyle(BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                }
                .padding(18)
                .frame(maxWidth: .infinity)
                .background(BKTheme.cardElevated.opacity(0.95))
                .clipShape(RoundedRectangle(cornerRadius: 16))

                VStack(spacing: 8) {
                    ForEach(question.options) { option in
                        Button {
                            viewModel.submit(optionId: option.id)
                        } label: {
                            Text(option.label)
                                .font(BKFont.body(15))
                                .foregroundStyle(BKTheme.textPrimary)
                                .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                                .padding(.horizontal, 14)
                                .background(BKTheme.card)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                                )
                        }
                        .disabled(!state.isInteractive)
                        .opacity(state.isInteractive ? 1 : 0.55)
                    }
                }
            }
        }
    }

    private var survivorSection: some View {
        let profile = LMSGameState.layoutProfile(forRemaining: state.displayedRemaining)
        return VStack(spacing: 10) {
            LastManStandingSurvivorField(
                entrants: state.visibleEntrants,
                remaining: state.displayedRemaining,
                profile: profile,
                freezeField: state.status == .lost
            )

            Text("\(state.displayedRemaining) players remaining")
                .font(BKFont.body(14))
                .foregroundStyle(BKTheme.textPrimary)
                .contentTransition(.numericText())
                .animation(.easeOut(duration: 0.25), value: state.displayedRemaining)

            if let commentary = viewModel.activeCommentary {
                Text(commentary)
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .transition(.opacity)
            }
        }
        .padding(.top, 4)
    }

    private var correctFlash: some View {
        Text("Correct")
            .font(BKFont.headline(20))
            .foregroundStyle(BKTheme.accent)
            .padding(.horizontal, 22)
            .padding(.vertical, 10)
            .background(BKTheme.cardElevated.opacity(0.95))
            .clipShape(Capsule())
            .shadow(color: BKTheme.accent.opacity(0.35), radius: 12)
    }

    private var lossOverlay: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
            VStack(spacing: 16) {
                if let user = state.entrantModels.first(where: { $0.isUser }) {
                    LMSEntrantIcon(entrant: user, size: 72, showYouLabel: true, emphasizeElimination: true)
                }
                Text("You've been eliminated")
                    .font(BKFont.title(24))
                    .foregroundStyle(BKTheme.textPrimary)
                Text("Finished \(state.finishRankOrdinal) / \(LMSGameState.startingEntrants)")
                    .font(BKFont.body(15))
                    .foregroundStyle(BKTheme.textSecondary)
                Text("Questions survived: \(state.questionsSurvived) / \(LMSGameState.totalQuestions)")
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.textMuted)
            }
            .padding(24)
        }
        .allowsHitTesting(false)
    }

    private func recordCompletionAndExit() {
        if !allowReplay, let dailyDate {
            Task {
                let answer = JSONValue.object([
                    "picks": .array(state.pickHistory.map { .string($0) }),
                ])
                await DailyCompletionService.recordCompletion(
                    modeId: GameModeID.lastManStanding.rawValue,
                    date: dailyDate,
                    score: viewModel.xpEarned,
                    won: state.status == .won,
                    answer: answer,
                    context: modelContext
                )
            }
        }
        viewModel.showResult = false
        onComplete()
        dismiss()
    }
}

// MARK: - Result

private struct LastManStandingResultView: View {
    let won: Bool
    let finishRank: Int
    let finishRankOrdinal: String
    let questionsSurvived: Int
    let xpEarned: Int
    var showPlayAgain: Bool
    var onPlayAgain: () -> Void
    var onHome: () -> Void

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()
            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        Text("LAST MAN STANDING")
                            .font(BKFont.caption(11))
                            .tracking(1)
                            .foregroundStyle(BKTheme.textMuted)
                        Text(won ? "Last Man Standing" : "Eliminated")
                            .font(BKFont.title(28))
                            .foregroundStyle(won ? BKTheme.accent : BKTheme.wrong)
                        Text("Finished \(won ? "1st" : finishRankOrdinal) / \(LMSGameState.startingEntrants)")
                            .font(BKFont.body(14))
                            .foregroundStyle(BKTheme.textSecondary)
                        Text("Questions survived: \(questionsSurvived) / \(LMSGameState.totalQuestions)")
                            .font(BKFont.caption(11))
                            .foregroundStyle(BKTheme.textMuted)
                    }
                    .padding(.top, 24)

                    XPResultSummary(earned: xpEarned, max: DailyXP.maxXP(.lastManStanding))

                    if won {
                        LMSEntrantIcon(
                            entrant: LMSEntrant(id: UUID(), isUser: true, shirtHue: 0.12, isEliminated: false, eliminationToken: 0),
                            size: 64,
                            showYouLabel: true
                        )
                        .padding(.top, 8)
                    }

                    VStack(spacing: 10) {
                        if showPlayAgain {
                            Button(action: onPlayAgain) {
                                Text("Play again")
                                    .font(BKFont.headline(16))
                                    .foregroundStyle(BKTheme.background)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                                    .background(BKTheme.accent)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                        }
                        Button(action: onHome) {
                            Text("Home")
                                .font(BKFont.headline(16))
                                .foregroundStyle(BKTheme.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(BKTheme.card)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                    }
                    .padding(.top, 8)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
        }
    }
}
