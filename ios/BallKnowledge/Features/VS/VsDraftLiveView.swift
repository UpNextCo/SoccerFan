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
    @State private var isFiringPremove = false

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
                                usedIds: stripUsedIds
                            )
                            .padding(.top, 6)
                            ZStack(alignment: .bottom) {
                                BattlePitchView(
                                    slots: battle.slots,
                                    state: draft.state,
                                    highlightedSlotId: draft.premove?.slotId,
                                    interactiveSlotId: nil,
                                    pendingSlotId: draft.premove?.slotId,
                                    pendingPick: draft.premovePick,
                                    compact: true,
                                    slotScale: 0.88,
                                    onTapSlot: { open($0) },
                                    onDropConstraint: { id, slot in
                                        guard !isFilled(slot.id) else { return }
                                        draft.assignConstraint(id: id, toSlot: slot.id)
                                        draft.openSlot(slot)
                                    }
                                )
                                if let msg = draft.wrongMessage {
                                    Text(msg.uppercased())
                                        .font(BKFont.caption(11)).tracking(0.5)
                                        .foregroundStyle(BKTheme.wrong)
                                        .multilineTextAlignment(.center)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 8)
                                        .background(BKTheme.card.opacity(0.92))
                                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                        .padding(.bottom, 8)
                                        .transition(.opacity)
                                }
                            }
                            .frame(maxHeight: .infinity)
                            .padding(.horizontal, 34)
                            .padding(.bottom, collapsedH)
                            .modifier(VsDraftShakeEffect(animatableData: CGFloat(draft.shakeToken)))
                            .animation(.linear(duration: 0.4), value: draft.shakeToken)
                            .animation(.easeInOut(duration: 0.2), value: draft.wrongMessage)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

                        VsDraftPicksSheet(
                            battle: battle,
                            live: live,
                            picksBySlot: picksBySlot,
                            turnName: turnName,
                            premoveName: draft.premove?.player.name,
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
            let used = Set(ids ?? [])
            draft.extraUsedPlayerIds = used
            _ = draft.invalidatePremoveIfTaken(usedPlayerIds: used)
        }
        .onChange(of: live?.usedConstraintIds) { _, ids in
            draft.extraUsedConstraintIds = Set(ids ?? [])
        }
        .onChange(of: live?.yourTurn) { _, yourTurn in
            draft.queuesPremove = yourTurn != true && live?.finished != true
            if yourTurn == true {
                Task { await firePremoveIfNeeded() }
            } else {
                draft.closeSlot()
            }
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
                await firePremoveIfNeeded()
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
        draft.queuesPremove = live?.yourTurn != true && live?.finished != true
        _ = draft.invalidatePremoveIfTaken(usedPlayerIds: Set(live?.usedPlayerIds ?? []))
        let model = draft
        model.confirmPick = { [weak model] dto in
            guard let model,
                  let slot = model.activeSlot,
                  let constraint = model.state.constraint(forSlot: slot.id) else { return false }
            if viewModel.challenge?.live?.yourTurn != true {
                model.setPremove(slotId: slot.id, constraint: constraint, player: dto)
                return true
            }
            return await lockDraftPick(model: model, slotId: slot.id, constraint: constraint, player: dto)
        }
        syncPitch()
        if live?.yourTurn == true {
            Task { await firePremoveIfNeeded() }
        }
    }

    @discardableResult
    private func lockDraftPick(
        model: DraftMasterViewModel,
        slotId: String,
        constraint: BattleConstraint,
        player: BattlePlayerDTO
    ) async -> Bool {
        let ok = await viewModel.lockPick(slotId: slotId, constraintId: constraint.id, playerId: player.id)
        if ok {
            let locked = viewModel.challenge?.live?.yourPicks.last(where: { $0.slotId == slotId })
            let correct = locked?.correct ?? (player.satisfiesConstraint ?? true)
            model.lockConfirmedPick(slotId: slotId, constraint: constraint, player: player, correct: correct)
            if correct {
                HapticManager.success()
            } else {
                let msg = locked?.wrongReason ?? constraint.rejectReason(player: player.name)
                model.flashWrong(msg)
            }
        } else {
            model.selectionError = viewModel.errorMessage ?? "Couldn't lock that pick"
        }
        return ok
    }

    private func firePremoveIfNeeded() async {
        guard !isFiringPremove,
              live?.yourTurn == true,
              live?.finished != true,
              let pre = draft.premove else { return }
        isFiringPremove = true
        defer { isFiringPremove = false }
        let used = Set(live?.usedPlayerIds ?? [])
        if used.contains(pre.player.id) {
            draft.clearPremove()
            draft.flashWrong("Premove cancelled — player taken")
            return
        }
        if isFilled(pre.slotId) {
            draft.clearPremove()
            return
        }
        draft.closeSlot()
        let ok = await lockDraftPick(
            model: draft,
            slotId: pre.slotId,
            constraint: pre.constraint,
            player: pre.player
        )
        if ok {
            draft.premove = nil
        } else {
            let msg = viewModel.errorMessage ?? ""
            if msg.localizedCaseInsensitiveContains("your turn") { return }
            draft.clearPremove()
            draft.flashWrong(
                msg.localizedCaseInsensitiveContains("already named")
                    ? "Premove cancelled — player taken"
                    : (msg.isEmpty ? "Premove cancelled" : msg)
            )
        }
    }

    private var stripUsedIds: Set<String> {
        var ids = Set(live?.usedConstraintIds ?? []).union(draft.state.usedConstraintIds)
        if let chipId = draft.premove?.constraint.id { ids.remove(chipId) }
        return ids
    }

    private func syncPitch() {
        draft.applyLockedPicks(
            live?.yourPicks ?? [],
            preservingSlot: draft.activeSlot?.id ?? draft.premove?.slotId
        )
    }

    private func isFilled(_ slotId: String) -> Bool {
        live?.yourPicks.contains(where: { $0.slotId == slotId }) == true
            || draft.state.isLocked(slotId)
    }

    private func open(_ slot: BattleSlot) {
        guard !isFilled(slot.id) else { return }
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
            Text(pick.correct ? "\(pick.displayName.uppercased()) PLAYED" : "\(pick.displayName.uppercased()) BURNED")
                .font(BKFont.caption(12)).tracking(0.8)
                .foregroundStyle(pick.correct ? BKTheme.accent : BKTheme.wrong)

            HStack(alignment: .center, spacing: 12) {
                PlayerAvatar(urlString: pick.headshotUrl, size: 52)
                VStack(alignment: .leading, spacing: 3) {
                    Text(pick.playerName)
                        .font(BKFont.headline(17))
                        .foregroundStyle(pick.correct ? BKTheme.textPrimary : BKTheme.wrong)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    Text("\(pick.statValue)")
                        .font(BKFont.title(22))
                        .foregroundStyle(pick.correct ? BKTheme.textPrimary : BKTheme.wrong)
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
    var premoveName: String? = nil
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
                                 ? "Drag a chip onto any empty slot, then name a player."
                                 : (premoveName != nil
                                    ? "Premove set — it plays when it's your turn."
                                    : "Waiting for \(turnName). You can set a premove now."))
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
                    Text(live?.yourTurn == true
                         ? "ANY POSITION"
                         : (premoveName != nil ? "PREMOVE READY" : "WAITING"))
                        .font(BKFont.title(18))
                        .foregroundStyle(BKTheme.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    if let premoveName, live?.yourTurn != true {
                        Text(premoveName.uppercased())
                            .font(BKFont.caption(11)).tracking(0.4)
                            .foregroundStyle(BKTheme.accent)
                            .lineLimit(1)
                    }
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
                    .foregroundStyle(row.correct ? BKTheme.textPrimary : BKTheme.wrong)
                    .lineLimit(1)
                if !row.correct, let reason = row.wrongReason, !reason.isEmpty {
                    Text(reason)
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.wrong)
                        .lineLimit(2)
                }
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

private struct VsDraftShakeEffect: GeometryEffect {
    var animatableData: CGFloat
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 7 * sin(animatableData * .pi * 4), y: 0))
    }
}
