import Foundation

enum AppConfig {
    static let productionAPIURL = "https://ballknowledge-production.up.railway.app"

    #if DEBUG
    // Use production API while local backend isn't running. Switch to http://127.0.0.1:3000 for local dev.
    static let apiBaseURL = URL(string: productionAPIURL)!
    #else
    static let apiBaseURL = URL(string: productionAPIURL)!
    #endif

    static let privacyPolicyURL = URL(string: "https://ballknowledge.app/privacy")!
    static let maxGuessWhoGuesses = 8
    static let dailyXpGoal = 3000

    /// Dev sign-in can replay dailies and skips completed-game UI lockout (DEBUG only).
    static func allowsUnlimitedDailyPlay(isDevAccount: Bool) -> Bool {
        #if DEBUG
        return isDevAccount
        #else
        return false
        #endif
    }

    /// DEBUG: auto-present the all-7 celebration on Home appear so you can iterate on it
    /// without clearing the daily set. Flip to `false` when done previewing.
    #if DEBUG
    static let previewDailyCompleteCelebration = true
    #endif
}

enum UserDefaultsKeys {
    static let hasCompletedOnboarding = "hasCompletedOnboarding"
    static let isDevAccount = "isDevAccount"
    static let completedPostSignInSetup = "completedPostSignInSetup"
    /// Local calendar date (YYYY-MM-DD) for which the all-7 celebration was already shown.
    static let dailyCompleteCelebratedDate = "dailyCompleteCelebratedDate"
}
