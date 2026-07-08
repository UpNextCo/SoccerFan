import SwiftUI
import SwiftData

// MARK: - ViewModel

@Observable
final class DraftMasterViewModel {
    var state: BattleGameState
    var activeSlot: BattleSlot?
    var searchQuery = ""
    var results: [BattlePlayerDTO] = []
    var isSearching = false
    var selectionError: String?
    var showResult = false
    var showShare = false
    var confettiBurstToken = 0
    var shakeToken = 0
    var wrongMessage: String?
    /// Fires a +XP pop on the pitch when a correct pick bumps running XP.
    var draftXpPopTrigger = 0
    var lastDraftXpPop = 0

    init(challenge: BattleChallenge) {
        state = BattleGameState(challenge: challenge)
    }

    var challenge: BattleChallenge { state.challenge }
    var category: BattleCategory { state.challenge.category }

    /// Mid-build and worth saving: started assigning clubs or picking players.
    var isResumable: Bool {
        state.phase == .building && (!state.picks.isEmpty || !state.assignments.isEmpty)
    }

    func restore(_ saved: BattleGameState) {
        state = saved
        searchQuery = ""
        results = []
        activeSlot = nil
        selectionError = nil
        showResult = false
        showShare = false
    }

    func start() { HapticManager.light(); state.phase = .building }

    func restart() {
        state = BattleGameState(challenge: state.challenge)
        state.phase = .building
        resetTransient()
    }

    private func resetTransient() {
        searchQuery = ""; results = []; activeSlot = nil; selectionError = nil
        showResult = false; showShare = false; confettiBurstToken = 0
    }

    // MARK: Constraint assignment (one chip per slot)

    var unusedConstraints: [BattleConstraint] { challenge.constraints.filter { !state.usedConstraintIds.contains($0.id) } }

    func assignConstraint(id: String, toSlot slotId: String) {
        guard let constraint = challenge.constraints.first(where: { $0.id == id }) else { return }
        assignConstraint(constraint, toSlot: slotId)
    }

    func assignConstraint(_ constraint: BattleConstraint, toSlot slotId: String) {
        // Locked slots are final — can't drop onto them, and a chip burned on a locked slot
        // can't be moved/reused elsewhere.
        if state.isLocked(slotId) { return }
        if state.assignments.contains(where: { $0.value.id == constraint.id && state.isLocked($0.key) }) { return }
        // A chip can only sit on one slot: pull it off any other (unlocked) slot first.
        for (sid, c) in state.assignments where c.id == constraint.id && sid != slotId {
            state.assignments[sid] = nil
            state.picks[sid] = nil
        }
        if state.assignments[slotId]?.id != constraint.id { state.picks[slotId] = nil }
        state.assignments[slotId] = constraint
        HapticManager.light()
    }

    // MARK: Slot / search

    func openSlot(_ slot: BattleSlot) {
        if state.isLocked(slot.id) { return } // wrong pick is final
        activeSlot = slot
        searchQuery = ""
        results = []
        selectionError = nil
    }

    func closeSlot() { activeSlot = nil; searchQuery = ""; results = [] }

    func setActiveSlotConstraint(_ constraint: BattleConstraint) {
        guard let slot = activeSlot else { return }
        assignConstraint(constraint, toSlot: slot.id)
        searchQuery = ""
        results = []
        selectionError = nil
    }

    func removePick(_ slotId: String) { state.picks[slotId] = nil; HapticManager.light() }

    func clearSlot(_ slotId: String) {
        state.picks[slotId] = nil
        state.assignments[slotId] = nil
        HapticManager.light()
    }

    func search() async {
        guard let slot = activeSlot, let constraint = state.constraint(forSlot: slot.id) else { results = []; return }
        let q = searchQuery.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { results = []; return }
        isSearching = true
        defer { isSearching = false }
        do {
            let res = try await APIClient.shared.battlePlayers(
                categoryId: category.id, constraint: constraint, position: slot.position, query: q
            )
            let used = state.usedPlayerIds
            let currentId = state.pick(forSlot: slot.id)?.player.id
            results = res.filter { !used.contains($0.id) || $0.id == currentId }
        } catch {
            results = []
        }
    }

