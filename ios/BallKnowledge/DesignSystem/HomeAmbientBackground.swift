import SwiftUI

/// Soft green atmosphere for the home hero — static gradients (no TimelineView / blur stacks).
struct HomeAmbientBackground: View {
    var body: some View {
        GeometryReader { geo in
            ZStack {
                BKTheme.background
                StaticAmbientGlowLayer(size: geo.size, intensity: 1.0, includeSpotlight: true)
            }
        }
        .overlay { contentFade }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    private var contentFade: some View {
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

/// Green glow layer for in-game stadium backdrops (no animation).
struct AmbientGlowOverlay: View {
    var intensity: Double = 1.0

    var body: some View {
        GeometryReader { geo in
            StaticAmbientGlowLayer(size: geo.size, intensity: intensity, includeSpotlight: false)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

// MARK: - Static ambient primitives

/// Frozen snapshot of the old animated hero — same palette, no per-frame blur/redraw cost.
private struct StaticAmbientGlowLayer: View {
    let size: CGSize
    var intensity: Double = 1.0
    var includeSpotlight: Bool = false

    var body: some View {
        ZStack {
            if includeSpotlight {
                RadialGradient(
                    colors: [
                        Color(hex: "0C2218").opacity(0.58),
                        BKTheme.background.opacity(0.26),
                        BKTheme.background,
                    ],
                    center: UnitPoint(x: 0.5, y: 0.06),
                    startRadius: 0,
                    endRadius: max(size.width, size.height) * 0.55
                )
            }

            staticRotatingWash(size: size, intensity: intensity)

            staticGlowOrb(
                size: size,
                center: CGPoint(x: size.width * 0.12, y: size.height * 0.02),
                diameter: 300,
                core: BKTheme.accent.opacity(0.11 * intensity)
            )
            staticGlowOrb(
                size: size,
                center: CGPoint(x: size.width * 0.88, y: size.height * 0.08),
                diameter: 240,
                core: Color(hex: "00AA55").opacity(0.075 * intensity)
            )
            staticGlowOrb(
                size: size,
                center: CGPoint(x: size.width * 0.52, y: size.height * -0.04),
                diameter: 194,
                core: BKTheme.accent.opacity(0.048 * intensity)
            )
        }
    }
}

private func staticRotatingWash(size: CGSize, intensity: Double) -> some View {
    AngularGradient(
        stops: [
            .init(color: .clear, location: 0),
            .init(color: BKTheme.accent.opacity(0.028 * intensity), location: 0.22),
            .init(color: .clear, location: 0.45),
            .init(color: Color(hex: "006633").opacity(0.02 * intensity), location: 0.68),
            .init(color: .clear, location: 1),
        ],
        center: .center,
        angle: .degrees(24)
    )
    .frame(width: size.width * 1.6, height: size.height * 0.9)
    .opacity(0.48 * intensity)
    .offset(y: -size.height * 0.08)
}

private func staticGlowOrb(size: CGSize, center: CGPoint, diameter: CGFloat, core: Color) -> some View {
    Circle()
        .fill(
            RadialGradient(
                colors: [core, core.opacity(0.35), .clear],
                center: .center,
                startRadius: 0,
                endRadius: diameter * 0.5
            )
        )
        .frame(width: diameter, height: diameter)
        .position(x: center.x, y: center.y)
}

// MARK: - Game stadium backdrop

/// Shared in-game atmosphere: faint floodlit stadium photo fading to page-black, plus static green glow.
struct StadiumBackground: View {
    var glowIntensity: Double = 0.45

    var body: some View {
        ZStack {
            stadiumPhotoLayer
            AmbientGlowOverlay(intensity: glowIntensity)
        }
        .ignoresSafeArea()
    }

    private var stadiumPhotoLayer: some View {
        GeometryReader { geo in
            ZStack(alignment: .top) {
                BKTheme.background
                GameModeBundleImage(name: "stadium")
                    .scaledToFill()
                    .frame(width: geo.size.width, height: geo.size.height * 0.88, alignment: .top)
                    .clipped()
                    .grayscale(0.5)
                    .blur(radius: 4)
                    .opacity(0.03)
                    .overlay(
                        LinearGradient(
                            stops: [
                                .init(color: BKTheme.background.opacity(0.0), location: 0.0),
                                .init(color: BKTheme.background.opacity(0.0), location: 0.30),
                                .init(color: BKTheme.background.opacity(0.75), location: 0.60),
                                .init(color: BKTheme.background, location: 0.78),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
            }
        }
    }
}
