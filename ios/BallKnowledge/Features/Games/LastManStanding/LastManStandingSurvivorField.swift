import SwiftUI

// MARK: - Entrant emoji palette

/// Head-and-shoulders adult busts + Fitzpatrick skin tones. Seeded per entrant.
/// Mostly clean 🧑 busts in light tones (same family as YOU); 👨 is rare because
/// Apple's man glyph often renders with a moustache.
enum LMSEntrantEmoji {
    private static let tones: [String] = [
        "\u{1F3FB}", // light
        "\u{1F3FC}", // medium-light
        "\u{1F3FD}", // medium
        "\u{1F3FE}", // medium-dark
        "\u{1F3FF}", // dark
    ]

    private static let youEmoji = "🧑" + "\u{1F3FB}"

    static func glyph(for entrant: LMSEntrant) -> String {
        if entrant.isUser { return youEmoji }
        var hasher = Hasher()
        hasher.combine(entrant.id)
        let seed = UInt64(bitPattern: Int64(hasher.finalize()))

        // ~85% 🧑 (clean bust), ~8% 👩, ~7% 👨 (moustache-prone — keep scarce).
        let baseRoll = Int(seed % 100)
        let base: String
        if baseRoll < 8 {
            base = "👩"
        } else if baseRoll < 15 {
            base = "👨"
        } else {
            base = "🧑"
        }

        // Mostly light like YOU; a little medium; sparse darker tones.
        let toneRoll = Int((seed >> 8) % 100)
        let toneIndex: Int
        if toneRoll < 4 {
            toneIndex = 4 // dark
        } else if toneRoll < 8 {
            toneIndex = 3 // medium-dark
        } else if toneRoll < 22 {
            toneIndex = 2 // medium
        } else if toneRoll < 40 {
            toneIndex = 1 // medium-light
        } else {
            toneIndex = 0 // light
        }

        return base + tones[toneIndex]
    }
}

// MARK: - Entrant icon

struct LMSEntrantIcon: View {
    let entrant: LMSEntrant
    let size: CGFloat
    var showYouLabel: Bool = true
    var emphasizeElimination: Bool = false
    /// When false, skip the per-cell label gutter so a packed crowd fits without scrolling.
    var reserveLabelGutter: Bool = true

    private var isOut: Bool { entrant.isEliminated || emphasizeElimination }

    private var emoji: String { LMSEntrantEmoji.glyph(for: entrant) }

    private var labelHeight: CGFloat {
        reserveLabelGutter ? max(7, size * 0.16) : 0
    }

    var body: some View {
        VStack(spacing: reserveLabelGutter ? 2 : 0) {
            ZStack {
                Text(emoji)
                    .font(.system(size: size * 0.82))
                    .frame(width: size, height: size)
                    .opacity(isOut ? 0.28 : 1)
                    .saturation(isOut ? 0.15 : 1)

                if isOut {
                    Image(systemName: "xmark")
                        .font(.system(size: size * 0.36, weight: .bold))
                        .foregroundStyle(BKTheme.wrong)
                }
            }

            if reserveLabelGutter {
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
                .frame(height: labelHeight)
            } else if entrant.isUser, showYouLabel {
                // Compact crowd: tiny YOU tag overlaid under the glyph without padding every cell.
                Text("YOU")
                    .font(.system(size: 7, weight: .bold, design: .rounded))
                    .tracking(0.3)
                    .foregroundStyle(BKTheme.accent.opacity(isOut ? 0.35 : 1))
                    .offset(y: -1)
            }
        }
        .frame(width: size, height: size + (reserveLabelGutter ? labelHeight + 2 : (entrant.isUser && showYouLabel ? 8 : 0)))
    }
}

// MARK: - Survivor field

struct LastManStandingSurvivorField: View {
    let entrants: [LMSEntrant]
    let remaining: Int
    let profile: LMSLayoutProfile
    var freezeField: Bool = false

    /// Dense opening field — no label gutters, fixed column count.
    private var isPackedCrowd: Bool { remaining > 22 }

    private var columns: [GridItem] {
        if isPackedCrowd {
            return Array(
                repeating: GridItem(.flexible(minimum: 0), spacing: profile.spacing),
                count: profile.minColumns
            )
        }
        let cell = profile.iconSize
        return [GridItem(.adaptive(minimum: cell, maximum: cell), spacing: profile.spacing)]
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .center, spacing: profile.spacing) {
            ForEach(entrants) { entrant in
                LMSEntrantIcon(
                    entrant: entrant,
                    size: profile.iconSize,
                    showYouLabel: remaining <= 22 || entrant.isUser,
                    reserveLabelGutter: !isPackedCrowd
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .animation(freezeField ? nil : .easeInOut(duration: 0.32), value: entrants.count)
    }

    /// Exact height needed to show every entrant — dock sizes to this (no inner scroll).
    static func contentHeight(entrantCount: Int, profile: LMSLayoutProfile, availableWidth: CGFloat, remaining: Int) -> CGFloat {
        guard entrantCount > 0, availableWidth > 0 else { return 0 }
        let packed = remaining > 22
        let spacing = profile.spacing
        let cols: Int
        if packed {
            cols = max(1, profile.minColumns)
        } else {
            let cell = profile.iconSize
            cols = max(1, Int((availableWidth + spacing) / (cell + spacing)))
        }
        let rows = (entrantCount + cols - 1) / cols
        // Packed crowd: emoji-only rows. Later rounds: emoji + YOU label gutter.
        let rowHeight: CGFloat = packed
            ? profile.iconSize + (/* YOU tag under first cell */ 0)
            : profile.iconSize + max(9, profile.iconSize * 0.2)
        // Leave a sliver for the YOU tag that hangs under the user cell in packed mode.
        let youSlop: CGFloat = packed ? 8 : 0
        return CGFloat(rows) * rowHeight + CGFloat(max(0, rows - 1)) * spacing + youSlop
    }
}
