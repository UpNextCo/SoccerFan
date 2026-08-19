import SwiftUI

@MainActor
@Observable
final class VsDraftLiveSearch {
    var query = ""
    var results: [BattlePlayerDTO] = []
    var isSearching = false
    var selectedConstraint: BattleConstraint?
    var selectionError: String?

    func reset() {
        query = ""
        results = []
        selectedConstraint = nil
        selectionError = nil
    }

    func search(battle: BattleChallenge, slotPosition: String, usedPlayerIds: Set<String>) async {
        guard let constraint = selectedConstraint else {
            results = []
            return
        }
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else {
            results = []
            return
        }
        isSearching = true
        defer { isSearching = false }
        do {
            let rows = try await APIClient.shared.battlePlayers(
                categoryId: battle.category.id,
                constraint: constraint,
                position: slotPosition,
                query: q
            )
            results = rows.filter { !usedPlayerIds.contains($0.id) }
        } catch {
            results = []
        }
    }
}

struct VsDraftLiveView: View {
    @Environment(\.dismiss) private var dismiss
    var viewModel: VsViewModel
    let battle: BattleChallenge
    @State private var search = VsDraftLiveSearch()
    @FocusState private var searchFocused: Bool
    @State private var now = Date()

    private var live: VsLiveDTO? { viewModel.challenge?.live }
    private var slot: BattleSlot? {
        guard let live else { return nil }
        return battle.slots.first { $0.id == live.slotId }
            ?? battle.slots[safe: live.slotIndex]
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                scoreboard
                slotHero
                if live?.youLocked == true || live?.finished == true {
                    lockedState
                } else {
                    pickArea
                }
                rivals
            }
            .background(StadiumBackground())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: {
                        Ph.x.bold.color(BKTheme.textPrimary).frame(width: 15, height: 15)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text("VS · DRAFT XI")
                        .font(BKFont.caption(13)).tracking(1)
                        .foregroundStyle(BKTheme.accent)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    VsChallengeOverflowMenu(viewModel: viewModel)
                }
            }
        }
        .onReceive(Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()) { now = $0 }
        .onChange(of: live?.slotId) { _, _ in
            search.reset()
            searchFocused = false
        }
        .onChange(of: viewModel.challenge?.result.allDone) { _, done in
            if done == true { dismiss() }
        }
        .onChange(of: viewModel.challenge?.id) { _, id in
            if id == nil { dismiss() }
        }
        .task(id: viewModel.challenge?.id) {
            while !Task.isCancelled {
                await viewModel.poll()
                if viewModel.challenge?.result.allDone == true { break }
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private var scoreboard: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(live?.board ?? [], id: \.userId) { row in
                    VStack(spacing: 2) {
                        Text(row.isYou ? "YOU" : row.displayName.uppercased())
                            .font(BKFont.caption(9))
                            .foregroundStyle(BKTheme.textMuted)
                            .lineLimit(1)
                        Text("\(row.total)")
                            .font(BKFont.title(22))
                            .foregroundStyle(row.isYou ? BKTheme.accent : BKTheme.textPrimary)
                            .contentTransition(.numericText())
                    }
                    .frame(minWidth: 64)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 8)
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 4)
        }
        .animation(.easeOut(duration: 0.25), value: live?.board.map(\.total))
    }

    private var slotHero: some View {
        VStack(spacing: 6) {
            HStack {
                Text("SLOT \((live?.slotIndex ?? 0) + 1)/\(live?.slotCount ?? battle.slots.count)")
                    .font(BKFont.caption(11)).tracking(1)
                    .foregroundStyle(BKTheme.textMuted)
                Spacer()
                Text(timerLabel)
                    .font(BKFont.headline(16))
                    .foregroundStyle(secondsLeft <= 20 ? BKTheme.wrong : BKTheme.accent)
                    .monospacedDigit()
            }
            .padding(.horizontal, 20)

            Text(live?.slotLabel ?? slot?.label ?? "—")
                .font(BKFont.title(44))
                .foregroundStyle(BKTheme.textPrimary)
            Text((live?.slotPosition ?? slot?.position ?? "").uppercased())
                .font(BKFont.caption(12)).tracking(1.2)
                .foregroundStyle(BKTheme.textSecondary)
            Text(battle.category.title.uppercased())
                .font(BKFont.caption(11))
                .foregroundStyle(BKTheme.textMuted)
        }
        .padding(.vertical, 10)
    }

    private var pickArea: some View {
        VStack(spacing: 12) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(battle.constraints) { constraint in
                        let used = live?.usedConstraintIds.contains(constraint.id) == true
                        let selected = search.selectedConstraint?.id == constraint.id
                        Button {
                            guard !used else { return }
                            search.selectedConstraint = constraint
                            search.selectionError = nil
                            searchFocused = true
                            Task {
                                await search.search(
                                    battle: battle,
                                    slotPosition: live?.slotPosition ?? "",
                                    usedPlayerIds: Set(live?.usedPlayerIds ?? [])
                                )
                            }
                        } label: {
                            HStack(spacing: 6) {
                                ConstraintIcon(constraint: constraint, size: 22)
                                Text(constraint.label.uppercased())
                                    .font(.system(size: 10, weight: .bold, design: .rounded))
                                    .foregroundStyle(selected ? BKTheme.background : BKTheme.textSecondary)
                            }
                            .padding(.horizontal, 10).padding(.vertical, 8)
                            .background(selected ? BKTheme.accent : BKTheme.card)
                            .clipShape(Capsule())
                            .opacity(used ? 0.35 : 1)
                        }
                        .disabled(used)
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }

            if search.selectedConstraint != nil {
                HStack(spacing: 12) {
                    TextField("", text: $search.query, prompt:
                        Text("SEARCH PLAYERS").foregroundStyle(BKTheme.textMuted)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                    )
                    .textFieldStyle(.plain)
                    .foregroundStyle(BKTheme.background)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .focused($searchFocused)
                    .onChange(of: search.query) { _, _ in
                        Task {
                            await search.search(
                                battle: battle,
                                slotPosition: live?.slotPosition ?? "",
                                usedPlayerIds: Set(live?.usedPlayerIds ?? [])
                            )
                        }
                    }
                    if search.isSearching { ProgressView().tint(BKTheme.textMuted) }
                }
                .padding(.horizontal, 16).padding(.vertical, 14)
                .background(Color.white).clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(BKTheme.accent.opacity(0.35), lineWidth: 1.5))
                .padding(.horizontal, 16)
            } else {
                Text("Pick any remaining constraint")
                    .font(BKFont.body(13))
                    .foregroundStyle(BKTheme.textSecondary)
            }

            if let error = search.selectionError ?? viewModel.errorMessage {
                Text(error.uppercased())
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.wrong)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
            }

            ScrollView {
                VStack(spacing: 0) {
                    ForEach(search.results) { player in
                        Button {
                            Task { await lock(player) }
                        } label: {
                            HStack(spacing: 12) {
                                PlayerAvatar(urlString: player.headshotUrl, size: 32)
                                Text(player.name.uppercased())
                                    .font(.system(size: 13, weight: .bold, design: .rounded))
                                    .foregroundStyle(BKTheme.textPrimary)
                                Spacer()
                                Text(GuessWhoDisplay.nationalityFlag(player.nationality ?? ""))
                                    .font(.system(size: 20))
                            }
                            .padding(.horizontal, 14).padding(.vertical, 12)
                        }
                        .disabled(viewModel.isBusy)
                        if player.id != search.results.last?.id {
                            Divider().background(BKTheme.cardElevated)
                        }
                    }
                }
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 16)
            }
        }
    }

    private var lockedState: some View {
        VStack(spacing: 10) {
            let you = live?.board.first(where: \.isYou)
            Text("LOCKED IN")
                .font(BKFont.caption(11)).tracking(1.2)
                .foregroundStyle(BKTheme.accent)
            Text(you?.playerName ?? "Pick saved")
                .font(BKFont.title(26))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
            if let label = you?.constraintLabel {
                Text(label.uppercased())
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.textSecondary)
            }
            if let value = you?.statValue {
                Text("+\(value) \(battle.category.noun.uppercased())")
                    .font(BKFont.headline(16))
                    .foregroundStyle(BKTheme.accent)
            }
            Text("Waiting for everyone else — or the clock.")
                .font(BKFont.body(13))
                .foregroundStyle(BKTheme.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(20)
    }

    private var rivals: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("THIS SLOT")
                .font(BKFont.caption(10)).tracking(1)
                .foregroundStyle(BKTheme.textMuted)
                .padding(.horizontal, 16)
            VStack(spacing: 8) {
                ForEach(live?.board.filter { !$0.isYou } ?? [], id: \.userId) { row in
                    HStack(spacing: 10) {
                        PlayerAvatar(urlString: row.headshotUrl, size: 28)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.displayName)
                                .font(BKFont.headline(14))
                                .foregroundStyle(BKTheme.textPrimary)
                            if row.locked {
                                Text("\(row.playerName ?? "Locked") · \(row.constraintLabel ?? "")")
                                    .font(BKFont.caption(11))
                                    .foregroundStyle(BKTheme.textSecondary)
                                    .lineLimit(1)
                            } else {
                                Text("Picking…")
                                    .font(BKFont.caption(11))
                                    .foregroundStyle(BKTheme.textMuted)
                            }
                        }
                        Spacer()
                        if row.locked, let value = row.statValue {
                            Text("\(value)")
                                .font(BKFont.title(20))
                                .foregroundStyle(BKTheme.accent)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
    }

    private var secondsLeft: Int {
        guard let live, let deadline = Self.parseDeadline(live.deadlineAt) else { return 0 }
        return max(0, Int(deadline.timeIntervalSince(now)))
    }

    private static func parseDeadline(_ raw: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: raw) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }

    private var timerLabel: String {
        let total = secondsLeft
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private func lock(_ player: BattlePlayerDTO) async {
        guard let live, let constraint = search.selectedConstraint else { return }
        if player.satisfiesConstraint == false {
            search.selectionError = constraint.rejectReason(player: player.name)
            HapticManager.error()
            return
        }
        let ok = await viewModel.lockPick(slotId: live.slotId, constraintId: constraint.id, playerId: player.id)
        if ok {
            HapticManager.success()
            search.reset()
        } else {
            search.selectionError = viewModel.errorMessage
            HapticManager.error()
        }
    }
}

private extension Collection {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

