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
    var checkError: String?
    /// When true, survivor grid won't animate position changes (X marks stamp in place first).
    var freezeSurvivorLayout = false
    /// Sequential run token from POST /daily/lms/start — required for each check.
    var runToken: String?

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

    var isResumable: Bool {
        state.status != .won && state.status != .lost &&
        (state.questionsSurvived > 0 || !state.pickHistory.isEmpty || state.status != .intro)
    }

    func restore(_ saved: LMSGameState) {
        var s = saved
        // Mid-animation snapshots shouldn't leave the player stuck — re-pose the current question.
        if s.status == .correctReveal || s.status == .eliminating {
            s.status = .question
            s.pendingEliminationIds = []
            s.finalizeEliminations()
        }
        state = s
        showResult = false
        showCorrectFlash = false
        activeCommentary = nil
        eliminationSummary = nil
        lastReveal = nil
        isChecking = false
        checkError = nil
        freezeSurvivorLayout = false
        runToken = nil
    }

    func beginIfNeeded() {
        guard state.status == .intro else { return }
        state.status = .question
        Task { await ensureRunToken() }
    }

    /// Start (or resume) a sequential LMS run. Passes local pickHistory so the server can
    /// re-issue a token at the correct question index after an app kill.
    func ensureRunToken() async {
        guard let dailyDate, runToken == nil else { return }
        do {
            let started = try await APIClient.shared.lastManStandingStart(
                date: dailyDate,
                resumePicks: state.pickHistory
            )
            runToken = started.token
            checkError = nil
        } catch {
            checkError = "Couldn't start today's quiz. Check your connection and try again."
        }
    }

    func submit(optionId: String) async {
        guard state.status == .question, state.currentQuestion != nil, !isChecking else { return }
        guard let dailyDate else { return }

        isChecking = true
        defer { isChecking = false }
        checkError = nil

        if runToken == nil {
            await ensureRunToken()
        }
        guard let token = runToken else {
            checkError = "Couldn't reach the server. Try again."
            return
        }

        do {
            let result = try await APIClient.shared.lastManStandingCheck(
                date: dailyDate,
                token: token,
                optionId: optionId
            )
            state.pickHistory.append(optionId)
            lastReveal = result.reveal
            if result.correct {
                runToken = result.nextToken
                await handleCorrect()
            } else {
                runToken = nil
                handleWrong()
            }
        } catch {
            checkError = "Couldn't check that answer. Check your connection and try again."
        }
    }

    private func handleCorrect() async {
        state.status = .correctReveal
        showCorrectFlash = true
        eliminationSummary = nil
        HapticManager.success()

        try? await Task.sleep(for: .milliseconds(235))
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
        freezeSurvivorLayout = true
        activeCommentary = state.currentStep.commentary

        let ids = state.pendingEliminationIds
        let targetRemaining = state.nextStepAfterCorrect?.remaining ?? state.displayedRemaining
        let startRemaining = state.displayedRemaining

        guard !ids.isEmpty else {
            freezeSurvivorLayout = false
            advanceToNextQuestion()
            return
        }

        // Phase 1 — stamp X marks in place. Layout stays frozen on the pre-elim
        // field so icons don't slide while crosses appear.
        let waveCount = ids.count >= 20 ? 4 : 3
        let waves = splitIntoWaves(ids, waveCount: waveCount)
        var eliminatedSoFar = 0

        for (waveIndex, wave) in waves.enumerated() {
            for id in wave {
                eliminationWaveToken += 1
                state.markEliminated(id, token: eliminationWaveToken)
                eliminatedSoFar += 1
                try? await Task.sleep(for: .milliseconds(20))
            }
            HapticManager.light()
            let interim = max(targetRemaining, startRemaining - eliminatedSoFar)
            withAnimation(.easeOut(duration: 0.12)) {
                state.displayedRemaining = interim
            }
            if waveIndex < waves.count - 1 {
                try? await Task.sleep(for: .milliseconds(80))
            }
        }

        withAnimation(.easeOut(duration: 0.15)) {
            state.displayedRemaining = targetRemaining
        }

        let eliminated = startRemaining - targetRemaining
        eliminationSummary = "\(eliminated) eliminated · \(targetRemaining) remain"

        // Hold so the crossed-out field reads clearly before anything moves.
        try? await Task.sleep(for: .milliseconds(520))

        // Phase 2 — drop the eliminated icons and let survivors reflow.
        freezeSurvivorLayout = false
        withAnimation(.easeInOut(duration: 0.32)) {
            state.finalizeEliminations()
        }
        try? await Task.sleep(for: .milliseconds(340))

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
        freezeSurvivorLayout = false
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
                VStack(spacing: 0) {
                    ScrollView(showsIndicators: false) {
                        questionSection
                            .padding(.horizontal, 16)
                            .padding(.top, 18)
                            .padding(.bottom, 24)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                    survivorDock
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
        .animation(.easeOut(duration: 0.21), value: state.currentQuestionIndex)
        .persistsGameProgress(
            viewModel.state,
            isResumable: viewModel.isResumable,
            modeId: GameModeID.lastManStanding.rawValue,
            date: dailyDate,
            version: LMSGameState.progressVersion,
            enabled: !allowReplay
        )
        .onAppear {
            if !allowReplay, let dailyDate,
               let saved = GameProgressStore.load(
                LMSGameState.self,
                modeId: GameModeID.lastManStanding.rawValue,
                date: dailyDate,
                version: LMSGameState.progressVersion,
                context: modelContext
               ) {
                viewModel.restore(saved)
            }
            viewModel.beginIfNeeded()
        }
        .alert(
            "Connection issue",
            isPresented: Binding(
                get: { viewModel.checkError != nil },
                set: { if !$0 { viewModel.checkError = nil } }
            )
        ) {
            Button("OK", role: .cancel) { viewModel.checkError = nil }
            Button("Retry") {
                Task { await viewModel.ensureRunToken() }
            }
        } message: {
            Text(viewModel.checkError ?? "")
        }
        .fullScreenCover(isPresented: $viewModel.showResult) {
            LastManStandingResultView(
                won: state.status == .won,
                finishRank: state.finishRank,
                finishRankOrdinal: state.finishRankOrdinal,
                questionsSurvived: state.questionsSurvived,
                xpEarned: viewModel.xpEarned,
                onHome: {
                    viewModel.showResult = false
                    onComplete()
                    dismiss()
                }
            )
            .task {
                guard !allowReplay, let dailyDate else { return }
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
    }

    private enum SurvivorDockMetrics {
        static let labelGap: CGFloat = 10
    }

    private var survivorDock: some View {
        // During elimination, visibleEntrants still includes crossed-out icons — key
        // layout off that count so icon size/spacing don't jump until they actually leave.
        let layoutCount = max(state.displayedRemaining, state.visibleEntrants.count)
        let profile = LMSGameState.layoutProfile(forRemaining: layoutCount)
        let dockWidth = UIScreen.main.bounds.width - 32
        let entrantCount = state.visibleEntrants.count
        let contentHeight = LastManStandingSurvivorField.contentHeight(
            entrantCount: entrantCount,
            profile: profile,
            availableWidth: dockWidth
        )
        let scrollCap = profile.maxHeight
        let needsScroll = contentHeight > scrollCap

        return VStack(spacing: 0) {
            Rectangle()
                .fill(Color.white.opacity(0.06))
                .frame(height: 1)

            Group {
                if needsScroll {
                    ScrollView(.vertical, showsIndicators: false) {
                        survivorField(profile: profile)
                    }
                    .frame(height: scrollCap)
                } else {
                    survivorField(profile: profile)
                }
            }

            Spacer().frame(height: SurvivorDockMetrics.labelGap)

            survivorStatusRow
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 10)
        .safeAreaPadding(.bottom, 4)
        .background(BKTheme.background.opacity(0.92))
    }

    private func survivorField(profile: LMSLayoutProfile) -> some View {
        LastManStandingSurvivorField(
            entrants: state.visibleEntrants,
            remaining: state.displayedRemaining,
            profile: profile,
            // Freeze layout while X marks stamp in; reflow only after finalize.
            freezeField: state.status == .lost || viewModel.freezeSurvivorLayout
        )
    }

    private var survivorStatusRow: some View {
        HStack(spacing: 8) {
            Text("\(state.displayedRemaining) remaining")
                .font(BKFont.body(14))
                .foregroundStyle(BKTheme.textPrimary)
                .contentTransition(.numericText())
                .animation(.easeOut(duration: 0.19), value: state.displayedRemaining)

            if let summary = viewModel.eliminationSummary {
                Text("·")
                    .foregroundStyle(BKTheme.textMuted)
                Text(summary)
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.accent.opacity(0.85))
                    .lineLimit(1)
            } else if let commentary = viewModel.activeCommentary {
                Text("·")
                    .foregroundStyle(BKTheme.textMuted)
                Text(commentary)
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textSecondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity)
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
            .opacity(viewModel.isChecking ? 0.72 : 1)
            .animation(.easeOut(duration: 0.12), value: viewModel.isChecking)
        }
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
