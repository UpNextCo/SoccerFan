import SwiftUI

enum AppTab: Hashable {
    case home, play, daily, leagues, profile
}

struct MainTabView: View {
    @State private var selectedTab: AppTab = .home

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                switch selectedTab {
                case .home:
                    HomeView(selectedTab: $selectedTab)
                case .play:
                    PlayTabView()
                case .daily:
                    DailyTabView()
                case .leagues:
                    LeaguesTabView()
                case .profile:
                    ProfileTabView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.bottom, 72)

            BKTabBar(selection: $selectedTab)
        }
        .background(BKTheme.background)
    }
}

struct PlayTabView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var modes: [GameModeMetaDTO] = []
    @State private var dailyBundle: DailyBundleDTO?
    @State private var presentedMode: GameModeID?
    @State private var showAlreadyPlayedAlert = false
    @State private var alreadyPlayedTitle = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(modes) { mode in
                        GameModeTile(
                            mode: mode,
                            isCompletedToday: isCompleted(mode)
                        ) {
                            openMode(mode)
                        }
                    }
                }
                .padding(16)
            }
            .background(BKTheme.background)
            .navigationTitle("Play")
            .task {
                let apiModes = try? await APIClient.shared.gameModes()
                modes = GameModeCatalog.resolve(from: apiModes)
                dailyBundle = try? await APIClient.shared.dailyToday()
            }
            .fullScreenCover(item: $presentedMode) { mode in
                DailyGameHost(
                    mode: mode,
                    dailyBundle: dailyBundle,
                    allowReplay: false,
                    onFinished: {
                        presentedMode = nil
                        Task {
                            dailyBundle = try? await APIClient.shared.dailyToday()
                        }
                    }
                )
            }
            .alert("Already played today", isPresented: $showAlreadyPlayedAlert) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("You've finished \(alreadyPlayedTitle) for today. Come back tomorrow.")
            }
        }
    }

    private func isCompleted(_ mode: GameModeMetaDTO) -> Bool {
        guard let bundle = dailyBundle else { return false }
        return DailyCompletionService.completedSet(for: bundle)
            .contains(GameModeCatalog.normalizedModeId(mode.id))
    }

    private func openMode(_ mode: GameModeMetaDTO) {
        guard mode.isAvailable, let bundle = dailyBundle else { return }
        guard let modeId = GameModeID(rawValue: GameModeCatalog.normalizedModeId(mode.id)) else { return }
        guard DailyPlayOrder.playableModes.contains(modeId) else { return }

        if bundle.isCompleted(modeId) {
            alreadyPlayedTitle = mode.title
            showAlreadyPlayedAlert = true
            return
        }

        presentedMode = modeId
    }
}

