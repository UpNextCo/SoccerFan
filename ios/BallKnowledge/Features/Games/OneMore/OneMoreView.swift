import SwiftUI

// MARK: - ViewModel

@MainActor
@Observable
final class OneMoreViewModel {
    var state: OneMoreGameState
    var showResult = false
    var showBustOverlay = false
    var confettiBurstToken = 0
    var scorePulseToken = 0
    var lastFeedback: String?

    init(prompt: OneMorePrompt) {
        self.state = OneMoreGameState(prompt: prompt)
    }

    var xpEarned: Int {
        let score = state.phase == .busted ? 0 : state.bankedScore
        return OneMoreScoring.xp(from: score, streak: state.streak)
    }

    var canCashOut: Bool {
        state.phase == .playing && state.streak > 0
    }

    /// Mid-run and worth saving: at least one round attempted, not busted/cashed out.
    var isResumable: Bool {
        state.isActive && (state.roundIndex > 0 || !state.picks.isEmpty)
    }

    func restore(_ saved: OneMoreGameState) {
        var s = saved
        // A snapshot taken mid-reveal has no resolved outcome — re-pose that round.
        if s.phase == .revealing { s.phase = .playing; s.chosenOptionId = nil }
        state = s
        resetTransient()
    }

    /// Tap an option → reveal both values briefly → resolve.
    func choose(_ option: OneMoreOption) {
        guard state.phase == .playing, let round = state.currentRound else { return }
        state.chosenOptionId = option.id
        state.phase = .revealing
        HapticManager.light()
        Task {
            try? await Task.sleep(for: .seconds(OneMoreTiming.reveal))
            resolve(option, in: round)
        }
    }

    private func resolve(_ option: OneMoreOption, in round: OneMoreRound) {
        guard state.phase == .revealing else { return }

        if state.prompt.qualifies(option) {
            state.streak += 1
            state.picks.append(OneMorePick(name: option.name, statValue: option.value, pointsAfter: state.currentScore))
            lastFeedback = "+\(OneMoreScoring.points(forPick: state.streak, rounds: state.totalRounds)) XP"
            HapticManager.success()
            scorePulseToken += 1
            state.chosenOptionId = nil
            state.roundIndex += 1
            if state.currentRound == nil {
                cashOut(cleared: true) // ran out of rounds → you cleared it
            } else {
                state.phase = .playing
            }
        } else {
            let correct = round.options.first { state.prompt.qualifies($0) }
            state.bustPick = OneMorePick(name: option.name, statValue: option.value, pointsAfter: state.currentScore)
            state.bustCorrect = correct
            state.streak = 0
            state.bankedScore = 0
            state.phase = .busted
            lastFeedback = correct.map { "\($0.name) had \($0.value)" } ?? "Wrong pick"
            HapticManager.error()
            showBustOverlay = true
            Task {
                try? await Task.sleep(for: .seconds(OneMoreTiming.bustHold))
                showBustOverlay = false
                showResult = true
            }
        }
    }

    func cashOut(cleared: Bool = false) {
        guard cleared || canCashOut else { return }
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
        state = OneMoreGameState(prompt: state.prompt)
        resetTransient()
    }

    private func resetTransient() {
        showResult = false
        showBustOverlay = false
        confettiBurstToken = 0
        scorePulseToken = 0
        lastFeedback = nil
    }
}

// MARK: - Main View

