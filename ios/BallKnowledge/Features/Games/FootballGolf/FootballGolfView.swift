import SwiftUI

// Neon green accent per spec (#1AFF1A).
private let golfNeon = Color(red: 26.0 / 255.0, green: 255.0 / 255.0, blue: 26.0 / 255.0)

// MARK: - ViewModel

@MainActor
@Observable
final class FootballGolfViewModel {
    let course: FootballGolfCourse
    var currentHoleIndex = 0
    var results: [FootballGolfHoleResult] = []
    var phase: FootballGolfPhase = .playing

    // current-hole working state
    var matched: [FootballGolfAnswer] = []
    var wrongGuesses = 0
    var hintsUsed = 0
    var revealedHints: [String] = []
    var guess = ""

    // transient UI signals
    var lastRevealed: FootballGolfAnswer?
    var wrongFlashToken = 0
    var revealToken = 0
    var showResult = false
    var confettiToken = 0

    enum FootballGolfPhase: Equatable { case playing, holeResult, finished }

    init(course: FootballGolfCourse) {
        self.course = course
    }

    var currentHole: FootballGolfHole? {
        course.holes.indices.contains(currentHoleIndex) ? course.holes[currentHoleIndex] : nil
    }

    var totalScore: Int { results.map(\.relativeToPar).reduce(0, +) }
    var xpEarned: Int { FootballGolfScoring.xp(total: totalScore) }

    var hintsRemaining: Int {
        guard let hole = currentHole else { return 0 }
        return max(0, hole.hints.count - revealedHints.count)
    }

    private var matchedIds: Set<String> { Set(matched.map(\.id)) }

    func submitGuess() {
        guard phase == .playing, let hole = currentHole else { return }
        let trimmed = guess.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        if let answer = FootballGolfMatcher.match(guess: trimmed, in: hole.answers, alreadyMatched: matchedIds) {
            matched.append(answer)
            lastRevealed = answer
            revealToken += 1
            guess = ""
            HapticManager.success()
            if matched.count >= hole.par {
                completeHole(skipped: false)
            }
        } else {
            wrongGuesses += 1
            wrongFlashToken += 1
            guess = ""
            HapticManager.error()
        }
    }

    func useHint() {
        guard phase == .playing, let hole = currentHole, revealedHints.count < hole.hints.count else { return }
        revealedHints.append(hole.hints[revealedHints.count])
        hintsUsed += 1
        HapticManager.light()
    }

    func skipHole() {
        guard phase == .playing else { return }
        completeHole(skipped: true)
    }

    private func completeHole(skipped: Bool) {
        guard let hole = currentHole else { return }
        let result = FootballGolfHoleResult(
            id: hole.id,
            holeNumber: hole.holeNumber,
            par: hole.par,
            matched: matched,
            wrongGuesses: wrongGuesses,
            hintsUsed: hintsUsed,
            skipped: skipped
        )
        results.append(result)
        phase = .holeResult
        switch result.outcome {
        case .eagle, .birdie: HapticManager.success()
        case .par: HapticManager.light()
        default: HapticManager.error()
        }
    }

    func advance() {
        guard phase == .holeResult else { return }
        if results.count >= course.holes.count {
            phase = .finished
            if totalScore <= -2 { confettiToken += 1 }
            showResult = true
            return
        }
        currentHoleIndex += 1
        matched = []
        wrongGuesses = 0
        hintsUsed = 0
        revealedHints = []
        guess = ""
        lastRevealed = nil
        phase = .playing
    }

    var lastResult: FootballGolfHoleResult? { results.last }
}

// MARK: - Main View

