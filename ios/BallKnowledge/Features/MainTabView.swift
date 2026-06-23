import SwiftUI

enum AppTab: Hashable {
    case today, leagues, you
}

struct MainTabView: View {
    @State private var selectedTab: AppTab = .today

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                switch selectedTab {
                case .today:
                    HomeView(selectedTab: $selectedTab)
                case .leagues:
                    LeaguesTabView()
                case .you:
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
