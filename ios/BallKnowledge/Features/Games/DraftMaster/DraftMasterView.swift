import SwiftUI
import SwiftData

// MARK: - ViewModel

@Observable
final class DraftMasterViewModel {
    var state: BattleGameState
    var searchQuery = ""
    var searchResults: [PlayerSearchResultDTO] = []
    var isSearching = false
    var activeSlot: BattleSlot?
    var selectionError: String?
    var showResult = false
    var showShare = false
    var confettiBurstToken = 0

    private let practice: Bool
    private let dailyDate: String?
    private let dailyBundle: DailyBundleDTO?

    init(practice: Bool, dailyDate: String?, dailyBundle: DailyBundleDTO?) {
        self.practice = practice
        self.dailyDate = dailyDate
        self.dailyBundle = dailyBundle
        state = BattleGameState(challenge: Self.resolveChallenge(practice: practice, dailyDate: dailyDate, dailyBundle: dailyBundle))
    }

    private static func resolveChallenge(practice: Bool, dailyDate: String?, dailyBundle: DailyBundleDTO?) -> BattleChallenge {
        if practice { return BattleSeed.makePracticeChallenge() }
        if let server = DailyChallengeResolver.battleChallenge(from: dailyBundle) { return server }
        return BattleSeed.makeDailyChallenge(date: dailyDate)
    }

    var scenario: BattleScenario { state.challenge.scenario }
    var formation: BattleFormation { state.challenge.formation }

    func start() {
        HapticManager.light()
        state.phase = .building
    }

    func newPractice() {
        state = BattleGameState(challenge: BattleSeed.makePracticeChallenge())
        resetTransient()
    }

    func restart() {
        state = BattleGameState(challenge: Self.resolveChallenge(practice: practice, dailyDate: dailyDate, dailyBundle: dailyBundle))
        state.phase = .building
        resetTransient()
    }

    private func resetTransient() {
        searchQuery = ""
        searchResults = []
        activeSlot = nil
        selectionError = nil
        showResult = false
        showShare = false
        confettiBurstToken = 0
    }

    // MARK: Slot fill

    func openSlot(_ slot: BattleSlot) {
        activeSlot = slot
        searchQuery = ""
        searchResults = []
        selectionError = nil
    }

    func closeSlot() {
        activeSlot = nil
        searchQuery = ""
        searchResults = []
    }

    func removePick(slotId: String) {
        state.picks.removeAll { $0.slotId == slotId }
        HapticManager.light()
    }

    /// Budget available for the active slot (remaining funds + whatever the slot currently holds).
    private func budgetForActiveSlot() -> Double {
        guard let slot = activeSlot else { return state.remainingEur }
        let existing = state.pick(forSlot: slot.id)?.priceEur ?? 0
        return state.remainingEur + existing
    }

    func price(for player: PlayerSearchResultDTO) -> Double {
        player.priceEur ?? 5_000_000
    }

    func canAfford(_ player: PlayerSearchResultDTO) -> Bool {
        price(for: player) <= budgetForActiveSlot() + 0.5
    }

    func search() async {
        guard let slot = activeSlot else { searchResults = []; return }
        let query = searchQuery.trimmingCharacters(in: .whitespaces)
        guard query.count >= 2 else { searchResults = []; return }

        isSearching = true
        defer { isSearching = false }
        do {
            let results = try await APIClient.shared.searchPlayers(query: query)
            let used = state.usedPlayerIds
            searchResults = results
                .filter { BattleBucket.from(position: $0.position) == slot.bucket && !used.contains($0.id) }
                .sorted { canAfford($0) && !canAfford($1) }
                .prefix(PlayerSearchLimits.maxResults)
                .map { $0 }
        } catch {
            searchResults = []
        }
    }

