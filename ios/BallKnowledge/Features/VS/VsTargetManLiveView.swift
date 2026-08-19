import SwiftUI

struct VsTargetManLiveView: View {
    @Environment(\.dismiss) private var dismiss
    var viewModel: VsViewModel
    @State private var search = VsHotseatSearch()
    @FocusState private var searchFocused: Bool
    @State private var now = Date()

    private var live: VsTargetManDTO? { viewModel.challenge?.targetMan }
    private var turnName: String {
        live?.board.first(where: { $0.userId == live?.turnUserId })?.displayName ?? "Someone"
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                scoreboard
                targetHeader
                pickGrid
                Spacer(minLength: 0)
                turnFooter
            }
            .background(StadiumBackground(glowIntensity: 0.32))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: {
                        Ph.x.bold.color(BKTheme.textPrimary).frame(width: 15, height: 15)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text("VS · TARGET MAN")
                        .font(BKFont.caption(13)).tracking(1)
                        .foregroundStyle(BKTheme.accent)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    VsChallengeOverflowMenu(viewModel: viewModel)
                }
            }
        }
        .onReceive(Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()) { now = $0 }
        .onChange(of: live?.yourTurn) { _, yourTurn in
            if yourTurn != true {
                search.reset()
                searchFocused = false
            }
        }
        .onChange(of: live?.slotIndex) { _, _ in
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
                    let isTurn = row.userId == live?.turnUserId && live?.finished != true
                    VStack(spacing: 2) {
                        Text(row.isYou ? "YOU" : row.displayName.uppercased())
                            .font(BKFont.caption(9))
                            .foregroundStyle(BKTheme.textMuted)
                            .lineLimit(1)
                        Text("\(row.pickCount)/\(live?.slotCount ?? 5)")
                            .font(BKFont.title(20))
                            .foregroundStyle(row.isYou ? BKTheme.accent : BKTheme.textPrimary)
                            .contentTransition(.numericText())
                    }
                    .frame(minWidth: 64)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 8)
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(isTurn ? BKTheme.accent : Color.clear, lineWidth: 1.5)
                    )
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 4)
        }
        .animation(.easeOut(duration: 0.25), value: live?.board.map(\.pickCount))
    }

    private var targetHeader: some View {
        VStack(spacing: 8) {
            HStack {
                Text(live?.yourTurn == true ? "YOUR TURN" : "\(turnName.uppercased())'S TURN")
                    .font(BKFont.caption(11)).tracking(1)
                    .foregroundStyle(live?.yourTurn == true ? BKTheme.accent : BKTheme.textMuted)
                Spacer()
                Text(timerLabel)
                    .font(BKFont.headline(16))
                    .foregroundStyle(secondsLeft <= 12 ? BKTheme.wrong : BKTheme.accent)
                    .monospacedDigit()
            }
            .padding(.horizontal, 20)

            Text("TARGET")
                .font(BKFont.caption(10)).tracking(1)
                .foregroundStyle(BKTheme.textMuted)
            Text(targetLabel)
                .font(BKFont.title(36))
                .foregroundStyle(BKTheme.accent)
            Text((live?.categoryLabel ?? "Target Man").uppercased())
                .font(BKFont.headline(14))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
            Text("ROW \((live?.slotIndex ?? 0) + 1) OF \(live?.slotCount ?? 5)  ·  SHARED NAMES  ·  SCORES AT THE END")
                .font(BKFont.caption(10)).tracking(0.6)
                .foregroundStyle(BKTheme.textMuted)
        }
        .padding(.vertical, 8)
    }

    private var pickGrid: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 8) {
                ForEach(0..<(live?.slotCount ?? 5), id: \.self) { slot in
                    rowCard(slot)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 12)
        }
    }

    private func rowCard(_ slot: Int) -> some View {
        let current = slot == live?.slotIndex && live?.finished != true
        return VStack(alignment: .leading, spacing: 8) {
            Text("ROW \(slot + 1)")
                .font(BKFont.caption(10)).tracking(0.8)
                .foregroundStyle(current ? BKTheme.accent : BKTheme.textMuted)
            HStack(spacing: 8) {
                ForEach(live?.board ?? [], id: \.userId) { person in
                    pickCell(person: person, slot: slot, current: current)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(current ? BKTheme.card : BKTheme.card.opacity(0.72))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(current ? BKTheme.accent.opacity(0.45) : Color.clear, lineWidth: 1)
        )
    }

    private func pickCell(person: VsTargetManBoardDTO, slot: Int, current: Bool) -> some View {
        let pick = live?.picks.first { $0.userId == person.userId && $0.slotIndex == slot }
        let waiting = current && person.userId == live?.turnUserId && pick == nil
        return VStack(alignment: .leading, spacing: 4) {
            Text(person.isYou ? "YOU" : person.displayName.uppercased())
                .font(BKFont.caption(8))
                .foregroundStyle(BKTheme.textMuted)
                .lineLimit(1)
            if let pick {
                Text(pick.playerName)
                    .font(BKFont.headline(12))
                    .foregroundStyle(BKTheme.textPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.75)
            } else if waiting {
                Text("…")
                    .font(BKFont.headline(16))
                    .foregroundStyle(BKTheme.accent)
            } else {
                Text("—")
                    .font(BKFont.headline(14))
                    .foregroundStyle(BKTheme.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(BKTheme.cardElevated)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    @ViewBuilder
    private var turnFooter: some View {
        if live?.yourTurn == true {
            VStack(spacing: 10) {
                if let feedback = search.feedback ?? viewModel.errorMessage {
                    Text(feedback)
                        .font(BKFont.caption(12))
                        .foregroundStyle(BKTheme.wrong)
                }
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(BKTheme.textMuted)
                    TextField("Search a player", text: Binding(
                        get: { search.query },
                        set: { search.update($0, namedIds: Set(live?.usedPlayerIds ?? [])) }
                    ))
                    .font(BKFont.body())
                    .foregroundStyle(BKTheme.textPrimary)
                    .focused($searchFocused)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                if !search.results.isEmpty {
                    PlayerSearchResultsList(
                        players: search.results,
                        isDisabled: { viewModel.isBusy || (live?.usedPlayerIds.contains($0.id) == true) }
                    ) { hit in
                        Task { await name(hit) }
                    }
                    .frame(maxHeight: 200)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 16)
            .background(BKTheme.background.opacity(0.92))
        } else {
            Text(live?.finished == true ? "Challenge over" : "Waiting for \(turnName)")
                .font(BKFont.body(14))
                .foregroundStyle(BKTheme.textSecondary)
                .padding(18)
        }
    }

    private var targetLabel: String {
        let value = live?.target ?? 0
        if live?.unit == "eur_m" { return "€\(value)m" }
        return "\(value)"
    }

    private var secondsLeft: Int {
        guard let live, let deadline = Self.parseDeadline(live.deadlineAt) else { return 0 }
        return max(0, Int(ceil(deadline.timeIntervalSince(now))))
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

    private func name(_ hit: PlayerSearchResultDTO) async {
        if live?.usedPlayerIds.contains(hit.id) == true {
            search.feedback = "Someone already named that player"
            HapticManager.error()
            return
        }
        let ok = await viewModel.pickTargetMan(playerId: hit.id)
        if ok {
            HapticManager.success()
            search.reset()
        } else {
            search.feedback = viewModel.errorMessage ?? "Couldn't lock that pick"
            HapticManager.error()
        }
    }
}