    func selectPlayer(_ dto: BattlePlayerDTO) {
        guard let slot = activeSlot, let constraint = state.constraint(forSlot: slot.id) else { return }
        if state.usedPlayerIds.contains(dto.id), state.pick(forSlot: slot.id)?.player.id != dto.id {
            selectionError = "Already in your XI"
            HapticManager.error()
            return
        }
        let player = BattlePlayer(id: dto.id, name: dto.name, statValue: dto.statValue, headshotUrl: dto.headshotUrl)
        let correct = dto.satisfiesConstraint ?? true
        let priorXP = DailyXP.draft(total: state.yourTotal, optimal: challenge.optimalScore)
        state.picks[slot.id] = BattlePick(constraint: constraint, player: player, correct: correct)
        selectionError = nil
        closeSlot()
        if correct {
            HapticManager.success()
            let newXP = DailyXP.draft(total: state.yourTotal, optimal: challenge.optimalScore)
            lastDraftXpPop = max(0, newXP - priorXP)
            if lastDraftXpPop > 0 { draftXpPopTrigger += 1 }
        } else {
            // Doesn't fit the chip: place it red/0, shake the pitch, and surface the reason.
            HapticManager.error()
            shakeToken += 1
            let msg = constraint.rejectReason(player: dto.name)
            wrongMessage = msg
            Task {
                try? await Task.sleep(for: .seconds(2.6))
                if wrongMessage == msg { wrongMessage = nil }
            }
        }
        if state.isComplete { submit() }
    }

    // MARK: Submit

    func submit() {
        guard state.isComplete, state.phase != .complete else { return }
        let result = BattleResult(yourTotal: state.yourTotal, optimalScore: challenge.optimalScore)
        state.result = result
        state.phase = .complete
        if result.percentage >= BattleTiming.confettiThreshold { confettiBurstToken += 1 }
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

    init(dailyDate: String? = nil, challenge: BattleChallenge, allowReplay: Bool = false, onComplete: @escaping () -> Void) {
        _viewModel = State(initialValue: DraftMasterViewModel(challenge: challenge))
        self.allowReplay = allowReplay
        self.dailyDate = dailyDate
        self.onComplete = onComplete
    }

    var body: some View {
        ZStack {
            NavigationStack {
                ZStack {
                    buildScreen

                    if viewModel.state.phase == .intro {
                        BattleCategoryOverlay(
                            challenge: viewModel.challenge,
                            onStart: viewModel.start
                        )
                        .transition(.opacity)
                    }
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
                        Text("DRAFT XI")
                            .font(BKFont.caption(13)).tracking(1).foregroundStyle(BKTheme.accent)
                    }
                }
            }

            FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                .zIndex(999)
        }
        .animation(.spring(response: 0.38, dampingFraction: 0.82), value: viewModel.state.phase)
        .persistsGameProgress(
            viewModel.state,
            isResumable: viewModel.isResumable,
            modeId: GameModeID.draftMaster.rawValue,
            date: dailyDate,
            version: BattleGameState.progressVersion,
            enabled: !allowReplay
        )
        .onAppear {
            guard !allowReplay, let dailyDate,
                  let saved = GameProgressStore.load(
                    BattleGameState.self, modeId: GameModeID.draftMaster.rawValue,
                    date: dailyDate, version: BattleGameState.progressVersion, context: modelContext) else { return }
            viewModel.restore(saved)
            if viewModel.state.isComplete, viewModel.state.phase == .building {
                viewModel.submit()
            }
        }
        .sheet(item: Binding(get: { viewModel.activeSlot }, set: { if $0 == nil { viewModel.closeSlot() } })) { slot in
            BattleSearchSheet(viewModel: viewModel, slot: slot)
        }
        .fullScreenCover(isPresented: $viewModel.showResult) {
            if let result = viewModel.state.result {
                BattleResultView(
                    state: viewModel.state,
                    result: result,
                    onShare: { viewModel.showShare = true },
                    onHome: {
                        if !allowReplay, let dailyDate {
                            Task {
                                await DailyCompletionService.recordCompletion(
                                    modeId: GameModeID.draftMaster.rawValue,
                                    date: dailyDate,
                                    score: result.xp,
                                    won: result.percentage >= 70,
                                    answer: viewModel.state.answerPayload(),
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
                BattleShareSheet(challenge: viewModel.challenge, result: result)
            }
        }
    }

    private var buildScreen: some View {
        VStack(spacing: 0) {
            BattleBuildHeader(category: viewModel.category, total: viewModel.state.yourTotal)

            BattleConstraintsStrip(
                constraints: viewModel.challenge.constraints,
                usedIds: viewModel.state.usedConstraintIds
            )

            BattlePitchView(
                slots: viewModel.challenge.slots,
                state: viewModel.state,
                onTapSlot: { viewModel.openSlot($0) },
                onDropConstraint: { id, slot in viewModel.assignConstraint(id: id, toSlot: slot.id); viewModel.openSlot(slot) }
            )
            .xpPop(
                amount: viewModel.lastDraftXpPop,
                trigger: viewModel.draftXpPopTrigger,
                alignment: .center
            )
            .frame(maxHeight: .infinity)
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 8)
            .modifier(ShakeEffect(animatableData: CGFloat(viewModel.shakeToken)))
            .animation(.linear(duration: 0.4), value: viewModel.shakeToken)

            if let msg = viewModel.wrongMessage {
                Text(msg.uppercased())
                    .font(BKFont.caption(11)).tracking(0.5)
                    .foregroundStyle(BKTheme.wrong)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16).padding(.bottom, 12)
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: viewModel.wrongMessage)
    }
}

/// Horizontal shake for a wrong pick (matches the other games' wrong-answer feel).
private struct ShakeEffect: GeometryEffect {
    var animatableData: CGFloat
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 7 * sin(animatableData * .pi * 4), y: 0))
    }
}

// MARK: - Category overlay

private struct BattleCategoryOverlay: View {
    let challenge: BattleChallenge
    var onStart: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.9)
                .ignoresSafeArea()