    func selectPlayer(_ player: PlayerSearchResultDTO) {
        guard let slot = activeSlot else { return }
        if state.usedPlayerIds.contains(player.id), state.pick(forSlot: slot.id)?.player.id != player.id {
            selectionError = "Already in your XI"
            HapticManager.error()
            return
        }
        let cost = price(for: player)
        if cost > budgetForActiveSlot() + 0.5 {
            selectionError = "Over budget — free up funds first"
            HapticManager.error()
            return
        }
        state.picks.removeAll { $0.slotId == slot.id }
        state.picks.append(BattlePick(slotId: slot.id, player: player, priceEur: cost, bucket: slot.bucket))
        selectionError = nil
        HapticManager.success()
        closeSlot()
    }

    // MARK: Kick off

    func kickOff() {
        guard state.isComplete else { return }
        let result = BattleScoring.simulate(picks: state.picks, scenario: scenario, seed: state.challenge.id)
        state.result = result
        state.phase = .complete
        if result.outcome == .win, BattleTiming.confettiOnWin { confettiBurstToken += 1 }
        Task {
            try? await Task.sleep(for: .seconds(BattleTiming.resultReveal))
            showResult = true
        }
    }
}

// MARK: - Main View

struct DraftMasterView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: DraftMasterViewModel
    private let allowReplay: Bool
    private let dailyDate: String?
    var onComplete: () -> Void

    init(dailyDate: String? = nil, dailyBundle: DailyBundleDTO? = nil, practice: Bool = false, allowReplay: Bool = true, onComplete: @escaping () -> Void) {
        _viewModel = State(initialValue: DraftMasterViewModel(practice: practice, dailyDate: dailyDate, dailyBundle: dailyBundle))
        self.allowReplay = allowReplay
        self.dailyDate = dailyDate
        self.onComplete = onComplete
    }

    var body: some View {
        ZStack {
            NavigationStack {
                Group {
                    if viewModel.state.phase == .intro {
                        BattleIntroView(
                            scenario: viewModel.scenario,
                            formation: viewModel.formation,
                            onStart: viewModel.start
                        )
                    } else {
                        buildScreen
                    }
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
                        Text("BATTLE MODE")
                            .font(BKFont.caption(13))
                            .tracking(1)
                            .foregroundStyle(BKTheme.accent)
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        if allowReplay, viewModel.state.phase == .intro {
                            Button { viewModel.newPractice() } label: {
                                Text("NEW").font(BKFont.caption(10)).foregroundStyle(BKTheme.textMuted)
                            }
                        }
                    }
                }
            }

            FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                .zIndex(999)
        }
        .animation(.spring(response: 0.38, dampingFraction: 0.82), value: viewModel.state.phase)
        .sheet(item: Binding(get: { viewModel.activeSlot }, set: { if $0 == nil { viewModel.closeSlot() } })) { slot in
            BattleSearchSheet(viewModel: viewModel, slot: slot)
        }
        .fullScreenCover(isPresented: $viewModel.showResult) {
            if let result = viewModel.state.result {
                BattleResultView(
                    challenge: viewModel.state.challenge,
                    result: result,
                    showPlayAgain: allowReplay,
                    onShare: { viewModel.showShare = true },
                    onPlayAgain: { viewModel.showResult = false; viewModel.restart() },
                    onHome: {
                        if !allowReplay, let dailyDate {
                            Task {
                                await DailyCompletionService.recordCompletion(
                                    modeId: GameModeID.draftMaster.rawValue,
                                    date: dailyDate,
                                    score: result.score,
                                    won: result.outcome == .win,
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
        .sheet(isPresented: $viewModel.showShare) {
            if let result = viewModel.state.result {
                BattleShareSheet(challenge: viewModel.state.challenge, result: result)
            }
        }
    }

    private var buildScreen: some View {
        VStack(spacing: 0) {
            BattleBudgetHeader(scenario: viewModel.scenario, spent: viewModel.state.spentEur, picks: viewModel.state.picks.count, slots: viewModel.formation.slots.count)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 14) {
                    BattleScenarioBanner(scenario: viewModel.scenario, formation: viewModel.formation)
                    BattlePitchView(
                        formation: viewModel.formation,
                        picks: viewModel.state.picks,
                        onTapSlot: { viewModel.openSlot($0) }
                    )
                    .frame(height: 380)
                }
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .padding(.bottom, 16)
            }

            BattleKickoffBar(
                ready: viewModel.state.isComplete,
                filled: viewModel.state.picks.count,
                total: viewModel.formation.slots.count,
                onKickOff: viewModel.kickOff
            )
        }
    }
}

// MARK: - Intro

private struct BattleIntroView: View {
    let scenario: BattleScenario
    let formation: BattleFormation
    var onStart: () -> Void

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                VStack(spacing: 8) {
                    Text(scenario.competition.uppercased())
                        .font(BKFont.caption(11)).tracking(1.2).foregroundStyle(BKTheme.accent)
                    Text(scenario.title)
                        .font(BKFont.title(24)).foregroundStyle(BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                    Text(scenario.subtitle.uppercased())
                        .font(BKFont.headline(15)).foregroundStyle(BKTheme.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 16)

                Text(scenario.narrative)
                    .font(BKFont.body(14)).foregroundStyle(BKTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 8)

                VStack(spacing: 12) {
                    introRow(label: "YOUR BUDGET", value: BattleFormat.money(scenario.budgetEur), accent: true)
                    introRow(label: "OPPONENT", value: scenario.opponentName.uppercased(), accent: false)
                    introRow(label: "FORMATION", value: formation.name, accent: false)
                }
                .padding(16)
                .background(BKTheme.cardElevated.opacity(0.9))
                .clipShape(RoundedRectangle(cornerRadius: 16))

                Text("Tap each position to sign a player. Stay under budget — sell and re-sign to free funds. When your XI is set, kick off and the match plays out.")
                    .font(BKFont.body(13)).foregroundStyle(BKTheme.textMuted)
                    .multilineTextAlignment(.center).padding(.horizontal, 8)

                Button(action: onStart) {
                    HStack(spacing: 8) {
                        Text("ENTER THE MARKET").font(BKFont.headline(15))
                        Ph.arrowRight.bold.color(BKTheme.background).frame(width: 14, height: 14)
                    }
                    .foregroundStyle(BKTheme.background)
                    .frame(maxWidth: .infinity).padding(.vertical, 16)
                    .background(BKTheme.accent).clipShape(Capsule())
                }
                .padding(.top, 4)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
    }

    private func introRow(label: String, value: String, accent: Bool) -> some View {
        VStack(spacing: 4) {
            Text(label).font(BKFont.caption(10)).tracking(0.6).foregroundStyle(BKTheme.textMuted)
            Text(value)
                .font(accent ? BKFont.headline(20) : BKFont.headline(15))
                .foregroundStyle(accent ? BKTheme.accent : BKTheme.textPrimary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Budget header

private struct BattleBudgetHeader: View {
    let scenario: BattleScenario
    let spent: Double
    let picks: Int
    let slots: Int

    private var remaining: Double { scenario.budgetEur - spent }
    private var fraction: Double { scenario.budgetEur > 0 ? min(1, spent / scenario.budgetEur) : 0 }

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("REMAINING").font(BKFont.caption(9)).foregroundStyle(BKTheme.textMuted)
                    Text(BattleFormat.money(max(0, remaining)))
                        .font(BKFont.headline(20))
                        .foregroundStyle(remaining < scenario.budgetEur * 0.08 ? Color.orange : BKTheme.accent)
                        .contentTransition(.numericText())
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("SQUAD").font(BKFont.caption(9)).foregroundStyle(BKTheme.textMuted)
                    Text("\(picks)/\(slots)").font(BKFont.headline(16)).foregroundStyle(BKTheme.textPrimary)
                }
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(BKTheme.card)
                    Capsule().fill(BKTheme.accent.opacity(0.85))
                        .frame(width: geo.size.width * fraction)
                }
            }
            .frame(height: 6)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(BKTheme.background)
    }
}

private struct BattleScenarioBanner: View {
    let scenario: BattleScenario
    let formation: BattleFormation

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(scenario.subtitle.uppercased())
                    .font(BKFont.headline(14)).foregroundStyle(BKTheme.textPrimary).lineLimit(1)
                Text("\(scenario.competition) · vs \(scenario.opponentName)")
                    .font(BKFont.caption(10)).foregroundStyle(BKTheme.textMuted).lineLimit(1)
            }
            Spacer()
            Text(formation.name)
                .font(BKFont.headline(13)).foregroundStyle(BKTheme.accent)
        }
        .padding(14)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - Pitch

private struct BattlePitchView: View {
    let formation: BattleFormation
    let picks: [BattlePick]
    var onTapSlot: (BattleSlot) -> Void

    var body: some View {
        GeometryReader { geo in
            ZStack {
                PitchBackground()
                ForEach(formation.slots) { slot in
                    let pick = picks.first { $0.slotId == slot.id }
                    BattlePitchSlot(slot: slot, pick: pick)
                        .position(
                            x: slot.point.x * geo.size.width,
                            y: slot.point.y * geo.size.height
                        )
                        .onTapGesture { onTapSlot(slot) }
                }
            }
        }
    }
}

private struct BattlePitchSlot: View {
    let slot: BattleSlot
    let pick: BattlePick?

    var body: some View {
        VStack(spacing: 3) {
            ZStack {
                Circle()
                    .fill(pick == nil ? BKTheme.card : BKTheme.accent.opacity(0.18))
                    .frame(width: 42, height: 42)
                    .overlay(
                        Circle().stroke(pick == nil ? BKTheme.textMuted.opacity(0.4) : BKTheme.accent, lineWidth: 1.5)
                    )
                if let pick {
                    PlayerAvatar(urlString: pick.player.headshotUrl, size: 38) {
                        PlayerTeamBadge(player: pick.player, size: 30) { fallbackBadge(pick) }
                    }
                } else {
                    Text("+")
                        .font(.system(size: 18, weight: .bold, design: .rounded))
                        .foregroundStyle(BKTheme.textMuted)
                }
            }
            Text(slot.label)
                .font(.system(size: 8, weight: .bold, design: .rounded))
                .foregroundStyle(pick == nil ? BKTheme.textMuted : BKTheme.accent)
            if let pick {
                Text(shortName(pick.player.name))
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundStyle(BKTheme.textPrimary)
                    .lineLimit(1).frame(maxWidth: 64)
                Text(BattleFormat.money(pick.priceEur))
                    .font(.system(size: 8, weight: .semibold, design: .rounded))
                    .foregroundStyle(BKTheme.textMuted)
            }
        }
        .frame(width: 70)
    }

    private func fallbackBadge(_ pick: BattlePick) -> some View {
        Circle().fill(BKTheme.cardElevated).frame(width: 30, height: 30)
            .overlay(
                Text(GuessWhoDisplay.clubAbbrev(pick.player.club))
                    .font(.system(size: 8, weight: .bold, design: .rounded))
                    .foregroundStyle(BKTheme.textMuted)
            )
    }

    private func shortName(_ name: String) -> String {
        name.split(separator: " ").last.map(String.init) ?? name
    }
}

private struct PitchBackground: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18)
                .fill(LinearGradient(colors: [BKTheme.card, BKTheme.cardElevated], startPoint: .top, endPoint: .bottom))
            GeometryReader { geo in
                let w = geo.size.width, h = geo.size.height
                Path { p in
                    p.move(to: CGPoint(x: 0, y: h * 0.5)); p.addLine(to: CGPoint(x: w, y: h * 0.5))
                }.stroke(BKTheme.textMuted.opacity(0.18), lineWidth: 1)
                Circle()
                    .stroke(BKTheme.textMuted.opacity(0.18), lineWidth: 1)
                    .frame(width: w * 0.26, height: w * 0.26)
                    .position(x: w * 0.5, y: h * 0.5)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(BKTheme.textMuted.opacity(0.12), lineWidth: 1))
    }
}

