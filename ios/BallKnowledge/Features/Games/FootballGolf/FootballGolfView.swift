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
    var guess = ""

    // transient UI signals
    var lastRevealed: FootballGolfAnswer?
    var wrongFlashToken = 0
    var revealToken = 0
    var showResult = false
    var confettiToken = 0

    // autocomplete
    var searchResults: [PlayerSearchResultDTO] = []
    var isSearching = false

    enum FootballGolfPhase: Equatable { case playing, holeResult, finished }

    init(course: FootballGolfCourse) {
        self.course = course
    }

    var currentHole: FootballGolfHole? {
        course.holes.indices.contains(currentHoleIndex) ? course.holes[currentHoleIndex] : nil
    }

    var totalScore: Int { results.map(\.relativeToPar).reduce(0, +) }
    var xpEarned: Int { FootballGolfScoring.xp(total: totalScore) }

    // Golf scoring: par is the POINTS target; every guess is a shot.
    var par: Int { currentHole?.par ?? 0 }
    var points: Int { matched.reduce(0) { $0 + $1.rarity.points } }
    var shots: Int { matched.count + wrongGuesses }
    var shotsRemaining: Int { max(0, par + footballGolfShotCap - shots) }

    private var matchedIds: Set<String> { Set(matched.map(\.id)) }

    /// End the hole if par points are reached; the shot cap force-settles the rest.
    private func checkComplete() {
        if points >= par {
            completeHole(skipped: false, effectiveShots: shots)
        } else if shots >= par + footballGolfShotCap {
            settle()
        }
    }

    /// Stop the hole and "fill" the remaining points at +2 shots each (the skip penalty).
    private func settle() {
        let remaining = max(0, par - points)
        completeHole(skipped: true, effectiveShots: shots + 2 * remaining)
    }

    func submitGuess() {
        guard phase == .playing, let hole = currentHole else { return }
        let trimmed = guess.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        if let answer = FootballGolfMatcher.match(guess: trimmed, in: hole.answers, alreadyMatched: matchedIds) {
            matched.append(answer)
            lastRevealed = answer
            revealToken += 1
            guess = ""
            searchResults = []
            HapticManager.success()
        } else {
            wrongGuesses += 1
            wrongFlashToken += 1
            guess = ""
            searchResults = []
            HapticManager.error()
        }
        checkComplete()
    }

    func search() async {
        guard phase == .playing else { searchResults = []; return }
        let q = guess.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 2 else { searchResults = []; return }
        isSearching = true
        defer { isSearching = false }
        let results = (try? await APIClient.shared.searchPlayers(query: q)) ?? []
        let used = matchedIds
        searchResults = Array(results.filter { !used.contains($0.id) }.prefix(6))
    }

    /// Tapped an autocomplete suggestion — validate by id against the hole's answers.
    func pick(_ r: PlayerSearchResultDTO) {
        guard phase == .playing, let hole = currentHole else { return }
        searchResults = []
        guess = ""
        if let answer = hole.answers.first(where: { $0.id == r.id && !matchedIds.contains($0.id) }) {
            matched.append(answer)
            lastRevealed = answer
            revealToken += 1
            HapticManager.success()
        } else {
            wrongGuesses += 1
            wrongFlashToken += 1
            HapticManager.error()
        }
        checkComplete()
    }

    func skipHole() {
        guard phase == .playing else { return }
        settle()
    }

    private func completeHole(skipped: Bool, effectiveShots: Int) {
        guard let hole = currentHole else { return }
        let result = FootballGolfHoleResult(
            id: hole.id,
            holeNumber: hole.holeNumber,
            par: hole.par,
            matched: matched,
            shots: effectiveShots,
            skipped: skipped
        )
        results.append(result)
        phase = .holeResult
        if result.relativeToPar <= -1 { HapticManager.success() }
        else if result.relativeToPar == 0 { HapticManager.light() }
        else { HapticManager.error() }
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
        guess = ""
        searchResults = []
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

                if vm.phase == .playing {
                    HStack {
                        Spacer()
                        Button { withAnimation { vm.skipHole() } } label: {
                            Text("SKIP HOLE  ·  +2 PER MISSING")
                                .font(BKFont.caption(10)).tracking(0.5)
                                .foregroundStyle(BKTheme.wrong)
                                .padding(.horizontal, 12).padding(.vertical, 7)
                                .background(BKTheme.card).clipShape(Capsule())
                        }
                    }
                    .padding(.horizontal, 16).padding(.bottom, 4)
                }

                ScrollView(showsIndicators: false) {
                    if let hole = vm.currentHole, vm.phase != .finished {
                        VStack(spacing: 16) {
                            promptCard(vm, hole)
                            matchedChips(vm, hole)
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
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

    // MARK: consolidated prompt card (hole #, category, par, points, shots)

    private func promptCard(_ vm: FootballGolfViewModel, _ hole: FootballGolfHole) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("HOLE \(hole.holeNumber) / \(vm.course.holes.count)")
                        .font(BKFont.caption(11)).tracking(1).foregroundStyle(BKTheme.textMuted)
                    Text(hole.category.uppercased())
                        .font(BKFont.caption(10)).tracking(0.6).foregroundStyle(golfNeon)
                }
                Spacer()
                Text("PAR \(hole.par)").font(BKFont.title(22)).foregroundStyle(golfNeon)
            }

            Text(hole.prompt)
                .font(BKFont.headline(19))
                .foregroundStyle(BKTheme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)

            Text("\(vm.points) / \(hole.par) pts  ·  \(vm.shotsRemaining) shots left")
                .font(BKFont.caption(11)).foregroundStyle(BKTheme.textMuted)
        }
        .padding(18)
        .background(BKTheme.cardElevated)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(golfNeon.opacity(0.25), lineWidth: 1))
    }

    // MARK: matched answer chips + empty slots

    private func matchedChips(_ vm: FootballGolfViewModel, _ hole: FootballGolfHole) -> some View {
        VStack(spacing: 12) {
            // points progress toward par
            HStack(spacing: 4) {
                ForEach(0..<hole.par, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 3)
                        .fill(i < vm.points ? golfNeon : BKTheme.cardElevated)
                        .frame(height: 8)
                }
            }

            if vm.matched.isEmpty {
                Text("NAME PLAYERS TO SCORE POINTS — RARER = MORE")
                    .font(BKFont.caption(10)).tracking(0.5)
                    .foregroundStyle(BKTheme.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(Array(vm.matched.enumerated()), id: \.element.id) { idx, answer in
                    FootballGolfAnswerChip(answer: answer, justRevealed: idx == vm.matched.count - 1)
                        .id("\(answer.id)-\(vm.revealToken)")
                }
            }
        }
    }

    // MARK: input bar

    private func inputBar(_ vm: FootballGolfViewModel) -> some View {
        VStack(spacing: 10) {
            if !vm.searchResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(vm.searchResults) { r in
                        Button { withAnimation { vm.pick(r) }; inputFocused = true } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "magnifyingglass").font(.system(size: 11)).foregroundStyle(BKTheme.textMuted)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.name.uppercased())
                                        .font(.system(size: 13, weight: .bold, design: .rounded))
                                        .foregroundStyle(BKTheme.textPrimary).lineLimit(1)
                                    Text("\(r.club) · \(r.nationality)")
                                        .font(BKFont.caption(10)).foregroundStyle(BKTheme.textMuted).lineLimit(1)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 14).padding(.vertical, 11)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if r.id != vm.searchResults.last?.id { Divider().background(BKTheme.cardElevated) }
                    }
                }
                .background(BKTheme.cardElevated)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }

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
                    .onChange(of: vm.guess) { _, _ in Task { await vm.search() } }
                    .padding(.horizontal, 16).padding(.vertical, 14)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .modifier(ShakeEffect(animatableData: CGFloat(vm.wrongFlashToken)))

                if vm.isSearching {
                    ProgressView().tint(golfNeon)
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
            Text("\(answer.rarity.label) · +\(answer.rarity.points)")
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
                Text(result.label)
                    .font(BKFont.title(38)).foregroundStyle(outcomeColor)
                Text("\(FootballGolfScoring.scoreLabel(result.relativeToPar)) on Hole \(result.holeNumber) · \(result.shots) shots")
                    .font(BKFont.headline(15)).foregroundStyle(BKTheme.textPrimary)

                if result.skipped {
                    Text("Skipped — \(result.pointsReached)/\(result.par) pts (+2 per missing)")
                        .font(BKFont.caption(12)).foregroundStyle(BKTheme.textMuted)
                }
                if !result.matched.isEmpty {
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
        if result.relativeToPar < 0 { return golfNeon }
        if result.relativeToPar == 0 { return BKTheme.textPrimary }
        return BKTheme.wrong
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
                                Text(result.label).font(BKFont.caption(10))
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
