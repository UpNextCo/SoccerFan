import SwiftUI
import SwiftData

@MainActor
@Observable
final class HomeViewModel {
    var dailyBundle: DailyBundleDTO?
    var gameModes: [GameModeMetaDTO] = []
    var isLoading = false
    var errorMessage: String?

    func load(context: ModelContext) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            dailyBundle = try await APIClient.shared.dailyToday()
            if let bundle = dailyBundle {
                try OfflineCache.saveDailyBundle(bundle, context: context)
            }
            let apiModes = try await APIClient.shared.gameModes()
            gameModes = GameModeCatalog.resolve(from: apiModes)
        } catch {
            let today = ISO8601DateFormatter().string(from: Date()).prefix(10)
            if let cached = try? OfflineCache.loadDailyBundle(date: String(today), context: context) {
                dailyBundle = cached
            }
            if gameModes.isEmpty {
                gameModes = GameModeCatalog.resolve(from: nil)
            }
            errorMessage = error.localizedDescription
        }

        await OfflineCache.syncPendingCompletions(context: context)
    }
}

struct HomeView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel = HomeViewModel()
    @State private var presentedMode: GameModeID?
    @State private var isSequentialDaily = false
    @State private var showAlreadyPlayedAlert = false
    @State private var alreadyPlayedTitle = ""
    @Binding var selectedTab: AppTab

    private var allowsUnlimitedDailyPlay: Bool { auth.allowsUnlimitedDailyPlay }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                HomeHeaderView(
                    user: auth.user,
                    streak: auth.user?.streak ?? 0,
                    onLeagues: { selectedTab = .leagues }
                )

                if viewModel.dailyBundle != nil || !viewModel.gameModes.isEmpty {
                    DailySection(
                        modes: viewModel.gameModes,
                        bundle: viewModel.dailyBundle,
                        allowUnlimitedPlay: allowsUnlimitedDailyPlay,
                        onContinue: {
                            guard let bundle = viewModel.dailyBundle else { return }
                            startDailyRun(with: bundle)
                        },
                        onSelect: { mode in
                            guard let bundle = viewModel.dailyBundle else { return }
                            openMode(mode, bundle: bundle)
                        }
                    )
                } else if viewModel.isLoading {
                    ProgressView()
                        .tint(BKTheme.accent)
                        .frame(height: 200)
                }

                ProgressStripView(
                    streak: auth.user?.streak ?? 0,
                    todayXp: auth.user?.todayXp ?? 0,
                    xpGoal: AppConfig.dailyXpGoal
                )
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(BKTheme.background)
        .refreshable {
            await viewModel.load(context: modelContext)
            await auth.refreshProfile()
        }
        .task {
            await viewModel.load(context: modelContext)
        }
        .fullScreenCover(item: $presentedMode) { mode in
            DailyGameHost(
                mode: mode,
                dailyBundle: viewModel.dailyBundle,
                allowReplay: allowsUnlimitedDailyPlay,
                onFinished: { handleModeFinished(mode) }
            )
        }
        .alert("Already played today", isPresented: $showAlreadyPlayedAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("You've finished \(alreadyPlayedTitle) for today. Come back tomorrow for a new daily.")
        }
    }

    private func openMode(_ mode: GameModeMetaDTO, bundle: DailyBundleDTO) {
        guard mode.isAvailable else { return }
        guard let modeId = GameModeID(rawValue: GameModeCatalog.normalizedModeId(mode.id)) else { return }
        guard DailyPlayOrder.playableModes.contains(modeId) else { return }

        if !allowsUnlimitedDailyPlay, bundle.isCompleted(modeId) {
            alreadyPlayedTitle = mode.title
            showAlreadyPlayedAlert = true
            return
        }

        isSequentialDaily = false
        presentedMode = modeId
    }

    private func startDailyRun(with bundle: DailyBundleDTO) {
        if allowsUnlimitedDailyPlay {
            isSequentialDaily = true
            presentedMode = DailyPlayOrder.firstIncomplete(in: bundle) ?? DailyPlayOrder.playableModes.first
            return
        }

        guard let next = DailyPlayOrder.firstIncomplete(in: bundle) else { return }
        isSequentialDaily = true
        presentedMode = next
    }

    private func handleModeFinished(_ mode: GameModeID) {
        presentedMode = nil
        Task {
            await auth.refreshProfile()
            await viewModel.load(context: modelContext)

            guard isSequentialDaily, let bundle = viewModel.dailyBundle else {
                isSequentialDaily = false
                return
            }

            if allowsUnlimitedDailyPlay {
                isSequentialDaily = false
                return
            }

            if let next = DailyPlayOrder.nextIncomplete(after: mode, in: bundle) {
                try? await Task.sleep(for: .milliseconds(450))
                presentedMode = next
            } else {
                isSequentialDaily = false
            }
        }
    }
}

