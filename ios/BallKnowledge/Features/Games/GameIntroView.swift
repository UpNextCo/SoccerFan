import SwiftUI

/// Per-device record of which games the player has chosen to skip the "how to play" intro for.
enum GameIntroPreferences {
    private static let storageKey = "game_intro_hidden_mode_ids"

    static func isHidden(_ mode: GameModeID) -> Bool {
        hiddenSet().contains(mode.rawValue)
    }

    static func hide(_ mode: GameModeID) {
        var ids = hiddenSet()
        ids.insert(mode.rawValue)
        UserDefaults.standard.set(Array(ids), forKey: storageKey)
    }

    /// Reset so intros show again (e.g. offered from Settings).
    static func reset() {
        UserDefaults.standard.removeObject(forKey: storageKey)
    }

    private static func hiddenSet() -> Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: storageKey) ?? [])
    }
}

/// The "how to play" copy for each game - a one-line tagline plus a few concise steps.
struct GameIntroContent {
    let tagline: String
    let steps: [String]

    static func forMode(_ mode: GameModeID) -> GameIntroContent {
        switch mode {
        case .guessWho:
            return GameIntroContent(
                tagline: "Guess the mystery footballer.",
                steps: [
                    "Each guess reveals how you compare on nationality, league, club, position, age and foot.",
                    "Green = exact match, yellow = close, arrows point higher or lower on age.",
                    "Crack it in as few guesses as you can - fewer guesses, more XP.",
                ]
            )
        case .targetMan:
            return GameIntroContent(
                tagline: "Hit the stat target.",
                steps: [
                    "Pick 5 players whose combined total for the day's stat lands as close to the target as possible.",
                    "You don't need to be exact - the closer you get, the more XP you bank.",
                ]
            )
        case .blindRank:
            return GameIntroContent(
                tagline: "Rank them by the hidden stat.",
                steps: [
                    "Place 10 players in order, highest to lowest, for the day's stat.",
                    "Rearrange as much as you like - only your final order counts.",
                    "The closer each player is to their true spot, the more XP.",
                ]
            )
        case .footballBingo:
            return GameIntroContent(
                tagline: "Fill the grid before the clock runs out.",
                steps: [
                    "Every square is a clue - a nationality, a club, a trophy or a stat.",
                    "Name a player who fits each square. Careful: a player can only be used once.",
                    "The more of your line-up you have left when the grid's full, the more XP.",
                ]
            )
        case .oneMore:
            return GameIntroContent(
                tagline: "Risk it for the streak.",
                steps: [
                    "Two players - one clears the day's threshold. Pick the one who qualifies.",
                    "Every correct pick banks XP and builds your streak; one wrong pick loses it all.",
                    "Cash out whenever you like - push your luck for more XP.",
                ]
            )
        case .draftMaster:
            return GameIntroContent(
                tagline: "Build the highest-scoring XI.",
                steps: [
                    "Drag each constraint chip onto a position on the pitch.",
                    "Pick a player who fits the chip and plays that role - they score their total for the day's stat.",
                    "The closer you get to the perfect XI, the more XP.",
                ]
            )
        case .worldCupXI:
            return GameIntroContent(
                tagline: "Name the mystery World Cup XI.",
                steps: [
                    "Each position has a clue pointing to one specific World Cup player.",
                    "Name as many as you can - get 6 of 11 to win.",
                    "Every correct pick adds XP.",
                ]
            )
        case .footballGolf:
            return GameIntroContent(
                tagline: "Nine holes. Beat par.",
                steps: [
                    "Each hole is a prompt - name valid answers to reach the hole's points target.",
                    "Rarer answers are worth more; common ones get you to par the easy way.",
                    "Go under par for big XP - every stroke over par chips it away.",
                ]
            )
        case .clubChain:
            return GameIntroContent(
                tagline: "Link them by shared clubs.",
                steps: [
                    "Connect the two players through a chain of real teammates.",
                    "Each step must be two players who shared a club at the same time.",
                    "Fewer steps earns a better medal - and more XP.",
                ]
            )
        case .footballTower:
            return GameIntroContent(
                tagline: "Climb as high as you can.",
                steps: [
                    "Answer each floor's prompt to climb the tower.",
                    "The higher you climb, the more XP.",
                ]
            )
        }
    }
}

/// Loads a game's tile art from `Resources/GameTiles/`, honouring the filename overrides
/// (e.g. `world_cup_xi` → `worldcup11.png`).
struct GameModeArtImage: View {
    let modeId: String

    var body: some View {
        if let image = loadImage() {
            Image(uiImage: image).resizable()
        } else {
            BKTheme.tileIconBackdrop
        }
    }

    private func loadImage() -> UIImage? {
        guard let url = GameModeTileArt.bundleImageURL(for: modeId) else { return nil }
        return UIImage(contentsOfFile: url.path)
    }
}

/// Consistent "how to play" screen shown before every game. Tile art on top, explanation in the
/// middle, and two ways in at the bottom: Play (shown again next time) or Play & don't show again.
struct GameIntroView: View {
    let mode: GameModeID
    var onPlay: () -> Void
    var onPlayAndHide: () -> Void
    var onClose: () -> Void

    private var content: GameIntroContent { GameIntroContent.forMode(mode) }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(BKTheme.textSecondary)
                        .frame(width: 40, height: 40)
                        .background(BKTheme.card)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 24) {
                    ZStack {
                        BKTheme.tileIconBackdrop
                        GameModeArtImage(modeId: mode.rawValue)
                            .scaledToFill()
                            // The tile PNGs sit high in their canvas; nudge the art down so it's
                            // centred nicely within the banner rather than crowding the top.
                            .offset(y: 30)
                    }
                    .frame(height: 200)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .stroke(Color.white.opacity(0.06), lineWidth: 1)
                    )

                    VStack(spacing: 8) {
                        Text(mode.title.uppercased())
                            .font(BKFont.title(26))
                            .foregroundStyle(BKTheme.textPrimary)
                            .multilineTextAlignment(.center)
                        Text(content.tagline)
                            .font(BKFont.body(16))
                            .foregroundStyle(BKTheme.accent)
                            .multilineTextAlignment(.center)
                    }

                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(Array(content.steps.enumerated()), id: \.offset) { index, step in
                            HStack(alignment: .top, spacing: 12) {
                                Text("\(index + 1)")
                                    .font(BKFont.caption(12))
                                    .foregroundStyle(BKTheme.background)
                                    .frame(width: 22, height: 22)
                                    .background(BKTheme.accent)
                                    .clipShape(Circle())
                                Text(step)
                                    .font(BKFont.body(15))
                                    .foregroundStyle(BKTheme.textSecondary)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity)
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                }
                .padding(.horizontal, 20)
                .padding(.top, 28)
                .padding(.bottom, 24)
            }

            VStack(spacing: 10) {
                Button(action: onPlay) {
                    Text("PLAY")
                        .font(BKFont.headline(16))
                        .foregroundStyle(BKTheme.background)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(BKTheme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)

                Button(action: onPlayAndHide) {
                    Text("Play & don't show this again")
                        .font(BKFont.body(14))
                        .foregroundStyle(BKTheme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BKTheme.background)
    }
}
