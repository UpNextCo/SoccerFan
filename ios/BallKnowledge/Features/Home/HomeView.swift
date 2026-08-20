import SwiftUI
import SwiftData
import UIKit

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
            let today = DailyDate.localToday()
            if let cached = try? OfflineCache.loadDailyBundle(date: today, context: context) {
                dailyBundle = cached
            }
            if gameModes.isEmpty {
                gameModes = GameModeCatalog.resolve(from: nil)
            }
            errorMessage = error.localizedDescription
        }

        await OfflineCache.syncPendingCompletions(context: context)
        if let dailyBundle {
            await DailyReminder.refresh(for: dailyBundle, modes: gameModes)
        }
    }
}

struct HomeView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @State private var viewModel = HomeViewModel()
    @State private var presentedMode: GameModeID?
    @State private var showAlreadyPlayedAlert = false
    @State private var alreadyPlayedTitle = ""
    @State private var inProgressModes: Set<String> = []
    @State private var trackedDailyDate = DailyDate.localToday()
    /// True while a game cover is up — celebration waits until we're back on home.
    @State private var isPlayingGame = false
    @State private var celebrationPayload: DailyCompleteCelebrationPayload?
    #if DEBUG
    @State private var showAwardPreview = false
    #endif
    @Binding var selectedTab: AppTab

    private var allowsUnlimitedDailyPlay: Bool { auth.allowsUnlimitedDailyPlay }

    private func isDailyComplete(_ bundle: DailyBundleDTO) -> Bool {
        let enabledIds = Set(
            viewModel.gameModes
                .filter(\.isAvailable)
                .map { GameModeCatalog.normalizedModeId($0.id) }
        )
        let activeModes = DailyPlayOrder.availableModes(in: bundle).filter {
            enabledIds.isEmpty || enabledIds.contains($0.rawValue)
        }
        return !activeModes.isEmpty && activeModes.allSatisfy { bundle.isCompleted($0) }
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                HomeHeaderView(
                    user: auth.user,
                    streak: auth.user?.streak ?? 0,
                    dailyComplete: viewModel.dailyBundle.map(isDailyComplete) ?? false
                )

                if viewModel.dailyBundle != nil {
                    DailySection(
                        modes: viewModel.gameModes,
                        bundle: viewModel.dailyBundle,
                        allowUnlimitedPlay: allowsUnlimitedDailyPlay,
                        todayXp: auth.user?.todayXp ?? 0,
                        inProgressModes: inProgressModes,
                        onSelect: { mode in
                            guard let bundle = viewModel.dailyBundle else { return }
                            openMode(mode, bundle: bundle)
                        }
                    )
                } else if viewModel.isLoading {
                    ProgressView()
                        .tint(BKTheme.accent)
                        .frame(height: 200)
                } else if let errorMessage = viewModel.errorMessage {
                    VStack(spacing: 12) {
                        Text("Today's games couldn't be loaded")
                            .font(BKFont.headline(17))
                            .foregroundStyle(BKTheme.textPrimary)
                        Text(errorMessage)
                            .font(BKFont.body(13))
                            .foregroundStyle(BKTheme.textMuted)
                            .multilineTextAlignment(.center)
                        Button("Try Again") {
                            Task { await viewModel.load(context: modelContext) }
                        }
                        .font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.background)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(BKTheme.accent)
                        .clipShape(Capsule())
                    }
                    .frame(maxWidth: .infinity, minHeight: 200)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, BKTabBar.scrollClearance)
        }
        .background { HomeAmbientBackground() }
        .refreshable {
            await viewModel.load(context: modelContext)
            await auth.refreshProfile()
        }
        .task {
            await reloadIfNeeded(force: true, context: modelContext)
            #if DEBUG
            if AppConfig.previewDailyCompleteCelebration {
                try? await Task.sleep(for: .milliseconds(500))
                presentCelebrationPreview()
            }
            if AppConfig.previewAwards {
                try? await Task.sleep(for: .milliseconds(400))
                showAwardPreview = true
            }
            #endif
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await reloadIfNeeded(force: false, context: modelContext) }
            }
        }
        .onReceive(Timer.publish(every: 30, on: .main, in: .common).autoconnect()) { _ in
            let today = DailyDate.localToday()
            guard today != trackedDailyDate || viewModel.dailyBundle?.date != today else { return }
            Task { await reloadIfNeeded(force: false, context: modelContext) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .dailyCompletionRecorded)) { _ in
            // The completion POST has landed on the server — refresh XP (top bar + card) and the
            // games-completed count now that the write is durable, avoiding the dismiss-time race.
            Task {
                await auth.refreshProfile()
                await viewModel.load(context: modelContext)
                refreshInProgress()
            }
        }
        .fullScreenCover(item: $presentedMode, onDismiss: {
            // Fires however the game closes — including tapping X mid-game — so an "In Progress"
            // tile shows up immediately (not only after a force-close + relaunch).
            isPlayingGame = false
            refreshInProgress()
            Task {
                await auth.refreshProfile()
                await viewModel.load(context: modelContext)
                refreshInProgress()
                // Let the game cover finish dismissing before stacking the celebration cover.
                try? await Task.sleep(for: .milliseconds(350))
                presentCelebrationIfNeeded()
            }
        }) { mode in
            DailyGameHost(
                mode: mode,
                dailyBundle: viewModel.dailyBundle,
                allowReplay: allowsUnlimitedDailyPlay,
                onFinished: { handleModeFinished(mode) }
            )
        }
        #if DEBUG
        .fullScreenCover(isPresented: $showAwardPreview) {
            TrophyCabinetView {
                showAwardPreview = false
            }
        }
        #endif
        .overlay(alignment: .top) {
            if let payload = celebrationPayload {
                StreakToastBanner(payload: payload) {
                    withAnimation(.spring(response: 0.38, dampingFraction: 0.86)) {
                        celebrationPayload = nil
                    }
                }
                .padding(.top, 10)
                .transition(.asymmetric(
                    insertion: .move(edge: .top).combined(with: .opacity),
                    removal: .move(edge: .top).combined(with: .opacity)
                ))
                .zIndex(30)
            }
        }
        .animation(.spring(response: 0.42, dampingFraction: 0.82), value: celebrationPayload)
        .alert("Already played today", isPresented: $showAlreadyPlayedAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("You've finished \(alreadyPlayedTitle) for today. Come back tomorrow for a new daily.")
        }
    }

    private func reloadIfNeeded(force: Bool, context: ModelContext) async {
        let today = DailyDate.localToday()
        if !force, viewModel.dailyBundle?.date == today, trackedDailyDate == today { return }
        trackedDailyDate = today
        await viewModel.load(context: context)
        refreshInProgress()
        await auth.refreshProfile()
    }

    private func openMode(_ mode: GameModeMetaDTO, bundle: DailyBundleDTO) {
        guard mode.isAvailable else { return }
        guard let modeId = GameModeID(rawValue: GameModeCatalog.normalizedModeId(mode.id)) else { return }
        guard DailyPlayOrder.playableModes.contains(modeId) else { return }

        if !allowsUnlimitedDailyPlay, bundle.isCompleted(modeId) {
            alreadyPlayedTitle = DailyGameCard.displayTitle(for: mode)
            showAlreadyPlayedAlert = true
            return
        }

        isPlayingGame = true
        presentedMode = modeId
    }

    private func handleModeFinished(_ mode: GameModeID) {
        // Dismiss the game cover; onDismiss refreshes profile/bundle and may present celebration.
        presentedMode = nil
    }

    /// Recompute which games have saved mid-game progress for today, and drop stale (past-day) snapshots.
    private func refreshInProgress() {
        guard let date = viewModel.dailyBundle?.date else {
            inProgressModes = []
            return
        }
        GameProgressStore.clearStale(keepingDate: date, context: modelContext)
        inProgressModes = GameProgressStore.inProgressModes(date: date, context: modelContext)
    }

    /// Show the streak toast once per day after the first finished daily.
    private func presentCelebrationIfNeeded() {
        guard celebrationPayload == nil,
              !isPlayingGame,
              presentedMode == nil else { return }
        guard let bundle = viewModel.dailyBundle else { return }
        guard DailyPlayOrder.completedCount(in: bundle) > 0 else { return }
        guard !DailyCompleteCelebration.hasShown(for: bundle.date) else { return }

        let streak = auth.user?.streak ?? 0
        guard streak > 0 else { return }
        DailyCompleteCelebration.markShown(for: bundle.date)
        celebrationPayload = DailyCompleteCelebrationPayload(
            date: bundle.date,
            todayXp: auth.user?.todayXp ?? 0,
            streak: streak
        )
    }

    #if DEBUG
    /// Skips the once-per-day gate so the streak toast can be previewed on launch.
    private func presentCelebrationPreview() {
        guard celebrationPayload == nil, !isPlayingGame, presentedMode == nil else { return }
        let todayXp = max(auth.user?.todayXp ?? 0, 1840)
        let streak = 10
        celebrationPayload = DailyCompleteCelebrationPayload(
            date: viewModel.dailyBundle?.date ?? DailyDate.localToday(),
            todayXp: todayXp,
            streak: streak
        )
    }
    #endif
}