struct DailyTabView: View {
    @State private var bundle: DailyBundleDTO?
    @State private var presentedMode: GameModeID?
    @State private var showAlreadyPlayedAlert = false
    @State private var alreadyPlayedTitle = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let bundle {
                    Text(bundle.date)
                        .font(BKFont.caption())
                        .foregroundStyle(BKTheme.textMuted)

                    Text("\(DailyPlayOrder.completedCount(in: bundle))/\(DailyPlayOrder.playableModes.count) completed")
                        .font(BKFont.body())
                        .foregroundStyle(BKTheme.textSecondary)

                    ForEach(DailyPlayOrder.playableModes) { mode in
                        Button {
                            openMode(mode, bundle: bundle)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(mode.title)
                                        .font(BKFont.headline())
                                        .foregroundStyle(BKTheme.textPrimary)
                                    Text(subtitle(for: mode, bundle: bundle))
                                        .font(BKFont.body())
                                        .foregroundStyle(
                                            bundle.isCompleted(mode) ? BKTheme.accent : BKTheme.textSecondary
                                        )
                                }
                                Spacer()
                                if bundle.isCompleted(mode) {
                                    Ph.checkCircle.fill
                                        .color(BKTheme.accent)
                                        .frame(width: 22, height: 22)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(20)
                            .background(BKTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                        }
                        .buttonStyle(.plain)
                    }
                } else {
                    ProgressView().tint(BKTheme.accent)
                }
                Spacer()
            }
            .padding(16)
            .background(BKTheme.background)
            .navigationTitle("Daily")
            .task {
                bundle = try? await APIClient.shared.dailyToday()
            }
            .fullScreenCover(item: $presentedMode) { mode in
                DailyGameHost(
                    mode: mode,
                    dailyBundle: bundle,
                    allowReplay: false,
                    onFinished: {
                        presentedMode = nil
                        Task { bundle = try? await APIClient.shared.dailyToday() }
                    }
                )
            }
            .alert("Already played today", isPresented: $showAlreadyPlayedAlert) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("You've finished \(alreadyPlayedTitle) for today. Come back tomorrow.")
            }
        }
    }

    private func subtitle(for mode: GameModeID, bundle: DailyBundleDTO) -> String {
        if bundle.isCompleted(mode) { return "Completed" }
        switch mode {
        case .guessWho: return "8 guesses · Wordle-style player guess"
        case .targetMan:
            if let puzzle = bundle.targetManPuzzle {
                return "\(puzzle.title) · target \(puzzle.target)"
            }
            return "Hit the stat target"
        case .blindRank:
            if let puzzle = bundle.blindRankPuzzle {
                return "\(puzzle.categoryTitle) · \(puzzle.presentationOrder.count) players"
            }
            return "Order the stats"
        default:
            return "One play per day"
        }
    }

    private func openMode(_ mode: GameModeID, bundle: DailyBundleDTO) {
        if bundle.isCompleted(mode) {
            alreadyPlayedTitle = mode.title
            showAlreadyPlayedAlert = true
            return
        }
        presentedMode = mode
    }
}

struct LeaguesTabView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Ph.trophy.fill
                    .color(.yellow)
                    .frame(width: 48, height: 48)
                Text("Weekly Leagues")
                    .font(BKFont.title())
                    .foregroundStyle(BKTheme.textPrimary)
                Text("Compete in Bronze, Silver and Gold leagues. Coming soon.")
                    .font(BKFont.body())
                    .multilineTextAlignment(.center)
                    .foregroundStyle(BKTheme.textSecondary)
                    .padding(.horizontal, 32)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(BKTheme.background)
            .navigationTitle("Leagues")
        }
    }
}

struct ProfileTabView: View {
    @Environment(AuthManager.self) private var auth
    @State private var showDeleteConfirm = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                if let user = auth.user {
                    VStack(spacing: 8) {
                        Circle()
                            .fill(BKTheme.card)
                            .frame(width: 80, height: 80)
                            .overlay {
                                Text(user.displayName.prefix(1).uppercased())
                                    .font(BKFont.title(32))
                                    .foregroundStyle(BKTheme.accent)
                            }
                        Text(user.displayName)
                            .font(BKFont.headline(20))
                            .foregroundStyle(BKTheme.textPrimary)
                        Text("Level \(user.level)")
                            .font(BKFont.caption())
                            .foregroundStyle(BKTheme.accent)
                    }

                    HStack(spacing: 16) {
                        statBox("XP", value: "\(user.xp)")
                        statBox("Streak", value: "\(user.streak)")
                        statBox("Today", value: "\(user.todayXp)")
                    }
                }

                VStack(spacing: 12) {
                    Link("Privacy Policy", destination: AppConfig.privacyPolicyURL)
                        .font(BKFont.body())
                        .foregroundStyle(BKTheme.accent)

                    Button("Sign Out") {
                        Task { await auth.signOut() }
                    }
                    .font(BKFont.headline())
                    .foregroundStyle(BKTheme.textPrimary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 14))

                    Button("Delete Account") {
                        showDeleteConfirm = true
                    }
                    .font(BKFont.body())
                    .foregroundStyle(BKTheme.wrong)
                }
                .padding(.horizontal, 16)

                Spacer()
            }
            .padding(.top, 32)
            .background(BKTheme.background)
            .navigationTitle("Profile")
            .confirmationDialog("Delete your account?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
                Button("Delete Account", role: .destructive) {
                    Task { await auth.deleteAccount() }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    private func statBox(_ label: String, value: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(BKFont.headline())
                .foregroundStyle(BKTheme.textPrimary)
            Text(label)
                .font(BKFont.caption(10))
                .foregroundStyle(BKTheme.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}
