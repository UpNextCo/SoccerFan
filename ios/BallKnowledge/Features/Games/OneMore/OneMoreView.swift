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

    private let practice: Bool

    init(practice: Bool = false, dailyDate: String? = nil, serverPuzzle: OneMorePuzzleDTO? = nil) {
        self.practice = practice
        let serverDaily = practice ? nil : serverPuzzle.flatMap(OneMoreSeed.makeServerPrompt)
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
            lastFeedback = "+\(OneMoreScoring.points(forPick: state.streak)) pts"
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
        let prompt = practice ? OneMoreSeed.makePracticePrompt() : OneMoreSeed.makeDailyPrompt()
        state = OneMoreGameState(prompt: prompt)
        resetTransient()
    }

    func newPracticeRound() {
        state = OneMoreGameState(prompt: OneMoreSeed.makePracticePrompt())
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
                                VStack(spacing: 34) {
                                    OneMorePickHistory(
                                        picks: viewModel.state.picks,
                                        statLabel: viewModel.state.prompt.statNoun
                                    )
                                    if viewModel.canCashOut {
                                        OneMoreCashOutButton { viewModel.cashOut() }
                                            .transition(.opacity)
                                    }
                                }
                                .padding(.top, 14)
                            }
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
        .background(BKTheme.background)
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
                PlayerAvatar(urlString: option.headshotUrl, size: 68) {
                    Circle()
                        .fill(BKTheme.card)
                        .frame(width: 68, height: 68)
                        .overlay(
                            Text(initials)
                                .font(.system(size: 22, weight: .bold, design: .rounded))
                                .foregroundStyle(BKTheme.textMuted)
                        )
                }

                Text(option.name)
                    .font(BKFont.headline(15))
                    .foregroundStyle(BKTheme.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(minHeight: 38, alignment: .top)

                if !option.primaryClub.isEmpty {
                    HStack(spacing: 5) {
                        PlayerTeamBadge(player: option.badgeDTO, size: 16) {
                            Circle().fill(BKTheme.card).frame(width: 16, height: 16)
                        }
                        Text(option.primaryClub)
                            .font(BKFont.caption(10))
                            .foregroundStyle(BKTheme.textSecondary)
                            .lineLimit(1)
                    }
                }

                if !option.position.isEmpty {
                    Text(option.position.uppercased())
                        .font(BKFont.caption(9))
                        .tracking(0.5)
                        .foregroundStyle(BKTheme.textMuted)
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
            // The card's own colour radiates around the player image and fades to the page colour
            // toward the edges and bottom.
            RadialGradient(
                colors: [BKTheme.card, BKTheme.background],
                center: UnitPoint(x: 0.5, y: 0.18),
                startRadius: 6,
                endRadius: 175
            )
            // Subtle diagonal texture (toned down).
            DiagonalLineTexture(color: .white.opacity(0.03), spacing: 9)
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
        VStack(spacing: 34) {
            HStack {
                Text("YOUR RUN")
                    .font(BKFont.caption(11))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Spacer()
                HStack(spacing: 6) {
                    Ph.lightning.fill
                        .color(BKTheme.streak)
                        .frame(width: 14, height: 14)
                    Text("\(streak) STREAK")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textPrimary)
                }
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
                .foregroundStyle(streak > 0 ? BKTheme.accent : BKTheme.textPrimary)
                .frame(maxWidth: .infinity)
                .scaleEffect(pulseScale)
                .contentTransition(.numericText())
                .animation(.spring(response: 0.32, dampingFraction: 0.55), value: currentScore)
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

    /// Latest five picks (oldest→newest), with their original 1-based pick number for scoring.
    private var recent: [(number: Int, pick: OneMorePick)] {
        Array(picks.enumerated().suffix(5)).map { (number: $0.offset + 1, pick: $0.element) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 0) {
                ForEach(recent, id: \.pick.id) { item in
                    VStack(spacing: 5) {
                        ZStack {
                            Circle().fill(BKTheme.accent).frame(width: 28, height: 28)
                            Image(systemName: "checkmark")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(BKTheme.background)
                        }
                        Text(shortName(item.pick.name))
                            .font(BKFont.caption(10))
                            .foregroundStyle(BKTheme.textPrimary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                        Text("+\(OneMoreScoring.points(forPick: item.number))")
                            .font(BKFont.caption(10))
                            .foregroundStyle(BKTheme.accent)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .background(alignment: .top) {
                // Connecting timeline line through the tick centres.
                GeometryReader { geo in
                    let n = max(recent.count, 1)
                    let colW = geo.size.width / CGFloat(n)
                    if recent.count > 1 {
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
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: picks.count)
    }

    private func shortName(_ name: String) -> String {
        name.split(separator: " ").last.map(String.init) ?? name
    }
}

// MARK: - Cash Out

private struct OneMoreCashOutButton: View {
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Ph.coins.regular
                    .color(BKTheme.textPrimary)
                    .frame(width: 18, height: 18)
                Text("CASH OUT")
                    .font(BKFont.headline(15))
                    .foregroundStyle(BKTheme.textPrimary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(BKTheme.cardElevated)
            .clipShape(RoundedRectangle(cornerRadius: 12))
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

                    Text("\(finalScore)")
                        .font(BKFont.title(52))
                        .foregroundStyle(isBusted ? BKTheme.textMuted : BKTheme.accent)

                    Text(isBusted ? "0 points banked" : "\(streak) correct in a row")
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

// MARK: - FIFA-style panel texture

/// Subtle "/" diagonal line texture, the FIFA/EA menu-panel finish.
private struct DiagonalLineTexture: View {
    var color: Color = .white.opacity(0.05)
    var spacing: CGFloat = 9
    var lineWidth: CGFloat = 1

    var body: some View {
        Canvas { ctx, size in
            guard size.width > 1, size.height > 1 else { return }
            var x = -size.height
            while x < size.width {
                var path = Path()
                path.move(to: CGPoint(x: x, y: size.height))
                path.addLine(to: CGPoint(x: x + size.height, y: 0))
                ctx.stroke(path, with: .color(color), lineWidth: lineWidth)
                x += spacing
            }
        }
        .allowsHitTesting(false)
    }
}