struct HomeHeaderView: View {
    let user: UserProfileDTO?
    let streak: Int
    var dailyComplete: Bool = false
    @State private var avatarImage: UIImage?
    @State private var showNotifications = false

    private var hasUnread: Bool {
        // Read VsMonitor so the bell badge updates when a VS alert lands.
        let vsUnread = VsMonitor.shared.hasTabBadge || ActivityFeedStore.unreadVsAlertCount > 0
        return vsUnread || HomeActivity.hasUnread(user: user, streak: streak, dailyComplete: dailyComplete)
    }

    var body: some View {
        HStack(spacing: 12) {
            avatarCircle

            VStack(alignment: .leading, spacing: 4) {
                Text(headerName)
                    .font(BKFont.headline(15))
                    .foregroundStyle(BKTheme.textPrimary)
                HStack(spacing: 8) {
                    HStack(spacing: 4) {
                        Ph.lightning.fill
                            .color(BKTheme.accent)
                            .frame(width: 12, height: 12)
                        Text("\(user?.xp ?? 0)")
                            .font(BKFont.caption())
                            .foregroundStyle(BKTheme.textPrimary)
                        Text("XP")
                            .font(BKFont.caption())
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                    HStack(spacing: 4) {
                        Ph.fire.fill
                            .color(BKTheme.streak)
                            .frame(width: 12, height: 12)
                        Text("\(streak)")
                            .font(BKFont.caption())
                            .foregroundStyle(BKTheme.textPrimary)
                        Text(streak == 1 ? "DAY" : "DAYS")
                            .font(BKFont.caption())
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                }
            }

            Spacer()

            Button { showNotifications = true } label: {
                Ph.bell.fill
                    .color(BKTheme.textSecondary)
                    .frame(width: 18, height: 18)
                    .frame(width: 40, height: 40)
                    .background(BKTheme.card)
                    .clipShape(Circle())
                    .overlay(alignment: .topTrailing) {
                        if hasUnread {
                            Circle()
                                .fill(BKTheme.accent)
                                .frame(width: 8, height: 8)
                                .offset(x: -2, y: 2)
                                .allowsHitTesting(false)
                        }
                    }
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .zIndex(2)
        }
        .padding(.top, 8)
        .zIndex(2)
        .onAppear { avatarImage = LocalProfile.loadAvatar() }
        .sheet(isPresented: $showNotifications) {
            NotificationsView(
                user: user,
                streak: streak,
                dailyComplete: dailyComplete
            )
        }
    }

    private var headerName: String {
        LocalProfile.nameOverride ?? user?.displayName ?? "Player"
    }

    private var avatarCircle: some View {
        Group {
            if let avatarImage {
                Image(uiImage: avatarImage)
                    .resizable()
                    .scaledToFill()
            } else {
                PlayerAvatar(urlString: user?.avatarUrl, size: 44) {
                    BKTheme.cardElevated
                        .overlay {
                            Ph.userCircle.fill
                                .color(BKTheme.avatarPlaceholder)
                                .frame(width: 26, height: 26)
                        }
                }
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(Circle())
    }
}

struct NotificationsView: View {
    let user: UserProfileDTO?
    let streak: Int
    var dailyComplete = false

    @Environment(\.dismiss) private var dismiss
    @State private var events: [ActivityEvent] = []
    @State private var isLoading = true
    @State private var loadFailed = false

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && events.isEmpty {
                    ProgressView()
                        .tint(BKTheme.accent)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if events.isEmpty {
                    ContentUnavailableView(
                        "No activity yet",
                        systemImage: "bell.slash.fill",
                        description: Text("Play today's games to start filling your feed.")
                    )
                } else {
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 10) {
                            if loadFailed {
                                Text("Couldn't refresh leagues — showing what we have.")
                                    .font(BKFont.caption(11))
                                    .foregroundStyle(BKTheme.textMuted)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 4)
                            }

                            ForEach(events) { event in
                                HStack(alignment: .top, spacing: 14) {
                                    Image(systemName: event.icon)
                                        .font(.system(size: 16, weight: .bold))
                                        .foregroundStyle(event.tint)
                                        .frame(width: 40, height: 40)
                                        .background(BKTheme.cardElevated)
                                        .clipShape(Circle())

                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(event.title)
                                            .font(BKFont.headline(15))
                                            .foregroundStyle(BKTheme.textPrimary)
                                        Text(event.message)
                                            .font(BKFont.body(13))
                                            .foregroundStyle(BKTheme.textSecondary)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }

                                    Spacer(minLength: 0)

                                    if event.unread {
                                        Circle()
                                            .fill(BKTheme.accent)
                                            .frame(width: 8, height: 8)
                                            .padding(.top, 6)
                                    }
                                }
                                .padding(14)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(BKTheme.card)
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                            }
                        }
                        .padding(16)
                        .padding(.bottom, 24)
                    }
                }
            }
            .background(BKTheme.background)
            .navigationTitle("Activity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(BKTheme.accent)
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        isLoading = true
        loadFailed = false

        let localEvents = HomeActivity.events(
            user: user,
            streak: streak,
            dailyComplete: dailyComplete,
            league: nil
        )
        events = localEvents

        var snapshot = ActivityLeagueSnapshot()
        let userId = user?.id

        do {
            async let overallTask = APIClient.shared.leaguesOverall()
            async let todayTask = APIClient.shared.leaguesDaily()
            let (overall, today) = try await (overallTask, todayTask)

            if let userId {
                if let mine = overall.standings.first(where: { $0.userId == userId }) {
                    snapshot.overallRank = mine.rank
                    snapshot.overallXp = mine.xp
                }
                snapshot.overallTotal = overall.standings.count

                if let mine = today.standings.first(where: { $0.userId == userId }) {
                    snapshot.todayRank = mine.rank
                    snapshot.todayXp = mine.xp
                }
                snapshot.todayTotal = today.standings.count
            }

            events = HomeActivity.events(
                user: user,
                streak: streak,
                dailyComplete: dailyComplete,
                league: snapshot
            )

            ActivityFeedStore.markOpened(
                overallRank: snapshot.overallRank,
                todayRank: snapshot.todayRank,
                todayDate: DailyDate.localToday()
            )
        } catch {
            loadFailed = true
            // Keep prior league snapshots if the refresh failed.
            ActivityFeedStore.markOpened(
                overallRank: ActivityFeedStore.lastOverallRank,
                todayRank: ActivityFeedStore.lastTodayRank,
                todayDate: ActivityFeedStore.lastTodayRankDate ?? DailyDate.localToday()
            )
        }

        isLoading = false
    }
}

struct DailySection: View {
    let modes: [GameModeMetaDTO]
    let bundle: DailyBundleDTO?
    var allowUnlimitedPlay = false
    let todayXp: Int
    var inProgressModes: Set<String> = []
    var onSelect: (GameModeMetaDTO) -> Void