struct FootballGolfView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: FootballGolfViewModel?
    @FocusState private var inputFocused: Bool
    private let allowReplay: Bool
    private let dailyDate: String?
    private let serverPuzzle: FootballGolfPuzzleDTO?
    var onComplete: () -> Void

    init(dailyDate: String? = nil, serverPuzzle: FootballGolfPuzzleDTO? = nil, allowReplay: Bool = true, onComplete: @escaping () -> Void) {
        self.dailyDate = dailyDate
        self.serverPuzzle = serverPuzzle
        self.allowReplay = allowReplay
        self.onComplete = onComplete
        if let serverPuzzle {
            _viewModel = State(initialValue: FootballGolfViewModel(course: FootballGolfCourse(dto: serverPuzzle)))
        } else {
            _viewModel = State(initialValue: nil)
        }
    }

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()
            if let viewModel {
                content(viewModel)
            } else {
                unavailableState
            }
        }
    }

    private var unavailableState: some View {
        VStack(spacing: 14) {
            Image(systemName: "flag.fill").font(.system(size: 34)).foregroundStyle(golfNeon)
            Text("TODAY'S COURSE ISN'T READY")
                .font(BKFont.headline(16))
                .foregroundStyle(BKTheme.textPrimary)
            Text("Pull the daily again in a moment.")
                .font(BKFont.caption(12))
                .foregroundStyle(BKTheme.textMuted)
            Button("CLOSE") { dismiss() }
                .font(BKFont.headline())
                .foregroundStyle(BKTheme.background)
                .padding(.horizontal, 28).padding(.vertical, 12)
                .background(golfNeon).clipShape(Capsule())
                .padding(.top, 8)
        }
    }

    @ViewBuilder
    private func content(_ vm: FootballGolfViewModel) -> some View {
        NavigationStack {
            VStack(spacing: 0) {
                FootballGolfScorecardStrip(holes: vm.course.holes, results: vm.results, currentIndex: vm.currentHoleIndex)

                ScrollView(showsIndicators: false) {
                    if let hole = vm.currentHole, vm.phase != .finished {
                        VStack(spacing: 18) {
                            holeHeader(vm, hole)
                            promptCard(hole)
                            matchedChips(vm, hole)
                            if !vm.revealedHints.isEmpty { hintsView(vm) }
                            statusRow(vm)
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 10)
                        .padding(.bottom, 24)
                    }
                }
                .scrollDismissesKeyboard(.interactively)

                if vm.phase == .playing { inputBar(vm) }
            }
            .background(BKTheme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: {
                        Ph.x.bold.color(BKTheme.textPrimary).frame(width: 15, height: 15)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text("FOOTBALL GOLF").font(BKFont.caption(13)).tracking(1).foregroundStyle(golfNeon)
                }
            }
            .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { inputFocused = true } }
            .onChange(of: vm.currentHoleIndex) { _, _ in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { inputFocused = true }
            }
        }
        .overlay {
            if vm.phase == .holeResult, let result = vm.lastResult {
                FootballGolfHoleResultOverlay(result: result, onNext: { withAnimation { vm.advance() } })
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
            }
        }
        .overlay { FootballConfettiView(burstToken: vm.confettiToken).allowsHitTesting(false) }
        .animation(.spring(response: 0.34, dampingFraction: 0.82), value: vm.phase)
        .fullScreenCover(isPresented: Binding(get: { vm.showResult }, set: { vm.showResult = $0 })) {
            FootballGolfFinalView(
                course: vm.course,
                results: vm.results,
                totalScore: vm.totalScore,
                xpEarned: vm.xpEarned,
                onDone: { finish(vm) }
            )
        }
    }

    // MARK: hole header

    private func holeHeader(_ vm: FootballGolfViewModel, _ hole: FootballGolfHole) -> some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                Text("HOLE \(hole.holeNumber) / \(vm.course.holes.count)")
                    .font(BKFont.caption(11)).tracking(1).foregroundStyle(BKTheme.textMuted)
                Text(hole.category.uppercased())
                    .font(BKFont.caption(10)).tracking(0.6).foregroundStyle(golfNeon)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("PAR \(hole.par)").font(BKFont.title(22)).foregroundStyle(golfNeon)
                Text("\(vm.matched.count)/\(hole.par) named")
                    .font(BKFont.caption(10)).foregroundStyle(BKTheme.textMuted)
            }
        }
    }

    private func promptCard(_ hole: FootballGolfHole) -> some View {
        Text(hole.prompt)
            .font(BKFont.headline(20))
            .foregroundStyle(BKTheme.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(18)
            .background(BKTheme.cardElevated)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(golfNeon.opacity(0.25), lineWidth: 1))
    }

    // MARK: matched answer chips + empty slots

    private func matchedChips(_ vm: FootballGolfViewModel, _ hole: FootballGolfHole) -> some View {
        VStack(spacing: 10) {
            ForEach(0..<hole.par, id: \.self) { i in
                if vm.matched.indices.contains(i) {
                    FootballGolfAnswerChip(answer: vm.matched[i], justRevealed: i == vm.matched.count - 1)
                        .id("\(vm.matched[i].id)-\(vm.revealToken)")
                } else {
                    HStack(spacing: 10) {
                        Text("\(i + 1)")
                            .font(.system(size: 12, weight: .heavy, design: .rounded))
                            .foregroundStyle(BKTheme.textMuted)
                            .frame(width: 26, height: 26)
                            .background(BKTheme.card).clipShape(Circle())
                        Text("TAP TO NAME ANSWER \(i + 1)")
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(BKTheme.textMuted)
                        Spacer()
                    }
                    .padding(.horizontal, 14).padding(.vertical, 14)
                    .background(BKTheme.card.opacity(0.5))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(i == vm.matched.count ? golfNeon.opacity(0.5) : Color.clear, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    )
                }
            }
        }
    }

    private func hintsView(_ vm: FootballGolfViewModel) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(vm.revealedHints, id: \.self) { hint in
                HStack(spacing: 8) {
                    Image(systemName: "lightbulb.fill").font(.system(size: 12)).foregroundStyle(.yellow)
                    Text(hint).font(BKFont.caption(12)).foregroundStyle(BKTheme.textSecondary)
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BKTheme.card.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func statusRow(_ vm: FootballGolfViewModel) -> some View {
        HStack(spacing: 16) {
            Label("\(vm.wrongGuesses) wrong", systemImage: "xmark.circle")
                .font(BKFont.caption(11)).foregroundStyle(vm.wrongGuesses > 0 ? BKTheme.wrong : BKTheme.textMuted)
            Label("\(vm.hintsUsed) hints", systemImage: "lightbulb")
                .font(BKFont.caption(11)).foregroundStyle(vm.hintsUsed > 0 ? .yellow : BKTheme.textMuted)
            Spacer()
            Text("strokes count against par")
                .font(BKFont.caption(10)).foregroundStyle(BKTheme.textMuted)
        }
        .padding(.top, 2)
    }

    // MARK: input bar

    private func inputBar(_ vm: FootballGolfViewModel) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                TextField("", text: Binding(get: { vm.guess }, set: { vm.guess = $0 }), prompt:
                    Text("NAME A PLAYER").foregroundStyle(BKTheme.textMuted).font(.system(size: 14, weight: .semibold, design: .rounded)))
                    .textFieldStyle(.plain)
                    .foregroundStyle(BKTheme.background)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.words)
                    .focused($inputFocused)
                    .submitLabel(.go)
                    .onSubmit { withAnimation { vm.submitGuess() }; inputFocused = true }
                    .padding(.horizontal, 16).padding(.vertical, 14)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .modifier(ShakeEffect(animatableData: CGFloat(vm.wrongFlashToken)))

                Button { withAnimation { vm.submitGuess() }; inputFocused = true } label: {
                    Text("GUESS").font(BKFont.headline(14)).foregroundStyle(BKTheme.background)
                        .padding(.horizontal, 18).padding(.vertical, 14)
                        .background(golfNeon).clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }

            HStack(spacing: 10) {
                Button { vm.useHint() } label: {
                    Label("HINT  +1", systemImage: "lightbulb.fill")
                        .font(BKFont.caption(12)).foregroundStyle(vm.hintsRemaining > 0 ? .yellow : BKTheme.textMuted)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(BKTheme.card).clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(vm.hintsRemaining == 0)

                Button { withAnimation { vm.skipHole() } } label: {
                    Label("SKIP  +2", systemImage: "forward.fill")
                        .font(BKFont.caption(12)).foregroundStyle(BKTheme.wrong)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(BKTheme.card).clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .padding(16)
        .background(BKTheme.background)
    }

    private func finish(_ vm: FootballGolfViewModel) {
        if !allowReplay, let dailyDate {
            let total = vm.totalScore
            Task {
                await DailyCompletionService.recordCompletion(
                    modeId: GameModeID.footballGolf.rawValue,
                    date: dailyDate,
                    score: max(0, 40 - total * 4),
                    won: total <= 0,
                    context: modelContext
                )
            }
        }
        vm.showResult = false
        onComplete()
        dismiss()
    }
}

// MARK: - Answer chip (with rarity reveal)

private struct FootballGolfAnswerChip: View {
    let answer: FootballGolfAnswer
    let justRevealed: Bool
    @State private var appeared = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(golfNeon)
            Text(answer.name.uppercased())
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(BKTheme.textPrimary)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(answer.rarity.label)
                .font(.system(size: 9, weight: .heavy, design: .rounded))
                .tracking(0.5)
                .foregroundStyle(rarityColor)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(rarityColor.opacity(0.15))
                .clipShape(Capsule())
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .background(BKTheme.cardElevated)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(rarityColor.opacity(0.4), lineWidth: 1))
        .scaleEffect(appeared ? 1 : (justRevealed ? 0.85 : 1))
        .onAppear { withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) { appeared = true } }
    }

    private var rarityColor: Color {
        switch answer.rarity {
        case .common: return BKTheme.textSecondary
        case .uncommon: return golfNeon
        case .rare: return .cyan
        case .ultraRare: return .purple
        }
    }
}