            VStack(spacing: 20) {
                VStack(spacing: 8) {
                    Text("TODAY'S CATEGORY")
                        .font(BKFont.caption(11)).tracking(1.2).foregroundStyle(BKTheme.accent)
                    Text(challenge.category.title)
                        .font(BKFont.title(26)).foregroundStyle(BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                }

                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 14) {
                    ForEach(challenge.constraints) { constraint in
                        VStack(spacing: 5) {
                            ConstraintIcon(constraint: constraint, size: 38)
                            Text(constraint.label.uppercased())
                                .font(.system(size: 8, weight: .bold, design: .rounded))
                                .foregroundStyle(BKTheme.textMuted)
                                .lineLimit(1).minimumScaleFactor(0.6)
                        }
                    }
                }

                Button(action: onStart) {
                    HStack(spacing: 8) {
                        Text("BUILD YOUR XI").font(BKFont.headline(15))
                        Ph.arrowRight.bold.color(BKTheme.background).frame(width: 14, height: 14)
                    }
                    .foregroundStyle(BKTheme.background)
                    .frame(maxWidth: .infinity).padding(.vertical, 16)
                    .background(BKTheme.accent).clipShape(Capsule())
                }
            }
            .padding(20)
            .background(BKTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .padding(.horizontal, 24)
        }
    }
}

// MARK: - Build header

/// Animates an integer rolling up/down when the value changes inside an animation transaction.
private struct CountingNumber: AnimatableModifier {
    var value: Double
    var animatableData: Double {
        get { value }
        set { value = newValue }
    }
    func body(content: Content) -> some View {
        Text("\(Int(value.rounded()))")
    }
}

private struct BattleBuildHeader: View {
    let category: BattleCategory
    let total: Int

    var body: some View {
        VStack(spacing: 2) {
            Text(category.title.uppercased())
                .font(BKFont.headline(14)).tracking(1)
                .foregroundStyle(BKTheme.textSecondary)
                .lineLimit(1).minimumScaleFactor(0.7)
            Text("")
                .modifier(CountingNumber(value: Double(total)))
                .font(BKFont.title(44)).foregroundStyle(BKTheme.accent)
                .animation(.easeOut(duration: 0.5), value: total)
        }
        .frame(maxWidth: .infinity)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 4)
    }
}

