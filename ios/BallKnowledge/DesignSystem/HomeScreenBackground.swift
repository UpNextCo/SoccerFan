import SwiftUI

/// Home scroll background — Rive when `home_ambient.riv` is bundled, procedural orbs otherwise.
struct HomeScreenBackground: View {
    var body: some View {
        if HomeRiveConfig.isAvailable {
            HomeRiveBackground()
        } else {
            HomeAmbientBackground()
        }
    }
}

struct HomeBackgroundFade: View {
    var body: some View {
        LinearGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: .clear, location: 0.34),
                .init(color: BKTheme.background.opacity(0.65), location: 0.52),
                .init(color: BKTheme.background, location: 0.68),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
    }
}