    private var orderedModes: [GameModeMetaDTO] {
        let order = bundle.map(DailyPlayOrder.availableModes) ?? DailyPlayOrder.playableModes
        return order.compactMap { id in
            modes.first {
                $0.isAvailable && GameModeCatalog.normalizedModeId($0.id) == id.rawValue
            }
        }
    }

    private var totalCount: Int { orderedModes.count }

    private var completedCount: Int {
        guard let bundle, !allowUnlimitedPlay else { return 0 }
        return orderedModes.filter { mode in
            guard let modeId = GameModeID(
                rawValue: GameModeCatalog.normalizedModeId(mode.id)
            ) else { return false }
            return bundle.isCompleted(modeId)
        }.count
    }

    private var allComplete: Bool {
        guard bundle != nil, !allowUnlimitedPlay, totalCount > 0 else { return false }
        return completedCount >= totalCount
    }

    var body: some View {
        VStack(spacing: 0) {
            hub
                .padding(.bottom, 20)

            VStack(spacing: 0) {
                ForEach(Array(orderedModes.enumerated()), id: \.element.id) { index, mode in
                    DailyGameCard(
                        mode: mode,
                        state: state(for: mode),
                        earnedXp: earnedXp(for: mode),
                        showsDivider: index < orderedModes.count - 1,
                        onTap: { onSelect(mode) }
                    )
                }
            }
        }
    }

