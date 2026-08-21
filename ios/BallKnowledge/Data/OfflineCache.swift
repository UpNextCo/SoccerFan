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
    /// The mode's answer inputs, JSON-encoded, so a queued completion is still server-verifiable on
    /// sync. Optional (nil for modes that don't send answers, and for rows queued by older builds).
    var answerData: Data?
    var createdAt: Date

    init(modeId: String, date: String, score: Int, guesses: Int, won: Bool, shareGrid: String, answerData: Data? = nil) {
        self.modeId = modeId
        self.date = date
        self.score = score
        self.guesses = guesses
        self.won = won
        self.shareGrid = shareGrid
        self.answerData = answerData
        self.createdAt = .now
    }
}

/// Persisted mid-game progress so a player can leave / force-close and resume where they left off.
/// One row per (modeId, date); cleared when the game is completed or the day rolls over.
@Model
final class GameProgress {
    @Attribute(.unique) var key: String   // "modeId#date"
    var modeId: String
    var date: String
    var version: Int
    var stateData: Data
    var updatedAt: Date

    init(key: String, modeId: String, date: String, version: Int, stateData: Data) {
        self.key = key
        self.modeId = modeId
        self.date = date
        self.version = version
        self.stateData = stateData
        self.updatedAt = .now
    }
}

/// Save/restore for in-progress daily games. State blobs are the game's own `…GameState` encoded as
/// JSON, tagged with a per-game `version` so an incompatible snapshot is discarded rather than crashing.
enum GameProgressStore {
    private static func key(_ modeId: String, _ date: String) -> String { "\(modeId)#\(date)" }

