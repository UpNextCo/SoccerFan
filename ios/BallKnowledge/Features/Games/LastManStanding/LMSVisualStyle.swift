import SwiftUI

// MARK: - Shared polish for Last Man Standing surfaces

enum LMSVisualStyle {
    static let cardRadius: CGFloat = 18
    static let optionRadius: CGFloat = 16
    static let hairlineOpacity: Double = 0.055

    static func cardStroke<S: InsettableShape>(_ shape: S) -> some View {
        shape.strokeBorder(Color.white.opacity(hairlineOpacity), lineWidth: 0.5)
    }
}

struct LMSOptionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.975 : 1)
            .opacity(configuration.isPressed ? 0.88 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}