    private var hub: some View {
        VStack(spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("TODAY'S DAILY")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.accent)
                    Text(dateline)
                        .font(BKFont.title(20))
                        .foregroundStyle(BKTheme.textPrimary)
                }
                Spacer()
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    Text((allComplete ? "New in " : "Resets in ") + DailyTime.untilReset(from: context.date))
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textMuted)
                }
            }

            VStack(spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(completedCount)")
                        .font(.system(size: 40, weight: .black, design: .rounded))
                        .foregroundStyle(completedCount > 0 ? BKTheme.accent : BKTheme.textPrimary)
                        .contentTransition(.numericText())
                        .animation(.spring(response: 0.45, dampingFraction: 0.7), value: completedCount)
                    Text("/ \(totalCount) games completed")
                        .font(BKFont.body(14))
                        .foregroundStyle(BKTheme.textSecondary)
                    Spacer()
                    HStack(spacing: 6) {
                        Ph.lightning.fill
                            .color(BKTheme.accent)
                            .frame(width: 16, height: 16)
                        Text("\(todayXp)")
                            .font(BKFont.headline(17))
                            .foregroundStyle(BKTheme.textPrimary)
                        Text("XP TODAY")
                            .font(BKFont.caption(10))
                            .foregroundStyle(BKTheme.textMuted)
                    }
                }
                progressBar
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { hubBackground }
    }

    private var hubBackground: some View {
        ZStack {
            Color(hex: "141414")

            hubHeroImage

            hubTextScrim

            BKGlass.roundedRect(cornerRadius: 20)
        }
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        // Decorative art can paint outside the card bounds; never let it steal taps
        // from the header (notifications bell sits just above this hub).
        .allowsHitTesting(false)
    }

    private var hubHeroImage: some View {
        GeometryReader { geo in
            GameModeBundleImage(name: "hero")
                .scaledToFill()
                .frame(width: geo.size.width * 1.45, height: geo.size.height * 1.35)
                .position(x: geo.size.width * 0.76, y: geo.size.height * 0.34)
                .frame(width: geo.size.width, height: geo.size.height)
                .mask {
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0),
                            .init(color: .clear, location: 0.3),
                            .init(color: .white.opacity(0.25), location: 0.42),
                            .init(color: .white.opacity(0.65), location: 0.55),
                            .init(color: .white, location: 0.7),
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                }
        }
        .allowsHitTesting(false)
    }

    private var hubTextScrim: some View {
        GeometryReader { geo in
            ZStack {
                LinearGradient(
                    stops: [
                        .init(color: Color(hex: "141414").opacity(0.55), location: 0),
                        .init(color: Color(hex: "141414").opacity(0.18), location: 0.38),
                        .init(color: .clear, location: 0.62),
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )

                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    LinearGradient(
                        colors: [.clear, Color(hex: "141414").opacity(0.3)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: geo.size.height * 0.35)
                }
            }
        }
    }

    private var progressBar: some View {
        HStack(spacing: 5) {
            ForEach(0..<totalCount, id: \.self) { i in
                Capsule()
                    .fill(i < completedCount
                          ? AnyShapeStyle(LinearGradient(colors: [BKTheme.accent, BKTheme.accentMuted],
                                                         startPoint: .leading, endPoint: .trailing))
                          : AnyShapeStyle(Color.white.opacity(0.22)))
                    .frame(height: 6)
                    .shadow(color: i < completedCount ? BKTheme.accent.opacity(0.55) : .clear,
                            radius: 4)
            }
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.7), value: completedCount)
    }

    private var dateline: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE d MMM"
        formatter.timeZone = .current
        if let bundleDate = bundle?.date, let d = DailyDate.displayDate(from: bundleDate) {
            return formatter.string(from: d)
        }
        return formatter.string(from: Date())
    }

    private func state(for mode: GameModeMetaDTO) -> DailyTileState {
        if !mode.isAvailable {
            return .unavailable
        }
        let normalized = GameModeCatalog.normalizedModeId(mode.id)
        let modeId = GameModeID(rawValue: normalized)
        if let bundle, !allowUnlimitedPlay, let modeId, bundle.isCompleted(modeId) {
            return .completed
        }
        if inProgressModes.contains(normalized) {
            return .inProgress
        }
        return .available
    }

    private func earnedXp(for mode: GameModeMetaDTO) -> Int? {
        guard let bundle else { return nil }
        let normalized = GameModeCatalog.normalizedModeId(mode.id)
        if let serverXp = bundle.completionXpByMode[normalized] {
            return serverXp
        }
        guard let modeId = GameModeID(rawValue: normalized) else { return nil }
        return DailyCompletionService.locallyEarnedXp(modeId, date: bundle.date)
    }
}

