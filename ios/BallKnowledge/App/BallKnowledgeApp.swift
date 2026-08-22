import SwiftUI
import SwiftData

@main
struct BallKnowledgeApp: App {
    @State private var auth = AuthManager()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .preferredColorScheme(.light)
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
    @AppStorage(UserDefaultsKeys.hasCompletedOnboarding) private var completedOnboarding = false
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
            } else if completedOnboarding {
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
        .dismissesKeyboardOnDragUp()
    }
}

struct LaunchLoadingView: View {
    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()
            VStack(spacing: 16) {
                GameModeBundleImage(name: "balllsss")
                    .scaledToFill()
                    .frame(width: 80, height: 80)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                ProgressView()
                    .tint(BKTheme.accent)
            }
        }
    }
}

struct SignInOnlyView: View {
    @AppStorage(UserDefaultsKeys.hasCompletedOnboarding) private var completedOnboarding = true

    var body: some View {
        ZStack {
            HomeAmbientBackground()
            SignInOnboardingPage(
                title: "Welcome back",
                subtitle: "Sign in to continue today's games, keep your streak moving and represent your club.",
                secondaryActionTitle: "See how it works",
                secondaryAction: { completedOnboarding = false }
            )
        }
        .ignoresSafeArea(edges: .bottom)
    }
}
