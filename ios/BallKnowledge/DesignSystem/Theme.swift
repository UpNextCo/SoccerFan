import SwiftUI

enum BKTheme {
    static let background = Color(hex: "0A0A0A")
    static let card = Color(hex: "1A1A1A")
    static let cardElevated = Color(hex: "242424")
    /// Backdrop behind game tile art — lifts icons whose PNGs use #141414.
    static let tileIconBackdrop = Color(hex: "181818")
    static let tileIconBrightness: CGFloat = 0.02
    static let accent = Color(hex: "00FF66")
    static let accentMuted = Color(hex: "00CC52")
    static let textPrimary = Color.white
    static let textSecondary = Color(hex: "AAAAAA")
    static let textMuted = Color(hex: "666666")
    static let wrong = Color(hex: "FF4444")
    static let partial = Color(hex: "FFAA00")
    static let correct = Color(hex: "00FF66")
    static let streak = Color(hex: "FF6B00")
    static let inProgress = Color(hex: "FFB020")

    // Guess Who feedback badges (Who Are Ya style)
    static let guessCorrect = Color(hex: "00E055")
    static let guessWrong = Color(hex: "3D3D3D")
    static let guessPartial = Color(hex: "5C5C5C")
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b: Double
        switch hex.count {
        case 6:
            r = Double((int >> 16) & 0xFF) / 255
            g = Double((int >> 8) & 0xFF) / 255
            b = Double(int & 0xFF) / 255
        default:
            r = 1; g = 1; b = 1
        }
        self.init(red: r, green: g, blue: b)
    }
}

struct BKFont {
    static func title(_ size: CGFloat = 28) -> Font {
        .system(size: size, weight: .heavy, design: .rounded)
    }

    static func headline(_ size: CGFloat = 17) -> Font {
        .system(size: size, weight: .bold, design: .rounded)
    }

    static func body(_ size: CGFloat = 15) -> Font {
        .system(size: size, weight: .medium, design: .default)
    }

    static func caption(_ size: CGFloat = 12) -> Font {
        .system(size: size, weight: .semibold, design: .rounded)
    }
}