struct OneMoreView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: OneMoreViewModel
    private let allowReplay: Bool
    private let dailyDate: String?
    var onComplete: () -> Void

    init(
        dailyDate: String? = nil,
        prompt: OneMorePrompt,
        allowReplay: Bool = false,
        onComplete: @escaping () -> Void
    ) {
        _viewModel = State(initialValue: OneMoreViewModel(prompt: prompt))
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

                            // The whole run — streak, XP at risk, the pick track and the cash-out —
                            // in one panel so the button reads as "bank this run", not a floating chip.
                            VStack(spacing: 18) {
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
                                        statLabel: viewModel.state.prompt.statNoun,
                                        nextPoints: viewModel.state.nextPickPoints,
                                        showNext: viewModel.state.isActive,
                                        rounds: viewModel.state.totalRounds
                                    )
                                }

                                if viewModel.canCashOut {
                                    OneMoreCashOutButton(score: viewModel.state.currentScore) { viewModel.cashOut() }
                                        .transition(.opacity)
                                }
                            }
                            .padding(.vertical, 16)
                            .padding(.horizontal, 16)
                            .frame(maxWidth: .infinity)
                            .background(
                                // Very subtle green glow behind the run that slowly breathes, like
                                // the home hero's orbs.
                                TimelineView(.animation(minimumInterval: 1 / 30)) { tl in
                                    let t = tl.date.timeIntervalSinceReferenceDate
                                    let pulse = 0.035 + 0.018 * (0.5 + 0.5 * sin(t * 0.5))
                                    RadialGradient(
                                        colors: [BKTheme.accent.opacity(pulse), BKTheme.accent.opacity(pulse * 0.3), .clear],
                                        center: .center,
                                        startRadius: 0,
                                        endRadius: 260
                                    )
                                    .blur(radius: 28)
                                }
                                .allowsHitTesting(false)
                            )
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 16)
                    }

                    if let round = viewModel.state.currentRound, viewModel.state.isActive {
                        OneMoreChoiceSection(
                            round: round,
                            prompt: viewModel.state.prompt,
                            phase: viewModel.state.phase,
                            chosenId: viewModel.state.chosenOptionId,
                            onPick: { viewModel.choose($0) }
                        )
                    }
                }
                .animation(.spring(response: 0.38, dampingFraction: 0.78), value: viewModel.state.streak)
                .animation(.spring(response: 0.38, dampingFraction: 0.78), value: viewModel.canCashOut)
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
                        Text("ONE MORE")
                            .font(BKFont.caption(13))
                            .tracking(1.5)
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                }
            }

            if viewModel.showBustOverlay {
                OneMoreBustOverlay(
                    lostScore: viewModel.state.bustPick?.pointsAfter ?? 0,
                    reason: viewModel.lastFeedback ?? "Wrong pick"
                )
                .transition(.opacity)
                .zIndex(50)
            }

            FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                .zIndex(999)
        }
        .persistsGameProgress(
            viewModel.state,
            isResumable: viewModel.isResumable,
            modeId: GameModeID.oneMore.rawValue,
            date: dailyDate,
            version: OneMoreGameState.progressVersion,
            enabled: !allowReplay
        )
        .onAppear {
            guard !allowReplay, let dailyDate,
                  let saved = GameProgressStore.load(
                    OneMoreGameState.self, modeId: GameModeID.oneMore.rawValue,
                    date: dailyDate, version: OneMoreGameState.progressVersion, context: modelContext) else { return }
            viewModel.restore(saved)
        }
        .fullScreenCover(isPresented: $viewModel.showResult) {
            OneMoreResultView(
                prompt: viewModel.state.prompt,
                outcome: viewModel.state.phase,
                picks: viewModel.state.picks,
                bustPick: viewModel.state.bustPick,
                bustCorrect: viewModel.state.bustCorrect,
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
        VStack(alignment: .leading, spacing: 10) {
            Text(prompt.question)
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .foregroundStyle(BKTheme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(2)
            Text(prompt.ruleLine.uppercased())
                .font(BKFont.caption(10))
                .tracking(0.5)
                .foregroundStyle(BKTheme.textMuted)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
    }
}

// MARK: - Choice Section

private struct OneMoreChoiceSection: View {
    let round: OneMoreRound
    let prompt: OneMorePrompt
    let phase: OneMorePhase
    let chosenId: String?
    var onPick: (OneMoreOption) -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            if let first = round.options.first {
                card(first)
            }
            Text("OR")
                .font(BKFont.caption(11))
                .tracking(1.5)
                .foregroundStyle(BKTheme.textMuted)
            if round.options.count > 1 {
                card(round.options[1])
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 16)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: phase)
    }

    private func card(_ option: OneMoreOption) -> some View {
        OneMoreChoiceCard(
            option: option,
            qualifies: prompt.qualifies(option),
            statNoun: prompt.statNoun,
            revealed: phase == .revealing,
            isChosen: chosenId == option.id,
            onTap: { onPick(option) }
        )
    }
}

private struct OneMoreChoiceCard: View {
    let option: OneMoreOption
    let qualifies: Bool
    let statNoun: String
    let revealed: Bool
    let isChosen: Bool
    var onTap: () -> Void

