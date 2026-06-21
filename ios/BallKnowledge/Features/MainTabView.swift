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
    @State private var showGuessWho = false
    @State private var showFootballBingo = false
    @State private var showTargetMan = false
    @State private var showFootballGolf = false
    @State private var showBlindRank = false
    @State private var showOneMore = false
    @State private var showDraftMaster = false
    @State private var dailyBundle: DailyBundleDTO?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(modes) { mode in
                        GameModeTile(mode: mode) {
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
            .fullScreenCover(isPresented: $showGuessWho) {
                if let bundle = dailyBundle, let game = bundle.games.first {
                    GuessWhoView(puzzle: game.puzzle, date: bundle.date, onComplete: {})
                }
            }
            .fullScreenCover(isPresented: $showFootballBingo) {
                FootballBingoView(onComplete: {
                    showFootballBingo = false
                })
            }
            .fullScreenCover(isPresented: $showTargetMan) {
                TargetManView(onComplete: {
                    showTargetMan = false
                })
            }
            .fullScreenCover(isPresented: $showFootballGolf) {
                FootballGolfView(onComplete: {
                    showFootballGolf = false
                })
            }
            .fullScreenCover(isPresented: $showBlindRank) {
                BlindRankView(onComplete: {
                    showBlindRank = false
                })
            }
            .fullScreenCover(isPresented: $showOneMore) {
                OneMoreView(onComplete: {
                    showOneMore = false
                })
            }
            .fullScreenCover(isPresented: $showDraftMaster) {
                DraftMasterView(onComplete: {
                    showDraftMaster = false
                })
            }
        }
    }

    private func openMode(_ mode: GameModeMetaDTO) {
        guard mode.isAvailable else { return }
        switch GameModeCatalog.normalizedModeId(mode.id) {
        case GameModeID.guessWho.rawValue:
            showGuessWho = true
        case GameModeID.footballBingo.rawValue:
            showFootballBingo = true
        case GameModeID.targetMan.rawValue:
            showTargetMan = true
        case GameModeID.footballGolf.rawValue:
            showFootballGolf = true
        case GameModeID.blindRank.rawValue:
            showBlindRank = true
        case GameModeID.oneMore.rawValue:
            showOneMore = true
        case GameModeID.draftMaster.rawValue:
            showDraftMaster = true
        default:
            break
        }
    }
}

struct DailyTabView: View {
    @State private var bundle: DailyBundleDTO?

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let bundle {
                    Text(bundle.date)
                        .font(BKFont.caption())
                        .foregroundStyle(BKTheme.textMuted)

                    ForEach(bundle.games, id: \.modeId) { game in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(game.title)
                                .font(BKFont.headline())
                                .foregroundStyle(BKTheme.textPrimary)
                            Text(bundle.alreadyPlayed ? "Completed" : "Not played yet")
                                .font(BKFont.body())
                                .foregroundStyle(bundle.alreadyPlayed ? BKTheme.accent : BKTheme.textSecondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(20)
                        .background(BKTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                    }

                    Text("Archive coming soon")
                        .font(BKFont.caption())
                        .foregroundStyle(BKTheme.textMuted)
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
        }
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
