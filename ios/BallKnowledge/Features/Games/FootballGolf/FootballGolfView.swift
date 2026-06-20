import SwiftUI

// MARK: - ViewModel

@MainActor
@Observable
final class FootballGolfViewModel {
    var state: FootballGolfGameState
    var showResult = false
    var confettiBurstToken = 0

    init(course: FootballGolfCourse = FootballGolfSeed.weeklyCourse()) {
        self.state = FootballGolfGameState(course: course)
    }

    var xpEarned: Int {
        FootballGolfScoring.xp(from: state.totalScore, par: state.course.totalPar)
    }

    var leaderboard: [FootballGolfLeaderboardEntry] {
        FootballGolfSeed.mockLeaderboard(userScore: state.totalScore)
    }

    var canSubmitHole: Bool {
        guard state.phase == .playing, let hole = state.currentHole else { return false }
        guard state.draftAnswers.count == hole.par else { return false }
        return state.draftAnswers.allSatisfy {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    func restart() {
        state = FootballGolfGameState(course: FootballGolfSeed.weeklyCourse())
        showResult = false
        confettiBurstToken = 0
    }

    func submitHole() {
        guard canSubmitHole, let hole = state.currentHole else { return }

        let grading = FootballGolfMatcher.grade(hole: hole, submittedAnswers: state.draftAnswers)
        let outcome = FootballGolfScoring.outcome(correctCount: grading.correctCount, par: hole.par)

        let result = FootballGolfHoleResult(
            id: hole.id,
            holeId: hole.id,
            holeNumber: hole.holeNumber,
            par: hole.par,
            submittedAnswers: state.draftAnswers.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) },
            matchedAnswers: grading.matched,
            correctCount: grading.correctCount,
            outcome: outcome
        )

        state.holeResults.append(result)
        state.lastHoleResult = result
        state.phase = .holeResult

        switch outcome {
        case .birdie:
            HapticManager.success()
        case .par:
            HapticManager.light()
        case .bogey:
            HapticManager.error()
        }

        Task {
            try? await Task.sleep(for: .seconds(FootballGolfTiming.holeResultAutoAdvance))
            advanceFromHoleResult()
        }
    }

    func advanceFromHoleResult() {
        guard state.phase == .holeResult else { return }

        if state.holeResults.count >= state.course.holes.count {
            state.phase = .finished
            if state.totalScore <= -3 {
                confettiBurstToken += 1
                HapticManager.success()
            }
            showResult = true
            return
        }

        state.currentHoleIndex += 1
        if let hole = state.currentHole {
            state.draftAnswers = Array(repeating: "", count: hole.par)
        }
        state.lastHoleResult = nil
        state.phase = .playing
    }
}

// MARK: - Main View