struct DailyGameCard: View {
    let mode: GameModeMetaDTO
    let state: DailyTileState
    var earnedXp: Int?
    var showsDivider = true
    var onTap: () -> Void

    private let iconSize: CGFloat = 72
    private let iconCornerRadius: CGFloat = 16
    private let rowContentSpacing: CGFloat = 14

    private var normalizedModeId: String {
        GameModeCatalog.normalizedModeId(mode.id)
    }

    private var tileArtImageName: String? {
        GameModeTileArt.bundleImageName(for: normalizedModeId)
    }

    private var displayTitle: String {
        Self.displayTitle(for: mode)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: rowContentSpacing) {
                thumbnail

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(displayTitle)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(BKTheme.textPrimary)
                            .lineLimit(1)

                        if state == .completed, let earnedXp {
                            Text(earnedXp > 0 ? "+\(earnedXp) XP" : "0 XP")
                                .font(.system(size: 10, weight: .bold, design: .rounded))
                                .foregroundStyle(BKTheme.textSecondary)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 4)
                                .background(Color.white.opacity(0.07))
                                .clipShape(Capsule())
                        }
                    }

                    Text(Self.blurb(for: mode))
                        .font(.system(size: 13))
                        .foregroundStyle(BKTheme.textSecondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                playAction
            }
            .padding(.vertical, 12)
            .opacity(state == .completed || state == .unavailable ? 0.65 : 1)

            if showsDivider {
                Rectangle()
                    .fill(Color(hex: "141414"))
                    .frame(height: 1)
                    .padding(.leading, iconSize + rowContentSpacing)
            }
        }
    }

    private var thumbnail: some View {
        ZStack {
            BKTheme.tileIconBackdrop
            if let tileArtImageName {
                GameModeBundleImage(name: tileArtImageName)
                    .scaledToFill()
                    .frame(width: iconSize, height: iconSize, alignment: .top)
                    .scaleEffect(BKTheme.tileIconScale)
                    .brightness(BKTheme.tileIconBrightness)
            }
        }
        .frame(width: iconSize, height: iconSize)
        .clipShape(RoundedRectangle(cornerRadius: iconCornerRadius, style: .continuous))
        .saturation(state == .completed || state == .unavailable ? 0.45 : 1)
    }

    private var playAction: some View {
        VStack(spacing: 3) {
            Button(action: onTap) {
                Text(playLabel)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(playForeground)
                    .frame(minWidth: 58)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(BKTheme.cardElevated)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(state == .unavailable)

            if let sublabel = playSublabel {
                Text(sublabel)
                    .font(.system(size: 10))
                    .foregroundStyle(BKTheme.textMuted)
            }
        }
    }

    private var playLabel: String {
        switch state {
        case .completed: return "Done"
        case .inProgress: return "Resume"
        case .available: return "Play"
        case .unavailable: return "Unavailable"
        }
    }

    private var playForeground: Color {
        switch state {
        case .completed, .unavailable: return BKTheme.textMuted
        case .inProgress, .available: return BKTheme.accent
        }
    }

    private var playSublabel: String? {
        switch state {
        case .inProgress: return "In Progress"
        case .completed, .available, .unavailable: return nil
        }
    }

    static func displayTitle(for mode: GameModeMetaDTO) -> String {
        guard let id = GameModeID(rawValue: GameModeCatalog.normalizedModeId(mode.id)) else {
            return mode.title.localizedCapitalized
        }
        switch id {
        case .footballBingo: return "Football Bingo"
        case .oneMore: return "One More"
        case .draftMaster: return "Draft XI"
        case .footballGolf: return "Football Golf"
        case .clubChain: return "Club Chain"
        case .guessWho: return "Guess Who?"
        case .targetMan: return "Target Man"
        case .worldCupXI: return "World Cup XI"
        case .blindRank: return "Blind Rank"
        case .footballTower: return "Football Tower"
        case .lastManStanding: return "Last Man Standing"
        case .backYourself: return "Back Yourself"
        case .darts501: return "Football 501"
        }
    }

    static func blurb(for mode: GameModeMetaDTO) -> String {
        guard let id = GameModeID(rawValue: GameModeCatalog.normalizedModeId(mode.id)) else {
            return mode.subtitle
        }
        switch id {
        case .guessWho:
            return "Guess the mystery player"
        case .targetMan:
            return "Hit the stat target"
        case .blindRank:
            return "Rank before stats drop"
        case .footballBingo:
            return "Complete the grid"
        case .oneMore:
            return "Streak or cash out"
        case .draftMaster:
            return "Draft the best squad"
        case .worldCupXI:
            return "Build the World Cup XI"
        case .footballGolf:
            return "Rarer answers win"
        case .clubChain:
            return "Find the missing links"
        case .footballTower:
            return "Climb the tower"
        case .lastManStanding:
            return "Survive the field"
        case .backYourself:
            return "How many you can name?"
        case .darts501:
            return "Check out from 501"
        }
    }
}

