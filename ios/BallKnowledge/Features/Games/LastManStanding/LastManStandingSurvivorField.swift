import SwiftUI

// MARK: - Entrant icon

struct LMSEntrantIcon: View {
    let entrant: LMSEntrant
    let size: CGFloat
    var showYouLabel: Bool = true
    var emphasizeElimination: Bool = false

    private var isOut: Bool { entrant.isEliminated || emphasizeElimination }

    private var iconColor: Color {
        if isOut { return Color.white.opacity(0.14) }
        if entrant.isUser { return BKTheme.accent }
        return Color.white.opacity(0.26)
    }

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.68, weight: .regular))
                    .foregroundStyle(iconColor)
                    .frame(width: size, height: size)

                if isOut {
                    Image(systemName: "xmark")
                        .font(.system(size: size * 0.36, weight: .bold))
                        .foregroundStyle(BKTheme.wrong)
                }
            }

            Group {
                if entrant.isUser, showYouLabel {
                    Text("YOU")
                        .font(.system(size: max(7, size * 0.15), weight: .bold, design: .rounded))
                        .tracking(0.4)
                        .foregroundStyle(BKTheme.accent.opacity(isOut ? 0.35 : 1))
                } else {
                    Text(" ")
                        .font(.system(size: max(6, size * 0.13)))
                }
            }
            .frame(height: max(7, size * 0.16))
        }
        .frame(width: size + 2, height: size + max(9, size * 0.2))
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
        .animation(freezeField ? nil : .spring(response: 0.25, dampingFraction: 0.86), value: entrants.count)
    }
}