    private var initials: String {
        let parts = option.name.split(separator: " ")
        let letters = parts.prefix(2).compactMap { $0.first }
        return String(letters).uppercased()
    }

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 8) {
                PlayerAvatar(urlString: option.headshotUrl, size: 80)
                .shadow(color: BKTheme.accent.opacity(0.5), radius: 5, y: 3) // tight green glow under the circle

                Text(option.name)
                    .font(BKFont.headline(15))
                    .foregroundStyle(BKTheme.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(minHeight: 26, alignment: .top)
                    .offset(y: 6) // nudge the name down closer to the position line



                HStack(spacing: 6) {
                    Text(GuessWhoDisplay.nationalityFlag(option.nationality))
                        .font(.system(size: 14))
                    if !option.position.isEmpty {
                        Text(option.position.uppercased())
                            .font(BKFont.caption(10))
                            .tracking(0.5)
                            .foregroundStyle(BKTheme.textMuted)
                    }
                }

                if !option.primaryClub.isEmpty {
                    VStack(spacing: 4) {
                        PlayerTeamBadge(player: option.badgeDTO, size: 36) {
                            Circle().fill(BKTheme.card).frame(width: 36, height: 36)
                        }
                        Text(option.primaryClub)
                            .font(BKFont.caption(10))
                            .foregroundStyle(BKTheme.textSecondary)
                            .lineLimit(1)
                    }
                    .padding(.top, 2)
                }

                if revealed {
                    HStack(spacing: 6) {
                        Text("\(option.value)")
                            .font(BKFont.headline(18))
                            .foregroundStyle(qualifies ? BKTheme.accent : BKTheme.wrong)
                            .contentTransition(.numericText())
                        (qualifies ? Ph.checkCircle.fill : Ph.xCircle.fill)
                            .color(qualifies ? BKTheme.accent : BKTheme.wrong)
                            .frame(width: 18, height: 18)
                    }
                    .padding(.top, 2)
                    .transition(.opacity.combined(with: .scale))
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .padding(.horizontal, 10)
            .background(cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(borderColor, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(revealed)
    }

    /// A slight neutral edge that only goes green/red once revealed (win/loss feedback).
    private var borderColor: Color {
        guard revealed else { return Color.white.opacity(0.10) }
        if qualifies { return BKTheme.accent.opacity(0.7) }
        return isChosen ? BKTheme.wrong.opacity(0.7) : Color.white.opacity(0.10)
    }

    /// FIFA/EA-style panel: dark fill that fades into the page, a faint accent slash, and a subtle
    /// diagonal line texture — no borders.
    @ViewBuilder private var cardBackground: some View {
        ZStack {
            // Flat fill matching the question rectangle at the top.
            BKTheme.card
            if revealed, qualifies {
                BKTheme.accent.opacity(0.16)
            } else if revealed, isChosen {
                BKTheme.wrong.opacity(0.16)
            }
        }
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

    var body: some View {
        VStack(spacing: 22) {
            HStack(spacing: 8) {
                Ph.lightning.fill
                    .color(BKTheme.streak)
                    .frame(width: 18, height: 18)
                Text("\(streak) STREAK")
                    .font(BKFont.headline(15))
                    .foregroundStyle(BKTheme.textPrimary)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 8)

            VStack(spacing: 2) {
                Text("\(DailyXP.projected(.oneMore, score: currentScore))")
                    .font(BKFont.title(52))
                    .foregroundStyle(streak > 0 ? BKTheme.accent : BKTheme.textPrimary)
                    .scaleEffect(pulseScale)
                    .contentTransition(.numericText())
                    .animation(.spring(response: 0.32, dampingFraction: 0.55), value: currentScore)
                Text(streak > 0 ? "XP AT RISK" : "XP")
                    .font(BKFont.caption(11))
                    .tracking(1)
                    .foregroundStyle(BKTheme.textMuted)
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
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
    var nextPoints: Int = 0
    var showNext: Bool = false
    var rounds: Int = 1

    private enum Item: Identifiable {
        case pick(number: Int, pick: OneMorePick)
        case next(points: Int)
        var id: String {
            switch self {
            case .pick(_, let p): return "p-\(p.id)"
            case .next: return "next"
            }
        }
    }

    /// Latest five entries (picks oldest→newest, plus the upcoming "next" empty slot), so the row
    /// slides as the run grows.
    private var items: [Item] {
        var arr: [Item] = picks.enumerated().map { .pick(number: $0.offset + 1, pick: $0.element) }
        if showNext { arr.append(.next(points: nextPoints)) }
        return Array(arr.suffix(5))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 0) {
                ForEach(items) { item in
                    column(item).frame(maxWidth: .infinity)
                }
            }
            .background(alignment: .top) {
                // Connecting timeline line through the circle centres.
                GeometryReader { geo in
                    let n = max(items.count, 1)
                    let colW = geo.size.width / CGFloat(n)
                    if items.count > 1 {
                        Path { p in
                            p.move(to: CGPoint(x: colW / 2, y: 14))
                            p.addLine(to: CGPoint(x: geo.size.width - colW / 2, y: 14))
                        }
                        .stroke(BKTheme.accent.opacity(0.3), lineWidth: 2)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: items.count)
    }

    @ViewBuilder private func column(_ item: Item) -> some View {
        switch item {
        case let .pick(number, pick):
            VStack(spacing: 5) {
                ZStack {
                    Circle().fill(BKTheme.accent).frame(width: 28, height: 28)
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(BKTheme.background)
                }
                Text(shortName(pick.name))
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Text("+\(pickXP(number))")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.accent)
            }
        case let .next(points):
            VStack(spacing: 5) {
                ZStack {
                    Circle().fill(BKTheme.cardElevated) // hides the timeline line behind the empty slot
                    Circle().strokeBorder(BKTheme.textMuted.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, dash: [3, 2]))
                }
                .frame(width: 28, height: 28)
                Text("NEXT")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
                    .lineLimit(1)
                Text("+\(nextXP(points))")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
            }
        }
    }

    /// XP the nth correct pick added (its escalating share of the max).
    private func pickXP(_ number: Int) -> Int {
        DailyXP.oneMorePick(number, rounds: rounds)
    }

    /// XP the upcoming pick would add on top of the current pot.
    private func nextXP(_ points: Int) -> Int {
        DailyXP.oneMorePick(picks.count + 1, rounds: rounds)
    }

    private func shortName(_ name: String) -> String {
        name.split(separator: " ").last.map(String.init) ?? name
    }
}

// MARK: - Cash Out

private struct OneMoreCashOutButton: View {
    let score: Int
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text("💰")
                    .font(.system(size: 18))
                Text("CASH OUT")
                    .font(BKFont.headline(15))
                    .foregroundStyle(BKTheme.textPrimary)
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text("\(DailyXP.projected(.oneMore, score: score))")
                        .font(BKFont.headline(16))
                        .foregroundStyle(BKTheme.accent)
                        .contentTransition(.numericText())
                    Text("XP")
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.accent)
                }
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 22)
            .background(BKTheme.cardElevated)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
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
                    Text("Lost \(DailyXP.projected(.oneMore, score: lostScore)) XP on the line")
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
    let bustCorrect: OneMoreOption?
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
                            .foregroundStyle(BKTheme.textMuted)
                        Text(isBusted ? "RUN OVER" : "CASHED OUT")
                            .font(BKFont.title(28))
                            .foregroundStyle(isBusted ? BKTheme.wrong : BKTheme.textPrimary)
                        Text(prompt.title)
                            .font(BKFont.body(14))
                            .foregroundStyle(BKTheme.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 24)

                    XPResultSummary(earned: xpEarned, max: DailyXP.maxXP(.oneMore))

                    Text(isBusted ? "Run ended on a wrong pick" : "\(streak) correct in a row")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textMuted)

                    VStack(spacing: 8) {
                        ForEach(picks) { pick in
                            HStack(spacing: 10) {
                                Ph.checkCircle.fill
                                    .color(BKTheme.accent)
                                    .frame(width: 14, height: 14)
                                Text(pick.name)
                                    .font(BKFont.body(13))
                                    .foregroundStyle(BKTheme.textPrimary)
                                    .lineLimit(1)
                                Spacer()
                                Text("\(pick.statValue) \(prompt.statNoun)")
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
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(bustPick.name)
                                        .font(BKFont.body(13))
                                        .foregroundStyle(BKTheme.wrong)
                                        .lineLimit(1)
                                    if let bustCorrect {
                                        Text("Answer: \(bustCorrect.name) (\(bustCorrect.value) \(prompt.statNoun))")
                                            .font(BKFont.caption(10))
                                            .foregroundStyle(BKTheme.textMuted)
                                            .lineLimit(1)
                                    }
                                }
                                Spacer()
                                Text("\(bustPick.statValue) \(prompt.statNoun)")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.wrong)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(BKTheme.wrong.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }

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

// MARK: - Stadium Background

/// Subtle night-stadium atmosphere: the moody floodlit top sits faintly behind the content and
/// fades to solid page-black before the bright pitch shows, so text/cards stay readable.
struct StadiumBackground: View {
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .top) {
                BKTheme.background
                // Confine the photo to the upper ~66% so you still glimpse the pitch, then fade it
                // fully into the page colour — leaving the cards section on clean black.
                GameModeBundleImage(name: "stadium")
                    .scaledToFill()
                    .frame(width: geo.size.width, height: geo.size.height * 0.88, alignment: .top)
                    .clipped()
                    .grayscale(0.5)
                    .blur(radius: 4)
                    .opacity(0.03)
                    .overlay(
                        LinearGradient(
                            stops: [
                                .init(color: BKTheme.background.opacity(0.0), location: 0.0),
                                .init(color: BKTheme.background.opacity(0.0), location: 0.30),
                                .init(color: BKTheme.background.opacity(0.75), location: 0.60),
                                .init(color: BKTheme.background, location: 0.78),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
            }
        }
        .ignoresSafeArea()
    }
}