struct FootballGolfView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel = FootballGolfViewModel()
    @FocusState private var focusedField: Int?
    var onComplete: () -> Void

    var body: some View {
        ZStack {
            NavigationStack {
                VStack(spacing: 0) {
                    FootballGolfProgressBar(
                        holes: viewModel.state.course.holes,
                        completedResults: viewModel.state.holeResults,
                        currentHoleIndex: viewModel.state.currentHoleIndex
                    )

                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 20) {
                            FootballGolfCourseHeader(course: viewModel.state.course)

                            if let hole = viewModel.state.currentHole, viewModel.state.phase == .playing {
                                FootballGolfHoleCard(
                                    hole: hole,
                                    answers: $viewModel.state.draftAnswers,
                                    focusedField: $focusedField
                                )
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 24)
                    }
                    .scrollDismissesKeyboard(.interactively)

                    if viewModel.state.phase == .playing {
                        FootballGolfSubmitButton(
                            enabled: viewModel.canSubmitHole,
                            label: "SUBMIT HOLE"
                        ) {
                            focusedField = nil
                            viewModel.submitHole()
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
                        Text("FOOTBALL GOLF")
                            .font(BKFont.caption(13))
                            .tracking(1)
                            .foregroundStyle(BKTheme.accent)
                    }
                }
            }

            if viewModel.state.phase == .holeResult, let result = viewModel.state.lastHoleResult {
                FootballGolfHoleResultOverlay(result: result) {
                    viewModel.advanceFromHoleResult()
                }
                .transition(.opacity.combined(with: .scale(scale: 0.96)))
                .zIndex(10)
            }

            FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                .zIndex(999)
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.82), value: viewModel.state.phase)
        .fullScreenCover(isPresented: $viewModel.showResult) {
            FootballGolfScorecardView(
                course: viewModel.state.course,
                results: viewModel.state.holeResults,
                totalScore: viewModel.state.totalScore,
                xpEarned: viewModel.xpEarned,
                leaderboard: viewModel.leaderboard,
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

// MARK: - Progress

private struct FootballGolfProgressBar: View {
    let holes: [FootballGolfHole]
    let completedResults: [FootballGolfHoleResult]
    let currentHoleIndex: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(holes.enumerated()), id: \.element.id) { index, hole in
                VStack(spacing: 4) {
                    Capsule()
                        .fill(fillColor(for: index))
                        .frame(height: 4)

                    if let result = completedResults.first(where: { $0.holeNumber == hole.holeNumber }) {
                        Text(result.outcome == .birdie ? "-1" : result.outcome == .par ? "0" : "+1")
                            .font(.system(size: 8, weight: .bold, design: .rounded))
                            .foregroundStyle(outcomeColor(result.outcome))
                    } else {
                        Text("\(hole.holeNumber)")
                            .font(.system(size: 8, weight: .bold, design: .rounded))
                            .foregroundStyle(index == currentHoleIndex ? BKTheme.accent : BKTheme.textMuted)
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    private func fillColor(for index: Int) -> Color {
        if completedResults.contains(where: { $0.holeNumber == holes[index].holeNumber }) {
            return BKTheme.accent
        }
        if index == currentHoleIndex {
            return BKTheme.accent.opacity(0.45)
        }
        return BKTheme.cardElevated
    }

    private func outcomeColor(_ outcome: FootballGolfHoleOutcome) -> Color {
        switch outcome {
        case .birdie: return BKTheme.accent
        case .par: return BKTheme.textSecondary
        case .bogey: return BKTheme.wrong
        }
    }
}

// MARK: - Course Header

private struct FootballGolfCourseHeader: View {
    let course: FootballGolfCourse

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WEEKLY COURSE")
                .font(BKFont.caption(10))
                .tracking(0.8)
                .foregroundStyle(BKTheme.accent)
            Text(course.title.uppercased())
                .font(BKFont.headline(18))
                .foregroundStyle(BKTheme.textPrimary)
            Text(course.theme)
                .font(BKFont.caption(11))
                .foregroundStyle(BKTheme.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(BKTheme.cardElevated.opacity(0.9))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Hole Card

private struct FootballGolfHoleCard: View {
    let hole: FootballGolfHole
    @Binding var answers: [String]
    var focusedField: FocusState<Int?>.Binding

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("HOLE \(hole.holeNumber)")
                    .font(BKFont.caption(11))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Spacer()
                Text("PAR \(hole.par)")
                    .font(BKFont.caption(11))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.accent)
            }

            Text(hole.question)
                .font(BKFont.body(15))
                .foregroundStyle(BKTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 10) {
                ForEach(0..<hole.par, id: \.self) { index in
                    HStack(spacing: 10) {
                        Text("\(index + 1)")
                            .font(.system(size: 11, weight: .heavy, design: .rounded))
                            .foregroundStyle(BKTheme.background)
                            .frame(width: 22, height: 22)
                            .background(BKTheme.accent.opacity(0.85))
                            .clipShape(Circle())

                        TextField("", text: binding(for: index), prompt:
                            Text("Answer \(index + 1)")
                                .foregroundStyle(BKTheme.textMuted)
                                .font(.system(size: 14, weight: .semibold, design: .rounded))
                        )
                        .textFieldStyle(.plain)
                        .foregroundStyle(BKTheme.background)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.words)
                        .focused(focusedField, equals: index)
                        .submitLabel(index == hole.par - 1 ? .done : .next)
                        .onSubmit {
                            if index < hole.par - 1 {
                                focusedField.wrappedValue = index + 1
                            }
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(
                                focusedField.wrappedValue == index
                                    ? BKTheme.accent.opacity(0.65)
                                    : BKTheme.accent.opacity(0.2),
                                lineWidth: 1.5
                            )
                    )
                }
            }
        }
        .padding(16)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func binding(for index: Int) -> Binding<String> {
        Binding(
            get: {
                guard answers.indices.contains(index) else { return "" }
                return answers[index]
            },
            set: { newValue in
                while answers.count <= index {
                    answers.append("")
                }
                answers[index] = newValue
            }
        )
    }
}

// MARK: - Hole Result Overlay

private struct FootballGolfHoleResultOverlay: View {
    let result: FootballGolfHoleResult
    var onContinue: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.72)
                .ignoresSafeArea()
                .onTapGesture(perform: onContinue)

            VStack(spacing: 18) {
                Text(result.outcome.label)
                    .font(BKFont.title(36))
                    .foregroundStyle(outcomeColor)

                Text("\(result.correctCount)/\(result.par) correct")
                    .font(BKFont.headline(18))
                    .foregroundStyle(BKTheme.textPrimary)

                Text(holeScoreLabel)
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.textSecondary)

                if !result.matchedAnswers.isEmpty {
                    VStack(spacing: 6) {
                        Text("MATCHED")
                            .font(BKFont.caption(10))
                            .foregroundStyle(BKTheme.textMuted)
                        ForEach(result.matchedAnswers, id: \.self) { answer in
                            Text(answer.uppercased())
                                .font(BKFont.caption(11))
                                .foregroundStyle(BKTheme.accent)
                        }
                    }
                }

                Button(action: onContinue) {
                    Text("NEXT HOLE")
                        .font(BKFont.headline())
                        .foregroundStyle(BKTheme.background)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(BKTheme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .padding(.top, 8)
            }
            .padding(24)
            .frame(maxWidth: 320)
            .background(BKTheme.cardElevated)
            .clipShape(RoundedRectangle(cornerRadius: 20))
            .padding(.horizontal, 24)
        }
    }

    private var outcomeColor: Color {
        switch result.outcome {
        case .birdie: return BKTheme.accent
        case .par: return BKTheme.textPrimary
        case .bogey: return BKTheme.wrong
        }
    }

    private var holeScoreLabel: String {
        switch result.outcome {
        case .birdie: return "Hole score: -1"
        case .par: return "Hole score: E"
        case .bogey: return "Hole score: +1"
        }
    }
}

// MARK: - Submit

private struct FootballGolfSubmitButton: View {
    let enabled: Bool
    let label: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(BKFont.headline())
                .foregroundStyle(BKTheme.background)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(enabled ? BKTheme.accent : BKTheme.cardElevated)
                .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .disabled(!enabled)
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
        .background(BKTheme.background)
    }
}

