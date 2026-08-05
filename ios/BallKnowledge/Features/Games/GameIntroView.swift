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
                   "Every square shows a category - a nationality, club, trophy or stat.",
"Tap a square that applies to the player. Skip if none fit.",
"Use Wildcard once per game to autoselect every square for that player.",
"The more players you have left when you complete the grid, the more XP.",
                ]
            )
        case .oneMore:
            return GameIntroContent(
                tagline: "Risk it for the streak.",
                steps: [
                    "Two players are shown. Pick the one who meets today's target.",
                    "Each correct answer banks XP, but one wrong answer ends your run.",
                    "Cash out whenever you like, or push your luck for more XP.",
                ]
            )
        case .draftMaster:
            return GameIntroContent(
                tagline: "Build the highest-scoring XI.",
                steps: [
                    "Drag the tiles onto the positions on the pitch.",
                    "Pick a player for each position who matches the tile and scores highly in today's category.",
                    "The closer you get to the perfect XI, the more XP.",
                ]
            )
        case .worldCupXI:
            return GameIntroContent(
                tagline: "Name the mystery World Cup XI.",
                steps: [
                    "Each position has a clue pointing to one specific World Cup player.",
                    "Answer as many questions as you can.",
                    "Every correct pick adds XP.",
                ]
            )
        case .footballGolf:
            return GameIntroContent(
                tagline: "Five holes. Beat par.",
                steps: [
                    "Each hole has a prompt, a point target (max 4), and a stroke par.",
                    "Common names score 1 pt — clearing usually means a few household picks.",
                    "Rarer answers score more and can save shots. Finish under par for birdies and big XP.",
                ]
            )
        case .clubChain:
            return GameIntroContent(
                tagline: "Link them by shared clubs.",
                steps: [
                    "Connect the two players through a chain of real teammates.",
                    "Each step must be two players who shared a club at the same time.",
                    "You get three lives — wrong guesses cost a heart and XP. Fewer steps earn a better medal.",
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
        case .lastManStanding:
            return GameIntroContent(
                tagline: "Outlast the field.",
                steps: [
                    "100 anonymous entrants. One of them is you.",
                    "Answer 10 football questions — one wrong answer and you're out.",
                    "Survive every round to be the Last Man Standing.",
                ]
            )
        case .backYourself:
            return GameIntroContent(
                tagline: "Pledge how many you can name.",
                steps: [
                    "See today's category — managed by, WC squads, club combos, awards, and more.",
                    "Set your pledge — XP scales up to the Max XP threshold (extra names still count for the win).",
                    "Search and name that many players with three lives. Miss the pledge and you get 0 XP.",
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
        .background(StadiumBackground())
    }
}
