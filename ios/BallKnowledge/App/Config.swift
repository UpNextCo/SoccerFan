import Foundation

enum AppConfig {
    static let productionAPIURL = "https://ballknowledge-production.up.railway.app"

    #if DEBUG
    // Use production API while local backend isn't running. Switch to http://127.0.0.1:3000 for local dev.
    static let apiBaseURL = URL(string: productionAPIURL)!
    #else
    static let apiBaseURL = URL(string: productionAPIURL)!
    #endif

    static let websiteURL = URL(string: productionAPIURL)!
    static let privacyPolicyURL = URL(string: "\(productionAPIURL)/privacy")!
    static let termsOfServiceURL = URL(string: "\(productionAPIURL)/terms")!
    static let supportURL = URL(string: "\(productionAPIURL)/support")!
    static let shareURL = websiteURL
    static let maxGuessWhoGuesses = 8
    static let dailyXpGoal = 3000

    /// Numeric Apple ID from App Store Connect → your app → App Information.
    /// Needed for Profile → Rate (opens the write-review page). `requestReview()` alone
    /// is throttled by Apple and usually does nothing on TestFlight.
    /// Set this once the ASC app record exists — it works before public release.
    static let appStoreId: String? = "6791646115"

    /// App Store “Write a Review” deep link. Nil until `appStoreId` is set.
    static var rateAppURL: URL? {
        guard let appStoreId, !appStoreId.isEmpty else { return nil }
        return URL(string: "https://apps.apple.com/app/id\(appStoreId)?action=write-review")
    }

    /// Dev sign-in can replay dailies and skips completed-game UI lockout (DEBUG only).
    static func allowsUnlimitedDailyPlay(isDevAccount: Bool) -> Bool {
        #if DEBUG
        return isDevAccount
        #else
        return false
        #endif
    }

    /// DEBUG: auto-present the streak toast on Home appear so you can iterate on it
    /// without finishing a daily. Flip to `false` when done previewing.
    #if DEBUG
    static let previewDailyCompleteCelebration = false
    /// DEBUG: auto-present the trophy cabinet on Home appear.
    /// Flip to `false` when done previewing — Profile has the real entry now.
    static let previewAwards = false
    #endif
}

enum UserDefaultsKeys {
    static let hasCompletedOnboarding = "hasCompletedOnboarding"
    static let isDevAccount = "isDevAccount"
    static let completedPostSignInSetup = "completedPostSignInSetup"
    /// Local calendar date (YYYY-MM-DD) for which the first-game streak toast was already shown.
    static let dailyCompleteCelebratedDate = "dailyCompleteCelebratedDate"
    /// One-shot weekly pyramid league intro (Leagues → Weekly).
    /// Bumped to V2 so the new GameTiles trophy art is shown once.
    static let weeklyLeagueIntroShown = "weeklyLeagueIntroShownV2"
}