struct HomeHeaderView: View {
    let user: UserProfileDTO?
    let streak: Int
    var onLeagues: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(BKTheme.cardElevated)
                .frame(width: 44, height: 44)
                .overlay {
                    Text(initials)
                        .font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.accent)
                }

            VStack(alignment: .leading, spacing: 4) {
                Text("BALL KNOWLEDGE")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.accent)
                HStack(spacing: 8) {
                    HStack(spacing: 4) {
                        Ph.lightning.fill
                            .color(BKTheme.textPrimary)
                            .frame(width: 12, height: 12)
                        Text("\(user?.xp ?? 0)")
                            .font(BKFont.caption())
                            .foregroundStyle(BKTheme.textPrimary)
                    }
                    HStack(spacing: 4) {
                        Ph.fire.fill
                            .color(BKTheme.streak)
                            .frame(width: 12, height: 12)
                        Text("\(streak) \(streak == 1 ? "DAY" : "DAYS")")
                            .font(BKFont.caption())
                            .foregroundStyle(BKTheme.textPrimary)
                    }
                }
            }

            Spacer()

            Button(action: onLeagues) {
                Ph.trophy.fill
                    .color(.yellow)
                    .frame(width: 20, height: 20)
                    .frame(width: 40, height: 40)
                    .background(BKTheme.card)
                    .clipShape(Circle())
            }

            Ph.bell.fill
                .color(BKTheme.textSecondary)
                .frame(width: 18, height: 18)
                .frame(width: 40, height: 40)
                .background(BKTheme.card)
                .clipShape(Circle())
                .overlay(alignment: .topTrailing) {
                    Circle()
                        .fill(BKTheme.accent)
                        .frame(width: 8, height: 8)
                        .offset(x: -2, y: 2)
                }
        }
        .padding(.top, 8)
    }

    private var initials: String {
        let parts = (user?.displayName ?? "BK").split(separator: " ")
        return parts.prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased()
    }
}

struct DailySection: View {
    let modes: [GameModeMetaDTO]
    let bundle: DailyBundleDTO?
    var allowUnlimitedPlay = false
    var onContinue: () -> Void
    var onSelect: (GameModeMetaDTO) -> Void

    private var orderedModes: [GameModeMetaDTO] {
        DailyPlayOrder.playableModes.compactMap { id in
            modes.first { GameModeCatalog.normalizedModeId($0.id) == id.rawValue }
        }
    }

    private var totalCount: Int { DailyPlayOrder.playableModes.count }

    private var completedCount: Int {
        guard let bundle, !allowUnlimitedPlay else { return 0 }
        return DailyPlayOrder.completedCount(in: bundle)
    }

    private var allComplete: Bool {
        guard let bundle, !allowUnlimitedPlay else { return false }
        return DailyPlayOrder.allComplete(in: bundle)
    }

    private var upNextId: GameModeID? {
        guard let bundle, !allowUnlimitedPlay else { return DailyPlayOrder.playableModes.first }
        return DailyPlayOrder.firstIncomplete(in: bundle)
    }

