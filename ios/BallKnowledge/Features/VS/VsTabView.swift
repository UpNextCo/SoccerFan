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
            challenge = try await APIClient.shared.vsGet(id: id)
            VsMonitor.shared.track(challenge)
        } catch {
            // Keep last known state while polling.
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
                    Text("VS")
                        .font(BKFont.caption(13)).tracking(1.5)
                        .foregroundStyle(BKTheme.accent)
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
                    if viewModel.challenge?.result.allDone == true {
                        viewModel.playing = false
                    }
                } else {
                    break
                }
            }
        }
        .onChange(of: viewModel.challenge?.status) {
            if viewModel.challenge?.isLivePlay == true {
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
            if let challenge = viewModel.targetManChallenge {
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
            if let puzzle = viewModel.darts501Puzzle {
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
        ScrollView(showsIndicators: false) {
            VStack(spacing: 28) {
                VStack(spacing: 10) {
                    Ph.users.weight(.fill)
                        .color(BKTheme.accent)
                        .frame(width: 44, height: 44)
                    Text("Challenge your mates")
                        .font(BKFont.title(28))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text("Pick a game, share a code, invite up to 4 friends. Live turns for Back Yourself and Draft XI. No XP.")
                        .font(BKFont.body(14))
                        .foregroundStyle(BKTheme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 12)
                }
                .padding(.top, 28)

                VStack(alignment: .leading, spacing: 12) {
                    Text("PICK A GAME")
                        .font(BKFont.caption(11))
                        .tracking(1)
                        .foregroundStyle(BKTheme.textMuted)

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
                }

                Button {
                    Task { await viewModel.create() }
                } label: {
                    HStack {
                        if viewModel.isBusy {
                            ProgressView().tint(BKTheme.textPrimary)
                        }
                        Text("CREATE CHALLENGE")
                            .font(BKFont.headline(14))
                    }
                    .foregroundStyle(BKTheme.textPrimary)
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

                    Button {
                        Task { await viewModel.join() }
                    } label: {
                        Text("JOIN CHALLENGE")
                            .font(BKFont.headline(14))
                            .foregroundStyle(BKTheme.textPrimary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(BKTheme.card)
                            .clipShape(Capsule())
                    }
                    .disabled(viewModel.isBusy)
                    .buttonStyle(.plain)
                }

                if let error = viewModel.errorMessage {
                    Text(error)
                        .font(BKFont.body(13))
                        .foregroundStyle(BKTheme.wrong)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, BKTabBar.scrollClearance)
        }
    }

    @ViewBuilder
    private func challengeContent(_ challenge: VsChallengeDTO) -> some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Text(challenge.modeTitle)
                        .font(BKFont.caption(11)).tracking(1.2)
                        .foregroundStyle(BKTheme.accent)
                    Text(challenge.title)
                        .font(BKFont.title(26))
                        .foregroundStyle(BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 28)

                codeCard(challenge.code)

                playersCard(challenge)

                if challenge.result.allDone {
                    winnerCard(challenge)
                } else if viewModel.challenge?.isLiveDraft == true {
                    waitingCard(
                        title: "Live draft",
                        message: "Same position, same time. Lock your pick — then you’ll see everyone else’s."
                    )
                } else if viewModel.challenge?.isLiveHotseat == true {
                    waitingCard(
                        title: "Live Back Yourself",
                        message: "Take turns naming players. Shared names, 30 seconds each. Last one standing wins."
                    )
                } else if viewModel.youHavePlayed {
                    waitingCard(
                        title: "Score locked in",
                        message: "Waiting for everyone else to finish."
                    )
                } else if challenge.status == "waiting" {
                    waitingCard(
                        title: challenge.youAreHost ? "Waiting for friends" : "Waiting to start",
                        message: challenge.youAreHost
                            ? "Share your code. Start once at least one mate has joined — up to 4."
                            : "The host will start once everyone’s in."
                    )
                }

                if challenge.canStart {
                    Button {
                        Task { await viewModel.start() }
                    } label: {
                        HStack {
                            if viewModel.isBusy {
                                ProgressView().tint(BKTheme.textPrimary)
                            }
                            Text("START GAME")
                                .font(BKFont.headline(14))
                        }
                        .foregroundStyle(BKTheme.textPrimary)
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
                            .foregroundStyle(BKTheme.textPrimary)
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
            Text("CHALLENGE CODE")
                .font(BKFont.caption(10)).tracking(1)
                .foregroundStyle(BKTheme.textMuted)
            Text(code)
                .font(BKFont.title(40))
                .tracking(6)
                .foregroundStyle(BKTheme.textPrimary)
            ShareLink(item: "Join my Ball Knowledge VS challenge — code \(code)") {
                Text("Share code")
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.accent)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func playersCard(_ challenge: VsChallengeDTO) -> some View {
        let openSlots = max(0, challenge.maxPlayers - challenge.players.count)
        return VStack(spacing: 12) {
            ForEach(Array(challenge.players.enumerated()), id: \.element.userId) { index, player in
                if index > 0 { Divider().overlay(BKTheme.textMuted.opacity(0.25)) }
                playerRow(player, noun: challenge.categoryNoun, modeId: challenge.modeId)
            }
            if challenge.status == "waiting" {
                ForEach(0..<openSlots, id: \.self) { _ in
                    Divider().overlay(BKTheme.textMuted.opacity(0.25))
                    HStack {
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
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func playerRow(_ player: VsPlayerDTO, noun: String, modeId: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(playerLabel(player))
                .font(BKFont.headline(15))
                .foregroundStyle(BKTheme.textPrimary)
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

            VStack(spacing: 10) {
                ForEach(challenge.result.rankings, id: \.userId) { row in
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
