import Foundation

enum OneMoreSeed {
    /// Build the daily prompt from the server-generated puzzle. The server embeds the full set
    /// of binary rounds (each with two options + their real stat values), so play is offline-safe
    /// once the bundle is cached. nil when the puzzle is malformed/too thin — the daily is
    /// server-only (no local fallback), so the caller shows "unavailable".
    static func makeServerPrompt(from dto: OneMorePuzzleDTO) -> OneMorePrompt? {
        let rounds = dto.rounds.compactMap { round -> OneMoreRound? in
            guard round.options.count == 2 else { return nil }
            return OneMoreRound(options: round.options.map {
                OneMoreOption(
                    id: $0.id,
                    name: $0.name,
                    clubs: $0.clubs,
                    position: $0.position,
                    nationality: $0.nationality,
                    value: $0.value,
                    headshotUrl: $0.headshotUrl,
                    teamId: $0.teamId,
                    teamLogoUrl: $0.teamLogoUrl,
                    valueRevealed: $0.value > 0
                )
            })
        }
        guard rounds.count >= 3 else { return nil }
        return OneMorePrompt(
            id: dto.puzzleId,
            metricTitle: dto.title,
            valueNoun: dto.valueNoun,
            minimum: dto.minimum,
            compareMode: dto.compareMode,
            rounds: rounds,
            isDaily: true,
            date: dto.date
        )
    }
}