// MARK: - Constraints strip

private struct BattleConstraintsStrip: View {
    let constraints: [BattleConstraint]
    let usedIds: Set<String>

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 10) {
                    ForEach(constraints) { constraint in
                        let used = usedIds.contains(constraint.id)
                        ConstraintChip(constraint: constraint, used: used)
                            .draggable(constraint.id) {
                                ConstraintIcon(constraint: constraint, size: 44)
                            }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
        }
        .padding(.vertical, 8)
    }
}

private struct ConstraintChip: View {
    let constraint: BattleConstraint
    let used: Bool

    var body: some View {
        VStack(spacing: 4) {
            ConstraintIcon(constraint: constraint, size: 40)
            Text(constraint.label.uppercased())
                .font(.system(size: 8, weight: .bold, design: .rounded))
                .foregroundStyle(BKTheme.textMuted)
                .lineLimit(2)
                .minimumScaleFactor(0.6)
                .multilineTextAlignment(.center)
                .frame(width: 60, height: 22, alignment: .top)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
        .frame(width: 68, height: 82)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .topTrailing) {
            if used {
                Ph.checkCircle.fill.color(BKTheme.accent).frame(width: 12, height: 12).padding(3)
            }
        }
        .opacity(used ? 0.45 : 1)
    }
}

/// Renders a constraint chip's icon by type: club/nat_club → crest, league/nat_league → league badge,
/// nationality → flag. Combos overlay a small nationality flag on the crest/league badge.
struct ConstraintIcon: View {
    let constraint: BattleConstraint
    var size: CGFloat = 40

    var body: some View {
        Group {
            switch constraint.type {
            case .club:
                crest
            case .league:
                leagueBadge
            case .nationality:
                flagCircle
            case .nat_league:
                leagueBadge.overlay(alignment: .bottomTrailing) { flagBadge }
            case .nat_club:
                crest.overlay(alignment: .bottomTrailing) { flagBadge }
            }
        }
        .frame(width: size, height: size)
    }

    private var crest: some View {
        TeamBadgeImage(
            club: constraint.club ?? "",
            league: constraint.leagueName ?? "",
            teamId: constraint.teamId,
            logoURL: constraint.logoUrl.flatMap(URL.init(string:)),
            size: size
        ) {
            Circle().fill(BKTheme.cardElevated).frame(width: size, height: size)
                .overlay(
                    Text(GuessWhoDisplay.clubAbbrev(constraint.club ?? ""))
                        .font(.system(size: size * 0.3, weight: .bold, design: .rounded))
                        .foregroundStyle(BKTheme.textMuted)
                )
        }
    }

    private var leagueBadge: some View {
        LeagueBadgeImage(league: constraint.leagueName ?? "", size: size, lightBackdrop: true) {
            Circle().fill(BKTheme.cardElevated).frame(width: size, height: size)
                .overlay(
                    Text(GuessWhoDisplay.leagueAbbrev(constraint.leagueName ?? ""))
                        .font(.system(size: size * 0.28, weight: .bold, design: .rounded))
                        .foregroundStyle(BKTheme.textMuted)
                )
        }
    }

    private var flagCircle: some View {
        Text(GuessWhoDisplay.nationalityFlag(constraint.nationality ?? ""))
            .font(.system(size: size))
            .frame(width: size, height: size)
    }

    private var flagBadge: some View {
        Text(GuessWhoDisplay.nationalityFlag(constraint.nationality ?? ""))
            .font(.system(size: size * 0.48))
            .offset(x: size * 0.05, y: size * 0.05)
    }
}

// MARK: - Pitch

private struct BattlePitchView: View {
    let slots: [BattleSlot]
    let state: BattleGameState
    var onTapSlot: (BattleSlot) -> Void
    var onDropConstraint: (String, BattleSlot) -> Void