// MARK: - Kick off bar

private struct BattleKickoffBar: View {
    let ready: Bool
    let filled: Int
    let total: Int
    var onKickOff: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onKickOff) {
                HStack(spacing: 8) {
                    Text(ready ? "KICK OFF" : "FILL YOUR XI (\(filled)/\(total))")
                        .font(BKFont.headline(15))
                    if ready { Ph.arrowRight.bold.color(BKTheme.background).frame(width: 14, height: 14) }
                }
                .foregroundStyle(ready ? BKTheme.background : BKTheme.textMuted)
                .frame(maxWidth: .infinity).padding(.vertical, 16)
                .background(ready ? BKTheme.accent : BKTheme.card)
                .clipShape(Capsule())
            }
            .disabled(!ready)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(BKTheme.background)
    }
}

// MARK: - Search sheet

private struct BattleSearchSheet: View {
    @Bindable var viewModel: DraftMasterViewModel
    let slot: BattleSlot
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("SIGN A \(bucketLabel)")
                            .font(BKFont.caption(10)).foregroundStyle(BKTheme.textMuted)
                        Text("\(slot.label) · up to \(BattleFormat.money(budgetForSlot))")
                            .font(BKFont.headline(15)).foregroundStyle(BKTheme.accent)
                    }
                    Spacer()
                    if let pick = viewModel.state.pick(forSlot: slot.id) {
                        Button {
                            viewModel.removePick(slotId: slot.id)
                            dismiss()
                        } label: {
                            Text("REMOVE \(pick.player.name.split(separator: " ").last.map(String.init)?.uppercased() ?? "")")
                                .font(BKFont.caption(10)).foregroundStyle(BKTheme.wrong)
                        }
                    }
                }
                .padding(.horizontal, 16)

                HStack(spacing: 12) {
                    TextField("", text: $viewModel.searchQuery, prompt:
                        Text("SEARCH PLAYERS").foregroundStyle(BKTheme.textMuted)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                    )
                    .textFieldStyle(.plain)
                    .foregroundStyle(BKTheme.background)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .focused($focused)
                    .submitLabel(.search)
                    .onChange(of: viewModel.searchQuery) { _, _ in
                        viewModel.selectionError = nil
                        Task { await viewModel.search() }
                    }
                    if viewModel.isSearching { ProgressView().tint(BKTheme.accent) }
                }
                .padding(.horizontal, 16).padding(.vertical, 14)
                .background(Color.white).clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(BKTheme.accent.opacity(0.35), lineWidth: 1.5))
                .padding(.horizontal, 16)

                if let error = viewModel.selectionError {
                    Text(error.uppercased()).font(BKFont.caption(10)).foregroundStyle(BKTheme.wrong)
                }

                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(viewModel.searchResults) { player in
                            resultRow(player)
                            if player.id != viewModel.searchResults.last?.id {
                                Divider().background(BKTheme.cardElevated)
                            }
                        }
                    }
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 16)
                }
                Spacer(minLength: 0)
            }
            .padding(.top, 14)
            .background(BKTheme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(BKTheme.accent)
                }
            }
        }
        .presentationDetents([.large])
        .onAppear { focused = true }
    }

    private var bucketLabel: String {
        switch slot.bucket {
        case .gk: return "GOALKEEPER"
        case .def: return "DEFENDER"
        case .mid: return "MIDFIELDER"
        case .att: return "ATTACKER"
        }
    }

    private var budgetForSlot: Double {
        let existing = viewModel.state.pick(forSlot: slot.id)?.priceEur ?? 0
        return viewModel.state.remainingEur + existing
    }

    private func resultRow(_ player: PlayerSearchResultDTO) -> some View {
        let affordable = viewModel.canAfford(player)
        return Button {
            focused = false
            viewModel.selectPlayer(player)
        } label: {
            HStack(spacing: 12) {
                PlayerAvatar(urlString: player.headshotUrl, size: 32) {
                    PlayerTeamBadge(player: player, size: 28) {
                        Circle().fill(BKTheme.cardElevated).frame(width: 28, height: 28)
                            .overlay(
                                Text(GuessWhoDisplay.clubAbbrev(player.club))
                                    .font(.system(size: 8, weight: .bold, design: .rounded))
                                    .foregroundStyle(BKTheme.textMuted)
                            )
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(player.name.uppercased())
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(affordable ? BKTheme.textPrimary : BKTheme.textMuted)
                    Text("\(player.nationality) · \(player.club)")
                        .font(BKFont.caption(11)).foregroundStyle(BKTheme.textMuted).lineLimit(1)
                }
                Spacer(minLength: 0)
                Text(BattleFormat.money(viewModel.price(for: player)))
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(affordable ? BKTheme.accent : BKTheme.wrong)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .opacity(affordable ? 1 : 0.6)
        }
    }
}

// MARK: - Result

private struct BattleResultView: View {
    let challenge: BattleChallenge
    let result: BattleResult
    var showPlayAgain = true
    var onShare: () -> Void
    var onPlayAgain: () -> Void
    var onHome: () -> Void

    @State private var revealStep = 0

    private var verdictColor: Color {
        switch result.outcome {
        case .win: return BKTheme.accent
        case .draw: return .orange
        case .loss: return BKTheme.wrong
        }
    }

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()
            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    VStack(spacing: 6) {
                        Text(challenge.scenario.subtitle.uppercased())
                            .font(BKFont.caption(11)).tracking(1).foregroundStyle(BKTheme.textMuted)
                        Text(result.outcome.verdict)
                            .font(BKFont.title(34)).foregroundStyle(verdictColor)
                    }
                    .padding(.top, 24)

                    if revealStep >= 1 {
                        HStack(spacing: 18) {
                            scoreSide(name: "YOU", goals: result.yourGoals, highlight: result.outcome == .win)
                            Text("–").font(BKFont.title(30)).foregroundStyle(BKTheme.textMuted)
                            scoreSide(name: challenge.scenario.opponentName, goals: result.theirGoals, highlight: result.outcome == .loss)
                        }
                        .transition(.scale.combined(with: .opacity))
                    }

                    if revealStep >= 2, !result.events.isEmpty {
                        VStack(spacing: 6) {
                            ForEach(result.events) { e in
                                HStack {
                                    if e.forYou {
                                        Text("\(e.scorer) \(e.minuteLabel)")
                                            .font(BKFont.body(12)).foregroundStyle(BKTheme.textPrimary)
                                        Spacer()
                                    } else {
                                        Spacer()
                                        Text("\(e.minuteLabel) \(e.scorer)")
                                            .font(BKFont.body(12)).foregroundStyle(BKTheme.textSecondary)
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 24)
                        .transition(.opacity)
                    }

                    if revealStep >= 3 {
                        powerBars
                        scoreBreakdown
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }

                    VStack(spacing: 10) {
                        Button(action: onShare) {
                            Text("SHARE RESULT").font(BKFont.headline(14))
                                .foregroundStyle(BKTheme.background)
                                .frame(maxWidth: .infinity).padding(.vertical, 14)
                                .background(BKTheme.accent).clipShape(Capsule())
                        }
                        if showPlayAgain {
                            Button(action: onPlayAgain) {
                                Text("PLAY AGAIN").font(BKFont.headline(14)).foregroundStyle(BKTheme.textMuted)
                            }.padding(.top, 2)
                        }
                        Button(action: onHome) {
                            Text(showPlayAgain ? "BACK TO GAMES" : "DONE")
                                .font(BKFont.caption(11)).foregroundStyle(BKTheme.textMuted)
                        }
                    }
                    .padding(.top, 8)
                }
                .padding(.horizontal, 16).padding(.bottom, 32)
            }
        }
        .task {
            for step in 1...3 {
                try? await Task.sleep(for: .seconds(0.45))
                withAnimation(.spring(response: 0.42, dampingFraction: 0.78)) { revealStep = step }
                HapticManager.light()
            }
        }
    }

    private func scoreSide(name: String, goals: Int, highlight: Bool) -> some View {
        VStack(spacing: 4) {
            Text("\(goals)")
                .font(BKFont.title(48))
                .foregroundStyle(highlight ? BKTheme.accent : BKTheme.textPrimary)
            Text(name.uppercased())
                .font(BKFont.caption(10)).foregroundStyle(BKTheme.textMuted)
                .lineLimit(1).frame(maxWidth: 100)
        }
    }

    private var powerBars: some View {
        VStack(spacing: 10) {
            powerBar(label: "YOUR SQUAD", value: result.your.power, max: maxPower, color: BKTheme.accent)
            powerBar(label: challenge.scenario.opponentName.uppercased(), value: result.opp.power, max: maxPower, color: BKTheme.textSecondary)
        }
        .padding(14)
        .background(BKTheme.card).clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var maxPower: Double { max(result.your.power, result.opp.power, 1) }

    private func powerBar(label: String, value: Double, max: Double, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(BKFont.caption(9)).foregroundStyle(BKTheme.textMuted).lineLimit(1)
                Spacer()
                Text("\(Int(value.rounded()))").font(BKFont.caption(10)).foregroundStyle(BKTheme.textPrimary)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(BKTheme.cardElevated)
                    Capsule().fill(color).frame(width: geo.size.width * (value / max))
                }
            }
            .frame(height: 6)
        }
    }

    private var scoreBreakdown: some View {
        VStack(spacing: 10) {
            HStack {
                Text("SCORE").font(BKFont.caption(10)).foregroundStyle(BKTheme.textMuted)
                Spacer()
                Text("\(result.score)").font(BKFont.title(28)).foregroundStyle(BKTheme.accent)
            }
            breakdownRow("Squad power", result.powerPoints)
            breakdownRow(result.outcome.verdict.capitalized, result.outcomePoints)
            breakdownRow("Value for money", result.efficiencyPoints)
            Divider().background(BKTheme.cardElevated)
            HStack {
                Text("Spent \(BattleFormat.money(result.spentEur)) of \(BattleFormat.money(result.budgetEur))")
                    .font(BKFont.caption(10)).foregroundStyle(BKTheme.textMuted)
                Spacer()
                Text("\(BattleFormat.money(result.budgetLeftEur)) left")
                    .font(BKFont.caption(10)).foregroundStyle(BKTheme.textSecondary)
            }
        }
        .padding(14)
        .background(BKTheme.card).clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func breakdownRow(_ label: String, _ value: Int) -> some View {
        HStack {
            Text(label).font(BKFont.body(13)).foregroundStyle(BKTheme.textSecondary)
            Spacer()
            Text("+\(value)").font(BKFont.headline(13)).foregroundStyle(BKTheme.textPrimary)
        }
    }
}

