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

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                HomeHeaderView(user: auth.user, onLeagues: { selectedTab = .leagues })

                if let bundle = viewModel.dailyBundle {
                    DailyRunCard(
                        streak: auth.user?.streak ?? 0,
                        bundle: bundle,
                        onStart: { startDailyRun(with: bundle) }
                    )
                } else if viewModel.isLoading {
                    ProgressView()
                        .tint(BKTheme.accent)
                        .frame(height: 200)
                }

                if let bundle = viewModel.dailyBundle {
                    GamesGridSection(
                        modes: viewModel.gameModes,
                        completedModeIds: DailyCompletionService.completedSet(for: bundle),
                        onSelect: { mode in
                            openMode(mode, bundle: bundle)
                        }
                    )
                } else {
                    GamesGridSection(
                        modes: viewModel.gameModes,
                        completedModeIds: [],
                        onSelect: { _ in }
                    )
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
                allowReplay: false,
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

        if bundle.isCompleted(modeId) {
            alreadyPlayedTitle = mode.title
            showAlreadyPlayedAlert = true
            return
        }

        isSequentialDaily = false
        presentedMode = modeId
    }

    private func startDailyRun(with bundle: DailyBundleDTO) {
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
                    Text("Level \(user?.level ?? 1)")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.background)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(BKTheme.accent)
                        .clipShape(Capsule())
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

struct DailyRunCard: View {
    let streak: Int
    let bundle: DailyBundleDTO
    var onStart: () -> Void

    private var completedCount: Int { DailyPlayOrder.completedCount(in: bundle) }
    private var totalCount: Int { DailyPlayOrder.playableModes.count }
    private var allComplete: Bool { DailyPlayOrder.allComplete(in: bundle) }
    private var nextMode: GameModeID? { DailyPlayOrder.firstIncomplete(in: bundle) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("TODAY'S RUN")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.accent)
                Spacer()
                HStack(spacing: 4) {
                    Ph.fire.fill
                        .color(BKTheme.streak)
                        .frame(width: 14, height: 14)
                    Text("\(streak) DAY STREAK")
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.textPrimary)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(BKTheme.background.opacity(0.6))
                .clipShape(Capsule())
            }

            Text(allComplete ? "ALL DAILIES DONE" : "DAILY RUN")
                .font(BKFont.title(24))
                .foregroundStyle(BKTheme.textPrimary)

            Text(progressSubtitle)
                .font(BKFont.body(13))
                .foregroundStyle(BKTheme.textSecondary)

            HStack(spacing: 6) {
                ForEach(0..<totalCount, id: \.self) { index in
                    Capsule()
                        .fill(index < completedCount ? BKTheme.accent : BKTheme.cardElevated)
                        .frame(height: 4)
                }
            }
            .padding(.top, 2)

            if allComplete {
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    HStack(spacing: 6) {
                        Ph.checkCircle.fill
                            .color(BKTheme.accent)
                            .frame(width: 16, height: 16)
                        Text("New dailies in \(DailyRunCard.timeUntilMidnight(from: context.date))")
                            .font(BKFont.body(13))
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                }
            }

            if !allComplete {
                Button(action: onStart) {
                    HStack {
                        Text(nextMode == DailyPlayOrder.playableModes.first ? "START DAILY" : "CONTINUE DAILY")
                            .font(BKFont.headline(14))
                        Ph.arrowRight.bold
                            .color(BKTheme.background)
                            .frame(width: 16, height: 16)
                    }
                    .foregroundStyle(BKTheme.background)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(BKTheme.accent)
                    .clipShape(Capsule())
                }
                .padding(.top, 4)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            GeometryReader { geo in
                ZStack {
                    LinearGradient(
                        colors: [BKTheme.cardElevated, BKTheme.card],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )

                    BundleResourceImage(name: "banner2")
                        .scaledToFill()
                        .frame(width: geo.size.width, height: geo.size.height)
                        .clipped()

                    LinearGradient(
                        colors: [BKTheme.card.opacity(0.92), BKTheme.card.opacity(0.55), .clear],
                        startPoint: .leading,
                        endPoint: UnitPoint(x: 0.65, y: 0.5)
                    )
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private var progressSubtitle: String {
        if allComplete {
            return "\(completedCount)/\(totalCount) games completed today"
        }
        if let nextMode {
            return "Game \(completedCount + 1) of \(totalCount) · \(nextMode.title)"
        }
        return "\(completedCount)/\(totalCount) completed"
    }

    static func timeUntilMidnight(from date: Date, calendar: Calendar = .current) -> String {
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

struct GamesGridSection: View {
    let modes: [GameModeMetaDTO]
    let completedModeIds: Set<String>
    var onSelect: (GameModeMetaDTO) -> Void

    let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("GAMES")
                    .font(BKFont.headline(18))
                    .foregroundStyle(BKTheme.textPrimary)
                Spacer()
                Text("Daily only")
                    .font(BKFont.caption())
                    .foregroundStyle(BKTheme.textMuted)
            }

            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(modes) { mode in
                    GameModeTile(
                        mode: mode,
                        isCompletedToday: isCompleted(mode)
                    ) {
                        onSelect(mode)
                    }
                }
            }
        }
    }

    private func isCompleted(_ mode: GameModeMetaDTO) -> Bool {
        completedModeIds.contains(GameModeCatalog.normalizedModeId(mode.id))
    }
}