    var body: some View {
        GeometryReader { geo in
            let verticalInset: CGFloat = 14
            let usableHeight = max(0, geo.size.height - verticalInset * 2)
            ZStack {
                PitchBackground()
                ForEach(slots) { slot in
                    BattlePitchSlot(
                        slot: slot,
                        constraint: state.constraint(forSlot: slot.id),
                        pick: state.pick(forSlot: slot.id),
                        onTap: { onTapSlot(slot) },
                        onDrop: { id in onDropConstraint(id, slot) }
                    )
                    .position(
                        x: slot.point.x * geo.size.width,
                        y: verticalInset + slot.point.y * usableHeight
                    )
                }
            }
        }
    }
}

private struct BattlePitchSlot: View {
    let slot: BattleSlot
    let constraint: BattleConstraint?
    let pick: BattlePick?
    var onTap: () -> Void
    var onDrop: (String) -> Void

    @State private var targeted = false

    /// Soft whitish-green for empty slot rings + the plus.
    private static let ringColor = Color(red: 0.80, green: 0.93, blue: 0.84).opacity(0.85)

    private var strokeColor: Color {
        if targeted { return BKTheme.accent }
        if let pick { return pick.correct ? BKTheme.accent : BKTheme.wrong }
        return Self.ringColor
    }

    var body: some View {
        VStack(spacing: 3) {
            ZStack {
                Circle()
                    // Darker-grey fill so slots sit clearly on the grass; thin whitish-green ring.
                    .fill(pick != nil ? Color.black.opacity(0.30) : Color(white: 0.14).opacity(0.72))
                    .frame(width: 46, height: 46)
                    .overlay(
                        Circle().stroke(strokeColor, lineWidth: targeted ? 2.5 : 1.1)
                    )
                if let pick {
                    PlayerAvatar(urlString: pick.player.headshotUrl, size: 42)
                        .grayscale(pick.correct ? 0 : 0.85)
                        .opacity(pick.correct ? 1 : 0.55)
                } else if let constraint {
                    ConstraintIcon(constraint: constraint, size: 34)
                } else {
                    Text("+").font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(Self.ringColor)
                }
            }
            Text(slot.label)
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(Color.white.opacity(0.95))
            if let pick {
                Text(shortName(pick.player.name))
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundStyle(pick.correct ? .white : BKTheme.wrong)
                    .lineLimit(1).frame(maxWidth: 70)
                Text(pick.correct ? "\(pick.player.statValue)" : "0")
                    .font(.system(size: 9, weight: .heavy, design: .rounded))
                    .foregroundStyle(pick.correct ? .white : BKTheme.wrong)
            } else if constraint != nil {
                Text("TAP TO PICK")
                    .font(.system(size: 7, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.white.opacity(0.7))
            }
        }
        .shadow(color: .black.opacity(0.55), radius: 2, x: 0, y: 1)
        .frame(width: 76)
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
        .dropDestination(for: String.self) { items, _ in
            guard let name = items.first else { return false }
            onDrop(name)
            return true
        } isTargeted: { targeted = $0 }
    }

    private func shortName(_ name: String) -> String {
        name.split(separator: " ").last.map(String.init) ?? name
    }
}

// MARK: - Pitch background (shared by Battle Mode + World Cup XI)

/// A drawn top-down pitch: deep, slightly desaturated mown stripes + full markings, so it reads as
/// real turf while staying dark enough for headshots/badges to pop. Resolution-independent (scales
/// with the flexible pitch frame), so the markings always line up with the fraction-positioned slots.
/// Lives here (an in-target file) so both pitch games can share it without a separate compile unit.
struct PitchBackground: View {
    private let grassA = Color(red: 0.11, green: 0.26, blue: 0.16)
    private let grassB = Color(red: 0.14, green: 0.31, blue: 0.19)
    private let line = Color.white.opacity(0.32)

    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            let lw: CGFloat = 1.4

            // Mown stripes (parallel to the goal lines).
            let stripes = 7
            let band = h / CGFloat(stripes)
            for i in 0..<stripes {
                var p = Path(); p.addRect(CGRect(x: 0, y: band * CGFloat(i), width: w, height: band + 1))
                ctx.fill(p, with: .color(i.isMultiple(of: 2) ? grassA : grassB))
            }

            func stroke(_ p: Path) { ctx.stroke(p, with: .color(line), lineWidth: lw) }
            func rect(_ r: CGRect) -> Path { var p = Path(); p.addRect(r); return p }
            func dot(_ c: CGPoint, _ r: CGFloat = 2) {
                ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(line))
            }

