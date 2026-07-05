import Foundation

enum HomeRiveConfig {
    /// Drop `home_ambient.riv` into `Resources/Rive/` — uses Rive when present, orbs otherwise.
    static let fileName = "home_ambient"

    static var bundleURL: URL? {
        Bundle.main.url(forResource: fileName, withExtension: "riv", subdirectory: "Rive")
            ?? Bundle.main.url(forResource: fileName, withExtension: "riv")
    }

    static var isAvailable: Bool {
        bundleURL != nil
    }
}