// MARK: - Share

private struct BattleShareSheet: View {
    let challenge: BattleChallenge
    let result: BattleResult
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                VStack(spacing: 12) {
                    Text(challenge.scenario.subtitle.uppercased())
                        .font(BKFont.headline(15)).foregroundStyle(BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                    Text("\(result.outcome.verdict)  \(result.yourGoals)–\(result.theirGoals)")
                        .font(BKFont.title(28)).foregroundStyle(BKTheme.accent)
                    Text("Score \(result.score) · Spent \(BattleFormat.money(result.spentEur))")
                        .font(BKFont.caption(11)).foregroundStyle(BKTheme.textMuted)
                }
                .padding(20)
                .frame(maxWidth: .infinity)
                .background(LinearGradient(colors: [BKTheme.cardElevated, BKTheme.card], startPoint: .topLeading, endPoint: .bottomTrailing))
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .padding(.horizontal, 16)

                ShareLink(item: BattleSeed.shareText(challenge: challenge, result: result)) {
                    Text("SHARE").font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.background)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(BKTheme.accent).clipShape(Capsule())
                }
                .padding(.horizontal, 16)
                Spacer()
            }
            .padding(.top, 16)
            .background(BKTheme.background)
            .navigationTitle("Share Result")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(BKTheme.accent)
                }
            }
        }
        .presentationDetents([.medium])
    }
}