            let inset: CGFloat = 9
            let field = CGRect(x: inset, y: inset, width: w - inset * 2, height: h - inset * 2)
            stroke(rect(field))

            // Halfway line + centre circle + spot.
            var mid = Path(); mid.move(to: CGPoint(x: field.minX, y: field.midY)); mid.addLine(to: CGPoint(x: field.maxX, y: field.midY)); stroke(mid)
            let cr = w * 0.13
            stroke(Path(ellipseIn: CGRect(x: field.midX - cr, y: field.midY - cr, width: cr * 2, height: cr * 2)))
            dot(CGPoint(x: field.midX, y: field.midY))

            // Penalty + six-yard boxes, spots and arcs, top and bottom.
            let pbW = field.width * 0.58, pbH = field.height * 0.15
            let gbW = field.width * 0.30, gbH = field.height * 0.065
            // Regulation proportions (m): spot 11 from goal line, area 16.5 deep, arc radius 9.15.
            let spotDepthRatio = 11.0 / 16.5
            let arcRadiusRatio = 9.15 / 16.5
            // 3-sided box (open along the goal line, so we don't redraw the boundary there).
            func openBox(width bw: CGFloat, depth: CGFloat, top: Bool) {
                let edge = top ? field.minY : field.maxY
                let inner = top ? edge + depth : edge - depth
                let x0 = field.midX - bw / 2, x1 = field.midX + bw / 2
                var p = Path()
                p.move(to: CGPoint(x: x0, y: edge))
                p.addLine(to: CGPoint(x: x0, y: inner))
                p.addLine(to: CGPoint(x: x1, y: inner))
                p.addLine(to: CGPoint(x: x1, y: edge))
                stroke(p)
            }
            for top in [true, false] {
                let edge = top ? field.minY : field.maxY
                let dir: CGFloat = top ? 1 : -1
                openBox(width: pbW, depth: pbH, top: top)
                openBox(width: gbW, depth: gbH, top: top)
                let inner = edge + dir * pbH
                let spot = CGPoint(x: field.midX, y: edge + dir * pbH * spotDepthRatio)
                dot(spot)
                let r = pbH * arcRadiusRatio - lw / 2
                let dy = abs(inner - spot.y)
                guard dy < r else { continue }
                let dx = sqrt(r * r - dy * dy)
                let left = CGPoint(x: field.midX - dx, y: inner)
                let right = CGPoint(x: field.midX + dx, y: inner)
                let start = Angle(radians: atan2(left.y - spot.y, left.x - spot.x))
                let end = Angle(radians: atan2(right.y - spot.y, right.x - spot.x))
                var a = Path()
                // Top goal: end angle < start, so clockwise draws the outward (field-side) arc.
                // Bottom goal: end > start, so counter-clockwise draws the outward arc.
                a.addArc(center: spot, radius: r, startAngle: start, endAngle: end, clockwise: top)
                stroke(a)
            }

            // Corner arcs.
            let ca = w * 0.035
            let corners: [(CGPoint, Double, Double)] = [
                (CGPoint(x: field.minX, y: field.minY), 0, 90),
                (CGPoint(x: field.maxX, y: field.minY), 90, 180),
                (CGPoint(x: field.maxX, y: field.maxY), 180, 270),
                (CGPoint(x: field.minX, y: field.maxY), 270, 360),
            ]
            for (c, s, e) in corners {
                var p = Path(); p.addArc(center: c, radius: ca, startAngle: .degrees(s), endAngle: .degrees(e), clockwise: false); stroke(p)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .fill(RadialGradient(colors: [.clear, .black.opacity(0.28)], center: .center, startRadius: 10, endRadius: 320))
        )
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(0.08), lineWidth: 1))
    }
}

// MARK: - Search sheet

private struct BattleSearchSheet: View {
    @Bindable var viewModel: DraftMasterViewModel
    let slot: BattleSlot
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss

