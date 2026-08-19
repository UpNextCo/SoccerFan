import Foundation

extension Notification.Name {
    /// Posted whenever a daily completion is successfully recorded on the server, so any surface
    /// showing XP / games-completed (e.g. Home) can refresh once the write has actually landed.
    static let dailyCompletionRecorded = Notification.Name("dailyCompletionRecorded")
    static let sessionUnauthorized = Notification.Name("sessionUnauthorized")
}

enum APIError: LocalizedError {
    case invalidResponse
    case server(String)
    case unauthorized
    /// The token is well-formed but its account is gone (deleted account, wiped database). Distinct
    /// from `.unauthorized` only so callers can word it differently — both mean "sign in again".
    case accountMissing

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Invalid server response"
        case .server(let msg): return msg
        case .unauthorized: return "Please sign in again"
        case .accountMissing: return "Your account is no longer available. Please sign in again."
        }
    }
}

actor APIClient {
    static let shared = APIClient()

    private var token: String? { KeychainHelper.loadToken() }

    func setToken(_ token: String) {
        KeychainHelper.saveToken(token)
    }

    func clearToken() {
        KeychainHelper.deleteToken()
    }

    func hasToken() -> Bool {
        token != nil
    }

    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        queryItems: [URLQueryItem]? = nil,
        body: Encodable? = nil,
        authorized: Bool = true,
        // Set on account-scoped reads: a 404 there means the account itself is gone, so the session
        // must be torn down rather than reported as a transient failure.
        signedOutOnNotFound: Bool = false
    ) async throws -> T {
        var components = URLComponents(
            url: AppConfig.apiBaseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )!
        if let queryItems, !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        guard let url = components.url else {
            throw APIError.invalidResponse
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if authorized, let token {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            urlRequest.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }

        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if http.statusCode == 401 {
            await MainActor.run {
                NotificationCenter.default.post(name: .sessionUnauthorized, object: nil)
            }
            throw APIError.unauthorized
        }

        guard (200..<300).contains(http.statusCode) else {
            let decoded = try? JSONDecoder().decode(APIResponse<T>.self, from: data)
            if decoded?.error?.code == "USER_NOT_FOUND" || (http.statusCode == 404 && signedOutOnNotFound) {
                await MainActor.run {
                    NotificationCenter.default.post(name: .sessionUnauthorized, object: nil)
                }
                throw APIError.accountMissing
            }
            if let error = decoded?.error {
                throw APIError.server(error.message)
            }
            throw APIError.server("The server is unavailable. Please try again.")
        }

        let decoded = try JSONDecoder().decode(APIResponse<T>.self, from: data)
        if let error = decoded.error {
            throw APIError.server(error.message)
        }
        guard let result = decoded.data else {
            throw APIError.invalidResponse
        }
        return result
    }

    /// Like `request`, but allows `data: null` (used by VS active challenge).
    private func requestOptional<T: Decodable>(
        _ path: String,
        method: String = "GET",
        queryItems: [URLQueryItem]? = nil,
        body: Encodable? = nil,
        authorized: Bool = true
    ) async throws -> T? {
        var components = URLComponents(
            url: AppConfig.apiBaseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )!
        if let queryItems, !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        guard let url = components.url else {
            throw APIError.invalidResponse
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if authorized, let token {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            urlRequest.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }

        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if http.statusCode == 401 {
            await MainActor.run {
                NotificationCenter.default.post(name: .sessionUnauthorized, object: nil)
            }
            throw APIError.unauthorized
        }

        guard (200..<300).contains(http.statusCode) else {
            let decoded = try? JSONDecoder().decode(APIResponse<T>.self, from: data)
            if let error = decoded?.error {
                throw APIError.server(error.message)
            }
            throw APIError.server("The server is unavailable. Please try again.")
        }

        let decoded = try JSONDecoder().decode(APIResponse<T>.self, from: data)
        if let error = decoded.error {
            throw APIError.server(error.message)
        }
        return decoded.data
    }

    func authApple(identityToken: String, displayName: String?) async throws -> AuthResponseDTO {
        try await request(
            "auth/apple",
            method: "POST",
            body: AuthAppleRequestDTO(identityToken: identityToken, displayName: displayName),
            authorized: false
        )
    }

    func me(localDate: String? = nil) async throws -> UserProfileDTO {
        let date = localDate ?? DailyDate.localToday()
        return try await request(
            "auth/me",
            queryItems: [URLQueryItem(name: "date", value: date)],
            signedOutOnNotFound: true
        )
    }

    func xpByMode(localDate: String? = nil) async throws -> XpByModeResponseDTO {
        let date = localDate ?? DailyDate.localToday()
        return try await request("auth/me/xp-by-mode", queryItems: [URLQueryItem(name: "date", value: date)])
    }

    func updateDisplayName(_ displayName: String) async throws -> UserProfileDTO {
        struct Body: Encodable { let displayName: String }
        return try await request("auth/me", method: "PATCH", body: Body(displayName: displayName))
    }

    func uploadAvatar(jpegData: Data) async throws -> UserProfileDTO {
        struct Body: Encodable { let jpegBase64: String }
        return try await request(
            "auth/me/avatar",
            method: "PUT",
            body: Body(jpegBase64: jpegData.base64EncodedString())
        )
    }

    func clearAvatar() async throws -> UserProfileDTO {
        struct Body: Encodable { let clear: Bool }
        return try await request("auth/me/avatar", method: "PUT", body: Body(clear: true))
    }

    func deleteAccount() async throws {
        struct DeleteResponse: Decodable { let deleted: Bool }
        let _: DeleteResponse = try await request("auth/me", method: "DELETE")
    }

    func dailyToday(localDate: String? = nil) async throws -> DailyBundleDTO {
        let date = localDate ?? DailyDate.localToday()
        return try await request("daily/today", queryItems: [URLQueryItem(name: "date", value: date)])
    }

    func dailyComplete(_ body: DailyCompleteRequestDTO) async throws -> DailyCompleteResponseDTO {
        let response: DailyCompleteResponseDTO = try await request("daily/complete", method: "POST", body: body)
        await MainActor.run {
            NotificationCenter.default.post(name: .dailyCompletionRecorded, object: response)
        }
        return response
    }

    func dailyGuess(_ body: DailyGuessRequestDTO) async throws -> GuessResultDTO {
        try await request("daily/guess", method: "POST", body: body)
    }

    func revealGuessWhoAnswer(date: String) async throws -> GuessWhoAnswerDTO {
        try await request("daily/guesswho/answer", queryItems: [URLQueryItem(name: "date", value: date)])
    }

    func guessWhoHint(date: String, known: [String]) async throws -> GuessWhoHintDTO {
        struct Body: Encodable { let date: String; let known: [String] }
        return try await request("daily/guesswho/hint", method: "POST", body: Body(date: date, known: known))
    }

    func validateTowerAnswer(date: String, floor: Int, answerType: String, value: String) async throws -> Bool {
        struct Body: Encodable {
            let date: String
            let floor: Int
            let answerType: String
            let value: String
        }
        struct Resp: Decodable { let correct: Bool }
        let resp: Resp = try await request(
            "daily/tower/validate",
            method: "POST",
            body: Body(date: date, floor: floor, answerType: answerType, value: value)
        )
        return resp.correct
    }

    func validateOneMoreAnswer(date: String, playerId: String) async throws -> (valid: Bool, statValue: Int) {
        struct Body: Encodable {
            let date: String
            let playerId: String
        }
        struct Resp: Decodable {
            let valid: Bool
            let statValue: Int
        }
        let resp: Resp = try await request(
            "daily/onemore/validate",
            method: "POST",
            body: Body(date: date, playerId: playerId)
        )
        return (resp.valid, resp.statValue)
    }

    /// Validate a Club Chain move. Returns the shared-club link between `fromId` and `toId` (nil if
    /// they were never club teammates), plus — when `targetId` is supplied — whether `toId` also
    /// links to the target (a winning move) in the same round-trip.
    func clubChainLink(fromId: String, toId: String, targetId: String?) async throws -> ClubChainLinkResultDTO {
        struct Body: Encodable { let fromId: String; let toId: String; let targetId: String? }
        return try await request(
            "daily/clubchain/link",
            method: "POST",
            body: Body(fromId: fromId, toId: toId, targetId: targetId)
        )
    }

    /// Validate a Back Yourself pick against today's category. Wrong fits cost a life on the client.
    func darts501Throw(
        date: String,
        playerId: String,
        alreadyUsedIds: [String]
    ) async throws -> Darts501ThrowResultDTO {
        struct Body: Encodable {
            let date: String
            let playerId: String
            let alreadyUsedIds: [String]
        }
        return try await request(
            "daily/darts501/throw",
            method: "POST",
            body: Body(date: date, playerId: playerId, alreadyUsedIds: alreadyUsedIds)
        )
    }

    func backYourselfGuess(
        date: String,
        playerId: String,
        alreadyNamedIds: [String]
    ) async throws -> BackYourselfGuessResultDTO {
        struct Body: Encodable {
            let date: String
            let playerId: String
            let alreadyNamedIds: [String]
        }
        return try await request(
            "daily/backyourself/guess",
            method: "POST",
            body: Body(date: date, playerId: playerId, alreadyNamedIds: alreadyNamedIds)
        )
    }

    func lastManStandingStart(date: String, resumePicks: [String] = []) async throws -> LMSStartResultDTO {
        struct Body: Encodable {
            let date: String
            let resumePicks: [String]
        }
        return try await request(
            "daily/lms/start",
            method: "POST",
            body: Body(date: date, resumePicks: resumePicks)
        )
    }

    func lastManStandingCheck(date: String, token: String, optionId: String) async throws -> LMSCheckResultDTO {
        struct Body: Encodable {
            let date: String
            let token: String
            let optionId: String
        }
        return try await request(
            "daily/lms/check",
            method: "POST",
            body: Body(date: date, token: token, optionId: optionId)
        )
    }

    func oneMoreStart(date: String, resumePicks: [String] = []) async throws -> OneMoreStartResultDTO {
        struct Body: Encodable {
            let date: String
            let resumePicks: [String]
        }
        return try await request(
            "daily/onemore/start",
            method: "POST",
            body: Body(date: date, resumePicks: resumePicks)
        )
    }

    func oneMoreCheck(date: String, token: String, optionId: String) async throws -> OneMoreCheckResultDTO {
        struct Body: Encodable {
            let date: String
            let token: String
            let optionId: String
        }
        return try await request(
            "daily/onemore/check",
            method: "POST",
            body: Body(date: date, token: token, optionId: optionId)
        )
    }

    func battlePlayers(categoryId: String, constraint: BattleConstraint, position: String, query: String) async throws -> [BattlePlayerDTO] {
        struct ConstraintBody: Encodable {
            let type: String
            let club: String?
            let leagueId: Int?
            let nationality: String?
        }
        struct Body: Encodable {
            let categoryId: String
            let constraint: ConstraintBody
            let position: String
            let q: String
        }
        return try await request(
            "daily/battle/players",
            method: "POST",
            body: Body(
                categoryId: categoryId,
                constraint: ConstraintBody(
                    type: constraint.type.rawValue,
                    club: constraint.club,
                    leagueId: constraint.leagueId,
                    nationality: constraint.nationality
                ),
                position: position,
                q: query
            )
        )
    }

    func searchPlayers(
        query: String,
        currentTop5: Bool = false,
        nationality: String? = nil,
        club: String? = nil,
        teamId: Int? = nil
    ) async throws -> [PlayerSearchResultDTO] {
        var items = [URLQueryItem(name: "q", value: query)]
        if currentTop5 {
            items.append(URLQueryItem(name: "currentTop5", value: "1"))
        }
        if let nationality, !nationality.isEmpty {
            items.append(URLQueryItem(name: "nationality", value: nationality))
        }
        if let club, !club.isEmpty {
            items.append(URLQueryItem(name: "club", value: club))
        }
        if let teamId {
            items.append(URLQueryItem(name: "teamId", value: String(teamId)))
        }
        return try await request("players/search", queryItems: items)
    }

    func teamLogo(club: String, league: String) async -> TeamLogoDTO? {
        let trimmedClub = club.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedClub.isEmpty else { return nil }

        do {
            return try await request(
                "teams/logo",
                queryItems: [
                    URLQueryItem(name: "club", value: trimmedClub),
                    URLQueryItem(name: "league", value: league.trimmingCharacters(in: .whitespacesAndNewlines)),
                ]
            )
        } catch {
            return nil
        }
    }

    struct TargetManPlayerValue {
        let value: Int
        let inPool: Bool
    }

    func targetManValues(
        categoryId: String,
        playerIds: [String],
        pool: TargetManPoolDTO? = nil
    ) async throws -> [String: TargetManPlayerValue] {
        struct Body: Encodable {
            let categoryId: String
            let playerIds: [String]
            let pool: TargetManPoolDTO?
        }
        struct Entry: Decodable {
            let id: String
            let value: Int
            let inPool: Bool?
        }
        struct Resp: Decodable { let values: [Entry] }
        let resp: Resp = try await request(
            "players/target-values",
            method: "POST",
            body: Body(categoryId: categoryId, playerIds: playerIds, pool: pool)
        )
        return Dictionary(
            resp.values.map { ($0.id, TargetManPlayerValue(value: $0.value, inPool: $0.inPool ?? true)) },
            uniquingKeysWith: { a, _ in a }
        )
    }

    func targetManPoolMatch(
        playerIds: [String],
        pool: TargetManPoolDTO
    ) async throws -> [String: Bool] {
        struct Body: Encodable {
            let playerIds: [String]
            let pool: TargetManPoolDTO
        }
        struct Entry: Decodable { let id: String; let inPool: Bool }
        struct Resp: Decodable { let matches: [Entry] }
        let resp: Resp = try await request(
            "players/target-pool-match",
            method: "POST",
            body: Body(playerIds: playerIds, pool: pool)
        )
        return Dictionary(resp.matches.map { ($0.id, $0.inPool) }, uniquingKeysWith: { a, _ in a })
    }

    func getPlayerCareerStats(playerId: String, league: TargetManLeague) async throws -> PlayerCareerStatsDTO {
        try await getPlayerCareerStats(playerId: playerId, leagueId: league.apiLeagueId)
    }

    func getPlayerCareerStats(playerId: String, leagueId: Int) async throws -> PlayerCareerStatsDTO {
        try await request(
            "players/\(playerId)/stats/career",
            queryItems: [URLQueryItem(name: "leagueId", value: String(leagueId))]
        )
    }

    func getTopStats(
        leagueId: Int,
        metric: CareerStatMetric,
        min: Int,
        limit: Int = 50
    ) async throws -> [TopStatPlayerDTO] {
        try await request(
            "stats/top",
            queryItems: [
                URLQueryItem(name: "leagueId", value: String(leagueId)),
                URLQueryItem(name: "metric", value: metric.rawValue),
                URLQueryItem(name: "min", value: String(min)),
                URLQueryItem(name: "limit", value: String(limit)),
            ]
        )
    }

    func getTopStats(
        league: TargetManLeague,
        metric: CareerStatMetric,
        min: Int,
        limit: Int = 50
    ) async throws -> [TopStatPlayerDTO] {
        try await getTopStats(leagueId: league.apiLeagueId, metric: metric, min: min, limit: limit)
    }

    /// Kept for existing call sites; prefer `getPlayerCareerStats`.
    func playerCareerStats(playerId: String, league: TargetManLeague) async throws -> PlayerCareerStatsDTO {
        try await getPlayerCareerStats(playerId: playerId, league: league)
    }

    func gameModes() async throws -> [GameModeMetaDTO] {
        try await request("games")
    }

    func leaguesMe() async throws -> MyLeagueDTO {
        try await request("leagues/me")
    }

    func leaguesWeekly() async throws -> PlayerStandingsDTO {
        try await request("leagues/weekly")
    }

    func leaguesOverall() async throws -> PlayerStandingsDTO {
        try await request("leagues/overall")
    }

    func leaguesDaily(localDate: String? = nil) async throws -> PlayerStandingsDTO {
        let date = localDate ?? DailyDate.localToday()
        return try await request("leagues/daily", queryItems: [URLQueryItem(name: "date", value: date)])
    }

    func leaguePlayerXpByMode(userId: String, localDate: String? = nil) async throws -> XpByModeResponseDTO {
        let date = localDate ?? DailyDate.localToday()
        return try await request(
            "leagues/players/\(userId)/xp-by-mode",
            queryItems: [URLQueryItem(name: "date", value: date)]
        )
    }

    func leaguesTeams() async throws -> TeamStandingsDTO {
        try await request("leagues/teams")
    }

    func leagueTeamFans(teamId: Int) async throws -> TeamFansDTO {
        try await request("leagues/teams/\(teamId)")
    }

    func searchTeams(query: String) async throws -> [TeamSearchResultDTO] {
        try await request("teams/search", queryItems: [URLQueryItem(name: "q", value: query)])
    }

    func setFavoriteTeam(_ teamId: Int?) async throws {
        struct TeamBody: Encodable { let teamId: Int? }
        struct TeamResult: Decodable { let favoriteTeamId: Int? }
        let _: TeamResult = try await request("leagues/team", method: "PUT", body: TeamBody(teamId: teamId))
    }

    // MARK: VS

    func vsCreate(modeId: String) async throws -> VsChallengeDTO {
        struct Body: Encodable { let modeId: String }
        return try await request("vs/create", method: "POST", body: Body(modeId: modeId))
    }

    func vsJoin(code: String) async throws -> VsChallengeDTO {
        struct Body: Encodable { let code: String }
        return try await request("vs/join", method: "POST", body: Body(code: code))
    }

    func vsReshuffle(id: String) async throws -> VsChallengeDTO {
        try await request("vs/\(id)/reshuffle", method: "POST", body: EmptyBody())
    }

    func vsStart(id: String) async throws -> VsChallengeDTO {
        try await request("vs/\(id)/start", method: "POST", body: EmptyBody())
    }

    func vsActive() async throws -> VsChallengeDTO? {
        try await requestOptional("vs/active")
    }

    func vsGet(id: String) async throws -> VsChallengeDTO {
        try await request("vs/\(id)")
    }

    func vsSubmit(id: String, answer: JSONValue) async throws -> VsChallengeDTO {
        try await request("vs/\(id)/submit", method: "POST", body: VsSubmitRequestDTO(answer: answer))
    }

    func vsLock(id: String, slotId: String, constraintId: String, playerId: String) async throws -> VsChallengeDTO {
        try await request("vs/\(id)/lock", method: "POST", body: VsPickDTO(slotId: slotId, constraintId: constraintId, playerId: playerId))
    }

    func vsName(id: String, playerId: String) async throws -> VsChallengeDTO {
        struct Body: Encodable { let playerId: String }
        return try await request("vs/\(id)/name", method: "POST", body: Body(playerId: playerId))
    }

    func vsTargetPick(id: String, playerId: String) async throws -> VsChallengeDTO {
        struct Body: Encodable { let playerId: String }
        return try await request("vs/\(id)/target", method: "POST", body: Body(playerId: playerId))
    }

    func vsDartsThrow(id: String, playerId: String) async throws -> VsChallengeDTO {
        struct Body: Encodable { let playerId: String }
        return try await request("vs/\(id)/darts", method: "POST", body: Body(playerId: playerId))
    }

    func vsGiveUp(id: String) async throws -> VsChallengeDTO {
        try await request("vs/\(id)/giveup", method: "POST", body: EmptyBody())
    }

    func vsCancel(id: String) async throws -> VsLeaveDTO {
        try await request("vs/\(id)/cancel", method: "POST", body: EmptyBody())
    }

    func vsLeave(id: String) async throws -> VsLeaveDTO {
        try await request("vs/\(id)/leave", method: "POST", body: EmptyBody())
    }
}

private struct EmptyBody: Encodable {}

private struct AnyEncodable: Encodable {
    private let encodeFunc: (Encoder) throws -> Void

    init(_ wrapped: Encodable) {
        encodeFunc = wrapped.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeFunc(encoder)
    }
}
