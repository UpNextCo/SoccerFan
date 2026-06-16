import Foundation

enum AppConfig {
    #if DEBUG
    static let apiBaseURL = URL(string: "http://127.0.0.1:3000")!
    #else
    static let apiBaseURL = URL(string: "https://ballknowledge-api.up.railway.app")!
    #endif

    static let privacyPolicyURL = URL(string: "https://ballknowledge.app/privacy")!
    static let maxGuessWhoGuesses = 8
    static let dailyXpGoal = 300
}

enum UserDefaultsKeys {
    static let hasCompletedOnboarding = "hasCompletedOnboarding"
}
