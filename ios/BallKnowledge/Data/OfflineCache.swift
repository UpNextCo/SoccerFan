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
