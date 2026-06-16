import Foundation
import SwiftUI

@MainActor
@Observable
final class AuthManager {
    var user: UserProfileDTO?
    var isAuthenticated = false
    var isLoading = true
    var errorMessage: String?

    func bootstrap() async {
        isLoading = true
        defer { isLoading = false }

        guard await APIClient.shared.hasToken() else {
            isAuthenticated = false
            return
        }

        do {
            user = try await APIClient.shared.me()
            isAuthenticated = true
        } catch {
            await APIClient.shared.clearToken()
            isAuthenticated = false
        }
    }

    func signIn(identityToken: String, displayName: String?) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.authApple(
                identityToken: identityToken,
                displayName: displayName
            )
            await APIClient.shared.setToken(response.token)
            user = response.user
            isAuthenticated = true
            UserDefaults.standard.set(true, forKey: UserDefaultsKeys.hasCompletedOnboarding)
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

    func signOut() async {
        await APIClient.shared.clearToken()
        user = nil
        isAuthenticated = false
    }

    func deleteAccount() async {
        do {
            try await APIClient.shared.deleteAccount()
            await signOut()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    #if DEBUG
    func devSignIn() async {
        await signIn(identityToken: "dev:\(UUID().uuidString)", displayName: "Dev Player")
    }
    #endif
}
