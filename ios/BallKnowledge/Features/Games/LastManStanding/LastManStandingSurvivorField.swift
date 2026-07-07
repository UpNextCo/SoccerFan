import SwiftUI

// MARK: - Entrant icon

struct LMSEntrantIcon: View {
    let entrant: LMSEntrant
    let size: CGFloat
    var showYouLabel: Bool = true
    var emphasizeElimination: Bool = false

    @State private var eliminationScale: CGFloat = 1
    @State private var eliminationOpacity: Double = 1

    private var bustOpacity: Double {
        if entrant.isEliminated || emphasizeElimination { return 0.14 }
        if entrant.isUser { return 0.92 }
        return 0.38
    }

    var body: some View {
        VStack(spacing: 3) {
            ZStack {
                if entrant.isUser {
                    Circle()
                        .stroke(BKTheme.accent.opacity(0.85), lineWidth: max(1.2, size * 0.07))
                        .frame(width: size + 4, height: size + 4)
                }

                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.72, weight: .medium))
                    .foregroundStyle(Color.white.opacity(bustOpacity))
                    .frame(width: size, height: size)

                if entrant.isEliminated || emphasizeElimination {
                    Image(systemName: "xmark")
                        .font(.system(size: size * 0.38, weight: .black))
                        .foregroundStyle(BKTheme.wrong)
                        .shadow(color: .black.opacity(0.4), radius: 1, y: 1)
                }
            }
            .scaleEffect(eliminationScale)
            .opacity(eliminationOpacity)

            Group {
                if entrant.isUser, showYouLabel {
                    Text("YOU")
                        .font(.system(size: max(7, size * 0.15), weight: .bold, design: .rounded))
                        .tracking(0.4)
                        .foregroundStyle(BKTheme.accent)
                } else {
                    Text(" ")
                        .font(.system(size: max(7, size * 0.15)))
                }
            }
            .frame(height: max(8, size * 0.18))
        }
        .frame(width: size + 2, height: size + max(10, size * 0.22))
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

    private var cellSize: CGFloat { profile.iconSize + 2 }

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: cellSize, maximum: cellSize), spacing: profile.spacing)]
    }

    var body: some View {
        ZStack(alignment: .top) {
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
                    .padding(.top, 8)
            }

            LazyVGrid(columns: columns, alignment: .center, spacing: profile.spacing) {
                ForEach(entrants) { entrant in
                    LMSEntrantIcon(
                        entrant: entrant,
                        size: profile.iconSize,
                        showYouLabel: remaining <= 22 || entrant.isUser
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .top)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, maxHeight: profile.maxHeight, alignment: .top)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .animation(freezeField ? nil : .spring(response: 0.35, dampingFraction: 0.82), value: entrants.count)
    }
}
