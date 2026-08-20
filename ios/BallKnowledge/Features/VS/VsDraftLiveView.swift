import SwiftUI

struct VsDraftLiveView: View {
    @Environment(\.dismiss) private var dismiss
    var viewModel: VsViewModel
    let battle: BattleChallenge
    @State private var draft: DraftMasterViewModel
    @State private var picksExpanded = false
    @State private var seenPickIds: Set<String> = []
    @State private var seededPicks = false
    @State private var mateToast: VsLivePickFeedDTO?

    init(viewModel: VsViewModel, battle: BattleChallenge) {
        self.viewModel = viewModel
        self.battle = battle
        let draft = DraftMasterViewModel(challenge: battle)
        draft.state.phase = .building
        _draft = State(initialValue: draft)
    }

    private var live: VsLiveDTO? { viewModel.challenge?.live }
    private var namedPicks: [VsLivePickFeedDTO] { live?.picks ?? [] }
    private var picksBySlot: [(slot: BattleSlot, rows: [VsLivePickFeedDTO])] {
        battle.slots.compactMap { slot in
            let rows = namedPicks.filter { $0.slotId == slot.id }
            return rows.isEmpty ? nil : (slot, rows)
        }
    }
    private var turnName: String {
        live?.board.first(where: { $0.userId == live?.turnUserId })?.displayName ?? "Someone"
    }

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                let safeBottom = geo.safeAreaInsets.bottom
                let collapsedH = VsDraftPicksSheet.collapsedHeight(safeBottom: safeBottom)
                let expandedH = max(collapsedH, min(geo.size.height * 0.78, max(0, geo.size.height - 72)))
                if geo.size.width > 40, geo.size.height > 80 {
                    ZStack(alignment: .bottom) {
                        VStack(spacing: 0) {
                            scoreboard
                            BattleConstraintsStrip(
                                constraints: battle.constraints,
                                usedIds: Set(live?.usedConstraintIds ?? []).union(draft.state.usedConstraintIds)
                            )
                            .padding(.top, 6)
                            BattlePitchView(
                                slots: battle.slots,
                                state: draft.state,
                                highlightedSlotId: live?.slotId,
                                interactiveSlotId: live?.yourTurn == true ? live?.slotId : "",
                                compact: true,
                                slotScale: 0.88,
                                onTapSlot: { open($0) },
                                onDropConstraint: { id, slot in
                                    guard live?.yourTurn == true, slot.id == live?.slotId else { return }
                                    draft.assignConstraint(id: id, toSlot: slot.id)
                                    draft.openSlot(slot)
                                }
                            )
                            .frame(maxHeight: .infinity)
                            .padding(.horizontal, 34)
                            .padding(.bottom, collapsedH)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

                        VsDraftPicksSheet(
                            battle: battle,
                            live: live,
                            picksBySlot: picksBySlot,
                            turnName: turnName,
                            collapsedHeight: collapsedH,
                            expandedHeight: expandedH,
                            safeBottom: safeBottom,
                            expanded: $picksExpanded
                        )

                        if let mateToast {
                            VsDraftMateToast(pick: mateToast)
                                .padding(.bottom, collapsedH + 20)
                                .transition(.scale(scale: 0.92).combined(with: .opacity))
                        }
                    }
                    .animation(.spring(response: 0.32, dampingFraction: 0.86), value: mateToast?.id)
                    .frame(width: geo.size.width, height: geo.size.height + safeBottom)
                    .ignoresSafeArea(edges: .bottom)
                }
            }
            .background {
                StadiumBackground().ignoresSafeArea()
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(battle.category.title.uppercased())
                        .font(BKFont.caption(12)).tracking(0.6)
                        .foregroundStyle(BKTheme.textPrimary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 220)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    VsChallengeOverflowMenu(viewModel: viewModel)
                }
            }
        }
        .sheet(item: Binding(
            get: { draft.activeSlot },
            set: { if $0 == nil { draft.closeSlot() } }
        )) { slot in
            BattleSearchSheet(viewModel: draft, slot: slot)
        }
        .onAppear {
            wireDraft()
            seedSeenPicks()
        }
        .onChange(of: namedPicks.map(\.id)) { _, _ in
            revealMatePickIfNeeded()
        }
        .onChange(of: live?.yourPicks.map(\.id)) { _, _ in syncPitch() }
        .onChange(of: live?.usedPlayerIds) { _, ids in
            draft.extraUsedPlayerIds = Set(ids ?? [])
        }
        .onChange(of: live?.usedConstraintIds) { _, ids in
            draft.extraUsedConstraintIds = Set(ids ?? [])
        }
        .onChange(of: live?.yourTurn) { _, yourTurn in
            if yourTurn != true { draft.closeSlot() }
        }
        .onChange(of: live?.slotId) { _, _ in
            draft.closeSlot()
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
        let rows = live?.board ?? []
        let nameSize: CGFloat = rows.count >= 4 ? 11 : rows.count == 3 ? 13 : 15
        let scoreSize: CGFloat = rows.count >= 4 ? 24 : rows.count == 3 ? 30 : 38
        let hyphenSize: CGFloat = rows.count >= 4 ? 14 : rows.count == 3 ? 16 : 20
        let gap: CGFloat = rows.count >= 4 ? 8 : rows.count == 3 ? 12 : 16
        return HStack(spacing: gap) {
            ForEach(Array(rows.enumerated()), id: \.element.userId) { index, row in
                if index > 0 {
                    Text("–")
                        .font(BKFont.headline(hyphenSize))
                        .foregroundStyle(BKTheme.textMuted)
                }
                let isTurn = row.userId == live?.turnUserId && live?.finished != true
                VStack(spacing: 3) {
                    Text(row.isYou ? "YOU" : row.displayName.uppercased())
                        .font(BKFont.caption(nameSize))
                        .tracking(0.7)
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                    Text("\(row.total)")
                        .font(BKFont.title(scoreSize))
                        .contentTransition(.numericText())
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                }
                .foregroundStyle(isTurn ? BKTheme.accent : BKTheme.textPrimary)
                .opacity(isTurn ? 1 : 0.55)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.top, 28)
        .padding(.bottom, 14)
        .animation(.easeOut(duration: 0.25), value: live?.turnUserId)
        .animation(.easeOut(duration: 0.25), value: live?.board.map(\.total))
    }

    private func wireDraft() {
        draft.extraUsedPlayerIds = Set(live?.usedPlayerIds ?? [])
        draft.extraUsedConstraintIds = Set(live?.usedConstraintIds ?? [])
        let model = draft
        model.confirmPick = { [weak model] dto in
            guard let model,
                  let live = viewModel.challenge?.live,
                  let slot = model.activeSlot,
                  let constraint = model.state.constraint(forSlot: slot.id) else { return false }
            if dto.satisfiesConstraint == false {
                model.selectionError = constraint.rejectReason(player: dto.name)
                return false
            }
            let ok = await viewModel.lockPick(slotId: live.slotId, constraintId: constraint.id, playerId: dto.id)
            if ok {
                model.lockConfirmedPick(slotId: slot.id, constraint: constraint, player: dto)
            } else {
                model.selectionError = viewModel.errorMessage ?? "Couldn't lock that pick"
            }
            return ok
        }
        syncPitch()
    }

    private func syncPitch() {
        draft.applyLockedPicks(live?.yourPicks ?? [], preservingSlot: live?.yourTurn == true ? live?.slotId : nil)
    }

    private func open(_ slot: BattleSlot) {
        guard live?.yourTurn == true, slot.id == live?.slotId else { return }
        draft.openSlot(slot)
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

private struct VsDraftMateToast: View {
    let pick: VsLivePickFeedDTO

    var body: some View {
        VStack(spacing: 10) {
            Text("\(pick.displayName.uppercased()) PLAYED")
                .font(BKFont.caption(12)).tracking(0.8)
                .foregroundStyle(BKTheme.accent)

            HStack(alignment: .center, spacing: 12) {
                PlayerAvatar(urlString: pick.headshotUrl, size: 52)
                VStack(alignment: .leading, spacing: 3) {
                    Text(pick.playerName)
                        .font(BKFont.headline(17))
                        .foregroundStyle(BKTheme.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    Text("\(pick.statValue)")
                        .font(BKFont.title(22))
                        .foregroundStyle(BKTheme.textPrimary)
                        .monospacedDigit()
                }
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

private struct VsDraftPicksSheet: View {
    let battle: BattleChallenge
    let live: VsLiveDTO?
    let picksBySlot: [(slot: BattleSlot, rows: [VsLivePickFeedDTO])]
    let turnName: String
    let collapsedHeight: CGFloat
    let expandedHeight: CGFloat
    let safeBottom: CGFloat
    @Binding var expanded: Bool

    @State private var drag: CGFloat = 0
    @State private var now = Date()

    static func collapsedHeight(safeBottom: CGFloat) -> CGFloat {
        94 + safeBottom
    }

    private var sheetHeight: CGFloat {
        let floor = max(collapsedHeight, 1)
        let ceiling = max(expandedHeight, floor)
        let resting = expanded ? ceiling : floor
        let raw = min(ceiling, max(floor, resting - drag))
        return raw.isFinite ? raw : floor
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

    var body: some View {
        VStack(spacing: 0) {
            chrome
            if expanded {
                ScrollView(showsIndicators: true) {
                    VStack(alignment: .leading, spacing: 14) {
                        if picksBySlot.isEmpty {
                            Text(live?.yourTurn == true
                                 ? "Drag a chip onto the highlighted slot, then name a player."
                                 : "Waiting for \(turnName) to pick.")
                                .font(BKFont.body(13))
                                .foregroundStyle(BKTheme.textSecondary)
                        } else {
                            ForEach(picksBySlot, id: \.slot.id) { group in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(group.slot.position.uppercased())
                                        .font(BKFont.caption(10)).tracking(0.8)
                                        .foregroundStyle(BKTheme.textMuted)
                                    ForEach(group.rows) { row in
                                        pickRow(row)
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 12)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.bottom, safeBottom)
        .frame(height: sheetHeight, alignment: .top)
        .frame(maxWidth: .infinity)
        .background(BKTheme.card)
        .clipShape(sheetShape)
        .overlay {
            sheetShape.stroke(BKTheme.cardElevated, lineWidth: 1)
        }
        .contentShape(Rectangle())
        .gesture(dragGesture, including: expanded ? .none : .all)
        .onReceive(Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()) { now = $0 }
    }

    private var chrome: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(BKTheme.textMuted.opacity(0.55))
                .frame(width: 36, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 10)

            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(live?.yourTurn == true ? "YOUR TURN" : "\(turnName.uppercased())'S TURN")
                        .font(BKFont.headline(13)).tracking(0.8)
                        .foregroundStyle(live?.yourTurn == true ? BKTheme.accent : BKTheme.textMuted)
                    Text((live?.slotPosition ?? "—").uppercased())
                        .font(BKFont.title(18))
                        .foregroundStyle(BKTheme.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                Spacer(minLength: 8)
                Text(timerLabel)
                    .font(BKFont.title(22))
                    .foregroundStyle(secondsLeft <= 20 ? BKTheme.wrong : BKTheme.accent)
                    .monospacedDigit()
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 10)

            if !expanded {
                Text("Swipe up to see past picks")
                    .font(BKFont.caption(12)).tracking(0.4)
                    .foregroundStyle(BKTheme.textMuted)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
                    .padding(.bottom, 2)
            }
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .highPriorityGesture(dragGesture, including: expanded ? .gesture : .none)
        .onTapGesture {
            withAnimation(.interactiveSpring(response: 0.28, dampingFraction: 0.9)) {
                expanded.toggle()
            }
        }
    }

    private func pickRow(_ row: VsLivePickFeedDTO) -> some View {
        HStack(spacing: 10) {
            if let constraint = battle.constraints.first(where: { $0.id == row.constraintId }) {
                ConstraintIcon(constraint: constraint, size: 28)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(row.isYou ? "YOU" : row.displayName.uppercased())
                    .font(BKFont.caption(9))
                    .foregroundStyle(BKTheme.textMuted)
                Text("\(row.playerName)  (\(row.statValue))")
                    .font(BKFont.headline(14))
                    .foregroundStyle(BKTheme.textPrimary)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(BKTheme.cardElevated)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 2, coordinateSpace: .global)
            .onChanged { value in
                var transaction = Transaction()
                transaction.animation = nil
                withTransaction(transaction) {
                    drag = value.translation.height
                }
            }
            .onEnded { value in
                let predicted = value.predictedEndTranslation.height
                withAnimation(.interactiveSpring(response: 0.28, dampingFraction: 0.9)) {
                    if expanded {
                        if predicted > 56 { expanded = false }
                    } else if predicted < -56 {
                        expanded = true
                    }
                    drag = 0
                }
            }
    }

    private var secondsLeft: Int {
        guard let live, let deadline = Self.parseDeadline(live.deadlineAt) else { return 0 }
        return max(0, Int(ceil(deadline.timeIntervalSince(now))))
    }

    private var timerLabel: String {
        let total = secondsLeft
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private static func parseDeadline(_ raw: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: raw) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }
}
