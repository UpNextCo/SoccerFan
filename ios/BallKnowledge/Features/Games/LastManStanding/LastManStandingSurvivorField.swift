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
        if entrant.isEliminated || emphasizeElimination { return 0.12 }
        if entrant.isUser { return 0.88 }
        return 0.26
    }

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                if entrant.isUser {
                    Circle()
                        .stroke(BKTheme.accent.opacity(0.55), lineWidth: max(1, size * 0.045))
                        .frame(width: size + 3, height: size + 3)
                }

                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.68, weight: .regular))
                    .foregroundStyle(Color.white.opacity(bustOpacity))
                    .frame(width: size, height: size)

                if entrant.isEliminated || emphasizeElimination {
                    Image(systemName: "xmark")
                        .font(.system(size: size * 0.34, weight: .bold))
                        .foregroundStyle(BKTheme.wrong.opacity(0.9))
                }
            }
            .scaleEffect(eliminationScale)
            .opacity(eliminationOpacity)

            Group {
                if entrant.isUser, showYouLabel {
                    Text("YOU")
                        .font(.system(size: max(7, size * 0.15), weight: .bold, design: .rounded))
                        .tracking(0.4)
                        .foregroundStyle(BKTheme.accent.opacity(0.8))
                } else {
                    Text(" ")
                        .font(.system(size: max(6, size * 0.13)))
                }
            }
            .frame(height: max(7, size * 0.16))
        }
        .frame(width: size + 2, height: size + max(9, size * 0.2))
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
        LazyVGrid(columns: columns, alignment: .center, spacing: profile.spacing) {
            ForEach(entrants) { entrant in
                LMSEntrantIcon(
                    entrant: entrant,
                    size: profile.iconSize,
                    showYouLabel: remaining <= 22 || entrant.isUser
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: profile.maxHeight, alignment: .top)
        .padding(.top, 2)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .animation(freezeField ? nil : .spring(response: 0.38, dampingFraction: 0.86), value: entrants.count)
    }
}
