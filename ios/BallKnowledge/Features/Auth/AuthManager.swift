import Foundation
import SwiftUI
import SwiftData

@MainActor
@Observable
final class AuthManager {
    var user: UserProfileDTO?
    var isAuthenticated = false
    var isLoading = true
    var errorMessage: String?
    private(set) var isDevAccount = false

    var allowsUnlimitedDailyPlay: Bool {
        AppConfig.allowsUnlimitedDailyPlay(isDevAccount: isDevAccount)
    }

    func bootstrap(context: ModelContext) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        guard await APIClient.shared.hasToken() else {
            isAuthenticated = false
            clearLocalAccountState(context: context)
            return
        }

        do {
            user = try await APIClient.shared.me()
            isAuthenticated = true
            isDevAccount = UserDefaults.standard.bool(forKey: UserDefaultsKeys.isDevAccount)
            await ProfileSync.pushLocalToServer(auth: self)
        } catch APIError.unauthorized {
            await tearDownSession(context: context, message: nil)
        } catch APIError.accountMissing {
            // The token outlived its account. Anything cached locally belongs to an account that no
            // longer exists, so it must go — otherwise the app shows phantom XP against a fresh one.
            await tearDownSession(
                context: context,
                message: "Your account is no longer available. Please sign in again."
            )
        } catch {
            // Keep the valid local session usable during transient failures, but only claim to be
            // offline when it really was connectivity — a server error is not the same thing.
            isAuthenticated = true
            isDevAccount = UserDefaults.standard.bool(forKey: UserDefaultsKeys.isDevAccount)
            errorMessage = error is URLError
                ? "You're offline. Some information may be out of date."
                : error.localizedDescription
        }
    }

    private func tearDownSession(context: ModelContext, message: String?) async {
        await APIClient.shared.clearToken()
        user = nil
        isAuthenticated = false
        isDevAccount = false
        clearLocalAccountState(context: context)
        errorMessage = message
    }

    func signIn(identityToken: String, displayName: String?) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        isDevAccount = identityToken.hasPrefix("dev:")
        UserDefaults.standard.set(isDevAccount, forKey: UserDefaultsKeys.isDevAccount)

        do {
            let response = try await APIClient.shared.authApple(
                identityToken: identityToken,
                displayName: displayName
            )
            await APIClient.shared.setToken(response.token)
            user = response.user
            isAuthenticated = true
            UserDefaults.standard.set(true, forKey: UserDefaultsKeys.hasCompletedOnboarding)
            await ProfileSync.pushLocalToServer(auth: self)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refreshProfile() async {
        do {
            user = try await APIClient.shared.me()
        } catch {
            // Keep cached profile on transient errors
        }
    }

    func applyProfile(_ profile: UserProfileDTO) {
        user = profile
    }

    func signOut(context: ModelContext) async {
        await APIClient.shared.clearToken()
        user = nil
        isAuthenticated = false
        isDevAccount = false
        clearLocalAccountState(context: context)
    }

    func handleUnauthorized(context: ModelContext) async {
        let hasToken = await APIClient.shared.hasToken()
        guard isAuthenticated || hasToken else { return }
        errorMessage = "Your session expired. Please sign in again."
        await signOut(context: context)
    }

    /// Reset per-account state stored on this device so the next account that signs in starts clean
    /// (runs the pick-team / profile setup, no stale "games done", avatar or display name).
    private func clearLocalAccountState(context: ModelContext) {
        let defaults = UserDefaults.standard
        defaults.set(false, forKey: UserDefaultsKeys.completedPostSignInSetup)
        defaults.removeObject(forKey: UserDefaultsKeys.isDevAccount)
        defaults.removeObject(forKey: UserDefaultsKeys.dailyCompleteCelebratedDate)
        defaults.removeObject(forKey: UserDefaultsKeys.weeklyLeagueIntroShown)
        ActivityFeedStore.clear()
        DailyCompletionService.clearAllLocalCompletions()
        PerfectScoreStore.clear()
        OfflineCache.clearAllAccountData(context: context)
        LocalProfile.reset()
    }

    func deleteAccount(context: ModelContext) async {
        do {
            try await APIClient.shared.deleteAccount()
            await signOut(context: context)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    #if DEBUG
    func devSignIn() async {
        await signIn(identityToken: "dev:ballknowledge-vs-mate", displayName: "VS Mate")
    }
    #endif
}