    var body: some View {
        VStack(spacing: 12) {
            header
            VStack(spacing: 10) {
                ForEach(Array(orderedModes.enumerated()), id: \.element.id) { index, mode in
                    DailyGameCard(
                        index: index + 1,
                        mode: mode,
                        state: state(for: mode),
                        onTap: { onSelect(mode) }
                    )
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("TODAY'S DAILY")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.accent)
                    Text(dateline)
                        .font(BKFont.title(22))
                        .foregroundStyle(BKTheme.textPrimary)
                }
                Spacer()
                Text("\(completedCount)/\(totalCount)")
                    .font(BKFont.headline(16))
                    .foregroundStyle(BKTheme.textSecondary)
            }

            progressBar

            TimelineView(.periodic(from: .now, by: 60)) { context in
                Text(subtitle(now: context.date))
                    .font(BKFont.body(13))
                    .foregroundStyle(BKTheme.textSecondary)
            }

            if !allComplete {
                Button(action: onContinue) {
                    HStack(spacing: 8) {
                        Text(ctaTitle)
                            .font(BKFont.headline(15))
                        Ph.arrowRight.bold
                            .color(BKTheme.background)
                            .frame(width: 16, height: 16)
                    }
                    .foregroundStyle(BKTheme.background)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(BKTheme.accent)
                    .clipShape(Capsule())
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private var progressBar: some View {
        HStack(spacing: 5) {
            ForEach(0..<totalCount, id: \.self) { i in
                Capsule()
                    .fill(i < completedCount ? BKTheme.accent : BKTheme.cardElevated)
                    .frame(height: 6)
            }
        }
    }

    private var dateline: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE d MMM"
        return formatter.string(from: Date())
    }

    private var ctaTitle: String {
        completedCount == 0 ? "START TODAY'S DAILY" : "CONTINUE"
    }

    private func subtitle(now: Date) -> String {
        if allComplete {
            return "All done — new games in \(DailyTime.untilMidnight(from: now))"
        }
        return "Play each game once · resets in \(DailyTime.untilMidnight(from: now))"
    }

    private func state(for mode: GameModeMetaDTO) -> DailyTileState {
        let modeId = GameModeID(rawValue: GameModeCatalog.normalizedModeId(mode.id))
        if let bundle, !allowUnlimitedPlay, let modeId, bundle.isCompleted(modeId) {
            return .completed
        }
        if let modeId, modeId == upNextId { return .upNext }
        return .upcoming
    }
}

struct DailyGameCard: View {
    let index: Int
    let mode: GameModeMetaDTO
    let state: DailyTileState
    var onTap: () -> Void

    private let cornerRadius: CGFloat = 18
    private let height: CGFloat = 128

    private var tileArtImageName: String? {
        GameModeTileArt.bundleImageName(for: GameModeCatalog.normalizedModeId(mode.id))
    }

    var body: some View {
        Button(action: onTap) {
            ZStack(alignment: .bottomLeading) {
                artLayer
                gradientLayer

                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(mode.title)
                            .font(.system(size: 19, weight: .black, design: .rounded))
                            .foregroundStyle(.white)
                            .shadow(color: .black.opacity(0.5), radius: 3, y: 1)
                        Text(DailyGameCard.blurb(for: mode))
                            .font(BKFont.body(12))
                            .foregroundStyle(.white.opacity(0.85))
                            .shadow(color: .black.opacity(0.5), radius: 2, y: 1)
                    }
                    Spacer(minLength: 8)
                    trailingBadge
                }
                .padding(14)

                indexBadge
            }
            .frame(height: height)
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .stroke(state == .upNext ? BKTheme.accent : Color.white.opacity(0.06),
                            lineWidth: state == .upNext ? 2 : 1)
            )
            .saturation(state == .completed ? 0.25 : 1)
        }
        .buttonStyle(TilePressStyle())
    }

    private let artVerticalShift: CGFloat = 40

    private var artLayer: some View {
        GeometryReader { geo in
            ZStack {
                BKTheme.cardElevated
                if let tileArtImageName {
                    GameModeBundleImage(name: tileArtImageName)
                        .scaledToFill()
                        .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
                        .offset(y: -artVerticalShift)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
            .clipped()
        }
        .allowsHitTesting(false)
    }

    private var gradientLayer: some View {
        LinearGradient(
            colors: [
                .black.opacity(state == .completed ? 0.5 : 0.05),
                .black.opacity(state == .completed ? 0.65 : 0.4),
                .black.opacity(0.82),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private var trailingBadge: some View {
        switch state {
        case .completed:
            HStack(spacing: 5) {
                Ph.checkCircle.fill.color(BKTheme.accent).frame(width: 16, height: 16)
                Text("DONE").font(BKFont.caption(10)).foregroundStyle(.white)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.black.opacity(0.45))
            .clipShape(Capsule())
        case .upNext:
            HStack(spacing: 6) {
                Ph.play.fill.color(BKTheme.background).frame(width: 12, height: 12)
                Text("PLAY").font(BKFont.caption(11)).foregroundStyle(BKTheme.background)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(BKTheme.accent)
            .clipShape(Capsule())
        case .upcoming:
            Ph.play.fill
                .color(.white)
                .frame(width: 13, height: 13)
                .padding(10)
                .background(.black.opacity(0.4))
                .clipShape(Circle())
        }
    }

    private var indexBadge: some View {
        VStack {
            HStack {
                Text("\(index)")
                    .font(.system(size: 13, weight: .black, design: .rounded))
                    .foregroundStyle(state == .upNext ? BKTheme.background : .white)
                    .frame(width: 26, height: 26)
                    .background(Circle().fill(state == .upNext ? BKTheme.accent : Color.black.opacity(0.5)))
                Spacer()
            }
            Spacer()
        }
        .padding(12)
    }

    static func blurb(for mode: GameModeMetaDTO) -> String {
        guard let id = GameModeID(rawValue: GameModeCatalog.normalizedModeId(mode.id)) else {
            return mode.subtitle
        }
        switch id {
        case .guessWho: return "Crack the mystery player"
        case .targetMan: return "Hit the stat target"
        case .blindRank: return "Rank them blind"
        case .footballBingo: return "Fill the grid"
        case .oneMore: return "Name one more"
        case .draftMaster: return "Draft the best XI"
        case .worldCupXI: return "Build the World Cup XI"
        case .footballGolf: return "Fewest guesses wins"
        case .footballTower: return "Climb the tower"
        }
    }
}

enum DailyTime {
    static func untilMidnight(from date: Date, calendar: Calendar = .current) -> String {
        let startOfToday = calendar.startOfDay(for: date)
        guard let midnight = calendar.date(byAdding: .day, value: 1, to: startOfToday) else {
            return "tomorrow"
        }

        let seconds = max(0, midnight.timeIntervalSince(date))
        let totalMinutes = Int(seconds / 60)
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60

        if hours >= 1 {
            return hours == 1 ? "1 hour" : "\(hours) hours"
        }
        if minutes <= 1 { return "1 minute" }
        return "\(minutes) minutes"
    }
}

enum DailyTileState {
    case upNext
    case completed
    case upcoming
}

private struct TilePressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.62), value: configuration.isPressed)
    }
}

struct ProgressStripView: View {
    let streak: Int
    let todayXp: Int
    let xpGoal: Int

    var body: some View {
        HStack(spacing: 16) {
            VStack(spacing: 6) {
                ZStack {
                    Circle()
                        .stroke(BKTheme.cardElevated, lineWidth: 4)
                        .frame(width: 56, height: 56)
                    Circle()
                        .trim(from: 0, to: min(1, Double(streak % 7) / 7))
                        .stroke(BKTheme.streak, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        .frame(width: 56, height: 56)
                        .rotationEffect(.degrees(-90))
                    Ph.fire.fill
                        .color(BKTheme.streak)
                        .frame(width: 22, height: 22)
                }
                Text("\(streak) DAY")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textSecondary)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("TODAY'S XP")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
                Text("\(todayXp) / \(xpGoal) XP")
                    .font(BKFont.headline(14))
                    .foregroundStyle(BKTheme.textPrimary)
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(BKTheme.cardElevated)
                        Capsule()
                            .fill(BKTheme.accent)
                            .frame(width: geo.size.width * min(1, Double(todayXp) / Double(xpGoal)))
                    }
                }
                .frame(height: 8)
            }

            Ph.gift.fill
                .color(BKTheme.accent)
                .frame(width: 24, height: 24)
                .frame(width: 48, height: 48)
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .padding(16)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

struct DailyGameHost: View {
    let mode: GameModeID
    let dailyBundle: DailyBundleDTO?
    let allowReplay: Bool
    let onFinished: () -> Void

    var body: some View {
        Group {
            switch mode {
            case .guessWho:
                if let bundle = dailyBundle, let puzzle = bundle.guessWhoPuzzle {
                    GuessWhoView(
                        puzzle: puzzle,
                        date: bundle.date,
                        allowReplay: allowReplay,
                        onComplete: onFinished
                    )
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .targetMan:
                TargetManView(dailyBundle: dailyBundle, allowReplay: allowReplay, onComplete: onFinished)
            case .blindRank:
                BlindRankView(dailyBundle: dailyBundle, allowReplay: allowReplay, onComplete: onFinished)
            case .footballBingo:
                FootballBingoView(dailyDate: dailyBundle?.date, allowReplay: allowReplay, onComplete: onFinished)
            case .oneMore:
                OneMoreView(dailyDate: dailyBundle?.date, allowReplay: allowReplay, onComplete: onFinished)
            case .draftMaster:
                DraftMasterView(dailyDate: dailyBundle?.date, allowReplay: allowReplay, onComplete: onFinished)
            case .footballGolf:
                FootballGolfView(dailyDate: dailyBundle?.date, allowReplay: allowReplay, onComplete: onFinished)
            case .footballTower:
                FootballTowerView(dailyOnly: true, allowReplay: allowReplay, onComplete: onFinished)
            case .worldCupXI:
                WorldCupXIView(dailyDate: dailyBundle?.date, allowReplay: allowReplay, onComplete: onFinished)
            }
        }
    }
}

private struct DailyUnavailablePlaceholder: View {
    let modeTitle: String
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text(modeTitle)
                .font(BKFont.headline())
                .foregroundStyle(BKTheme.textPrimary)
            Text("Today's daily isn't available yet.")
                .font(BKFont.body())
                .foregroundStyle(BKTheme.textSecondary)
            Button("Close", action: onClose)
                .font(BKFont.headline())
                .foregroundStyle(BKTheme.background)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .background(BKTheme.accent)
                .clipShape(Capsule())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BKTheme.background)
    }
}
