import SwiftUI
import SwiftData

@Model
final class CachedDailyBundle {
    @Attribute(.unique) var date: String
    var jsonData: Data
    var fetchedAt: Date

    init(date: String, jsonData: Data, fetchedAt: Date = .now) {
        self.date = date
        self.jsonData = jsonData
        self.fetchedAt = fetchedAt
    }
}

@Model
final class PendingDailyCompletion {
    var modeId: String
    var date: String
    var score: Int
    var guesses: Int
    var won: Bool
    var shareGrid: String
    var createdAt: Date

    init(modeId: String, date: String, score: Int, guesses: Int, won: Bool, shareGrid: String) {
        self.modeId = modeId
        self.date = date
        self.score = score
        self.guesses = guesses
        self.won = won
        self.shareGrid = shareGrid
        self.createdAt = .now
    }
}

@Model
final class GuessWhoSession {
    @Attribute(.unique) var puzzleId: String
    var stateData: Data
    var updatedAt: Date

    init(puzzleId: String, stateData: Data) {
        self.puzzleId = puzzleId
        self.stateData = stateData
        self.updatedAt = .now
    }
}

enum OfflineCache {
    static func saveDailyBundle(_ bundle: DailyBundleDTO, context: ModelContext) throws {
        let data = try JSONEncoder().encode(bundle)
        let existing = try context.fetch(FetchDescriptor<CachedDailyBundle>(
            predicate: #Predicate { $0.date == bundle.date }
        ))
        existing.forEach { context.delete($0) }
        context.insert(CachedDailyBundle(date: bundle.date, jsonData: data))
        try context.save()
    }

    static func loadDailyBundle(date: String, context: ModelContext) throws -> DailyBundleDTO? {
        let rows = try context.fetch(FetchDescriptor<CachedDailyBundle>(
            predicate: #Predicate { $0.date == date }
        ))
        guard let row = rows.first else { return nil }
        return try JSONDecoder().decode(DailyBundleDTO.self, from: row.jsonData)
    }

    static func queueCompletion(_ request: DailyCompleteRequestDTO, context: ModelContext) throws {
        context.insert(PendingDailyCompletion(
            modeId: request.modeId,
            date: request.date,
            score: request.score,
            guesses: request.guesses,
            won: request.won,
            shareGrid: request.shareGrid
        ))
        try context.save()
    }

    static func syncPendingCompletions(context: ModelContext) async {
        let pending = (try? context.fetch(FetchDescriptor<PendingDailyCompletion>())) ?? []
        for item in pending {
            do {
                _ = try await APIClient.shared.dailyComplete(DailyCompleteRequestDTO(
                    modeId: item.modeId,
                    date: item.date,
                    score: item.score,
                    guesses: item.guesses,
                    won: item.won,
                    shareGrid: item.shareGrid
                ))
                context.delete(item)
            } catch {
                break
            }
        }
        try? context.save()
    }
}

enum DailyCompletionService {
    private static let storageKey = "daily_completed_mode_ids"

    static func completedSet(for bundle: DailyBundleDTO) -> Set<String> {
        var ids = Set(bundle.completedModeIds.map { GameModeCatalog.normalizedModeId($0) })
        ids.formUnion(localCompleted(for: bundle.date))
        return ids
    }

    static func isCompleted(_ mode: GameModeID, for bundle: DailyBundleDTO) -> Bool {
        completedSet(for: bundle).contains(mode.rawValue)
    }

    static func isLocallyCompleted(_ mode: GameModeID, date: String) -> Bool {
        localCompleted(for: date).contains(mode.rawValue)
    }

    static func markLocallyCompleted(_ mode: GameModeID, date: String) {
        var store = UserDefaults.standard.dictionary(forKey: storageKey) as? [String: [String]] ?? [:]
        var modes = Set(store[date] ?? [])
        modes.insert(mode.rawValue)
        store[date] = Array(modes)
        UserDefaults.standard.set(store, forKey: storageKey)
    }

    static func recordCompletion(
        modeId: String,
        date: String,
        score: Int,
        guesses: Int = 1,
        won: Bool,
        shareGrid: String = "",
        context: ModelContext
    ) async {
        let normalized = GameModeCatalog.normalizedModeId(modeId)
        if let mode = GameModeID(rawValue: normalized) {
            markLocallyCompleted(mode, date: date)
        }

        let request = DailyCompleteRequestDTO(
            modeId: normalized,
            date: date,
            score: score,
            guesses: guesses,
            won: won,
            shareGrid: shareGrid
        )

        do {
            _ = try await APIClient.shared.dailyComplete(request)
        } catch {
            try? queueCompletion(request, context: context)
        }
    }

    private static func localCompleted(for date: String) -> Set<String> {
        let store = UserDefaults.standard.dictionary(forKey: storageKey) as? [String: [String]] ?? [:]
        return Set((store[date] ?? []).map { GameModeCatalog.normalizedModeId($0) })
    }
}
