import Foundation

/// Shortens tower-bank prompt wording for on-screen display.
enum PromptDisplay {
    /// Football Golf: plural subject + compressed wording (many valid answers).
    static func golf(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = s.lowercased()
        if lower.hasPrefix("name an ") {
            s = String(s.dropFirst("name an ".count))
        } else if lower.hasPrefix("name a ") {
            s = String(s.dropFirst("name a ".count))
        } else {
            return compress(s)
        }

        let connectors = [" who ", " whose ", " that ", " with "]
        let boundary = connectors.compactMap { s.range(of: $0)?.lowerBound }.min()

        let subject: String
        var rest: String
        if let b = boundary {
            subject = String(s[s.startIndex..<b])
            rest = String(s[b...])
        } else {
            subject = s
            rest = ""
        }

        rest = rest.replacingOccurrences(of: " who has ", with: " who have ")
            .replacingOccurrences(of: " that has ", with: " that have ")
            .replacingOccurrences(of: " and has ", with: " and ")
            .replacingOccurrences(of: " and have ", with: " and ")

        var result = pluralizeLastWord(subject) + rest
        result = result.replacingOccurrences(of: "UEFA Champions League", with: "Champions League")
        result = result.prefix(1).uppercased() + result.dropFirst()
        return compress(result)
    }

    /// Football Tower: keep singular "Name a player…" but tighten phrasing.
    static func tower(_ raw: String) -> String {
        compress(raw.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private static func compress(_ text: String) -> String {
        var r = text

        func replaceRegex(_ pattern: String, _ template: String) {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return }
            let range = NSRange(r.startIndex..<r.endIndex, in: r)
            r = regex.stringByReplacingMatches(in: r, options: [], range: range, withTemplate: template)
        }

        // Threshold stats — keep the number attached to a verb phrase.
        replaceRegex(#"name a player who has made at least (\d+)"#, "Name a player with $1+")
        replaceRegex(#"name a player who has scored at least (\d+)"#, "Name a player with $1+")
        replaceRegex(#"(who|that) have made at least (\d+)"#, "that have $2+")
        replaceRegex(#"(who|that) have scored at least (\d+)"#, "that have $2+")
        replaceRegex(#"(who|that) made at least (\d+)"#, "that have $2+")
        replaceRegex(#"(who|that) scored at least (\d+)"#, "that have $2+")
        replaceRegex(#"(who|that) have at least (\d+)"#, "that have $2+")
        replaceRegex(#"who has made at least (\d+)"#, "with $1+")
        replaceRegex(#"who has scored at least (\d+)"#, "with $1+")
        replaceRegex(#"made at least (\d+)"#, "$1+")
        replaceRegex(#"scored at least (\d+)"#, "$1+")
        replaceRegex(#"have at least (\d+)"#, "$1+")
        replaceRegex(#"at least (\d+)"#, "$1+")
        replaceRegex(#"\bwho (\d+\+)"#, "that have $1")

        replaceRegex(#"who have played under both "#, "who played under ")
        replaceRegex(#"who have played under "#, "who played under ")
        replaceRegex(#"who has played under both "#, "who played under ")
        replaceRegex(#"who has played under "#, "who played under ")
        replaceRegex(#"who have played in the "#, "in the ")
        replaceRegex(#"who have played for both "#, "who played for ")
        replaceRegex(#"who have played for "#, "who played for ")
        replaceRegex(#"who have played with both "#, "who played with ")
        replaceRegex(#"who have played with "#, "who played with ")
        replaceRegex(#"who has played for both "#, "who played for ")
        replaceRegex(#"who has played for "#, "who played for ")
        replaceRegex(#"who has played with both "#, "who played with ")
        replaceRegex(#"who has played with "#, "who played with ")
        replaceRegex(#"who have scored in "#, "who scored in ")
        replaceRegex(#"who has scored in "#, "who scored in ")
        replaceRegex(#"who have won "#, "who won ")
        replaceRegex(#"who has won "#, "who won ")
        replaceRegex(#" who have "#, " that have ")
        replaceRegex(#" who has "#, " that has ")

        r = r.replacingOccurrences(of: "appearances", with: "apps", options: .caseInsensitive)
        r = r.replacingOccurrences(of: "played for both ", with: "played for ", options: .caseInsensitive)
        r = r.replacingOccurrences(of: "played with both ", with: "played with ", options: .caseInsensitive)
        r = r.replacingOccurrences(of: "European Championship", with: "Euro", options: .caseInsensitive)
        r = r.replacingOccurrences(of: "Africa Cup of Nations", with: "AFCON", options: .caseInsensitive)
        r = r.replacingOccurrences(of: "Europe's top-5 leagues", with: "top-5 leagues", options: .caseInsensitive)
        r = r.replacingOccurrences(of: "their whole club career at a single club", with: "one-club careers", options: .caseInsensitive)
        r = r.replacingOccurrences(of: "Champions League final", with: "CL final", options: .caseInsensitive)
        r = r.replacingOccurrences(of: "Europa League final", with: "Europa final", options: .caseInsensitive)

        while r.contains("  ") {
            r = r.replacingOccurrences(of: "  ", with: " ")
        }
        return r.trimmingCharacters(in: .whitespaces)
    }

    private static func pluralizeLastWord(_ phrase: String) -> String {
        var core = phrase
        var trailing = ""
        while let last = core.last, ".!?,".contains(last) {
            trailing = String(last) + trailing
            core.removeLast()
        }
        var words = core.split(separator: " ").map(String.init)
        guard var last = words.popLast() else { return phrase }
        if !last.lowercased().hasSuffix("s") { last += "s" }
        words.append(last)
        return words.joined(separator: " ") + trailing
    }
}
