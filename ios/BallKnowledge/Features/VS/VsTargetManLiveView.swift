import SwiftUI

struct VsTargetManLiveView: View {
    @Environment(\.dismiss) private var dismiss
    var viewModel: VsViewModel
    @State private var search = VsHotseatSearch()
    @FocusState private var searchFocused: Bool
    @State private var now = Date()
    @State private var seenPickIds: Set<String> = []
    @State private var seededPicks = false
    @State private var mateToast: VsTargetManPickDTO?

    private var live: VsTargetManDTO? { viewModel.challenge?.targetMan }
    private var namedPicks: [VsTargetManPickDTO] { live?.picks ?? [] }
    private var turnName: String {
        live?.board.first(where: { $0.userId == live?.turnUserId })?.displayName ?? "Someone"
    }

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                let safeBottom = geo.safeAreaInsets.bottom
                let showingResults = live?.yourTurn == true && !search.results.isEmpty
                let sheetH = (showingResults ? 286 : 118) + safeBottom
                ZStack(alignment: .bottom) {
                    VStack(spacing: 0) {
                        targetHeader
                        pickGrid
                        Spacer(minLength: 0)
                    }
                    .padding(.bottom, sheetH)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .background(StadiumBackground(glowIntensity: 0.32))

                    if live?.finished != true {
                        turnSheet(safeBottom: safeBottom)
                            .frame(height: sheetH, alignment: .top)
                    }

                    if let mateToast {
                        VsTargetManMateToast(pick: mateToast)
                            .padding(.bottom, sheetH + 20)
                            .transition(.scale(scale: 0.92).combined(with: .opacity))
                    }
                }
                .animation(.spring(response: 0.32, dampingFraction: 0.86), value: mateToast?.id)
                .frame(width: geo.size.width, height: geo.size.height + safeBottom)
                .ignoresSafeArea(edges: .bottom)
            }
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
        .liftsForKeyboard()
        .onAppear { seedSeenPicks() }
        .onChange(of: namedPicks.map(\.id)) { _, _ in
            revealMatePickIfNeeded()
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

    private var targetHeader: some View {
        VStack(spacing: 10) {
            Text(targetLabel)
                .font(BKFont.title(44))
                .foregroundStyle(BKTheme.accent)
            Text((live?.categoryLabel ?? "Target Man").uppercased())
                .font(BKFont.headline(17))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
        }
        .padding(.top, 12)
        .padding(.bottom, 20)
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
        let people = live?.board ?? []
        return Group {
            if people.count <= 2 {
                HStack(spacing: 8) {
                    ForEach(people, id: \.userId) { person in
                        pickCell(person: person, slot: slot, current: current)
                    }
                }
            } else {
                GeometryReader { geo in
                    let cellW = (geo.size.width - 8) / 2
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(people, id: \.userId) { person in
                                pickCell(person: person, slot: slot, current: current)
                                    .frame(width: cellW)
                            }
                        }
                        .scrollTargetLayout()
                    }
                    .scrollTargetBehavior(.viewAligned)
                }
                .frame(height: 58)
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
            Group {
                if let pick {
                    HStack(alignment: .center, spacing: 6) {
                        PlayerAvatar(urlString: pick.headshotUrl, size: 28)
                        Text(pick.playerName.isEmpty ? "Skipped" : pick.playerName)
                            .font(BKFont.headline(12))
                            .foregroundStyle(BKTheme.textPrimary)
                            .lineLimit(2)
                            .minimumScaleFactor(0.75)
                    }
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
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .padding(8)
        .frame(maxWidth: .infinity, minHeight: 58, maxHeight: 58, alignment: .topLeading)
        .background(BKTheme.cardElevated)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var sheetShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: 18,
            bottomLeadingRadius: 0,
            bottomTrailingRadius: 0,
            topTrailingRadius: 18,
            style: .continuous
        )
    }

    private func turnSheet(safeBottom: CGFloat) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                Text(live?.yourTurn == true ? "YOUR TURN" : "\(turnName.uppercased())'S TURN")
                    .font(BKFont.headline(13)).tracking(0.8)
                    .foregroundStyle(live?.yourTurn == true ? BKTheme.accent : BKTheme.textMuted)
                Spacer(minLength: 8)
                Text(timerLabel)
                    .font(BKFont.title(22))
                    .foregroundStyle(secondsLeft <= 12 ? BKTheme.wrong : BKTheme.accent)
                    .monospacedDigit()
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .padding(.bottom, 12)

            if live?.yourTurn == true {
                if !search.results.isEmpty {
                    PlayerSearchResultsList(
                        players: search.results,
                        isDisabled: { viewModel.isBusy || (live?.usedPlayerIds.contains($0.id) == true) }
                    ) { hit in
                        Task { await name(hit) }
                    }
                    .frame(maxHeight: 160)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)
                }
                if let feedback = search.feedback ?? viewModel.errorMessage {
                    Text(feedback)
                        .font(BKFont.caption(12))
                        .foregroundStyle(BKTheme.wrong)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 8)
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
                .background(BKTheme.cardElevated)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.horizontal, 24)
            } else {
                Text(live?.finished == true ? "Challenge over" : "Waiting for \(turnName)")
                    .font(BKFont.body(14))
                    .foregroundStyle(BKTheme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 24)
            }
            Spacer(minLength: 0)
        }
        .padding(.bottom, safeBottom)
        .frame(maxWidth: .infinity)
        .background(BKTheme.card)
        .clipShape(sheetShape)
        .overlay {
            sheetShape.stroke(BKTheme.cardElevated, lineWidth: 1)
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

    private func seedSeenPicks() {
        seenPickIds = Set(namedPicks.map(\.id))
        seededPicks = true
    }

    private func revealMatePickIfNeeded() {
        let ids = namedPicks.map(\.id)
        if !seededPicks {
            seedSeenPicks()
            return
        }
        let fresh = namedPicks.filter { !seenPickIds.contains($0.id) }
        seenPickIds.formUnion(ids)
        guard let mate = fresh.last(where: { !$0.isYou }) else { return }
        mateToast = mate
        Task {
            try? await Task.sleep(for: .seconds(2.1))
            if mateToast?.id == mate.id {
                mateToast = nil
            }
        }
    }
}

private struct VsTargetManMateToast: View {
    let pick: VsTargetManPickDTO

    var body: some View {
        VStack(spacing: 10) {
            Text("\(pick.displayName.uppercased()) PLAYED")
                .font(BKFont.caption(12)).tracking(0.8)
                .foregroundStyle(BKTheme.accent)

            HStack(alignment: .center, spacing: 12) {
                PlayerAvatar(urlString: pick.headshotUrl, size: 52)
                Text(pick.playerName.isEmpty ? "Skipped" : pick.playerName)
                    .font(BKFont.headline(17))
                    .foregroundStyle(BKTheme.textPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.75)
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: 280)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(BKTheme.cardElevated, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.35), radius: 16, y: 8)
        .allowsHitTesting(false)
    }
}