    static func save<T: Encodable>(_ state: T, modeId: String, date: String, version: Int, context: ModelContext) {
        guard let data = try? JSONEncoder().encode(state) else { return }
        let k = key(modeId, date)
        let existing = (try? context.fetch(FetchDescriptor<GameProgress>(predicate: #Predicate { $0.key == k }))) ?? []
        if let row = existing.first {
            row.stateData = data
            row.version = version
            row.updatedAt = .now
        } else {
            context.insert(GameProgress(key: k, modeId: modeId, date: date, version: version, stateData: data))
        }
        try? context.save()
    }

    static func load<T: Decodable>(_ type: T.Type, modeId: String, date: String, version: Int, context: ModelContext) -> T? {
        let k = key(modeId, date)
        guard let row = (try? context.fetch(FetchDescriptor<GameProgress>(predicate: #Predicate { $0.key == k })))?.first else {
            return nil
        }
        guard row.version == version, let decoded = try? JSONDecoder().decode(T.self, from: row.stateData) else {
            context.delete(row)
            try? context.save()
            return nil
        }
        return decoded
    }

    static func clear(modeId: String, date: String, context: ModelContext) {
        let k = key(modeId, date)
        let rows = (try? context.fetch(FetchDescriptor<GameProgress>(predicate: #Predicate { $0.key == k }))) ?? []
        rows.forEach { context.delete($0) }
        try? context.save()
    }

    /// Mode ids that have saved progress for `date` — drives the home "In Progress" badge.
    static func inProgressModes(date: String, context: ModelContext) -> Set<String> {
        let rows = (try? context.fetch(FetchDescriptor<GameProgress>(predicate: #Predicate { $0.date == date }))) ?? []
        return Set(rows.map(\.modeId))
    }

    /// Drop snapshots from previous days (called when today's bundle loads).
    static func clearStale(keepingDate date: String, context: ModelContext) {
        let rows = (try? context.fetch(FetchDescriptor<GameProgress>(predicate: #Predicate { $0.date != date }))) ?? []
        rows.forEach { context.delete($0) }
        try? context.save()
    }
}

/// Drop-in persistence for a game screen: writes the game's state whenever it changes (so a
/// force-close mid-move is safe) and when the app backgrounds, and clears the snapshot once the
/// game is no longer resumable (finished). Restore is done by each game on open (it must hydrate
/// its own view model). Disabled for dev replay.
private struct GameProgressPersistence<State: Codable & Equatable>: ViewModifier {
    let state: State
    let isResumable: Bool
    let modeId: String
    let date: String?
    let version: Int
    let enabled: Bool

    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .onChange(of: state) { _, _ in persist() }
            .onChange(of: scenePhase) { _, phase in if phase == .background { persist() } }
    }

    private func persist() {
        guard enabled, let date else { return }
        if isResumable {
            GameProgressStore.save(state, modeId: modeId, date: date, version: version, context: modelContext)
        } else {
            GameProgressStore.clear(modeId: modeId, date: date, context: modelContext)
        }
    }
}

extension View {
    /// See `GameProgressPersistence`. `enabled` should be `!allowReplay` so dev replays don't persist.
    func persistsGameProgress<State: Codable & Equatable>(
        _ state: State,
        isResumable: Bool,
        modeId: String,
        date: String?,
        version: Int,
        enabled: Bool
    ) -> some View {
        modifier(GameProgressPersistence(
            state: state, isResumable: isResumable, modeId: modeId, date: date, version: version, enabled: enabled
        ))
    }
}

enum OfflineCache {
    /// Remove all persisted data that belongs to the signed-in account.
    @MainActor
    static func clearAllAccountData(context: ModelContext) {
        let cachedBundles = (try? context.fetch(FetchDescriptor<CachedDailyBundle>())) ?? []
        let pendingCompletions = (try? context.fetch(FetchDescriptor<PendingDailyCompletion>())) ?? []
        let gameProgress = (try? context.fetch(FetchDescriptor<GameProgress>())) ?? []
        cachedBundles.forEach { context.delete($0) }
        pendingCompletions.forEach { context.delete($0) }
        gameProgress.forEach { context.delete($0) }
        try? context.save()
    }

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
        let answerData = request.answer.flatMap { try? JSONEncoder().encode($0) }
        context.insert(PendingDailyCompletion(
            modeId: request.modeId,
            date: request.date,
            score: request.score,
            guesses: request.guesses,
            won: request.won,
            shareGrid: request.shareGrid,
            answerData: answerData
        ))
        try context.save()
    }

    static func syncPendingCompletions(context: ModelContext) async {
        let pending = (try? context.fetch(FetchDescriptor<PendingDailyCompletion>())) ?? []
        for item in pending {
            // The server only accepts today's (or, for the midnight-rollover case, yesterday's)
            // daily — anything older can never be credited, so drop it instead of wedging the queue.
            guard let acceptable = acceptableSyncDates(), acceptable.contains(item.date) else {
                context.delete(item)
                continue
            }
            let answer = item.answerData.flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }
            do {
                _ = try await APIClient.shared.dailyComplete(DailyCompleteRequestDTO(
                    modeId: item.modeId,
                    date: item.date,
                    score: item.score,
                    guesses: item.guesses,
                    won: item.won,
                    shareGrid: item.shareGrid,
                    answer: answer
                ))
                context.delete(item)
            } catch {
                // Keep draining the rest of the queue — one failing item shouldn't wedge the others.
                continue
            }
        }
        try? context.save()
    }

    /// Local "today" and "yesterday" — mirrors the server's completion-date window.
    private static func acceptableSyncDates() -> Set<String>? {
        DailyDate.acceptableSyncDates()
    }
}

enum DailyCompletionService {
    private static let storageKey = "daily_completed_mode_ids"
    private static let xpStorageKey = "daily_completed_mode_xp"

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

    static func markLocallyCompleted(_ mode: GameModeID, date: String, xp: Int) {
        var store = UserDefaults.standard.dictionary(forKey: storageKey) as? [String: [String]] ?? [:]
        var modes = Set(store[date] ?? [])
        modes.insert(mode.rawValue)
        store[date] = Array(modes)
        UserDefaults.standard.set(store, forKey: storageKey)

        var xpStore =
            UserDefaults.standard.dictionary(forKey: xpStorageKey) as? [String: [String: Int]] ?? [:]
        var dailyXp = xpStore[date] ?? [:]
        dailyXp[mode.rawValue] = xp
        xpStore[date] = dailyXp
        UserDefaults.standard.set(xpStore, forKey: xpStorageKey)
    }

    static func locallyEarnedXp(_ mode: GameModeID, date: String) -> Int? {
        let store =
            UserDefaults.standard.dictionary(forKey: xpStorageKey) as? [String: [String: Int]] ?? [:]
        return store[date]?[mode.rawValue]
    }

    /// Wipe every locally-recorded daily completion. Call on sign-out / account deletion so one
    /// account's "games done" state never bleeds into the next account on this device.
    static func clearAllLocalCompletions() {
        UserDefaults.standard.removeObject(forKey: storageKey)
        UserDefaults.standard.removeObject(forKey: xpStorageKey)
    }

    /// Record a finished daily: lock it locally first (so it can't be replayed even offline), then
    /// POST to the server — queueing for later sync on failure. Returns the server response (XP,
    /// streak, …) when online, nil when the completion was queued offline.
    @discardableResult
    static func recordCompletion(
        modeId: String,
        date: String,
        score: Int,
        guesses: Int = 1,
        won: Bool,
        shareGrid: String = "",
        answer: JSONValue? = nil,
        context: ModelContext
    ) async -> DailyCompleteResponseDTO? {
        let normalized = GameModeCatalog.normalizedModeId(modeId)
        if let mode = GameModeID(rawValue: normalized) {
            let xp = DailyXP.xp(mode: normalized, score: score)
            markLocallyCompleted(mode, date: date, xp: xp)
            if DailyPlayOrder.playableModes.contains(mode),
               xp >= DailyXP.maxXP(mode),
               let count = PerfectScoreStore.record(mode: mode, date: date),
               let unlock = TrophyUnlockPayload.perfectScoreUnlock(mode: mode, count: count) {
                await MainActor.run {
                    NotificationCenter.default.post(name: .perfectScoreUnlocked, object: unlock)
                }
            }
        }

        let request = DailyCompleteRequestDTO(
            modeId: normalized,
            date: date,
            score: score,
            guesses: guesses,
            won: won,
            shareGrid: shareGrid,
            answer: answer
        )

        do {
            return try await APIClient.shared.dailyComplete(request)
        } catch {
            try? OfflineCache.queueCompletion(request, context: context)
            return nil
        }
    }

    private static func localCompleted(for date: String) -> Set<String> {
        let store = UserDefaults.standard.dictionary(forKey: storageKey) as? [String: [String]] ?? [:]
        return Set((store[date] ?? []).map { GameModeCatalog.normalizedModeId($0) })
    }
}

/// Lifetime perfect-score counts per daily game. One perfect per calendar date per mode.
enum PerfectScoreStore {
    static let tierCount = 6
    private static let countsKey = "perfectScoreCounts"
    private static let datesKey = "perfectScoreLastDates"

    static func count(for mode: GameModeID) -> Int {
        let store = UserDefaults.standard.dictionary(forKey: countsKey) as? [String: Int] ?? [:]
        return max(0, store[mode.rawValue] ?? 0)
    }

    /// `-1` when none earned, `5` when Ultimate is unlocked.
    static func earnedThroughIndex(for mode: GameModeID) -> Int {
        min(count(for: mode), tierCount) - 1
    }

    /// Increments once per `date` + mode. Returns the new count, or nil if already counted today.
    static func record(mode: GameModeID, date: String) -> Int? {
        var dates = UserDefaults.standard.dictionary(forKey: datesKey) as? [String: String] ?? [:]
        if dates[mode.rawValue] == date { return nil }

        var counts = UserDefaults.standard.dictionary(forKey: countsKey) as? [String: Int] ?? [:]
        let next = (counts[mode.rawValue] ?? 0) + 1
        counts[mode.rawValue] = next
        dates[mode.rawValue] = date
        UserDefaults.standard.set(counts, forKey: countsKey)
        UserDefaults.standard.set(dates, forKey: datesKey)
        return next
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: countsKey)
        UserDefaults.standard.removeObject(forKey: datesKey)
    }
}