enum DailyTime {
    /// Countdown to local midnight — puzzles roll on the user's calendar day (NYT-style).
    static func untilReset(from date: Date) -> String {
        let seconds = DailyDate.secondsUntilLocalMidnight(from: date)
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
    case completed
    case inProgress
    case available
    case unavailable
}

struct DailyGameHost: View {
    let mode: GameModeID
    let dailyBundle: DailyBundleDTO?
    let allowReplay: Bool
    let onFinished: () -> Void

    // Consistent "how to play" screen shown before every game (unless the player chose to skip it).
    @State private var showIntro: Bool

    init(mode: GameModeID, dailyBundle: DailyBundleDTO?, allowReplay: Bool, onFinished: @escaping () -> Void) {
        self.mode = mode
        self.dailyBundle = dailyBundle
        self.allowReplay = allowReplay
        self.onFinished = onFinished
        _showIntro = State(initialValue: !GameIntroPreferences.isHidden(mode))
    }

    var body: some View {
        ZStack {
            if showIntro {
                GameIntroView(
                    mode: mode,
                    onPlay: { dismissIntro() },
                    onPlayAndHide: {
                        GameIntroPreferences.hide(mode)
                        dismissIntro()
                    },
                    onClose: onFinished
                )
                // Intro eases up and out of the way; the game fades in beneath it.
                .transition(.asymmetric(
                    insertion: .opacity,
                    removal: .move(edge: .top).combined(with: .opacity)
                ))
                .zIndex(1)
            } else {
                gameContent
                    .transition(.opacity)
            }
        }
    }