// MARK: - Scorecard strip

private struct FootballGolfScorecardStrip: View {
    let holes: [FootballGolfHole]
    let results: [FootballGolfHoleResult]
    let currentIndex: Int

    var body: some View {
        HStack(spacing: 5) {
            ForEach(Array(holes.enumerated()), id: \.element.id) { index, hole in
                let result = results.first { $0.holeNumber == hole.holeNumber }
                VStack(spacing: 4) {
                    Capsule()
                        .fill(result != nil ? golfNeon : (index == currentIndex ? golfNeon.opacity(0.45) : BKTheme.cardElevated))
                        .frame(height: 4)
                    Text(cell(result, holeNumber: hole.holeNumber))
                        .font(.system(size: 9, weight: .bold, design: .rounded))
                        .foregroundStyle(color(result, index: index))
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }

    private func cell(_ result: FootballGolfHoleResult?, holeNumber: Int) -> String {
        guard let result else { return "\(holeNumber)" }
        return FootballGolfScoring.scoreLabel(result.relativeToPar)
    }

    private func color(_ result: FootballGolfHoleResult?, index: Int) -> Color {
        guard let result else { return index == currentIndex ? golfNeon : BKTheme.textMuted }
        if result.relativeToPar < 0 { return golfNeon }
        if result.relativeToPar == 0 { return BKTheme.textSecondary }
        return BKTheme.wrong
    }
}

// MARK: - Hole result overlay

private struct FootballGolfHoleResultOverlay: View {
    let result: FootballGolfHoleResult
    var onNext: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.74).ignoresSafeArea().onTapGesture(perform: onNext)
            VStack(spacing: 16) {
                Text(result.outcome.label)
                    .font(BKFont.title(38)).foregroundStyle(outcomeColor)
                Text("\(FootballGolfScoring.scoreLabel(result.relativeToPar)) on Hole \(result.holeNumber)")
                    .font(BKFont.headline(16)).foregroundStyle(BKTheme.textPrimary)

                if result.skipped {
                    Text("Skipped").font(BKFont.caption(12)).foregroundStyle(BKTheme.textMuted)
                } else if !result.matched.isEmpty {
                    VStack(spacing: 6) {
                        ForEach(result.matched) { a in
                            HStack {
                                Text(a.name).font(BKFont.caption(12)).foregroundStyle(BKTheme.textSecondary)
                                Spacer()
                                Text(a.rarity.label).font(.system(size: 9, weight: .heavy, design: .rounded))
                                    .foregroundStyle(a.rarity.isStandout ? golfNeon : BKTheme.textMuted)
                            }
                        }
                    }
                    .frame(maxWidth: 240)
                }

                if result.wrongGuesses > 0 || result.hintsUsed > 0 {
                    Text("\(result.wrongGuesses) wrong · \(result.hintsUsed) hints")
                        .font(BKFont.caption(11)).foregroundStyle(BKTheme.textMuted)
                }

                Button(action: onNext) {
                    Text("NEXT HOLE").font(BKFont.headline()).foregroundStyle(BKTheme.background)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(golfNeon).clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .padding(.top, 6)
            }
            .padding(24).frame(maxWidth: 320)
            .background(BKTheme.cardElevated).clipShape(RoundedRectangle(cornerRadius: 20))
            .padding(.horizontal, 24)
        }
    }

    private var outcomeColor: Color {
        switch result.outcome {
        case .eagle, .birdie: return golfNeon
        case .par: return BKTheme.textPrimary
        default: return BKTheme.wrong
        }
    }
}

// MARK: - Final scorecard

private struct FootballGolfFinalView: View {
    let course: FootballGolfCourse
    let results: [FootballGolfHoleResult]
    let totalScore: Int
    let xpEarned: Int
    var onDone: () -> Void

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()
            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        Text("ROUND COMPLETE").font(BKFont.caption(11)).tracking(1).foregroundStyle(BKTheme.textMuted)
                        Text("You finished \(FootballGolfScoring.scoreLabel(totalScore))")
                            .font(BKFont.title(40)).foregroundStyle(golfNeon)
                        Text(FootballGolfScoring.finishMessage(totalScore))
                            .font(BKFont.headline(16)).foregroundStyle(BKTheme.textPrimary)
                        Text("+\(xpEarned) XP").font(BKFont.headline(15)).foregroundStyle(golfNeon)
                    }
                    .padding(.top, 28)

