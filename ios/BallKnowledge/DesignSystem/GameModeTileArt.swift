import SwiftUI
import UIKit

enum GameModeTileArt {
    /// Drop `{modeId}.png` into `Resources/GameTiles/` — no Asset Catalog or xcodegen change needed.
    /// Filenames match `GameModeID.rawValue`, e.g. `guess_who.png`, `football_bingo.png`.
    static func bundleImageName(for modeId: String) -> String? {
        let resolvedId = GameModeCatalog.normalizedModeId(modeId)
        return bundleImageURL(for: resolvedId) != nil ? resolvedId : nil
    }

    static func bundleImageURL(for name: String) -> URL? {
        let extensions = ["png", "PNG", "jpg", "jpeg"]

        for ext in extensions {
            if let url = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "GameTiles") {
                return url
            }
            if let url = Bundle.main.url(forResource: name, withExtension: ext) {
                return url
            }
            if let path = Bundle.main.path(forResource: name, ofType: ext, inDirectory: "GameTiles") {
                return URL(fileURLWithPath: path)
            }
        }

        // Folder-reference copy (blue folder in Xcode) — most reliable for drop-in tiles.
        if let resourcePath = Bundle.main.resourcePath {
            for ext in extensions {
                let path = (resourcePath as NSString).appendingPathComponent("GameTiles/\(name).\(ext)")
                if FileManager.default.fileExists(atPath: path) {
                    return URL(fileURLWithPath: path)
                }
            }
        }

        return nil
    }

    /// Drop `{name}.png` into `Resources/` — used for the home hero banner, etc.
    static func bundleResourceURL(for name: String, subdirectory: String = "Resources") -> URL? {
        let extensions = ["png", "PNG", "jpg", "jpeg"]

        for ext in extensions {
            if let url = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: subdirectory) {
                return url
            }
            if let url = Bundle.main.url(forResource: name, withExtension: ext) {
                return url
            }
            if let path = Bundle.main.path(forResource: name, ofType: ext, inDirectory: subdirectory) {
                return URL(fileURLWithPath: path)
            }
        }

        if let resourcePath = Bundle.main.resourcePath {
            for ext in extensions {
                for relativePath in ["\(subdirectory)/\(name).\(ext)", "\(name).\(ext)"] {
                    let path = (resourcePath as NSString).appendingPathComponent(relativePath)
                    if FileManager.default.fileExists(atPath: path) {
                        return URL(fileURLWithPath: path)
                    }
                }
            }
        }

        return nil
    }
}

struct BundleResourceImage: View {
    let name: String
    var subdirectory: String = "Resources"

    var body: some View {
        if let image = loadImage() {
            Image(uiImage: image)
                .resizable()
        }
    }

    private func loadImage() -> UIImage? {
        guard let url = GameModeTileArt.bundleResourceURL(for: name, subdirectory: subdirectory),
              let image = UIImage(contentsOfFile: url.path) else {
            return nil
        }
        return image
    }
}

struct GameModeBundleImage: View {
    let name: String

    var body: some View {
        if let image = loadImage() {
            Image(uiImage: image)
                .resizable()
        }
    }

    private func loadImage() -> UIImage? {
        guard let url = GameModeTileArt.bundleImageURL(for: name),
              let image = UIImage(contentsOfFile: url.path) else {
            return nil
        }
        return image
    }
}