struct GameModeTile: View {
    let mode: GameModeMetaDTO
    var isCompletedToday = false
    var onTap: () -> Void

    private let cornerRadius: CGFloat = 14

    private var tileArtImageName: String? {
        GameModeTileArt.bundleImageName(for: GameModeCatalog.normalizedModeId(mode.id))
    }

    private var usesImageArt: Bool { tileArtImageName != nil }

    var body: some View {
        Button(action: onTap) {
            ZStack(alignment: .topLeading) {
                BKTheme.card

                if usesImageArt {
                    tileArtLayer
                    tileBottomFade
                }

                tileContent
                    .zIndex(2)

                if isCompletedToday {
                    VStack {
                        HStack {
                            Spacer()
                            Ph.checkCircle.fill
                                .color(BKTheme.accent)
                                .frame(width: 22, height: 22)
                                .background(Circle().fill(BKTheme.background.opacity(0.85)))
                                .padding(8)
                        }
                        Spacer()
                    }
                    .zIndex(3)
                }
            }
            .frame(height: 110)
            .frame(maxWidth: .infinity, alignment: .leading)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            .opacity(tileOpacity)
        }
        .buttonStyle(TilePressStyle())
    }

    private var tileOpacity: Double {
        if !mode.isAvailable { return usesImageArt ? 0.65 : 0.65 }
        if isCompletedToday { return usesImageArt ? 0.82 : 0.82 }
        return 1
    }

    private var tileArtLayer: some View {
        GeometryReader { geo in
            if let tileArtImageName {
                GameModeBundleImage(name: tileArtImageName)
                    .scaledToFill()
                    .frame(width: geo.size.width, height: geo.size.height)
                    .opacity(mode.isAvailable ? 1 : 0.75)
            }
        }
        .allowsHitTesting(false)
    }

    private var tileBottomFade: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            LinearGradient(
                colors: [Color.clear, Color.black.opacity(0.55), Color.black.opacity(0.88)],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 54)
        }
        .allowsHitTesting(false)
        .zIndex(1)
    }

    private var tileContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 0)
            tileTitle
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        .padding(10)
    }

    private var tileTitle: some View {
        Text(mode.title)
            .font(.system(size: 15, weight: .black, design: .rounded))
            .foregroundStyle(BKTheme.textPrimary)
            .shadow(color: usesImageArt ? Color.black.opacity(0.45) : .clear, radius: 3, y: 1)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
    }
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
            case .tenaball:
                DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
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