                    VStack(spacing: 8) {
                        ForEach(results) { result in
                            HStack {
                                Text("HOLE \(result.holeNumber)").font(BKFont.caption(10)).foregroundStyle(BKTheme.textMuted).frame(width: 56, alignment: .leading)
                                Text("Par \(result.par)").font(BKFont.caption(10)).foregroundStyle(BKTheme.textSecondary)
                                Spacer()
                                Text(result.outcome.label).font(BKFont.caption(10))
                                    .foregroundStyle(result.relativeToPar < 0 ? golfNeon : (result.relativeToPar == 0 ? BKTheme.textSecondary : BKTheme.wrong))
                                Text(FootballGolfScoring.scoreLabel(result.relativeToPar))
                                    .font(BKFont.headline(14)).foregroundStyle(BKTheme.textPrimary).frame(width: 32, alignment: .trailing)
                            }
                            .padding(.horizontal, 14).padding(.vertical, 11)
                            .background(BKTheme.card).clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }
                    .padding(.horizontal, 20)

                    Button(action: onDone) {
                        Text("DONE").font(BKFont.headline()).foregroundStyle(BKTheme.background)
                            .frame(maxWidth: .infinity).padding(.vertical, 16)
                            .background(golfNeon).clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                    .padding(.horizontal, 24).padding(.bottom, 32)
                }
            }
        }
    }
}

// MARK: - Shake effect for wrong guesses

private struct ShakeEffect: GeometryEffect {
    var animatableData: CGFloat
    func effectValue(size: CGSize) -> ProjectionTransform {
        let translation = 6 * sin(animatableData * .pi * 4)
        return ProjectionTransform(CGAffineTransform(translationX: translation, y: 0))
    }
}
