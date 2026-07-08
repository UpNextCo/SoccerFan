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
    var eliminationSummary: String?
    var lastReveal: String?
    var isChecking = false
    var eliminationWaveToken = 0

    private let dailyDate: String?

    init(prompt: LMSPrompt, dailyDate: String?) {
        self.dailyDate = dailyDate
        let seed = LMSPromptSeed.entrantSeed(for: prompt)
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

    func submit(optionId: String) async {
        guard state.status == .question, let question = state.currentQuestion, !isChecking else { return }
        guard let dailyDate else { return }

        isChecking = true
        defer { isChecking = false }

        do {
            let result = try await APIClient.shared.lastManStandingCheck(
                date: dailyDate,
                questionId: question.id,
                optionId: optionId
            )
            state.pickHistory.append(optionId)
            lastReveal = result.reveal
            if result.correct {
                await handleCorrect()
            } else {
                handleWrong()
            }
        } catch {
            // Offline / server error — don't advance on unknown result.
        }
    }

    private func handleCorrect() async {
        state.status = .correctReveal
        showCorrectFlash = true
        eliminationSummary = nil
        HapticManager.success()

        try? await Task.sleep(for: .milliseconds(350))
        showCorrectFlash = false
        await runElimination()
    }

    private func handleWrong() {
        state.eliminateUser()
        state.status = .lost
        HapticManager.error()
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
        let targetRemaining = state.nextStepAfterCorrect?.remaining ?? state.displayedRemaining
        let startRemaining = state.displayedRemaining

        guard !ids.isEmpty else {
            advanceToNextQuestion()
            return
        }

        let waveCount = ids.count >= 20 ? 4 : 3
        let waves = splitIntoWaves(ids, waveCount: waveCount)
        var eliminatedSoFar = 0

        for (waveIndex, wave) in waves.enumerated() {
            for id in wave {
                eliminationWaveToken += 1
                state.markEliminated(id, token: eliminationWaveToken)
                eliminatedSoFar += 1
                try? await Task.sleep(for: .milliseconds(35))
            }
            HapticManager.light()
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

        let eliminated = startRemaining - targetRemaining
        eliminationSummary = "\(eliminated) eliminated · \(targetRemaining) remain"
        try? await Task.sleep(for: .milliseconds(900))

        state.finalizeEliminations()
        eliminationSummary = nil
        advanceToNextQuestion()
    }

    private func advanceToNextQuestion() {
        state.currentQuestionIndex += 1
        state.status = .question
        lastReveal = nil
    }

    private func splitIntoWaves(_ ids: [UUID], waveCount: Int) -> [[UUID]] {
        let chunkSize = max(1, Int(ceil(Double(ids.count) / Double(waveCount))))
        return stride(from: 0, to: ids.count, by: chunkSize).map {
            Array(ids[$0..<min($0 + chunkSize, ids.count)])
        }
    }

    func restart() {
        let prompt = state.prompt
        let seed = LMSPromptSeed.entrantSeed(for: prompt)
        state = LMSGameState.make(prompt: prompt, seed: seed)
        state.status = .question
        showResult = false
        showCorrectFlash = false
        activeCommentary = nil
        eliminationSummary = nil
        lastReveal = nil
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
        _viewModel = State(initialValue: LastManStandingViewModel(prompt: prompt, dailyDate: dailyDate))
        self.allowReplay = allowReplay
        self.dailyDate = dailyDate
        self.onComplete = onComplete
    }

    private var state: LMSGameState { viewModel.state }

    var body: some View {
        ZStack {
            NavigationStack {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 20) {
                        questionSection
                        survivorSection
                    }
                    .animation(.easeOut(duration: 0.32), value: state.currentQuestionIndex)
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                    .padding(.bottom, 32)
                }
                .background(StadiumBackground(glowIntensity: 0.28))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { dismiss() } label: {
                            Ph.x.bold
                                .color(BKTheme.textSecondary)
                                .frame(width: 13, height: 13)
                                .frame(width: 32, height: 32)
                                .background(BKTheme.card.opacity(0.9))
                                .clipShape(Circle())
                                .overlay(LMSVisualStyle.cardStroke(Circle()))
                        }
                        .buttonStyle(.plain)
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
                onHome: {
                    recordCompletionAndExit()
                }
            )
        }
    }

    @ViewBuilder
    private var questionSection: some View {
        if let question = state.currentQuestion, state.status != .lost {
            LastManStandingQuestionCard(
                question: question,
                isInteractive: state.isInteractive && !viewModel.isChecking
            ) { optionId in
                Task { await viewModel.submit(optionId: optionId) }
            }
            .id(question.id)
            .transition(.opacity.combined(with: .offset(y: 8)))

            if viewModel.isChecking {
                ProgressView()
                    .controlSize(.small)
                    .tint(BKTheme.textMuted)
                    .padding(.top, 2)
            }
        }
    }

    private var survivorSection: some View {
        let profile = LMSGameState.layoutProfile(forRemaining: state.displayedRemaining)
        return VStack(spacing: 12) {
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
                .animation(.easeOut(duration: 0.28), value: state.displayedRemaining)

            if let summary = viewModel.eliminationSummary {
                Text(summary)
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.accent.opacity(0.85))
                    .transition(.opacity)
            }

            if let commentary = viewModel.activeCommentary {
                Text(commentary)
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .transition(.opacity)
            }
        }
        .padding(.top, 6)
    }

    private var correctFlash: some View {
        Text("Correct")
            .font(BKFont.headline(20))
            .foregroundStyle(BKTheme.accent)
            .padding(.horizontal, 20)
            .padding(.vertical, 9)
            .background(BKTheme.card.opacity(0.96))
            .clipShape(Capsule())
            .overlay(LMSVisualStyle.cardStroke(Capsule()))
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
                if let reveal = viewModel.lastReveal {
                    Text(reveal)
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textMuted)
                        .multilineTextAlignment(.center)
                }
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
    var onHome: () -> Void

    var body: some View {
        GameResultScreen(onExit: onHome) {
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
            }
            .padding(.horizontal, 20)
        }
    }
}