    private var assignedConstraint: BattleConstraint? { viewModel.state.constraint(forSlot: slot.id) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(slot.position.uppercased())")
                            .font(BKFont.caption(10)).foregroundStyle(BKTheme.textMuted)
                        Text(assignedConstraint?.label.uppercased() ?? "CHOOSE A CHIP")
                            .font(BKFont.headline(16)).foregroundStyle(BKTheme.accent)
                    }
                    Spacer()
                    if viewModel.state.pick(forSlot: slot.id) != nil {
                        Button {
                            viewModel.removePick(slot.id)
                            dismiss()
                        } label: {
                            Text("REMOVE").font(BKFont.caption(10)).foregroundStyle(BKTheme.wrong)
                        }
                    }
                }
                .padding(.horizontal, 16)

                // Chip chooser (unused chips + the one already on this slot)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(constraintChoices) { constraint in
                            let selected = assignedConstraint?.id == constraint.id
                            Button {
                                viewModel.setActiveSlotConstraint(constraint)
                                focused = true
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
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                }

                if assignedConstraint != nil {
                    HStack(spacing: 12) {
                        TextField("", text: $viewModel.searchQuery, prompt:
                            Text("SEARCH \(slot.position.uppercased())S").foregroundStyle(BKTheme.textMuted)
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
                        if viewModel.isSearching { ProgressView().tint(BKTheme.textMuted) }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 14)
                    .background(Color.white).clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(BKTheme.accent.opacity(0.35), lineWidth: 1.5))
                    .padding(.horizontal, 16)
                }

                if let error = viewModel.selectionError {
                    Text(error.uppercased()).font(BKFont.caption(10)).foregroundStyle(BKTheme.wrong)
                }

                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(viewModel.results) { player in
                            resultRow(player)
                            if player.id != viewModel.results.last?.id {
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
        .onAppear { if assignedConstraint != nil { focused = true } }
    }

    private var constraintChoices: [BattleConstraint] {
        var list = viewModel.unusedConstraints
        if let assignedConstraint, !list.contains(where: { $0.id == assignedConstraint.id }) {
            list.insert(assignedConstraint, at: 0)
        }
        return list
    }

    private func resultRow(_ player: BattlePlayerDTO) -> some View {
        Button {
            focused = false
            viewModel.selectPlayer(player)
        } label: {
            HStack(spacing: 12) {
                PlayerAvatar(urlString: player.headshotUrl, size: 32)
                Text(player.name.uppercased())
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(BKTheme.textPrimary)
                Spacer(minLength: 0)
                // Show the flag, not the stat — players shouldn't see the value before they pick.
                Text(GuessWhoDisplay.nationalityFlag(player.nationality ?? ""))
                    .font(.system(size: 20))
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
        }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ")
        let first = parts.first?.first.map(String.init) ?? ""
        let last = parts.count > 1 ? (parts.last?.first.map(String.init) ?? "") : ""
        return (first + last).uppercased()
    }
}

// MARK: - Result

private struct BattleResultView: View {
    let state: BattleGameState
    let result: BattleResult
    var onShare: () -> Void
    var onHome: () -> Void

    @State private var revealStep = 0

    private var challenge: BattleChallenge { state.challenge }

    var body: some View {
        GameResultScreen(onExit: onHome) {
            VStack(spacing: 20) {
                VStack(spacing: 6) {
                    Text(challenge.category.title.uppercased())
                        .font(BKFont.caption(11)).tracking(1).foregroundStyle(BKTheme.textMuted)
                    Text(result.verdict)
                        .font(BKFont.title(32)).foregroundStyle(BKTheme.accent)
                }
                .padding(.top, 24)

                if revealStep >= 1 {
                    VStack(spacing: 10) {
                        VStack(spacing: 4) {
                            Text("\(result.percentage)%")
                                .font(BKFont.title(56)).foregroundStyle(BKTheme.accent)
                                .contentTransition(.numericText())
                            Text("OF THE PERFECT XI")
                                .font(BKFont.caption(10)).tracking(1).foregroundStyle(BKTheme.textMuted)
                        }
                        XPResultSummary(earned: result.xp, max: DailyXP.maxXP(.draftMaster))
                    }
                    .transition(.scale.combined(with: .opacity))
                }

                if revealStep >= 2 {
                    HStack(spacing: 18) {
                        totalSide(label: "YOUR XI", value: result.yourTotal, accent: true)
                        Text("/").font(BKFont.title(28)).foregroundStyle(BKTheme.textMuted)
                        totalSide(label: "OPTIMAL", value: result.optimalScore, accent: false)
                    }
                    .transition(.opacity)
                }

                if revealStep >= 3 {
                    VStack(spacing: 14) {
                        xiCard(title: "YOUR XI", total: result.yourTotal, rows: yourRows)
                        if !optimalRows.isEmpty {
                            xiCard(title: "PERFECT XI", total: result.optimalScore, rows: optimalRows)
                        }
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                Button(action: onShare) {
                    Text("SHARE RESULT").font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.textPrimary)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(BKTheme.card).clipShape(Capsule())
                }
                .padding(.top, 8)
            }
            .padding(.horizontal, 16)
        }
        .task {
            for step in 1...3 {
                try? await Task.sleep(for: .seconds(0.42))
                withAnimation(.spring(response: 0.42, dampingFraction: 0.78)) { revealStep = step }
                HapticManager.light()
            }
        }
    }

    private func totalSide(label: String, value: Int, accent: Bool) -> some View {
        VStack(spacing: 4) {
            Text("\(value)")
                .font(BKFont.title(40))
                .foregroundStyle(accent ? BKTheme.accent : BKTheme.textPrimary)
            Text(label).font(BKFont.caption(10)).foregroundStyle(BKTheme.textMuted)
        }
    }

    // A row to render: position label, chip icon, player name, stat.
    private struct XIRow: Identifiable {
        let id: String
        let label: String
        let constraint: BattleConstraint
        let name: String
        let stat: Int
    }

    private func fallbackConstraint(id: String, label: String) -> BattleConstraint {
        BattleConstraint(id: id, type: .league, label: label, club: nil, teamId: nil, logoUrl: nil,
                         leagueId: nil, leagueName: label, nationality: nil)
    }

    private var yourRows: [XIRow] {
        challenge.slots.compactMap { slot in
            guard let pick = state.pick(forSlot: slot.id) else { return nil }
            return XIRow(id: slot.id, label: slot.label, constraint: pick.constraint, name: pick.player.name, stat: pick.score)
        }
    }

    private var optimalRows: [XIRow] {
        challenge.optimalLineup.map { o in
            let label = challenge.slots.first { $0.id == o.slotId }?.label ?? BattleFormations.shortLabel(o.position)
            let constraint = challenge.constraints.first { $0.id == o.constraintId }
                ?? fallbackConstraint(id: o.constraintId, label: o.constraintLabel)
            return XIRow(id: o.slotId, label: label, constraint: constraint, name: o.playerName, stat: o.statValue)
        }
    }

    private func xiCard(title: String, total: Int, rows: [XIRow]) -> some View {
        VStack(spacing: 8) {
            HStack {
                Text(title).font(BKFont.caption(10)).tracking(1).foregroundStyle(BKTheme.textMuted)
                Spacer()
                Text("\(total) \(challenge.category.noun)")
                    .font(.system(size: 13, weight: .heavy, design: .rounded)).foregroundStyle(BKTheme.accent)
            }
            ForEach(rows) { row in
                HStack(spacing: 10) {
                    Text(row.label)
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(BKTheme.textMuted).frame(width: 30, alignment: .leading)
                    ConstraintIcon(constraint: row.constraint, size: 20)
                    Text(row.name)
                        .font(BKFont.body(13)).foregroundStyle(BKTheme.textPrimary).lineLimit(1)
                    Spacer(minLength: 0)
                    Text("\(row.stat)")
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundStyle(BKTheme.accent)
                }
            }
        }
        .padding(14)
        .background(BKTheme.card).clipShape(RoundedRectangle(cornerRadius: 14))
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
                    Text(challenge.category.title.uppercased())
                        .font(BKFont.headline(15)).foregroundStyle(BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                    Text("\(result.percentage)%")
                        .font(BKFont.title(34)).foregroundStyle(BKTheme.accent)
                    Text("\(result.yourTotal) / \(result.optimalScore) \(challenge.category.noun)")
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
