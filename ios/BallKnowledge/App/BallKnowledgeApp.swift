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
            GameProgress.self,
        ])
    }
}

struct RootView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(\.modelContext) private var modelContext
    @AppStorage(UserDefaultsKeys.completedPostSignInSetup) private var completedSetup = false

    var body: some View {
        Group {
            if auth.isLoading {
                LaunchLoadingView()
            } else if auth.isAuthenticated {
                // Show the pick-team / profile setup for any account that hasn't finished it — a
                // returning user with a club already set skips straight through.
                if completedSetup || auth.user?.favoriteTeamId != nil {
                    MainTabView()
                } else {
                    PostSignInSetupView()
                }
            } else if UserDefaults.standard.bool(forKey: UserDefaultsKeys.hasCompletedOnboarding) {
                SignInOnlyView()
            } else {
                OnboardingContainerView()
            }
        }
        .task {
            await auth.bootstrap(context: modelContext)
        }
        .onReceive(NotificationCenter.default.publisher(for: .sessionUnauthorized)) { _ in
            Task { await auth.handleUnauthorized(context: modelContext) }
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

                SignInWithAppleButtonView(
                    onSignedIn: { token, name in
                        Task { await auth.signIn(identityToken: token, displayName: name) }
                    },
                    onError: { auth.errorMessage = $0 }
                )
                .padding(.horizontal, 24)

                if let error = auth.errorMessage {
                    Text(error)
                        .font(BKFont.body(13))
                        .foregroundStyle(BKTheme.wrong)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                HStack(spacing: 18) {
                    Link("Privacy Policy", destination: AppConfig.privacyPolicyURL)
                    Link("Terms of Service", destination: AppConfig.termsOfServiceURL)
                }
                .font(BKFont.caption(11))
                .foregroundStyle(BKTheme.textMuted)
            }
        }
    }
}