// MARK: - Scorecard

private struct FootballGolfScorecardView: View {
    let course: FootballGolfCourse
    let results: [FootballGolfHoleResult]
    let totalScore: Int
    let xpEarned: Int
    let leaderboard: [FootballGolfLeaderboardEntry]
    var onPlayAgain: () -> Void
    var onHome: () -> Void

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        Text("ROUND COMPLETE")
                            .font(BKFont.caption(11))
                            .tracking(1)
                            .foregroundStyle(BKTheme.textMuted)
                        Text(FootballGolfScoring.scoreLabel(totalScore))
                            .font(BKFont.title(48))
                            .foregroundStyle(BKTheme.accent)
                        Text(FootballGolfScoring.relativeToParLabel(total: totalScore, par: course.totalPar))
                            .font(BKFont.body())
                            .foregroundStyle(BKTheme.textSecondary)
                        Text("+\(xpEarned) XP")
                            .font(BKFont.headline(18))
                            .foregroundStyle(BKTheme.accent)
                    }
                    .padding(.top, 24)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("SCORECARD")
                            .font(BKFont.caption(11))
                            .tracking(0.8)
                            .foregroundStyle(BKTheme.textMuted)

                        ForEach(results) { result in
                            HStack {
                                Text("HOLE \(result.holeNumber)")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.textMuted)
                                    .frame(width: 56, alignment: .leading)
                                Text("Par \(result.par)")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.textSecondary)
                                Spacer()
                                Text(result.outcome.label)
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(outcomeColor(result.outcome))
                                Text(result.outcome == .birdie ? "-1" : result.outcome == .par ? "E" : "+1")
                                    .font(BKFont.headline(14))
                                    .foregroundStyle(BKTheme.textPrimary)
                                    .frame(width: 28, alignment: .trailing)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(BKTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }
                    .padding(.horizontal, 20)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("LEADERBOARD")
                            .font(BKFont.caption(11))
                            .tracking(0.8)
                            .foregroundStyle(BKTheme.textMuted)

                        ForEach(Array(leaderboard.enumerated()), id: \.element.id) { index, entry in
                            HStack {
                                Text("\(index + 1)")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.textMuted)
                                    .frame(width: 20, alignment: .leading)
                                Text(entry.name.uppercased())
                                    .font(BKFont.caption(11))
                                    .foregroundStyle(entry.isUser ? BKTheme.accent : BKTheme.textPrimary)
                                Spacer()
                                Text(FootballGolfScoring.scoreLabel(entry.score))
                                    .font(BKFont.headline(14))
                                    .foregroundStyle(entry.isUser ? BKTheme.accent : BKTheme.textPrimary)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(entry.isUser ? BKTheme.accent.opacity(0.12) : BKTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }
                    .padding(.horizontal, 20)

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

    private func outcomeColor(_ outcome: FootballGolfHoleOutcome) -> Color {
        switch outcome {
        case .birdie: return BKTheme.accent
        case .par: return BKTheme.textSecondary
        case .bogey: return BKTheme.wrong
        }
    }
}