    private func dismissIntro() {
        withAnimation(.easeInOut(duration: 0.28)) { showIntro = false }
    }

    // Every game is server-puzzle-only: if today's puzzle isn't in the bundle we show the
    // "unavailable" placeholder rather than silently swapping in a local practice puzzle that
    // wouldn't match what everyone else is playing.
    @ViewBuilder private var gameContent: some View {
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
                if let challenge = DailyChallengeResolver.targetManChallenge(from: dailyBundle) {
                    TargetManView(challenge: challenge, allowReplay: allowReplay, onComplete: onFinished)
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .blindRank:
                if let challenge = DailyChallengeResolver.blindRankChallenge(from: dailyBundle) {
                    BlindRankView(challenge: challenge, allowReplay: allowReplay, onComplete: onFinished)
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .footballBingo:
                if let bundle = dailyBundle, let puzzle = bundle.footballBingoPuzzle {
                    FootballBingoView(
                        dailyDate: bundle.date,
                        serverPuzzle: puzzle,
                        allowReplay: allowReplay,
                        onComplete: onFinished
                    )
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .oneMore:
                if let bundle = dailyBundle, let puzzle = bundle.oneMorePuzzle,
                   let prompt = OneMoreSeed.makeServerPrompt(from: puzzle) {
                    OneMoreView(
                        dailyDate: bundle.date,
                        prompt: prompt,
                        allowReplay: allowReplay,
                        onComplete: onFinished
                    )
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .draftMaster:
                if let bundle = dailyBundle, let challenge = DailyChallengeResolver.battleChallenge(from: bundle) {
                    DraftMasterView(dailyDate: bundle.date, challenge: challenge, allowReplay: allowReplay, onComplete: onFinished)
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .footballGolf:
                FootballGolfView(
                    dailyDate: dailyBundle?.date,
                    serverPuzzle: dailyBundle?.footballGolfPuzzle,
                    allowReplay: allowReplay,
                    onComplete: onFinished
                )
            case .footballTower:
                FootballTowerView(
                    dailyOnly: true,
                    serverPuzzle: dailyBundle?.footballTowerPuzzle,
                    allowReplay: allowReplay,
                    onComplete: onFinished
                )
            case .worldCupXI:
                if let bundle = dailyBundle, let puzzle = DailyChallengeResolver.worldCupXIPuzzle(from: bundle) {
                    WorldCupXIView(dailyDate: bundle.date, puzzle: puzzle, allowReplay: allowReplay, onComplete: onFinished)
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .clubChain:
                if let bundle = dailyBundle, let puzzle = DailyChallengeResolver.clubChainPuzzle(from: bundle) {
                    ClubChainView(dailyDate: bundle.date, puzzle: puzzle, allowReplay: allowReplay, onComplete: onFinished)
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .lastManStanding:
                if let bundle = dailyBundle, let puzzle = bundle.lastManStandingPuzzle,
                   let prompt = LastManStandingSeed.makeServerPrompt(from: puzzle) {
                    LastManStandingView(
                        dailyDate: bundle.date,
                        prompt: prompt,
                        allowReplay: allowReplay,
                        onComplete: onFinished
                    )
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                        .onAppear { Self.logLMSUnavailable(bundle: dailyBundle) }
                }
            case .backYourself:
                if let bundle = dailyBundle, let puzzle = DailyChallengeResolver.backYourselfPuzzle(from: bundle) {
                    BackYourselfView(dailyDate: bundle.date, puzzle: puzzle, allowReplay: allowReplay, onComplete: onFinished)
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .darts501:
                if let bundle = dailyBundle, let puzzle = DailyChallengeResolver.darts501Puzzle(from: bundle) {
                    Darts501View(dailyDate: bundle.date, puzzle: puzzle, allowReplay: allowReplay, onComplete: onFinished)
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            }
        }
    }

    private static func logLMSUnavailable(bundle: DailyBundleDTO?) {
        #if DEBUG
        guard let bundle else {
            print("[LMS] unavailable — dailyBundle is nil")
            return
        }
        let modeIds = bundle.games.map(\.modeId).joined(separator: ", ")
        print("[LMS] unavailable — bundle date=\(bundle.date) games=[\(modeIds)]")
        if let puzzle = bundle.lastManStandingPuzzle {
            let mapped = puzzle.questions.filter { !$0.options.isEmpty }.count
            print("[LMS] puzzle present puzzleId=\(puzzle.puzzleId) questions=\(puzzle.questions.count) mappable=\(mapped) (need \(LMSGameState.totalQuestions))")
            for q in puzzle.questions {
                print("[LMS]   q slot=\(q.slot) type=\(q.type) options=\(q.options.count) id=\(q.id) prompt=\(q.prompt.prefix(60))")
            }
        } else if bundle.games.contains(where: { GameModeCatalog.normalizedModeId($0.modeId) == GameModeID.lastManStanding.rawValue }) {
            print("[LMS] game row present but lastManStandingPuzzle accessor returned nil (decode/case mismatch)")
        } else {
            print("[LMS] no last_man_standing game in bundle — missing from server OR decode dropped it (see [LMS decode] logs)")
        }
        #endif
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
