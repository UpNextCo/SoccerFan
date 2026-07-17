import Foundation

/// Local source of truth for game mode tiles. Merges API metadata (counts, availability)
/// with on-device ids/titles so renames work before the backend is redeployed.
///
/// DEFUNCT (hidden from homepage): guessWho, worldCupXI, blindRank, footballTower — code kept elsewhere.
enum GameModeCatalog {
    private static let defaultPlayerCounts = [12400, 6400, 15200, 22100, 7600, 9800, 11300, 8900, 9200, 8700]

    private static let locallyAvailable: Set<GameModeID> = [
        .footballBingo, .targetMan, .footballGolf, .oneMore, .draftMaster, .clubChain, .lastManStanding,
    ]

    /// Maps retired API ids to their replacement mode.
    private static let legacyIdMap: [String: GameModeID] = [
        "tiki_taka_toe": .targetMan,
        "where_were_ya": .footballGolf,
        "emoji_players": .oneMore,
        "guess_the_goal": .draftMaster,
        "career_path": .footballTower,
        "tenaball": .worldCupXI,
    ]

    static func resolve(from apiModes: [GameModeMetaDTO]?) -> [GameModeMetaDTO] {
        let apiById = Dictionary(uniqueKeysWithValues: (apiModes ?? []).map { ($0.id, $0) })
        let hasRemoteCatalog = !apiById.isEmpty

        return GameModeID.allCases.enumerated().map { index, mode in
            let apiMode = apiEntry(for: mode, in: apiById)
            let isAvailable = hasRemoteCatalog
                ? (apiMode?.isAvailable ?? false)
                : locallyAvailable.contains(mode)

            return GameModeMetaDTO(
                id: mode.rawValue,
                title: apiMode?.title ?? mode.title,
                subtitle: apiMode?.subtitle ?? "",
                playerCount: apiMode?.playerCount ?? defaultPlayerCounts[index],
                isAvailable: isAvailable
            )
        }
    }

    static func normalizedModeId(_ rawId: String) -> String {
        legacyIdMap[rawId]?.rawValue ?? rawId
    }

    private static func apiEntry(
        for mode: GameModeID,
        in apiById: [String: GameModeMetaDTO]
    ) -> GameModeMetaDTO? {
        if let direct = apiById[mode.rawValue] {
            return direct
        }
        for (legacyId, mappedMode) in legacyIdMap where mappedMode == mode {
            if let legacy = apiById[legacyId] {
                return legacy
            }
        }
        return nil
    }
}
