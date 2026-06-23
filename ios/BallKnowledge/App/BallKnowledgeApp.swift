import SwiftUI
import SwiftData

@main
struct BallKnowledgeApp: App {
    @State private var auth = AuthManager()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .preferredColorScheme(.dark)
        }
        .modelContainer(for: [
            CachedDailyBundle.self,
            PendingDailyCompletion.self,
            GuessWhoSession.self,
        ])
    }
}

struct RootView: View {
    @Environment(AuthManager.self) private var auth
    @AppStorage(UserDefaultsKeys.skippedTeamPick) private var skippedTeamPick = false

    private var needsTeamPick: Bool {
        auth.user?.favoriteTeamId == nil && !skippedTeamPick
    }

    var body: some View {
        Group {
            if auth.isLoading {
                LaunchLoadingView()
            } else if auth.isAuthenticated {
                if needsTeamPick {
                    TeamPickerView(onDone: {})
                } else {
                    MainTabView()
                }
            } else if UserDefaults.standard.bool(forKey: UserDefaultsKeys.hasCompletedOnboarding) {
                SignInOnlyView()
            } else {
                OnboardingContainerView()
            }
        }
        .task {
            await auth.bootstrap()
        }
    }
}

struct LaunchLoadingView: View {
    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()
            VStack(spacing: 16) {
                Ph.soccerBall.fill
                    .color(BKTheme.accent)
                    .frame(width: 48, height: 48)
                ProgressView()
                    .tint(BKTheme.accent)
            }
        }
    }
}

struct SignInOnlyView: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()
            VStack(spacing: 24) {
                Text("BALL KNOWLEDGE")
                    .font(BKFont.title())
                    .foregroundStyle(BKTheme.accent)

                SignInWithAppleButtonView { token, name in
                    Task { await auth.signIn(identityToken: token, displayName: name) }
                }
                .padding(.horizontal, 24)

                #if DEBUG
                Button("Dev Sign In") {
                    Task { await auth.devSignIn() }
                }
                .foregroundStyle(BKTheme.textMuted)
                #endif
            }
        }
    }
}
