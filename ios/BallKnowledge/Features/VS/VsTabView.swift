import SwiftUI

@MainActor
@Observable
final class VsViewModel {
    var challenge: VsChallengeDTO?
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
            challenge = try await APIClient.shared.vsCreate()
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

    func poll() async {
        guard let id = challenge?.id else { return }
        do {
            challenge = try await APIClient.shared.vsGet(id: id)
            VsMonitor.shared.track(challenge)
        } catch {
            // Keep last known state while polling.
        }
    }

    func submit(state: BattleGameState) async -> (lineup: [BattleOptimalSlotDTO], optimalScore: Int?)? {
        guard let id = challenge?.id else { return nil }
        let picks = state.picks.map { slotId, pick in
            VsPickDTO(slotId: slotId, constraintId: pick.constraint.id, playerId: pick.player.id)
        }
        do {
            let updated = try await APIClient.shared.vsSubmit(id: id, picks: picks)
            challenge = updated
            VsMonitor.shared.track(challenge)
            errorMessage = nil
            let lineup = updated.optimalLineup ?? []
            return (lineup, updated.optimalScore)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func clearChallenge() {
        challenge = nil
        playing = false
        errorMessage = nil
        VsMonitor.shared.track(nil)
    }

    var youHavePlayed: Bool {
        guard let challenge else { return false }
        return challenge.youAreHost ? challenge.host.completed : (challenge.guest?.completed ?? false)
    }

    var canPlay: Bool {
        guard let challenge else { return false }
        return challenge.status == "active" && !youHavePlayed
    }

    var battleChallenge: BattleChallenge? {
        guard let challenge else { return nil }
        return DailyChallengeResolver.battleChallenge(from: challenge.puzzle)
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
                try? await Task.sleep(for: .seconds(3))
                guard !Task.isCancelled else { break }
                // Only poll while waiting on someone / something.
                if let c = viewModel.challenge,
                   c.status == "waiting" || c.status == "active",
                   !c.result.bothDone {
                    await viewModel.poll()
                } else {
                    break
                }
            }
        }
        .fullScreenCover(isPresented: $viewModel.playing) {
            if let challenge = viewModel.battleChallenge {
                DraftMasterView(
                    challenge: challenge,
                    allowReplay: true,
                    showsXp: false,
                    onSubmit: { state in
                        await viewModel.submit(state: state)
                    },
                    onComplete: {
                        viewModel.playing = false
                    }
                )
            }
        }
    }

    private var lobbyContent: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 28) {
                VStack(spacing: 10) {
                    Ph.users.weight(.fill)
                        .color(BKTheme.accent)
                        .frame(width: 44, height: 44)
                    Text("Challenge a mate")
                        .font(BKFont.title(28))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text("Create a code, share it, then both play the same Draft XI. Highest XI total wins — no XP.")
                        .font(BKFont.body(14))
                        .foregroundStyle(BKTheme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 12)
                }
                .padding(.top, 36)

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
                    Text("DRAFT XI")
                        .font(BKFont.caption(11)).tracking(1.2)
                        .foregroundStyle(BKTheme.accent)
                    Text(challenge.puzzle.category.title)
                        .font(BKFont.title(26))
                        .foregroundStyle(BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 28)

                codeCard(challenge.code)

                playersCard(challenge)

                if challenge.result.bothDone {
                    winnerCard(challenge)
                } else if viewModel.youHavePlayed {
                    waitingCard(
                        title: "Score locked in",
                        message: "Waiting for \(opponentName(challenge)) to finish their XI."
                    )
                } else if challenge.status == "waiting" {
                    waitingCard(
                        title: "Waiting for opponent",
                        message: "Share your code. You'll both play once they join."
                    )
                }

                if viewModel.canPlay {
                    Button {
                        viewModel.playing = true
                    } label: {
                        Text("PLAY DRAFT XI")
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

                if challenge.result.bothDone {
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
        VStack(spacing: 12) {
            playerRow(
                name: challenge.host.displayName + (challenge.youAreHost ? " (you)" : ""),
                score: challenge.host.score,
                completed: challenge.host.completed,
                noun: challenge.categoryNoun
            )
            Divider().overlay(BKTheme.textMuted.opacity(0.25))
            if let guest = challenge.guest {
                playerRow(
                    name: guest.displayName + (!challenge.youAreHost ? " (you)" : ""),
                    score: guest.score,
                    completed: guest.completed,
                    noun: challenge.categoryNoun
                )
            } else {
                HStack {
                    Text("Opponent")
                        .font(BKFont.headline(15))
                        .foregroundStyle(BKTheme.textMuted)
                    Spacer()
                    Text("Waiting…")
                        .font(BKFont.caption(12))
                        .foregroundStyle(BKTheme.textMuted)
                }
            }
        }
        .padding(16)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func playerRow(name: String, score: Int?, completed: Bool, noun: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(name)
                .font(BKFont.headline(15))
                .foregroundStyle(BKTheme.textPrimary)
            Spacer()
            if completed, let score {
                Text("\(score)")
                    .font(BKFont.title(22))
                    .foregroundStyle(BKTheme.accent)
                Text(noun.uppercased())
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
            } else if completed {
                Text("Done")
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.textMuted)
            } else {
                Text("Not played")
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.textMuted)
            }
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
            case "host":
                return challenge.youAreHost ? "YOU WIN" : "\(challenge.host.displayName.uppercased()) WINS"
            case "guest":
                if let guest = challenge.guest {
                    return challenge.youAreHost ? "\(guest.displayName.uppercased()) WINS" : "YOU WIN"
                }
                return "CHALLENGE COMPLETE"
            default:
                return "CHALLENGE COMPLETE"
            }
        }()

        return VStack(spacing: 14) {
            Text(headline)
                .font(BKFont.title(28))
                .foregroundStyle(BKTheme.accent)
                .multilineTextAlignment(.center)

            HStack(spacing: 20) {
                scoreSide(
                    label: challenge.youAreHost ? "YOU" : challenge.host.displayName.uppercased(),
                    value: challenge.host.score ?? 0,
                    highlight: challenge.result.winner == "host" || challenge.result.winner == "draw"
                )
                Text("VS")
                    .font(BKFont.caption(12)).tracking(1)
                    .foregroundStyle(BKTheme.textMuted)
                scoreSide(
                    label: {
                        if let guest = challenge.guest {
                            return challenge.youAreHost ? guest.displayName.uppercased() : "YOU"
                        }
                        return "OPPONENT"
                    }(),
                    value: challenge.guest?.score ?? 0,
                    highlight: challenge.result.winner == "guest" || challenge.result.winner == "draw"
                )
            }

            Text(challenge.categoryNoun.uppercased())
                .font(BKFont.caption(10)).tracking(1)
                .foregroundStyle(BKTheme.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(22)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func scoreSide(label: String, value: Int, highlight: Bool) -> some View {
        VStack(spacing: 4) {
            Text("\(value)")
                .font(BKFont.title(36))
                .foregroundStyle(highlight ? BKTheme.accent : BKTheme.textPrimary)
            Text(label)
                .font(BKFont.caption(10))
                .foregroundStyle(BKTheme.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
    }

    private func opponentName(_ challenge: VsChallengeDTO) -> String {
        if challenge.youAreHost {
            return challenge.guest?.displayName ?? "your opponent"
        }
        return challenge.host.displayName
    }
}
