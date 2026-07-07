import SwiftUI

// MARK: - Entrant icon

struct LMSEntrantIcon: View {
    let entrant: LMSEntrant
    let size: CGFloat
    var showYouLabel: Bool = true
    var emphasizeElimination: Bool = false

    @State private var eliminationScale: CGFloat = 1
    @State private var eliminationOpacity: Double = 1

    private var shirtColor: Color {
        if entrant.isUser {
            return Color(hue: entrant.shirtHue, saturation: 0.55, brightness: 0.92)
        }
        return Color(hue: entrant.shirtHue, saturation: 0.28, brightness: 0.78)
    }

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                RoundedRectangle(cornerRadius: size * 0.18, style: .continuous)
                    .fill(shirtColor.opacity(entrant.isEliminated ? 0.25 : 1))
                    .frame(width: size * 0.72, height: size * 0.82)
                    .overlay {
                        RoundedRectangle(cornerRadius: size * 0.18, style: .continuous)
                            .strokeBorder(
                                entrant.isUser ? BKTheme.accent.opacity(0.95) : Color.white.opacity(0.12),
                                lineWidth: entrant.isUser ? 1.8 : 0.6
                            )
                    }
                    .overlay(alignment: .top) {
                        Circle()
                            .fill(Color.white.opacity(entrant.isEliminated ? 0.15 : 0.35))
                            .frame(width: size * 0.22, height: size * 0.22)
                            .offset(y: -size * 0.08)
                    }
                    .overlay {
                        Image(systemName: "figure.stand")
                            .font(.system(size: size * 0.28, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(entrant.isEliminated ? 0.2 : 0.55))
                    }

                if entrant.isEliminated || emphasizeElimination {
                    Image(systemName: "xmark")
                        .font(.system(size: size * 0.34, weight: .black))
                        .foregroundStyle(BKTheme.wrong)
                        .shadow(color: .black.opacity(0.35), radius: 1, y: 1)
                }
            }
            .scaleEffect(eliminationScale)
            .opacity(eliminationOpacity)

            if entrant.isUser, showYouLabel {
                Text("YOU")
                    .font(.system(size: max(7, size * 0.16), weight: .bold, design: .rounded))
                    .tracking(0.4)
                    .foregroundStyle(BKTheme.accent)
            } else {
                Color.clear.frame(height: max(8, size * 0.18))
            }
        }
        .onChange(of: entrant.eliminationToken) { _, token in
            guard token > 0 else {
                eliminationScale = 1
                eliminationOpacity = 1
                return
            }
            runEliminationAnimation()
        }
        .onAppear {
            if entrant.eliminationToken > 0 {
                runEliminationAnimation()
            }
        }
    }

    private func runEliminationAnimation() {
        eliminationScale = 1
        eliminationOpacity = 1
        withAnimation(.spring(response: 0.18, dampingFraction: 0.45)) {
            eliminationScale = 1.15
        }
        withAnimation(.easeOut(duration: 0.22).delay(0.12)) {
            eliminationScale = 0.85
            eliminationOpacity = 0.35
        }
    }
}

// MARK: - Survivor field

struct LastManStandingSurvivorField: View {
    let entrants: [LMSEntrant]
    let remaining: Int
    let profile: LMSLayoutProfile
    var freezeField: Bool = false

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: profile.iconSize + profile.spacing), spacing: profile.spacing)]
    }

    var body: some View {
        ZStack {
            if profile.spotlight, entrants.count <= 3 {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [BKTheme.accent.opacity(0.22), .clear],
                            center: .center,
                            startRadius: 4,
                            endRadius: profile.iconSize * 2.2
                        )
                    )
                    .frame(width: profile.iconSize * 4, height: profile.iconSize * 4)
                    .blur(radius: 6)
            }

            LazyVGrid(columns: columns, alignment: .center, spacing: profile.spacing) {
                ForEach(entrants) { entrant in
                    LMSEntrantIcon(
                        entrant: entrant,
                        size: profile.iconSize,
                        showYouLabel: remaining > 3 || entrant.isUser
                    )
                }
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxHeight: profile.maxHeight)
        .clipped()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .animation(freezeField ? nil : .spring(response: 0.35, dampingFraction: 0.82), value: entrants.count)
    }
}
