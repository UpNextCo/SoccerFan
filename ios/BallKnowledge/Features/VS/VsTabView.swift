import SwiftUI

@MainActor
@Observable
final class VsViewModel {
    var challenge: VsChallengeDTO?
    var selectedMode: GameModeID = .backYourself
    var joinCode = ""
    var isLoading = false
    var isBusy = false
    var errorMessage: String?
    var playing = false

    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            challenge = try await APIClient.shared.vsActive()
            VsMonitor.shared.track(challenge)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func create() async {
        isBusy = true
        defer { isBusy = false }
        do {
            challenge = try await APIClient.shared.vsCreate(modeId: selectedMode.rawValue)
            VsMonitor.shared.track(challenge)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func join() async {
        let code = joinCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else {
            errorMessage = "Enter a challenge code"
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            challenge = try await APIClient.shared.vsJoin(code: code)
            VsMonitor.shared.track(challenge)
            joinCode = ""
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func reshuffleCategory() async {
        guard let id = challenge?.id else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            challenge = try await APIClient.shared.vsReshuffle(id: id)
            VsMonitor.shared.track(challenge)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func start() async {
        guard let id = challenge?.id else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            challenge = try await APIClient.shared.vsStart(id: id)
            VsMonitor.shared.track(challenge)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func poll() async {
        guard let id = challenge?.id else { return }
        do {
            applyPolled(try await APIClient.shared.vsGet(id: id))
        } catch {
            if case APIError.server(let message) = error,
               message.localizedCaseInsensitiveContains("expired") {
                playing = false
                clearChallenge()
            }
        }
    }

    func submit(answer: JSONValue) async -> VsChallengeDTO? {
        guard let id = challenge?.id else { return nil }
        do {
            let updated = try await APIClient.shared.vsSubmit(id: id, answer: answer)
            challenge = updated
            VsMonitor.shared.track(challenge)
            errorMessage = nil
            return updated
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func submitDraft(state: BattleGameState) async -> (lineup: [BattleOptimalSlotDTO], optimalScore: Int?)? {
        let updated = await submit(answer: state.answerPayload())
        return (updated?.optimalLineup ?? [], updated?.optimalScore)
    }

    func lockPick(slotId: String, constraintId: String, playerId: String) async -> Bool {
        guard let id = challenge?.id else { return false }
        isBusy = true
        defer { isBusy = false }
        do {
            challenge = try await APIClient.shared.vsLock(id: id, slotId: slotId, constraintId: constraintId, playerId: playerId)
            VsMonitor.shared.track(challenge)
            errorMessage = nil
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func throwDarts501(playerId: String) async -> Bool {
        guard let id = challenge?.id else { return false }
        isBusy = true
        defer { isBusy = false }
        do {
            challenge = try await APIClient.shared.vsDartsThrow(id: id, playerId: playerId)
            VsMonitor.shared.track(challenge)
            errorMessage = nil
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func pickTargetMan(playerId: String) async -> Bool {
        guard let id = challenge?.id else { return false }
        isBusy = true
        defer { isBusy = false }
        do {
            challenge = try await APIClient.shared.vsTargetPick(id: id, playerId: playerId)
            VsMonitor.shared.track(challenge)
            errorMessage = nil
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func namePlayer(playerId: String) async -> Bool {
        guard let id = challenge?.id else { return false }
        isBusy = true
        defer { isBusy = false }
        do {
            challenge = try await APIClient.shared.vsName(id: id, playerId: playerId)
            VsMonitor.shared.track(challenge)
            errorMessage = nil
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func giveUpHotseat() async -> Bool {
        guard let id = challenge?.id else { return false }
        isBusy = true
        defer { isBusy = false }
        do {
            challenge = try await APIClient.shared.vsGiveUp(id: id)
            VsMonitor.shared.track(challenge)
            errorMessage = nil
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func abandonChallenge() async {
        guard let challenge else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            if challenge.youAreHost {
                _ = try await APIClient.shared.vsCancel(id: challenge.id)
            } else {
                _ = try await APIClient.shared.vsLeave(id: challenge.id)
            }
            playing = false
            clearChallenge()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func applyPolled(_ updated: VsChallengeDTO) {
        if updated.status == "expired" {
            playing = false
            clearChallenge()
            return
        }
        challenge = updated
        VsMonitor.shared.track(challenge)
    }

    func clearChallenge() {
        challenge = nil
        playing = false
        errorMessage = nil
        VsMonitor.shared.track(nil)
    }

    var youHavePlayed: Bool {
        challenge?.players.first(where: \.isYou)?.completed ?? false
    }

    var canPlay: Bool {
        guard let challenge else { return false }
        return challenge.status == "active" && !youHavePlayed
    }

    var battleChallenge: BattleChallenge? {
        guard challenge?.modeId == GameModeID.draftMaster.rawValue,
              let dto = challenge?.puzzle.decode(DraftMasterPuzzleDTO.self) else { return nil }
        return DailyChallengeResolver.battleChallenge(from: dto)
    }

    var backYourselfPuzzle: BackYourselfPuzzle? {
        guard challenge?.modeId == GameModeID.backYourself.rawValue,
              let dto = challenge?.puzzle.decode(BackYourselfPuzzleDTO.self) else { return nil }
        return DailyChallengeResolver.backYourselfPuzzle(from: dto)
    }

    var targetManChallenge: TargetManChallenge? {
        guard let challenge, challenge.modeId == GameModeID.targetMan.rawValue,
              let dto = challenge.puzzle.decode(TargetManPuzzleDTO.self) else { return nil }
        return DailyChallengeResolver.targetManChallenge(from: dto, date: dto.date)
    }

    var darts501Puzzle: Darts501Puzzle? {
        guard challenge?.modeId == GameModeID.darts501.rawValue,
              let dto = challenge?.puzzle.decode(Darts501PuzzleDTO.self) else { return nil }
        return DailyChallengeResolver.darts501Puzzle(from: dto)
    }
}

struct VsTabView: View {
    @State private var viewModel = VsViewModel()
    @FocusState private var joinCodeFocused: Bool
    @Environment(\.keyboardHeight) private var keyboardHeight

    var body: some View {
        NavigationStack {
            ZStack {
                BKTheme.background.ignoresSafeArea()

                Group {
                    if viewModel.isLoading && viewModel.challenge == nil {
                        ProgressView().tint(BKTheme.accent)
                    } else if let challenge = viewModel.challenge {
                        challengeContent(challenge)
                    } else {
                        lobbyContent
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 6) {
                        Ph.users.weight(.fill)
                            .color(BKTheme.accent)
                            .frame(width: 14, height: 14)
                        Text(viewModel.challenge.map { "\($0.modeTitle) VS" } ?? "VS")
                            .font(BKFont.caption(13)).tracking(1.2)
                            .foregroundStyle(BKTheme.accent)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    VsChallengeOverflowMenu(viewModel: viewModel)
                }
            }
        }
        .task { await viewModel.refresh() }
        .task(id: viewModel.challenge?.id) {
            guard viewModel.challenge != nil else { return }
            while !Task.isCancelled {
                let live = viewModel.challenge?.isLivePlay == true
                try? await Task.sleep(for: .seconds(live ? 1 : 3))
                guard !Task.isCancelled else { break }
                if let c = viewModel.challenge,
                   c.status == "waiting" || c.status == "active",
                   !c.result.allDone {
                    await viewModel.poll()
                    if viewModel.challenge?.isLivePlay == true {
                        viewModel.playing = true
                    }
                    if viewModel.challenge?.result.allDone == true,
                       viewModel.challenge?.modeId != GameModeID.darts501.rawValue {
                        viewModel.playing = false
                    }
                } else {
                    break
                }
            }
        }
        .onChange(of: viewModel.challenge?.status) {
            if viewModel.challenge?.status == "expired" {
                viewModel.playing = false
                viewModel.clearChallenge()
            } else if viewModel.challenge?.isLivePlay == true {
                viewModel.playing = true
            }
        }
        .fullScreenCover(isPresented: $viewModel.playing) {
            playCover
        }
    }

    @ViewBuilder
    private var playCover: some View {
        switch viewModel.challenge?.modeId {
        case GameModeID.draftMaster.rawValue:
            if let battle = viewModel.battleChallenge {
                VsDraftLiveView(viewModel: viewModel, battle: battle)
            }
        case GameModeID.backYourself.rawValue:
            if let puzzle = viewModel.backYourselfPuzzle {
                VsHotseatView(viewModel: viewModel, puzzle: puzzle)
            }
        case GameModeID.targetMan.rawValue:
            if viewModel.challenge?.targetMan != nil {
                VsTargetManLiveView(viewModel: viewModel)
            } else if let challenge = viewModel.targetManChallenge {
                TargetManView(
                    challenge: challenge,
                    allowReplay: true,
                    showsXp: false,
                    onSubmit: { state in
                        _ = await viewModel.submit(answer: state.answerPayload())
                    },
                    onComplete: { viewModel.playing = false }
                )
            }
        case GameModeID.darts501.rawValue:
            if viewModel.challenge?.darts501 != nil {
                VsDarts501LiveView(viewModel: viewModel)
            } else if let puzzle = viewModel.darts501Puzzle {
                Darts501View(
                    dailyDate: nil,
                    puzzle: puzzle,
                    allowReplay: true,
                    showsXp: false,
                    onSubmit: { state in
                        _ = await viewModel.submit(answer: state.answerPayload())
                    },
                    onComplete: { viewModel.playing = false }
                )
            }
        default:
            Color.clear
        }
    }

    private var lobbyContent: some View {
        ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                VStack(spacing: 8) {
                    Text("Challenge your mates")
                        .font(BKFont.title(28))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text("Pick a game and invite up to 3 friends.")
                        .font(BKFont.body(14))
                        .foregroundStyle(BKTheme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 12)
                }
                .padding(.top, 8)
                .padding(.bottom, 16)

                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(DailyPlayOrder.vsModes) { mode in
                        Button {
                            viewModel.selectedMode = mode
                        } label: {
                            VsModeCard(mode: mode, selected: viewModel.selectedMode == mode)
                        }
                        .buttonStyle(.plain)
                    }
                }

                Button {
                    Task { await viewModel.create() }
                } label: {
                    HStack {
                        if viewModel.isBusy {
                            ProgressView().tint(BKTheme.background)
                        }
                        Text("CREATE CHALLENGE")
                            .font(BKFont.headline(14))
                    }
                    .foregroundStyle(BKTheme.background)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(BKTheme.accent)
                    .clipShape(Capsule())
                }
                .disabled(viewModel.isBusy)
                .buttonStyle(.plain)

                VStack(spacing: 12) {
                    Text("HAVE A CODE?")
                        .font(BKFont.caption(11))
                        .tracking(1)
                        .foregroundStyle(BKTheme.textMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    TextField("Enter code", text: $viewModel.joinCode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(BKFont.headline(18))
                        .foregroundStyle(BKTheme.textPrimary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(BKTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .focused($joinCodeFocused)
                        .submitLabel(.join)
                        .onSubmit {
                            Task { await viewModel.join() }
                        }

                    Button {
                        Task { await viewModel.join() }
                    } label: {
                        Text("JOIN CHALLENGE")
                            .font(BKFont.headline(14))
                            .foregroundStyle(BKTheme.textPrimary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(BKTheme.card)
                            .clipShape(Capsule())
                    }
                    .disabled(viewModel.isBusy)
                    .buttonStyle(.plain)
                }
                .padding(.top, 16)
                .id("vsJoinCode")

                if let error = viewModel.errorMessage {
                    Text(error)
                        .font(BKFont.body(13))
                        .foregroundStyle(BKTheme.wrong)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, keyboardHeight > 8 ? 16 : BKTabBar.scrollClearance)
        }
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: joinCodeFocused) { _, focused in
            guard focused else { return }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(80))
                withAnimation(.easeOut(duration: 0.25)) {
                    proxy.scrollTo("vsJoinCode", anchor: .bottom)
                }
            }
        }
        .onChange(of: keyboardHeight) { _, height in
            guard joinCodeFocused, height > 8 else { return }
            withAnimation(.easeOut(duration: 0.25)) {
                proxy.scrollTo("vsJoinCode", anchor: .bottom)
            }
        }
        }
    }

    @ViewBuilder
    private func challengeContent(_ challenge: VsChallengeDTO) -> some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 16) {
                VStack(spacing: 8) {
                    Text(challenge.title)
                        .font(BKFont.title(22))
                        .foregroundStyle(BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                        .lineLimit(4)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 300)
                    if challenge.youAreHost && challenge.status == "waiting" {
                        Button {
                            Task { await viewModel.reshuffleCategory() }
                        } label: {
                            if viewModel.isBusy {
                                ProgressView().tint(BKTheme.accent)
                            } else {
                                Image(systemName: "arrow.clockwise")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundStyle(BKTheme.accent)
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(viewModel.isBusy)
                        .accessibilityLabel("Change category")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 28)
                .padding(.top, 4)
                .padding(.bottom, 8)
                .animation(.easeOut(duration: 0.2), value: challenge.title)

                codeCard(challenge.code)

                playersCard(challenge)

                if challenge.result.allDone {
                    winnerCard(challenge)
                } else if viewModel.challenge?.isLiveDraft == true {
                    waitingCard(
                        title: "Live draft",
                        message: "Same pitch, one at a time. Drag a chip onto the highlighted slot — players can’t be reused."
                    )
                } else if viewModel.challenge?.isLiveHotseat == true {
                    waitingCard(
                        title: "Live Back Yourself",
                        message: "Take turns naming players. Shared names, 30 seconds each. Name someone who doesn’t fit and you’re out — last one standing wins."
                    )
                } else if viewModel.challenge?.isLiveTargetMan == true {
                    waitingCard(
                        title: "Live Target Man",
                        message: "Five rows, one at a time. Shared names. Closest to the target wins — scores stay hidden until the end."
                    )
                } else if viewModel.challenge?.isLiveDarts501 == true {
                    waitingCard(
                        title: "Live Football 501",
                        message: "Take turns naming players. Shared names. First to checkout wins. Three busts and you’re out — if everyone’s out, closest remaining wins."
                    )
                } else if viewModel.youHavePlayed {
                    waitingCard(
                        title: "Score locked in",
                        message: "Waiting for everyone else to finish."
                    )
                }

                if challenge.canStart {
                    Button {
                        Task { await viewModel.start() }
                    } label: {
                        HStack {
                            if viewModel.isBusy {
                                ProgressView().tint(BKTheme.background)
                            }
                            Text("START GAME")
                                .font(BKFont.headline(14))
                        }
                        .foregroundStyle(BKTheme.background)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(BKTheme.accent)
                        .clipShape(Capsule())
                    }
                    .disabled(viewModel.isBusy)
                    .buttonStyle(.plain)
                }

                if viewModel.canPlay {
                    Button {
                        viewModel.playing = true
                    } label: {
                        Text(viewModel.challenge?.isLivePlay == true
                             ? "REJOIN \(challenge.modeTitle)"
                             : "PLAY \(challenge.modeTitle)")
                            .font(BKFont.headline(14))
                            .foregroundStyle(BKTheme.background)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(BKTheme.accent)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }

                if let error = viewModel.errorMessage {
                    Text(error)
                        .font(BKFont.body(13))
                        .foregroundStyle(BKTheme.wrong)
                        .multilineTextAlignment(.center)
                }

                if challenge.result.allDone {
                    Button {
                        viewModel.clearChallenge()
                    } label: {
                        Text("NEW CHALLENGE")
                            .font(BKFont.caption(12))
                            .tracking(0.8)
                            .foregroundStyle(BKTheme.textMuted)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 4)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, BKTabBar.scrollClearance)
        }
    }

    private func codeCard(_ code: String) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 6) {
                Text("CHALLENGE CODE")
                    .font(BKFont.caption(10)).tracking(1)
                    .foregroundStyle(BKTheme.textMuted)
                ShareLink(item: "Join my Ball Knowledge VS challenge — code \(code)") {
                    Text("SHARE")
                        .font(BKFont.caption(10)).tracking(1)
                        .foregroundStyle(BKTheme.accent)
                }
            }
            Text(code)
                .font(BKFont.title(40))
                .tracking(6)
                .foregroundStyle(BKTheme.textPrimary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
        .background(Color(hex: "161616"))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func playersCard(_ challenge: VsChallengeDTO) -> some View {
        let openSlots = max(0, challenge.maxPlayers - challenge.players.count)
        return VStack(alignment: .leading, spacing: 12) {
            if challenge.status == "waiting" {
                Text(challenge.youAreHost ? "Waiting for friends" : "Waiting to start")
                    .font(BKFont.headline(16))
                    .foregroundStyle(BKTheme.textPrimary)
                    .padding(.bottom, 6)
            }
            ForEach(Array(challenge.players.enumerated()), id: \.element.userId) { index, player in
                if index > 0 { Divider().overlay(BKTheme.textMuted.opacity(0.25)) }
                playerRow(player, noun: challenge.categoryNoun, modeId: challenge.modeId)
            }
            if challenge.status == "waiting" {
                ForEach(0..<openSlots, id: \.self) { _ in
                    Divider().overlay(BKTheme.textMuted.opacity(0.25))
                    HStack(spacing: 10) {
                        Circle()
                            .strokeBorder(BKTheme.textMuted.opacity(0.35), style: StrokeStyle(lineWidth: 1.2, dash: [4, 3]))
                            .frame(width: 36, height: 36)
                        Text("Open slot")
                            .font(BKFont.headline(15))
                            .foregroundStyle(BKTheme.textMuted)
                        Spacer()
                        Text("Waiting…")
                            .font(BKFont.caption(12))
                            .foregroundStyle(BKTheme.textMuted)
                    }
                }
            }
        }
        .padding(16)
        .background(Color(hex: "121212"))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func playerRow(_ player: VsPlayerDTO, noun: String, modeId: String) -> some View {
        HStack(alignment: .center, spacing: 10) {
            lobbyAvatar(player)
            Text(playerLabel(player))
                .font(BKFont.headline(15))
                .foregroundStyle(BKTheme.textPrimary)
                .lineLimit(1)
            Spacer()
            if let score = player.displayScore ?? player.score {
                Text("\(score)")
                    .font(BKFont.title(22))
                    .foregroundStyle(BKTheme.accent)
                Text(scoreNoun(modeId, noun).uppercased())
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
            } else if player.completed {
                Text("Done")
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.textMuted)
            } else {
                Text("Waiting")
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.textMuted)
            }
        }
    }

    private func lobbyAvatar(_ player: VsPlayerDTO) -> some View {
        Group {
            if player.isYou, let image = LocalProfile.loadAvatar() {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                PlayerAvatar(urlString: player.avatarUrl, size: 36) {
                    BKTheme.cardElevated
                        .overlay {
                            Ph.userCircle.fill
                                .color(BKTheme.avatarPlaceholder)
                                .frame(width: 22, height: 22)
                        }
                }
            }
        }
        .frame(width: 36, height: 36)
        .clipShape(Circle())
    }

    private func playerLabel(_ player: VsPlayerDTO) -> String {
        var name = player.displayName
        if player.isYou { name += " (you)" }
        else if player.isHost { name += " (host)" }
        return name
    }

    private func scoreNoun(_ modeId: String, _ fallback: String) -> String {
        switch modeId {
        case GameModeID.targetMan.rawValue: return fallback
        case GameModeID.backYourself.rawValue: return "named"
        case GameModeID.darts501.rawValue: return "left"
        default: return fallback
        }
    }

    private func waitingCard(title: String, message: String) -> some View {
        VStack(spacing: 8) {
            Text(title)
                .font(BKFont.headline(16))
                .foregroundStyle(BKTheme.textPrimary)
            Text(message)
                .font(BKFont.body(14))
                .foregroundStyle(BKTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(18)
        .background(BKTheme.card.opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func targetManPickBreakdown(for userId: String, in challenge: VsChallengeDTO) -> some View {
        let picks = (challenge.targetMan?.picks ?? [])
            .filter { $0.userId == userId }
            .sorted { $0.slotIndex < $1.slotIndex }
        let unit = challenge.targetMan?.unit
        return VStack(spacing: 6) {
            ForEach(picks) { pick in
                HStack(spacing: 8) {
                    PlayerAvatar(urlString: pick.headshotUrl, size: 26)
                    Text(pick.playerName.isEmpty ? "Skipped" : pick.playerName)
                        .font(BKFont.body(13))
                        .foregroundStyle(BKTheme.textPrimary)
                        .lineLimit(1)
                    Spacer()
                    Text(formatTargetManValue(pick.statValue, unit: unit))
                        .font(BKFont.headline(13))
                        .foregroundStyle(BKTheme.accent)
                }
            }
        }
        .padding(picks.isEmpty ? 0 : 10)
        .background(BKTheme.cardElevated)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .opacity(picks.isEmpty ? 0 : 1)
    }

    private func formatTargetManValue(_ value: Int?, unit: String?) -> String {
        guard let value else { return "—" }
        if unit == "eur_m" { return "€\(value)m" }
        return "\(value)"
    }

    private func winnerCard(_ challenge: VsChallengeDTO) -> some View {
        let headline: String = {
            switch challenge.result.winner {
            case "draw": return "IT'S A DRAW"
            case "you": return "YOU WIN"
            default:
                if let winnerId = challenge.result.winnerUserId,
                   let winner = challenge.players.first(where: { $0.userId == winnerId }) {
                    return "\(winner.displayName.uppercased()) WINS"
                }
                return "CHALLENGE COMPLETE"
            }
        }()

        return VStack(spacing: 14) {
            Text(headline)
                .font(BKFont.title(28))
                .foregroundStyle(BKTheme.accent)
                .multilineTextAlignment(.center)

            VStack(spacing: 14) {
                ForEach(challenge.result.rankings, id: \.userId) { row in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(row.displayName + (row.userId == challenge.players.first(where: \.isYou)?.userId ? " (you)" : ""))
                                .font(BKFont.headline(14))
                                .foregroundStyle(BKTheme.textPrimary)
                                .lineLimit(1)
                            Spacer()
                            Text("\(row.displayScore)")
                                .font(BKFont.title(22))
                                .foregroundStyle(row.userId == challenge.result.winnerUserId || challenge.result.winner == "draw"
                                                 ? BKTheme.accent : BKTheme.textPrimary)
                        }
                        if challenge.modeId == GameModeID.targetMan.rawValue {
                            targetManPickBreakdown(for: row.userId, in: challenge)
                        }
                    }
                }
            }

            Text(scoreNoun(challenge.modeId, challenge.categoryNoun).uppercased())
                .font(BKFont.caption(10)).tracking(1)
                .foregroundStyle(BKTheme.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(22)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

struct VsChallengeOverflowMenu: View {
    var viewModel: VsViewModel
    @State private var confirm = false

    private var challenge: VsChallengeDTO? { viewModel.challenge }
    private var isHost: Bool { challenge?.youAreHost == true }
    private var canAbandon: Bool {
        guard let challenge else { return false }
        return challenge.status == "waiting" || challenge.status == "active"
    }

    var body: some View {
        if canAbandon {
            Menu {
                Button(isHost ? "Cancel challenge" : "Leave challenge", role: .destructive) {
                    confirm = true
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(BKTheme.textPrimary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .alert(isHost ? "Cancel challenge?" : "Leave challenge?", isPresented: $confirm) {
                Button(isHost ? "Keep it" : "Stay", role: .cancel) {}
                Button(isHost ? "Cancel challenge" : "Leave", role: .destructive) {
                    Task { await viewModel.abandonChallenge() }
                }
            } message: {
                Text(alertMessage)
            }
        }
    }

    private var alertMessage: String {
        if isHost {
            return "Everyone will be sent back to the lobby."
        }
        if (challenge?.players.count ?? 0) <= 2 {
            return "You're one of two players, so this will end the challenge."
        }
        return "The others will keep playing."
    }
}

private struct VsModeCard: View {
    let mode: GameModeID
    let selected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(BKTheme.background.opacity(0.45))
                if let name = GameModeTileArt.bundleImageName(for: mode.rawValue) {
                    GameModeBundleImage(name: name)
                        .scaledToFill()
                        .offset(y: 14)
                } else {
                    Image(systemName: mode.icon)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(BKTheme.accent)
                }
            }
            .frame(height: 72)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            Text(mode.title)
                .font(BKFont.caption(11))
                .tracking(0.6)
                .foregroundStyle(selected ? BKTheme.accent : BKTheme.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(10)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(selected ? BKTheme.accent : Color.clear, lineWidth: 2)
        )
    }
}
